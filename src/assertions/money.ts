import { expect } from '@playwright/test';
import type { Balance, LedgerEntry, MinorUnits, Transfer } from '../models/types';
import { add, format, neg, toBig } from '../money/money';

/** Exact balance check, printed in dollars on failure. */
export function expectBalance(actual: Balance, expected: Partial<Record<keyof Balance, MinorUnits>>) {
  for (const [field, value] of Object.entries(expected) as [keyof Balance, MinorUnits][]) {
    expect(format(actual[field]), field).toBe(format(value));
  }
}

/**
 * With no deposits in flight, every cent is either spendable or held:
 * current = available + pending. Must hold after every money test.
 */
export function expectBalanceInvariant(b: Balance) {
  for (const v of Object.values(b)) expect(v, 'amounts are integer strings in minor units').toMatch(/^-?\d+$/);
  expect(toBig(b.available_minor), 'available must never go negative').toBeGreaterThanOrEqual(0n);
  expect(format(add(b.available_minor, b.pending_minor)), 'available + pending = current').toBe(format(b.current_minor));
}

/**
 * The cost of a transfer to the source account is the sum of its principal and fee entries.
 * Holds and releases are bookkeeping and must never be added in (Roots reconciliation guide).
 */
export function expectSourceCost(entries: LedgerEntry[], accountId: string, expectedCost: MinorUnits) {
  const own = entries.filter((e) => e.account_id === accountId && (e.type === 'principal' || e.type === 'fee'));
  expect(format(add('0', ...own.map((e) => e.amount_minor))), 'principal + fee for source').toBe(format(neg(expectedCost)));
}

/** Fee posted to the ledger must equal fee_charged_minor on the transfer. */
export function expectFeeMatchesLedger(t: Transfer, entries: LedgerEntry[]) {
  const fees = entries.filter((e) => e.type === 'fee').map((e) => e.amount_minor);
  expect(format(neg(add('0', ...fees))), 'sum of fee entries = fee_charged_minor').toBe(format(t.fee_charged_minor));
}
