import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { LedgerEntry, List, Transfer } from '../models/types';

export class TransfersClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Transfer>('POST', '/api/v1/transfers', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Transfer>('GET', `/api/v1/transfers/${id}`, opts); }
  /** Every ledger entry this transfer made, across all accounts, oldest first. */
  transactions(id: string, opts: RequestOptions = {}) {
    return this.http.request<List<LedgerEntry>>('GET', `/api/v1/transfers/${id}/transactions`, opts);
  }
}
