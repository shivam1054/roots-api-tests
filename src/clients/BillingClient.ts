import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { BillingBalances } from '../models/types';

/** GET /billing: Roots' fees are paid from the billing balance; below its minimum, fee-incurring requests are refused (400 insufficient_billing_balance). */
export class BillingClient {
  constructor(private readonly http: RootsHttp) {}
  get(opts: RequestOptions = {}) { return this.http.request<BillingBalances>('GET', '/api/v1/billing', opts); }
}
