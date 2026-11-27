/**
 * Local mock of the Roots API, built from the public docs (core concepts, idempotency,
 * transfers, reconciliation, errors, test scenarios). It lets the suite run with no API key.
 *
 * It is a simulation, not the real thing. Fee amounts and timings are invented.
 * Run the same tests against the real sandbox with ROOTS_TARGET=sandbox.
 */
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const STEP_MS = Number(process.env.MOCK_STEP_MS ?? 100);
const SETTLE_MS = Number(process.env.MOCK_SETTLE_MS ?? 300);
const LOCK_MS = 60; // simulated processing time while a transfer holds its account locks

const CLIENTS: Record<string, string> = {
  rts_live_mock_client_a: 'client_a',
  rts_live_mock_client_b: 'client_b',
};
const FEES: Record<string, bigint> = { internal: 0n, ach: 25n, sameday_ach: 100n, fedwire: 1500n }; // mock values

// ---------- state ----------
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`;
const now = () => new Date().toISOString();
const persons = new Map<string, any>();
const accounts = new Map<string, any>();
const counterparties = new Map<string, any>();
const transfers = new Map<string, any>();
const ledger: any[] = [];
const documents: any[] = [];
const holds = new Map<string, { accountId: string; amount: bigint }>(); // transferId -> active hold
const idem = new Map<string, { compare: string; done: boolean; status?: number; body?: any }>();
const locks = new Set<string>();

// ---------- helpers ----------
type Result = { status: number; body?: any; headers?: Record<string, string> };
class ApiError extends Error {
  constructor(public status: number, public code: string, public detail: string, public violations?: any[]) { super(detail); }
}
const fail = (status: number, code: string, detail: string, violations?: any[]): never => { throw new ApiError(status, code, detail, violations); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function owned<T extends { client: string }>(map: Map<string, T>, key: string, client: string, what: string): T {
  const v = map.get(key);
  if (!v || v.client !== client) fail(404, 'not_found', `${what} not found`); // other clients' ids look like missing ids
  return v!;
}
const strip = ({ client, ...rest }: any) => rest;

const FLOWS: Record<string, string> = { principal: 'principal', fee: 'fee_charge', hold: 'hold_place', release: 'hold_release' };
function addEntry(accountId: string, transferId: string | null, type: string, amount: bigint, reason: string | null = null) {
  const t = now();
  ledger.push({ id: id('txn'), account_id: accountId, transfer_id: transferId, type, flow: FLOWS[type], amount_minor: amount.toString(), currency: 'usd', reason, occurred_at: t, posted_at: t, rail_refs: {}, bank_ref: null });
}

/** Page envelope used by every list endpoint: {data, page, page_size, total}. */
function paginate(rows: any[], q: URLSearchParams) {
  const page = Number(q.get('page') ?? 1), size = Number(q.get('page_size') ?? 20);
  const v: any[] = [];
  if (!Number.isInteger(page) || page < 1) v.push({ path: 'page', code: 'invalid' });
  if (!Number.isInteger(size) || size < 1 || size > 100) v.push({ path: 'page_size', code: 'invalid', message: 'between 1 and 100' });
  if (v.length) fail(422, 'validation', 'Request validation failed', v);
  return { data: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length };
}

function balance(accountId: string) {
  let current = 0n, held = 0n, inbound = 0n;
  for (const e of ledger) if (e.account_id === accountId && (e.type === 'principal' || e.type === 'fee')) current += BigInt(e.amount_minor);
  for (const h of holds.values()) if (h.accountId === accountId) held += h.amount;
  for (const t of transfers.values()) if (t.direction === 'deposit' && t.status === 'pending' && t.destination.id === accountId) inbound += BigInt(t.amount_minor);
  return { available_minor: (current - held).toString(), pending_minor: (held + inbound).toString(), current_minor: current.toString(), _held: held };
}

function accountView(a: any) {
  const { _held, ...bal } = balance(a.id);
  const cap = a.status === 'active' ? 'active' : a.status === 'pending' ? 'pending' : 'inactive';
  return { ...strip(a), capabilities: { send: cap, receive: cap }, balance: bal };
}

function placeHold(t: any, accountId: string, amount: bigint) { holds.set(t.id, { accountId, amount }); addEntry(accountId, t.id, 'hold', -amount); }
function releaseHold(t: any) { const h = holds.get(t.id); if (h) { holds.delete(t.id); addEntry(h.accountId, t.id, 'release', h.amount); } }
function consumeHold(t: any) { holds.delete(t.id); } // the principal entry now removes the money

function setStatus(t: any, status: string, extra: Record<string, unknown> = {}) {
  const stamp = `${status}_at`;
  Object.assign(t, { status, ...extra });
  if (stamp in t && t[stamp] === null) t[stamp] = now(); // timestamps are set once, never cleared
}

// ---------- transfer lifecycle (async, like the real rails) ----------
function failTransfer(t: any, code: string, message: string) {
  releaseHold(t);
  setStatus(t, 'failed', { status_detail: null, cancelable: false, failure: { code, message, return_code: null, return_description: null } });
}

function settle(t: any) {
  const src = t.source.id;
  consumeHold(t);
  addEntry(src, t.id, 'principal', -BigInt(t.amount_minor));
  if (t.direction === 'internal') addEntry(t.destination.id, t.id, 'principal', BigInt(t.amount_minor));
  if (BigInt(t.fee_quoted_minor) > 0n) { addEntry(src, t.id, 'fee', -BigInt(t.fee_quoted_minor), `${t.rail}_withdrawal`); t.fee_charged_minor = t.fee_quoted_minor; }
  setStatus(t, 'settled', { status_detail: null, cancelable: false });
}

function returnTransfer(t: any, code: string) {
  if (t.direction === 'withdrawal') addEntry(t.source.id, t.id, 'principal', BigInt(t.amount_minor)); // fee is NOT refunded
  else addEntry(t.destination.id, t.id, 'principal', -BigInt(t.amount_minor));
  setStatus(t, 'returned', { failure: { code: code === 'R03' ? 'invalid_bank_details' : code === 'R01' ? 'insufficient_funds' : 'returned_ach', message: 'Returned by the receiving bank', return_code: code, return_description: code === 'R03' ? 'No account / unable to locate account' : 'Returned' } });
}

function runLifecycle(t: any, accountNumber?: string) {
  setTimeout(() => {
    if (t.status !== 'pending') return;
    if (t.direction === 'internal' && t.amount_minor === '13') return failTransfer(t, 'payment_failed', 'Payment declined');
    if (accountNumber === '000111111116') return failTransfer(t, 'rail_rejected', 'Rejected by the rail at submission');
    if (t.direction === 'withdrawal') t.fee_quoted_minor = FEES[t.rail].toString(); // quoted once priced, not in the 201
    setStatus(t, 'submitted', { status_detail: 'bank_processing', cancelable: t.direction === 'withdrawal' && t.rail !== 'fedwire' });
    if (t.direction !== 'withdrawal') return; // internal transfers wait for sandbox settle
    setTimeout(() => {
      if (t.status !== 'submitted' || t.status_detail === 'cancel_requested') return;
      if (accountNumber === '000222222227') return failTransfer(t, 'rail_rejected', 'Rejected by the receiving bank');
      settle(t);
      if (accountNumber === '000333333335') setTimeout(() => returnTransfer(t, 'R03'), STEP_MS);
    }, SETTLE_MS);
  }, STEP_MS);
}

// ---------- handlers ----------
function createPerson(client: string, b: any): Result {
  const v: any[] = [];
  if (!['individual', 'business'].includes(b?.type)) v.push({ path: 'type', code: 'invalid' });
  if (!b?.details?.first_name && !b?.details?.business_name) v.push({ path: 'details.first_name', code: 'required' });
  if (b?.type === 'individual' && !b?.details?.last_name) v.push({ path: 'details.last_name', code: 'required' });
  if (b?.type === 'individual' && b?.role === 'own') v.push({ path: 'role', code: 'invalid' });
  if (v.length) fail(422, 'validation', 'Request validation failed', v);
  const p = { id: id('person'), client, type: b.type, role: b.role ?? null, external_id: b.external_id ?? null, details: b.details, mailing_address: b.mailing_address ?? null, financial: b.financial ?? null, operational: b.operational ?? null, documents: [] as string[], status: 'pending', status_detail: 'onboarding_incomplete', created_at: now() };
  persons.set(p.id, p);
  return { status: 201, body: strip(p) };
}

function patchPerson(client: string, personId: string, b: any): Result {
  const p = owned(persons, personId, client, 'person');
  if (p.status !== 'pending' || p.status_detail === 'in_review') fail(409, 'conflict', 'A person whose review has an outcome is closed to edits; a change of circumstances is a new review');
  if (b?.type && b.type !== p.type) fail(409, 'conflict', 'type is immutable');
  if (b?.role !== undefined && p.role !== null && b.role !== p.role) fail(409, 'conflict', 'A role, once set, never changes');
  for (const k of ['details', 'mailing_address', 'financial', 'operational']) if (b?.[k]) p[k] = { ...(p[k] ?? {}), ...b[k] };
  if (b?.role !== undefined) p.role = b.role;
  return { status: 200, body: strip(p) };
}

function changeRole(client: string, personId: string, b: any): Result {
  const p = owned(persons, personId, client, 'person');
  if (!['customer', 'own'].includes(b?.role)) fail(422, 'validation', 'role must be customer or own', [{ path: 'role', code: 'invalid' }]);
  if (b.role === 'own' && p.type === 'individual') fail(422, 'validation', 'An individual is never own', [{ path: 'role', code: 'invalid' }]);
  if (p.role === b.role) return { status: 200, body: strip(p) };
  if (p.role !== null) fail(409, 'conflict', 'A role never changes once set');
  if (p.status !== 'active') fail(409, 'conflict', 'The person must have a cleared review');
  p.role = b.role;
  return { status: 200, body: strip(p) };
}

function submitReview(client: string, personId: string): Result {
  const p = owned(persons, personId, client, 'person');
  if (p.status !== 'pending' || p.status_detail === 'in_review') fail(409, 'conflict', 'Review already has an outcome or is in progress');
  const d = p.details ?? {}, a = p.mailing_address ?? {}, f = p.financial ?? {};
  const required: [string, unknown][] = [
    ['details.date_of_birth', d.date_of_birth], ['details.nationality', d.nationality], ['details.occupation', d.occupation],
    ['details.phone', d.phone], ['details.email', d.email], ['details.tax_number', d.tax_number],
    ['mailing_address.line1', a.line1], ['mailing_address.city', a.city], ['mailing_address.country', a.country],
    ['financial.primary_source_of_funds', f.primary_source_of_funds], ['operational.account_purpose', p.operational?.account_purpose],
  ];
  const v = required.filter(([, val]) => !val).map(([path]) => ({ path, code: 'required' }));
  if (!p.documents.includes('passport')) v.push({ path: 'documents.identity', code: 'required' });
  if (!p.documents.some((x: string) => ['utility_bill', 'lease_agreement', 'bank_statement'].includes(x))) v.push({ path: 'documents.proof_of_address', code: 'required' });
  if (v.length) fail(422, 'review_not_ready', 'Person has unmet review requirements', v);
  const name = `${d.first_name ?? ''} ${d.last_name ?? ''} ${d.business_name ?? ''}`.toUpperCase();
  if (name.includes('SANCTIONED-TEST')) Object.assign(p, { status: 'inactive', status_detail: 'review_denied' });
  else if (name.includes('REFERRED-TEST')) Object.assign(p, { status: 'pending', status_detail: 'in_review' });
  else Object.assign(p, { status: 'active', status_detail: null });
  return { status: 200, body: strip(p) };
}

const DOCUMENT_TYPES = ['articles_of_incorporation', 'incorporation_documents', 'ownership_breakdown', 'ownership_chart', 'lease_agreement', 'bank_statement', 'term_sheet', 'financial_statement', 'utility_bill', 'invoice', 'bill_of_lading', 'commercial_contract', 'passport', 'national_id_front', 'national_id_back', 'drivers_license_front', 'drivers_license_back', 'regulatory_license', 'other'];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const isIsoCountry = (c: string) => /^[A-Z]{2}$/.test(c) && regionNames.of(c) !== c;

function uploadDocument(client: string, fields: Record<string, string>): Result {
  // Field rules from the API reference for POST /api/v1/documents.
  const v: any[] = [];
  if (fields.subject_type !== 'person') v.push({ path: 'subject_type', code: 'invalid', message: 'Must be "person"' });
  if (!fields.subject_id || fields.subject_id.length > 100) v.push({ path: 'subject_id', code: fields.subject_id ? 'too_long' : 'required' });
  if (!fields.type) v.push({ path: 'type', code: 'required' });
  else if (!DOCUMENT_TYPES.includes(fields.type)) v.push({ path: 'type', code: 'invalid', message: 'Unknown document type' });
  if (fields.document_number !== undefined) {
    const n = fields.document_number.replace(/\s+/g, ' ').trim();
    if (!n || n.length > 64 || /[\x00-\x1f\x7f]/.test(fields.document_number)) v.push({ path: 'document_number', code: 'invalid', message: '1-64 characters, no control characters' });
  }
  if (fields.issued_country !== undefined && !isIsoCountry(fields.issued_country)) v.push({ path: 'issued_country', code: 'invalid', message: 'ISO 3166-1 alpha-2 code' });
  if (!fields.file) v.push({ path: 'file', code: 'required' });
  if (v.length) fail(422, 'validation', 'Request validation failed', v);
  const p = owned(persons, fields.subject_id, client, 'person');
  if (p.status !== 'pending' || p.status_detail === 'in_review') fail(409, 'conflict', 'Person file is locked');
  p.documents.push(fields.type);
  const size = Number(fields.file.split(':').pop());
  const doc = { id: id('doc'), subject_type: 'person', subject_id: p.id, type: fields.type, status: 'uploaded', content_type: 'application/pdf', size_bytes: size, document_number: fields.document_number ?? null, issued_country: fields.issued_country ?? null, uploaded_at: now() };
  documents.push({ ...doc, client });
  return { status: 201, body: doc };
}

function createAccount(client: string, b: any): Result {
  if (!b?.person_id) fail(422, 'validation', 'person_id is required', [{ path: 'person_id', code: 'required' }]);
  const p = owned(persons, b.person_id, client, 'person');
  if (!['customer', 'own'].includes(p.role) || p.status !== 'active') fail(422, 'person_review_not_cleared', 'Person review is not cleared');
  if (b.label !== undefined && (typeof b.label !== 'string' || b.label.length < 1 || b.label.length > 60)) fail(422, 'validation', 'label must be 1-60 characters', [{ path: 'label', code: 'invalid' }]);
  const a = { id: id('acct'), client, person_id: p.id, label: b.label ?? null, currency: 'usd', status: 'pending', status_detail: 'provisioning', provider_account_id: null, created_at: now(), active_at: null as string | null, closed_at: null as string | null };
  accounts.set(a.id, a);
  setTimeout(() => Object.assign(a, { status: 'active', status_detail: null, active_at: now() }), STEP_MS);
  return { status: 201, body: accountView(a) };
}

const ACCOUNT_TRANSITIONS: Record<string, string[]> = { pending: ['active', 'failed'], active: ['frozen', 'closed'], frozen: ['active', 'closed'], failed: ['closed'], closed: [] };
function fundingDetails(client: string, accountId: string): Result {
  const a = owned(accounts, accountId, client, 'account');
  if (a.status === 'pending' || a.status === 'failed') fail(409, 'account_not_provisioned', 'The account has no bank account number yet');
  const p = persons.get(a.person_id);
  const digits = BigInt('0x' + a.id.slice(5, 17)).toString().padStart(12, '0').slice(-12);
  return { status: 200, body: { id: a.id, currency: 'usd', account_holder: `${p.details.first_name ?? p.details.business_name} ${p.details.last_name ?? ''}`.trim(), account_number: digits, routing_number: '084106768', swift_bic: null, institution_name: 'Mock Sponsor Bank, N.A.', institution_address: { line1: '1 Main Street', city: 'St. Louis', state: 'MO', postal_code: '63101', country: 'US' } } };
}

function patchAccount(client: string, accountId: string, b: any): Result {
  const a = owned(accounts, accountId, client, 'account');
  const extra = Object.keys(b ?? {}).filter((k) => !['status', 'label'].includes(k));
  if (extra.length) fail(422, 'validation', 'Unknown fields', extra.map((path) => ({ path, code: 'extra_forbidden' })));
  if (b?.label !== undefined) { if (typeof b.label !== 'string' || b.label.length < 1 || b.label.length > 60) fail(422, 'validation', 'label must be 1-60 characters', [{ path: 'label', code: 'invalid' }]); a.label = b.label; }
  if (b?.status === undefined) return { status: 200, body: accountView(a) };
  const to = b?.status;
  if (to === 'closed' && a.status === 'pending') fail(409, 'provisioning_in_progress', 'Account is still being provisioned');
  if (!ACCOUNT_TRANSITIONS[a.status]?.includes(to)) fail(409, 'illegal_transition', `Cannot move account from ${a.status} to ${to}`);
  const bal = balance(a.id);
  if (to === 'closed' && (bal.current_minor !== '0' || bal._held > 0n)) fail(409, 'account_has_balance', 'Account still holds a balance');
  a.status = to;
  if (to === 'closed') a.closed_at = now();
  return { status: 200, body: accountView(a) };
}

function createCounterparty(client: string, b: any): Result {
  const v: any[] = [];
  for (const f of ['person_id', 'counterparty_type', 'relationship_to_person', 'counterparty_information', 'external_account_information']) if (!b?.[f]) v.push({ path: f, code: 'required' });
  const acct = b?.external_account_information ?? {};
  if (!acct.routing_number) v.push({ path: 'external_account_information.routing_number', code: 'required' });
  if (!acct.account_number) v.push({ path: 'external_account_information.account_number', code: 'required' });
  const allowed = ['person_id', 'counterparty_type', 'relationship_to_person', 'external_id', 'description', 'label', 'counterparty_information', 'external_account_information'];
  for (const k of Object.keys(b ?? {})) if (!allowed.includes(k)) v.push({ path: k, code: 'extra_forbidden' });
  if (b?.counterparty_type && !['business', 'individual'].includes(b.counterparty_type)) v.push({ path: 'counterparty_type', code: 'invalid' });
  if (b?.relationship_to_person && !['customer', 'self'].includes(b.relationship_to_person)) v.push({ path: 'relationship_to_person', code: 'invalid' });
  if (acct.routing_number && !/^\d{9}$/.test(String(acct.routing_number))) v.push({ path: 'external_account_information.routing_number', code: 'invalid', message: '9 digits' });
  if (acct.account_number && !/^[A-Za-z0-9._:-]{1,64}$/.test(String(acct.account_number))) v.push({ path: 'external_account_information.account_number', code: 'invalid' });
  const rails: string[] = acct.supported_rails ?? [];
  if (!rails.length || rails.some((r) => !['ach', 'fedwire', 'fednow'].includes(r))) v.push({ path: 'external_account_information.supported_rails', code: 'invalid' });
  if (rails.includes('fedwire') && !acct.institution_name) v.push({ path: 'external_account_information.institution_name', code: 'required', message: 'Fedwire needs the institution name' });
  if (v.length) fail(422, 'validation', 'Request validation failed', v);
  owned(persons, b.person_id, client, 'person');
  const info = b.counterparty_information;
  const name = `${info.business_name ?? ''} ${info.first_name ?? ''} ${info.last_name ?? ''}`.toUpperCase();
  const status = name.includes('SANCTIONED-TEST') ? ['blocked', 'screening_rejected'] : name.includes('REFERRED-TEST') ? ['blocked', 'screening_pending'] : ['active', null];
  const c = { id: id('cpty'), client, person_id: b.person_id, counterparty_type: b.counterparty_type, external_id: b.external_id ?? null, label: b.label ?? null, description: b.description ?? null, relationship_to_person: b.relationship_to_person, status: status[0], status_detail: status[1], created_at: now(), counterparty_information: info, _account_number: acct.account_number, external_account_information: { external_account_type: 'bank_account', supported_rails: acct.supported_rails ?? ['ach'], account_subtype: acct.account_subtype ?? 'checking', account_number: `****${String(acct.account_number).slice(-4)}`, routing_number: acct.routing_number, institution_name: acct.institution_name ?? null } };
  counterparties.set(c.id, c);
  return { status: 201, body: cptyView(c) };
}
const cptyView = (c: any) => { const { _account_number, ...rest } = strip(c); return rest; };

function patchCounterparty(client: string, cptyId: string, b: any): Result {
  const c = owned(counterparties, cptyId, client, 'counterparty');
  if (c.status === 'deleted') fail(409, 'conflict', 'Counterparty is deleted');
  const ext = b?.external_account_information ?? {};
  if (b?.person_id !== undefined || ext.account_number !== undefined || ext.routing_number !== undefined) fail(409, 'conflict', 'person_id and bank account identifiers are immutable');
  if (b?.status !== undefined) {
    if (!['frozen', 'active'].includes(b.status)) fail(422, 'validation', 'status can only be frozen or active', [{ path: 'status', code: 'invalid' }]);
    if (c.status === 'blocked') fail(409, 'illegal_transition', 'A blocked counterparty is set by screening and cannot be changed');
    Object.assign(c, b.status === 'frozen' ? { status: 'frozen', status_detail: 'manual_freeze' } : { status: 'active', status_detail: null });
  }
  if (b?.label !== undefined) c.label = b.label;
  return { status: 200, body: cptyView(c) };
}

function deleteCounterparty(client: string, cptyId: string): Result {
  const c = owned(counterparties, cptyId, client, 'counterparty');
  Object.assign(c, { status: 'deleted', status_detail: null });
  return { status: 204 };
}

async function createTransfer(client: string, b: any): Promise<Result> {
  const v: any[] = [];
  if (b?.source?.type !== 'account' || !b?.source?.id) v.push({ path: 'source', code: 'invalid' });
  if (!['account', 'counterparty'].includes(b?.destination?.type) || !b?.destination?.id) v.push({ path: 'destination', code: 'invalid' });
  // TransferCreateRequest is strict: unknown fields (e.g. a client-computed fee or total) are rejected.
  const allowed = ['source', 'destination', 'amount_minor', 'currency', 'rail', 'purpose', 'description', 'memo', 'external_id'];
  for (const k of Object.keys(b ?? {})) if (!allowed.includes(k)) v.push({ path: k, code: 'extra_forbidden' });
  if (!(typeof b?.amount_minor === 'string' && /^[1-9][0-9]*$/.test(b.amount_minor) && b.amount_minor.length <= 11)) v.push({ path: 'amount_minor', code: 'invalid', message: 'Positive integer in minor units, as a string, at most 11 digits' });
  if (b?.currency !== undefined && b.currency !== 'usd') v.push({ path: 'currency', code: 'invalid' });
  if (!PURPOSES.includes(b?.purpose)) v.push({ path: 'purpose', code: b?.purpose === undefined ? 'required' : 'invalid' });
  if (b?.purpose === 'other' && !b?.description) v.push({ path: 'description', code: 'required', message: 'Required when purpose is other' });
  if (b?.external_id !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(String(b.external_id))) v.push({ path: 'external_id', code: 'invalid' });
  if (b?.memo !== undefined) {
    const m = String(b.memo);
    const asciiOnly = ['ach', 'sameday_ach', 'fedwire'].includes(b.rail);
    const max = ['ach', 'sameday_ach'].includes(b.rail) ? 80 : 140;
    if (!m || m.length > max || /[\x00-\x1f\x7f]/.test(m) || (asciiOnly && !/^[\x20-\x7e]+$/.test(m))) v.push({ path: 'memo', code: 'invalid', message: `Up to ${max} characters${asciiOnly ? ', printable ASCII' : ''}` });
  }
  if (b?.rail !== undefined && !['ach', 'sameday_ach', 'fedwire', 'fednow', 'swift', 'internal'].includes(b.rail)) v.push({ path: 'rail', code: 'invalid' });
  if (v.length) fail(422, 'validation', 'Request validation failed', v);

  const src = owned(accounts, b.source.id, client, 'account');
  const toAccount = b.destination.type === 'account';
  const dst: any = toAccount ? owned(accounts, b.destination.id, client, 'account') : owned(counterparties, b.destination.id, client, 'counterparty');
  if (src.status !== 'active') fail(409, 'account_not_active', 'Source account is not active');
  let rail: string;
  if (toAccount) {
    if (b.rail && b.rail !== 'internal') fail(422, 'validation', 'Internal transfers use rail "internal"', [{ path: 'rail', code: 'invalid' }]);
    if (dst.status !== 'active') fail(409, 'account_not_active', 'Destination account is not active');
    if (dst.id === src.id) fail(422, 'validation', 'Source and destination must differ', [{ path: 'destination', code: 'invalid' }]);
    rail = 'internal';
  } else {
    if (b.rail === 'swift') fail(501, 'rail_not_supported', 'SWIFT is not supported yet');
    if (b.rail === 'fednow') fail(409, 'rail_not_enabled', 'FedNow is not enabled for this client');
    if (!['ach', 'sameday_ach', 'fedwire'].includes(b.rail)) fail(422, 'validation', 'rail is required for withdrawals', [{ path: 'rail', code: 'invalid' }]);
    if (dst.status !== 'active') fail(409, 'conflict', `Counterparty is ${dst.status}`);
    const rails: string[] = dst.external_account_information.supported_rails;
    if (!(rails.includes(b.rail) || (b.rail === 'sameday_ach' && rails.includes('ach')))) fail(422, 'validation', 'Counterparty does not support this rail', [{ path: 'rail', code: 'invalid' }]);
    rail = b.rail;
  }

  // Per-account lock: a different request touching the same account gets 429.
  const touched = [src.id, dst.id];
  if (touched.some((k) => locks.has(k))) throw Object.assign(new ApiError(429, 'rate_limited', 'An operation is already in progress for this account'), { retryAfter: '1' });
  touched.forEach((k) => locks.add(k));
  try {
    await sleep(LOCK_MS);
    const amount = BigInt(b.amount_minor);
    const fee = rail === 'internal' ? 0n : FEES[rail];
    const t: any = {
      id: id('xfer'), client,
      source: { type: 'account', id: src.id }, destination: { type: b.destination.type, id: dst.id },
      direction: toAccount ? 'internal' : 'withdrawal', rail, amount_minor: amount.toString(),
      fee_quoted_minor: '0', fee_charged_minor: '0', fee_mode: 'on_top', // a withdrawal is quoted a moment after the 201
      status: 'pending', status_detail: null, failure: null, purpose: b.purpose, description: b.description ?? null, memo: b.memo ?? null, external_id: b.external_id ?? null,
      created_at: now(), submitted_at: null, settled_at: null, failed_at: null, returned_at: null, reversed_at: null, cancelled_at: null, cancel_requested_at: null,
      cancelable: !toAccount,
    };
    transfers.set(t.id, t);
    if (BigInt(balance(src.id).available_minor) < amount + fee) {
      setStatus(t, 'failed', { cancelable: false, failure: { code: 'insufficient_funds', message: 'Available balance is below the amount' } });
      fail(422, 'insufficient_funds', 'Available balance is below the amount');
    }
    placeHold(t, src.id, amount + fee);
    runLifecycle(t, toAccount ? undefined : dst._account_number);
    return { status: 201, body: strip(t) };
  } finally {
    touched.forEach((k) => locks.delete(k));
  }
}

const PURPOSES = ['treasury', 'family_support', 'supplier_payment', 'payroll', 'intercompany', 'investment', 'trade_settlement', 'loan_repayment', 'goods_services', 'other'];

/** POST /transfers/{id}/cancel: only withdrawals; before the bank has it, or ACH once sent. */
function cancelTransfer(client: string, transferId: string): Result {
  const t = owned(transfers, transferId, client, 'transfer');
  if (t.status === 'cancelled') return { status: 200, body: strip(t) };
  if (t.direction !== 'withdrawal' || !['pending', 'submitted'].includes(t.status)) fail(409, 'transfer_not_cancelable', 'This transfer can never be cancelled');
  if (t.status === 'submitted' && t.rail === 'fedwire') fail(409, 'transfer_not_cancelable', 'A wire already sent to the bank cannot be cancelled');
  if (t.status_detail === 'cancel_requested') return { status: 200, body: strip(t) };
  if (t.status === 'pending') {
    releaseHold(t);
    setStatus(t, 'cancelled', { status_detail: 'cancelled_before_submission', cancelable: false });
    return { status: 200, body: strip(t) };
  }
  Object.assign(t, { status_detail: 'cancel_requested', cancel_requested_at: now(), cancelable: false });
  setTimeout(() => { releaseHold(t); setStatus(t, 'cancelled', { status_detail: 'cancelled_at_bank' }); }, STEP_MS);
  return { status: 200, body: strip(t) };
}

function listTransfers(client: string, q: URLSearchParams): Result {
  const status = q.get('status'), direction = q.get('direction'), acct = q.get('account_id');
  if (status && !['pending', 'submitted', 'settled', 'failed', 'returned', 'cancelled', 'reversed'].includes(status)) fail(422, 'validation', 'Unknown status', [{ path: 'status', code: 'invalid' }]);
  const rows = [...transfers.values()].filter((t) => t.client === client)
    .filter((t) => !status || t.status === status).filter((t) => !direction || t.direction === direction)
    .filter((t) => !acct || t.source?.id === acct || t.destination?.id === acct)
    .sort((a, b) => (q.get('order') === 'asc' ? 1 : -1) * a.created_at.localeCompare(b.created_at))
    .map((t) => ({ id: t.id, source: t.source, destination: t.destination, direction: t.direction, rail: t.rail, amount_minor: t.amount_minor, status: t.status, status_detail: t.status_detail, failure: t.failure, external_id: t.external_id, created_at: t.created_at, settled_at: t.settled_at }));
  return { status: 200, body: paginate(rows, q) };
}

function sandboxDeposit(client: string, b: any): Result {
  const a = owned(accounts, b?.account_id, client, 'account');
  if (!(typeof b?.amount_minor === 'string' && /^[1-9][0-9]*$/.test(b.amount_minor) && b.amount_minor.length <= 11)) fail(422, 'validation', 'amount_minor must be a positive integer string', [{ path: 'amount_minor', code: 'invalid' }]);
  if (a.status !== 'active') fail(409, 'account_not_active', 'Account is not active');
  const t: any = { id: id('xfer'), client, source: null, destination: { type: 'account', id: a.id }, direction: 'deposit', rail: 'ach', amount_minor: b.amount_minor, fee_quoted_minor: '0', fee_charged_minor: '0', fee_mode: 'on_top', status: 'pending', status_detail: null, failure: null, external_id: null, created_at: now(), submitted_at: null, settled_at: null, failed_at: null, returned_at: null, reversed_at: null, cancelled_at: null, cancel_requested_at: null, cancelable: false };
  transfers.set(t.id, t);
  if (String(b.sender_name ?? '').toUpperCase().includes('SANCTIONED-TEST')) t.status_detail = 'awaiting_release';
  else setTimeout(() => { addEntry(a.id, t.id, 'principal', BigInt(t.amount_minor)); setStatus(t, 'settled'); }, STEP_MS);
  return { status: 202, body: { id: t.id } };
}

function sandboxAnswer(client: string, transferId: string, action: string, b: any): Result {
  const t = owned(transfers, transferId, client, 'transfer');
  if (action === 'return') {
    if (t.status !== 'settled' || t.direction === 'internal') fail(409, 'conflict', 'Only settled withdrawals or deposits can be returned');
    const code = b?.return_code ?? 'R01';
    if (!/^R\d{2}$/.test(code)) fail(422, 'validation', 'return_code must be R plus two digits', [{ path: 'return_code', code: 'invalid' }]);
    returnTransfer(t, code);
    return { status: 202, body: { transfer_id: t.id, outcome: 'returned' } };
  } else {
    if (t.status !== 'submitted' || t.direction === 'deposit') fail(409, 'conflict', `Transfer is ${t.status}`);
    if (action === 'fail' && t.direction === 'internal') fail(409, 'conflict', 'Internal transfers can only be settled');
    if (action === 'settle') settle(t); else failTransfer(t, 'rail_rejected', 'Failed by sandbox');
  }
  return { status: 202, body: { transfer_id: t.id, outcome: action === 'settle' ? 'settled' : 'failed' } };
}

function sandboxReview(client: string, personId: string, b: any): Result {
  const p = owned(persons, personId, client, 'person');
  if (p.status_detail !== 'in_review') fail(409, 'conflict', 'Person is not awaiting a decision');
  Object.assign(p, b?.outcome === 'cleared' ? { status: 'active', status_detail: null } : { status: 'inactive', status_detail: 'review_denied' });
  return { status: 202, body: strip(p) };
}

// ---------- idempotency (per Roots idempotency guide) ----------
async function withIdempotency(client: string, op: string, key: string | undefined, compare: string, run: () => Promise<Result> | Result): Promise<Result> {
  if (!key) fail(422, 'validation', 'Idempotency-Key header is required', [{ path: 'Idempotency-Key', code: 'required' }]);
  if (key!.length > 255) fail(422, 'validation', 'Idempotency-Key must be 1-255 characters');
  const k = `${client}|${op}|${key}`;
  const prev = idem.get(k);
  if (prev && !prev.done) fail(409, 'idempotency_key_in_progress', 'The first request with this key has not finished');
  if (prev && prev.compare !== compare) fail(409, 'idempotency_key_conflict', 'Key was already used with a different body');
  if (prev) return { status: prev.status!, body: prev.body, headers: { 'Idempotent-Replayed': 'true', ...(prev.status! >= 400 ? { 'Content-Type': 'application/problem+json' } : {}) } };
  idem.set(k, { compare, done: false });
  try {
    const r = await run();
    idem.set(k, { compare, done: true, status: r.status, body: r.body });
    return r;
  } catch (e) {
    // 4xx refusals store nothing, except a refused transfer, which is kept and replayed.
    if (e instanceof ApiError && e.code === 'insufficient_funds') idem.set(k, { compare, done: true, status: e.status, body: problemBody(e, '/api/v1/transfers') });
    else idem.delete(k);
    throw e;
  }
}

// ---------- HTTP plumbing ----------
function problemBody(e: ApiError, path: string) {
  return { type: `https://docs.roots.finance/docs/errors#${e.code}`, title: http.STATUS_CODES[e.status] ?? 'Error', status: e.status, detail: e.detail, code: e.code, instance: path, trace_id: randomUUID(), ...(e.violations ? { violations: e.violations } : {}) };
}

