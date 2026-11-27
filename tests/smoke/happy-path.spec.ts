import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance, expectBalanceInvariant } from '../../src/assertions/money';
import { expectStatus } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';

test.describe('Smoke: onboard, fund, move money', () => {
  test('customer -> account -> deposit -> internal transfer settles', { tag: ['@smoke', '@p0', '@money'] }, async ({ api, world }) => {
    const customer = await world.activeCustomer();
    const from = await world.fundedAccount(usd('500.00'), customer.id);
    const to = await world.activeAccount(customer.id);

    const res = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('120.50')).build());
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ direction: 'internal', rail: 'internal', amount_minor: '12050', status: 'pending' });

    await world.waitForTransfer(res.body.id, 'submitted');
    expectStatus(await api.sandbox.settle(res.body.id), 202);
    const settled = await world.waitForTransfer(res.body.id, 'settled');
    expect(settled.settled_at).toBeTruthy();

    const src = (await api.accounts.get(from.id)).body.balance;
    const dst = (await api.accounts.get(to.id)).body.balance;
    expectBalance(src, { current_minor: usd('379.50'), available_minor: usd('379.50'), pending_minor: '0' });
    expectBalance(dst, { current_minor: usd('120.50'), available_minor: usd('120.50') });
    expectBalanceInvariant(src);
    expectBalanceInvariant(dst);
  });

  test('transfer response follows the documented contract', { tag: ['@smoke', '@contract'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('50.00'));
    const to = await world.activeAccount(from.person_id);
    const { body } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('2500').build());

    expect(body.id).toMatch(/^xfer_/);
    expect(body.source).toEqual(expect.objectContaining({ type: 'account', id: from.id }));
    expect(body.destination).toEqual(expect.objectContaining({ type: 'account', id: to.id }));
    // Money is always an integer string in minor units, never a JSON number.
    for (const f of ['amount_minor', 'fee_quoted_minor', 'fee_charged_minor'] as const) expect(body[f]).toMatch(/^\d+$/);
    expect(['on_top', 'deducted']).toContain(body.fee_mode);
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const ts of ['settled_at', 'failed_at', 'returned_at'] as const) expect(body[ts]).toBeNull();
  });
});
