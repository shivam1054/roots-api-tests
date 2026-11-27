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
  status_detail: string | null;
  external_account_information: { account_number: string; routing_number: string; supported_rails: string[] };
}

export type Rail = 'internal' | 'ach' | 'sameday_ach' | 'fedwire';
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
  status: TransferStatus;
  status_detail: string | null;
  failure: { code: string; message: string; return_code?: string | null; return_description?: string | null } | null;
  external_id: string | null;
  created_at: string;
  submitted_at: string | null;
  settled_at: string | null;
  failed_at: string | null;
  returned_at: string | null;
}

export type LedgerEntryType = 'principal' | 'fee' | 'hold' | 'release';
export interface LedgerEntry {
  id: string;
  account_id: string;
  transfer_id: string | null;
  type: LedgerEntryType;
  amount_minor: MinorUnits; // signed: negative = money left the account
  created_at: string;
}

export interface List<T> { data: T[] }
