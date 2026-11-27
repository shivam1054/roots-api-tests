import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Counterparty } from '../models/types';

export class CounterpartiesClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Counterparty>('POST', '/api/v1/counterparties', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Counterparty>('GET', `/api/v1/counterparties/${id}`, opts); }
}
