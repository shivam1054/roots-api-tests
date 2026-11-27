import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Person } from '../models/types';

export class PersonsClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Person>('POST', '/api/v1/persons', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Person>('GET', `/api/v1/persons/${id}`, opts); }
  submitReview(id: string, opts: RequestOptions = {}) { return this.http.request<Person>('POST', `/api/v1/persons/${id}/review/submit`, opts); }
}
