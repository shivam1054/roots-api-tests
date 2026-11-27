/** Types follow the shapes in the Roots docs (core concepts, transfers, accounts, counterparties). */

export type MinorUnits = string; // integer cents as a JSON string, e.g. "125000" = $1,250.00

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  trace_id?: string;
  violations?: { path: string; code: string; message?: string }[];
}

export type PersonStatus = 'pending' | 'active' | 'inactive';
export interface Person {
  id: string;
  type: 'individual' | 'business';
  role: 'customer' | 'own' | null;
  status: PersonStatus;
  status_detail: string | null;
  external_id?: string | null;
}

/** The 19 document types accepted by POST /api/v1/documents. */
export const DOCUMENT_TYPES = [
  'articles_of_incorporation', 'incorporation_documents', 'ownership_breakdown', 'ownership_chart',
  'lease_agreement', 'bank_statement', 'term_sheet', 'financial_statement', 'utility_bill', 'invoice',
  'bill_of_lading', 'commercial_contract', 'passport', 'national_id_front', 'national_id_back',
  'drivers_license_front', 'drivers_license_back', 'regulatory_license', 'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface Balance {
  available_minor: MinorUnits;
  pending_minor: MinorUnits;
  current_minor: MinorUnits;
}
export type AccountStatus = 'pending' | 'active' | 'frozen' | 'closed' | 'failed';
export interface Account {
  id: string;
  person_id: string;
  label: string | null;
  currency: 'usd';
  status: AccountStatus;
  status_detail: string | null;
  capabilities: { send: string; receive: string };
  balance: Balance;
}

export interface Counterparty {
  id: string;
  person_id: string;
  status: 'active' | 'blocked' | 'frozen' | 'deleted';
  status_detail: 'screening_rejected' | 'screening_pending' | 'manual_freeze' | null;
  external_account_information: { account_number: string; routing_number: string; supported_rails: string[] };
}

export type Rail = 'internal' | 'ach' | 'sameday_ach' | 'fedwire' | 'fednow' | 'swift';
export type TransferStatus = 'pending' | 'submitted' | 'settled' | 'failed' | 'returned' | 'reversed' | 'cancelled';
export const TERMINAL_STATUSES: TransferStatus[] = ['settled', 'failed', 'returned', 'reversed', 'cancelled'];

export interface Endpoint { type: 'account' | 'counterparty'; id: string }
export interface Transfer {
  id: string;
  source: Endpoint | null;
  destination: Endpoint | null;
  direction: 'internal' | 'withdrawal' | 'deposit';
  rail: Rail;
  amount_minor: MinorUnits;
  fee_quoted_minor: MinorUnits;
  fee_charged_minor: MinorUnits;
  fee_mode: 'on_top' | 'deducted';
  purpose: string | null;
  memo: string | null;
  status: TransferStatus;
  status_detail: string | null;
  failure: { code: string; message: string; return_code?: string | null; return_description?: string | null } | null;
  external_id: string | null;
  created_at: string;
  submitted_at: string | null;
  settled_at: string | null;
  failed_at: string | null;
  returned_at: string | null;
  reversed_at: string | null;
  cancelled_at: string | null;
  cancel_requested_at: string | null;
  /** Whether POST /transfers/{id}/cancel is worth trying now (a hint, not a promise). */
  cancelable: boolean;
}

export type LedgerEntryType = 'principal' | 'fee' | 'hold' | 'release';
export interface LedgerEntry {
  id: string;
  account_id: string;
  transfer_id: string | null;
  type: LedgerEntryType;
  flow: string;
  amount_minor: MinorUnits; // signed: negative = money left the account
  currency: string;
  reason: string | null;
  occurred_at: string;
  posted_at: string | null;
}

/** Every list endpoint answers with this page envelope. */
export interface Page<T> { data: T[]; page: number; page_size: number; total: number }
/** @deprecated use Page */
export type List<T> = Page<T>;

export const TRANSFER_PURPOSES = ['treasury', 'family_support', 'supplier_payment', 'payroll', 'intercompany', 'investment', 'trade_settlement', 'loan_repayment', 'goods_services', 'other'] as const;

export interface FundingDetails {
  id: string;
  account_holder: string;
  account_number: string;
  routing_number: string;
  swift_bic?: string | null;
  institution_name: string;
}

export interface BillingBalances {
  billing_minor: MinorUnits;
  revenue_minor: MinorUnits;
  min_minor: MinorUnits;
  blocked: boolean;
}

export interface DocumentSummary {
  id: string;
  subject_type: 'person';
  subject_id: string;
  type: string;
  status: 'uploaded' | 'accepted' | 'rejected';
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}
