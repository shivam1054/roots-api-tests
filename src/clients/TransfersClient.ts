import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { LedgerEntry, LedgerEntryType, Page, Transfer } from '../models/types';

export class TransfersClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Transfer>('POST', '/api/v1/transfers', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Transfer>('GET', `/api/v1/transfers/${id}`, opts); }
  /** GET /transfers: filters (account_id matches either leg, status, direction) and page/page_size. */
  list(query: Record<string, string> = {}, opts: RequestOptions = {}) { return this.http.request<Page<Transfer>>('GET', '/api/v1/transfers', { ...opts, query }); }
  /** Only the creator can cancel. Requires an Idempotency-Key (added automatically). */
  cancel(id: string, opts: RequestOptions = {}) { return this.http.request<Transfer>('POST', `/api/v1/transfers/${id}/cancel`, opts); }
  /**
   * Ledger entries this transfer made, oldest first. Default types are principal and fee;
   * pass hold/release to see money moving between the account's own pockets.
   * A transfer that never executed has none and answers 404.
   */
  transactions(id: string, types?: LedgerEntryType[], opts: RequestOptions = {}) {
    return this.http.request<Page<LedgerEntry>>('GET', `/api/v1/transfers/${id}/transactions`, { ...opts, query: types ? { type: types } : undefined });
  }
}
