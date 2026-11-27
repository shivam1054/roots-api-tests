import type { RootsHttp, RequestOptions } from '../http/RootsHttp';

/** Sandbox-only endpoints from the Roots "Test scenarios" guide. */
export class SandboxClient {
  constructor(private readonly http: RootsHttp) {}
  deposit(accountId: string, amountMinor: string, senderName?: string, opts: RequestOptions = {}) {
    return this.http.request<{ id: string }>('POST', '/api/v1/sandbox/deposits', {
      ...opts, body: { account_id: accountId, amount_minor: amountMinor, ...(senderName ? { sender_name: senderName } : {}) },
    });
  }
  settle(transferId: string) { return this.http.request<{ transfer_id: string; outcome: 'settled' }>('POST', `/api/v1/sandbox/transfers/${transferId}/settle`); }
  fail(transferId: string) { return this.http.request<{ transfer_id: string; outcome: 'failed' }>('POST', `/api/v1/sandbox/transfers/${transferId}/fail`); }
  returnTransfer(transferId: string, returnCode = 'R01') {
    return this.http.request<{ transfer_id: string; outcome: 'returned' }>('POST', `/api/v1/sandbox/transfers/${transferId}/return`, { body: { return_code: returnCode } });
  }
  decideReview(personId: string, outcome: 'cleared' | 'denied') {
    return this.http.request('POST', `/api/v1/sandbox/persons/${personId}/review`, { body: { outcome } });
  }
  topUpBilling(amountMinor: string) {
    return this.http.request('POST', '/api/v1/sandbox/billing/deposits', { body: { amount_minor: amountMinor } });
  }
}
