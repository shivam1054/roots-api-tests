import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Account, FundingDetails, LedgerEntry, LedgerEntryType, Page } from '../models/types';

export interface TransactionFilters {
  types?: LedgerEntryType[];
  transferId?: string;
  direction?: 'credit' | 'debit';
  from?: string; // YYYY-MM-DD, UTC, inclusive
  to?: string;
  page?: number;
  pageSize?: number;
}

export class AccountsClient {
  constructor(private readonly http: RootsHttp) {}
  create(personId: string, opts: RequestOptions & { label?: string } = {}) {
    const { label, ...o } = opts;
    return this.http.request<Account>('POST', '/api/v1/accounts', { ...o, body: { person_id: personId, currency: 'usd', ...(label ? { label } : {}) } });
  }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Account>('GET', `/api/v1/accounts/${id}`, opts); }
  list(query: Record<string, string> = {}, opts: RequestOptions = {}) { return this.http.request<Page<Account>>('GET', '/api/v1/accounts', { ...opts, query }); }
  setStatus(id: string, status: 'active' | 'frozen' | 'closed', opts: RequestOptions = {}) {
    return this.http.request<Account>('PATCH', `/api/v1/accounts/${id}`, { ...opts, body: { status } });
  }
  patch(id: string, body: Record<string, unknown>, opts: RequestOptions = {}) {
    return this.http.request<Account>('PATCH', `/api/v1/accounts/${id}`, { ...opts, body });
  }
  /** Where the account's own payers send money: account and routing number, read live from the bank. */
  fundingDetails(id: string, opts: RequestOptions = {}) { return this.http.request<FundingDetails>('GET', `/api/v1/accounts/${id}/details`, opts); }
  /** Ledger entries for one account, newest first. Holds and releases only when asked for. */
  transactions(id: string, f: TransactionFilters | LedgerEntryType[] = {}, opts: RequestOptions = {}) {
    const filters: TransactionFilters = Array.isArray(f) ? { types: f } : f;
    const query: Record<string, string | string[]> = { type: filters.types ?? ['principal', 'fee', 'hold', 'release'] };
    if (filters.transferId) query.transfer_id = filters.transferId;
    if (filters.direction) query.direction = filters.direction;
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
    if (filters.page) query.page = String(filters.page);
    if (filters.pageSize) query.page_size = String(filters.pageSize);
    return this.http.request<Page<LedgerEntry>>('GET', `/api/v1/accounts/${id}/transactions`, { ...opts, query });
  }
  transaction(accountId: string, transactionId: string, opts: RequestOptions = {}) {
    return this.http.request<LedgerEntry>('GET', `/api/v1/accounts/${accountId}/transactions/${transactionId}`, opts);
  }
}