function parseMultipart(raw: Buffer): Record<string, string> {
  const text = raw.toString('latin1');
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]+\r\n)?\r\n([\s\S]*?)\r\n--/gi)) out[m[1]] = m[2] ? `file:${m[2]}:${m[3].length}` : m[3];
  return out;
}

async function route(req: http.IncomingMessage, raw: Buffer): Promise<Result> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname, method = req.method ?? 'GET';
  if (path === '/health') return { status: 200, body: { ok: true } };

  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer rts_live_')) fail(401, 'unauthorized', 'Missing or malformed bearer token');
  const client = CLIENTS[auth.slice('Bearer '.length)];
  if (!client) fail(401, 'unauthorized', 'Unknown, expired or revoked API key');

  const isMultipart = (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
  const fields = isMultipart ? parseMultipart(raw) : {};
  const text = raw.toString('utf8');
  let body: any = undefined;
  if (!isMultipart && text) { try { body = JSON.parse(text); } catch { fail(400, 'validation', 'Body is not valid JSON'); } }
  const key = req.headers['idempotency-key'] as string | undefined;
  const idemp = (op: string, run: () => Promise<Result> | Result) => withIdempotency(client!, op, key, isMultipart ? JSON.stringify(fields) : text, run);
  const seg = path.split('/').filter(Boolean); // ['api','v1',...]
  const r = seg.slice(2);

  if (method === 'POST' && path === '/api/v1/persons') return idemp('persons.create', () => createPerson(client!, body));
  if (method === 'GET' && path === '/api/v1/persons') return { status: 200, body: paginate([...persons.values()].filter((p) => p.client === client).map(strip), url.searchParams) };
  if (method === 'GET' && r[0] === 'persons' && r.length === 2) return { status: 200, body: strip(owned(persons, r[1], client!, 'person')) };
  if (method === 'PATCH' && r[0] === 'persons' && r.length === 2) return patchPerson(client!, r[1], body);
  if (method === 'POST' && r[0] === 'persons' && r[2] === 'role') return idemp(`persons.role:${r[1]}`, () => changeRole(client!, r[1], body));
  if (method === 'GET' && path === '/api/v1/documents') {
    if (url.searchParams.get('subject_type') !== 'person' || !url.searchParams.get('subject_id')) fail(422, 'validation', 'subject_type and subject_id are required');
    owned(persons, url.searchParams.get('subject_id')!, client!, 'person');
    return { status: 200, body: paginate(documents.filter((d) => d.client === client && d.subject_id === url.searchParams.get('subject_id')).map(strip), url.searchParams) };
  }
  if (method === 'GET' && path === '/api/v1/billing') return { status: 200, body: { billing_minor: '10000000', revenue_minor: '0', min_minor: '100000', blocked: false, billing_available_to_move_minor: '9900000', revenue_available_to_move_minor: '0', allowed_moves: [] } };
  if (method === 'POST' && r[0] === 'persons' && r[2] === 'review' && r[3] === 'submit') return idemp(`review.submit:${r[1]}`, () => submitReview(client!, r[1]));
  if (method === 'POST' && path === '/api/v1/documents') return idemp('documents.create', () => uploadDocument(client!, fields));
  if (method === 'POST' && path === '/api/v1/accounts') return idemp('accounts.create', () => createAccount(client!, body));
  if (method === 'GET' && path === '/api/v1/accounts') return { status: 200, body: paginate([...accounts.values()].filter((a) => a.client === client).map(accountView), url.searchParams) };
  if (r[0] === 'accounts' && r[2] === 'details' && method === 'GET') return fundingDetails(client!, r[1]);
  if (r[0] === 'accounts' && r[2] === 'transactions' && r.length === 4 && method === 'GET') {
    owned(accounts, r[1], client!, 'account');
    const e = ledger.find((x) => x.id === r[3] && x.account_id === r[1]);
    return e ? { status: 200, body: e } : fail(404, 'not_found', 'transaction not found');
  }
  if (r[0] === 'accounts' && r.length === 2 && method === 'GET') return { status: 200, body: accountView(owned(accounts, r[1], client!, 'account')) };
  if (r[0] === 'accounts' && r.length === 2 && method === 'PATCH') return patchAccount(client!, r[1], body);
  if (r[0] === 'accounts' && r[2] === 'transactions' && method === 'GET') {
    owned(accounts, r[1], client!, 'account');
    const q = url.searchParams;
    const types = q.getAll('type').length ? q.getAll('type') : ['principal', 'fee'];
    const dir = q.get('direction'), xfer = q.get('transfer_id');
    if (dir && !['credit', 'debit'].includes(dir)) fail(422, 'validation', 'direction must be credit or debit', [{ path: 'direction', code: 'invalid' }]);
    const rows = ledger.filter((e) => e.account_id === r[1] && types.includes(e.type))
      .filter((e) => !xfer || e.transfer_id === xfer)
      .filter((e) => !dir || (dir === 'credit' ? BigInt(e.amount_minor) > 0n : BigInt(e.amount_minor) < 0n))
      .slice().reverse(); // newest first
    return { status: 200, body: paginate(rows, q) };
  }
  if (method === 'POST' && path === '/api/v1/counterparties') return idemp('counterparties.create', () => createCounterparty(client!, body));
  if (method === 'GET' && path === '/api/v1/counterparties') return { status: 200, body: paginate([...counterparties.values()].filter((c) => c.client === client).map(cptyView), url.searchParams) };
  if (method === 'GET' && r[0] === 'counterparties' && r.length === 2) return { status: 200, body: cptyView(owned(counterparties, r[1], client!, 'counterparty')) };
  if (method === 'PATCH' && r[0] === 'counterparties' && r.length === 2) return patchCounterparty(client!, r[1], body);
  if (method === 'DELETE' && r[0] === 'counterparties' && r.length === 2) return deleteCounterparty(client!, r[1]);
  if (method === 'POST' && path === '/api/v1/transfers') return idemp('transfers.create', () => createTransfer(client!, body));
  if (method === 'GET' && path === '/api/v1/transfers') return listTransfers(client!, url.searchParams);
  if (method === 'POST' && r[0] === 'transfers' && r[2] === 'cancel') return idemp(`transfers.cancel:${r[1]}`, () => cancelTransfer(client!, r[1]));
  if (method === 'GET' && r[0] === 'transfers' && r.length === 2) return { status: 200, body: strip(owned(transfers, r[1], client!, 'transfer')) };
  if (method === 'GET' && r[0] === 'transfers' && r[2] === 'transactions') {
    owned(transfers, r[1], client!, 'transfer');
    const all = ledger.filter((e) => e.transfer_id === r[1]);
    if (!all.length) fail(404, 'not_found', 'This transfer has not been executed, so it has no transactions');
    const types = url.searchParams.getAll('type').length ? url.searchParams.getAll('type') : ['principal', 'fee'];
    return { status: 200, body: paginate(all.filter((e) => types.includes(e.type)), url.searchParams) }; // oldest first
  }
  if (method === 'POST' && path === '/api/v1/sandbox/deposits') return sandboxDeposit(client!, body);
  if (method === 'POST' && r[0] === 'sandbox' && r[1] === 'transfers') return sandboxAnswer(client!, r[2], r[3], body);
  if (method === 'POST' && r[0] === 'sandbox' && r[1] === 'persons' && r[3] === 'review') return sandboxReview(client!, r[2], body);
  if (method === 'POST' && path === '/api/v1/sandbox/billing/deposits') return { status: 202, body: {} };
  return fail(404, 'not_found', `No route for ${method} ${path}`);
}

http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID(); // echoed back when the client sends one
    let out: Result;
    try {
      out = await route(req, Buffer.concat(chunks));
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'X-Request-ID': requestId, ...(out.headers ?? {}) });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, 'internal_error', 'Unexpected error');
      if (!(e instanceof ApiError)) console.error(e);
      out = { status: err.status, body: problemBody(err, req.url ?? '') };
      res.writeHead(err.status, { 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId, ...((e as any).retryAfter ? { 'Retry-After': (e as any).retryAfter } : {}) });
    }
    res.end(out.body === undefined ? '' : JSON.stringify(out.body));
  });
}).listen(PORT, () => console.log(`Roots mock API on http://localhost:${PORT}`));
