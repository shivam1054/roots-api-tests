import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance, expectBalanceInvariant } from '../../src/assertions/money';
import { expectProblem, expectStatus } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';
import type { ApiResult } from '../../src/http/RootsHttp';
import type { Transfer } from '../../src/models/types';

/**
 * POST /transfers/{id}/cancel. Only withdrawals can be cancelled: before the bank has them,
 * or ACH once sent (Fedwire cannot be recalled). Every cancel gives the hold back.
 */
test.describe('Cancel a transfer', () => {
  /** "Still being created or sent" is a retryable 409: try again for a few seconds. */
  async function cancelWithRetry(cancel: () => Promise<ApiResult<Transfer>>) {
    for (let i = 0; i < 10; i++) {
      const r = await cancel();
      if (r.problem?.code !== 'transfer_cancel_unavailable') return r;
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error('cancel still unavailable after retries');
  }

  test('ACH withdrawal cancelled early: no money moves, hold released, no fee', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('500.00'));
    const cpty = await world.counterparty(from.person_id);
    const created = await world.withdrawal(from.id, cpty.id, usd('200.00'));
    expectStatus(created, 201);
    expect(created.body.cancelable).toBe(true);

    expectStatus(await cancelWithRetry(() => api.transfers.cancel(created.body.id)), 200);
    const t = await world.waitForTransfer(created.body.id, 'cancelled');
    expect(['cancelled_before_submission', 'cancelled_at_bank']).toContain(t.status_detail);
    expect(t.failure, 'a cancel is not a failure').toBeNull();
    expect(t.cancelled_at).toBeTruthy();
    expect(t.settled_at).toBeNull();
    expect(t.fee_charged_minor).toBe('0');
    expect(t.cancelable).toBe(false);

    const bal = (await api.accounts.get(from.id)).body.balance;
    expectBalance(bal, { available_minor: usd('500.00'), pending_minor: '0', current_minor: usd('500.00') });
    expectBalanceInvariant(bal);
  });

  test('ACH already at the bank: cancel is requested, then confirmed', { tag: ['@money', '@mock-only'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('500.00'));
    const cpty = await world.counterparty(from.person_id);
    const { body } = await world.withdrawal(from.id, cpty.id, usd('100.00'));
    await world.waitForTransfer(body.id, 'submitted');

    const res = await api.transfers.cancel(body.id);
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ status: 'submitted', status_detail: 'cancel_requested' });
    expect(res.body.cancel_requested_at).toBeTruthy();

    const t = await world.waitForTransfer(body.id, 'cancelled');
    expect(t.status_detail).toBe('cancelled_at_bank');
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('500.00'), pending_minor: '0' });
  });

  test('a wire already sent cannot be cancelled', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('500.00'));
    const cpty = await world.counterparty(from.person_id, (b) => b.withRails('ach', 'fedwire'));
    const { body } = await world.withdrawal(from.id, cpty.id, usd('100.00'), 'fedwire');
    const sent = await world.waitForTransfer(body.id, 'submitted', 'settled');
    expect(sent.cancelable).toBe(false);

    expectProblem(await api.transfers.cancel(body.id), 409, 'transfer_not_cancelable');
    expect((await api.transfers.get(body.id)).body.status).not.toBe('cancelled');
  });

  test('internal transfers and finished transfers are never cancelable', { tag: ['@p0', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const { body: internal } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('1000').build());
    expect(internal.cancelable).toBe(false);
    expectProblem(await api.transfers.cancel(internal.id), 409, 'transfer_not_cancelable');

    const cpty = await world.counterparty(from.person_id);
    const { body: w } = await world.withdrawal(from.id, cpty.id, '1000');
    await world.waitForTransfer(w.id, 'settled');
    expectProblem(await api.transfers.cancel(w.id), 409, 'transfer_not_cancelable');
  });

  test('cancelling twice is safe: second call returns the transfer unchanged', { tag: ['@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const { body } = await world.withdrawal(from.id, cpty.id, usd('10.00'));
    await cancelWithRetry(() => api.transfers.cancel(body.id));
    const first = await world.waitForTransfer(body.id, 'cancelled');

    const again = await api.transfers.cancel(body.id);
    expectStatus(again, 200);
    expect(again.body.cancelled_at).toBe(first.cancelled_at);
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00') });
  });

  test('cancel requires an Idempotency-Key', { tag: ['@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const { body } = await world.withdrawal(from.id, cpty.id, usd('10.00'));
    expectProblem(await api.transfers.cancel(body.id, { idempotencyKey: null }), 422, 'validation');
  });
});
