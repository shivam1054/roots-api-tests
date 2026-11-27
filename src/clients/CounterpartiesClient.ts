import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Counterparty, Page } from '../models/types';

export class CounterpartiesClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Counterparty>('POST', '/api/v1/counterparties', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Counterparty>('GET', `/api/v1/counterparties/${id}`, opts); }
  list(query: Record<string, string> = {}, opts: RequestOptions = {}) { return this.http.request<Page<Counterparty>>('GET', '/api/v1/counterparties', { ...opts, query }); }
  /** Merge patch. `status: frozen | active` freezes or unfreezes; bank identifiers are immutable (409). */
  patch(id: string, body: Record<string, unknown>, opts: RequestOptions = {}) {
    return this.http.request<Counterparty>('PATCH', `/api/v1/counterparties/${id}`, { ...opts, body });
  }
  /** Marks it deleted; the row stays readable for transfers that named it. */
  delete(id: string, opts: RequestOptions = {}) { return this.http.request<void>('DELETE', `/api/v1/counterparties/${id}`, opts); }
}
