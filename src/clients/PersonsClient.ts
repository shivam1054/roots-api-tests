import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { Page, Person } from '../models/types';

export class PersonsClient {
  constructor(private readonly http: RootsHttp) {}
  create(body: unknown, opts: RequestOptions = {}) { return this.http.request<Person>('POST', '/api/v1/persons', { ...opts, body }); }
  get(id: string, opts: RequestOptions = {}) { return this.http.request<Person>('GET', `/api/v1/persons/${id}`, opts); }
  list(query: Record<string, string> = {}, opts: RequestOptions = {}) { return this.http.request<Page<Person>>('GET', '/api/v1/persons', { ...opts, query }); }
  /** Merge patch. Closed to edits once review has an outcome (409). */
  patch(id: string, body: Record<string, unknown>, opts: RequestOptions = {}) { return this.http.request<Person>('PATCH', `/api/v1/persons/${id}`, { ...opts, body }); }
  submitReview(id: string, opts: RequestOptions = {}) { return this.http.request<Person>('POST', `/api/v1/persons/${id}/review/submit`, opts); }
  /** Give a role to a person who has none. A role never changes once set. */
  setRole(id: string, role: 'customer' | 'own', opts: RequestOptions = {}) {
    return this.http.request<Person>('POST', `/api/v1/persons/${id}/role`, { ...opts, body: { role } });
  }
}
