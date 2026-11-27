import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Account, LedgerEntry, LedgerEntryType, List } from '../models/types';

export class AccountsClient {
  constructor(private readonly http: RootsHttp) {}
  create(personId: string, opts: RequestOptions = {}) {
    return this.http.request<Account>('POST', '/api/v1/accounts', { ...opts, body: { person_id: personId, currency: 'usd' } });
  }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Account>('GET', `/api/v1/accounts/${id}`, opts); }
  setStatus(id: string, status: 'active' | 'frozen' | 'closed', opts: RequestOptions = {}) {
    return this.http.request<Account>('PATCH', `/api/v1/accounts/${id}`, { ...opts, body: { status } });
  }
  /** Ledger entries for one account. Holds and releases are only returned when asked for. */
  transactions(id: string, types: LedgerEntryType[] = ['principal', 'fee', 'hold', 'release'], opts: RequestOptions = {}) {
    return this.http.request<List<LedgerEntry>>('GET', `/api/v1/accounts/${id}/transactions`, { ...opts, query: { type: types } });
  }
}
