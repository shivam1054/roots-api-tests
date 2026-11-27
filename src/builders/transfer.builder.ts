import type { MinorUnits, Rail } from '../models/types';
import { externalId } from '../utils/ids';

export class TransferBuilder {
  private body: any = { amount_minor: '1000', currency: 'usd', purpose: 'treasury', external_id: externalId('xfer') };
  from(accountId: string) { this.body.source = { type: 'account', id: accountId }; return this; }
  toAccount(accountId: string) { this.body.destination = { type: 'account', id: accountId }; delete this.body.rail; return this; }
  toCounterparty(counterpartyId: string, rail: Exclude<Rail, 'internal'> = 'ach') {
    this.body.destination = { type: 'counterparty', id: counterpartyId };
    this.body.rail = rail;
    this.body.purpose = 'supplier_payment';
    return this;
  }
  amount(minor: MinorUnits) { this.body.amount_minor = minor; return this; }
  /** Escape hatch for negative tests: set any field to any value, e.g. amount_minor: -500 or 10.5. */
  with(field: string, value: unknown) { this.body[field] = value; return this; }
  build() { return structuredClone(this.body); }
}

export const aTransfer = () => new TransferBuilder();
