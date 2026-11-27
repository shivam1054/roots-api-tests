import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalance, expectBalanceInvariant, expectSourceCost } from '../../src/assertions/money';
import { expectProblem } from '../../src/assertions/problem';
import { usd } from '../../src/money/money';

test.describe('Internal transfers', () => {
  test('money is held while in flight, then moves exactly once', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);

    const { body: t } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('30.00')).build());
    await world.waitForTransfer(t.id, 'submitted');

    // In flight: available drops, pending rises, current is unchanged (Roots reconciliation guide).
    const inFlight = (await api.accounts.get(from.id)).body.balance;
    expectBalance(inFlight, { available_minor: usd('70.00'), pending_minor: usd('30.00'), current_minor: usd('100.00') });
    expectBalanceInvariant(inFlight);

    await api.sandbox.settle(t.id);
    await world.waitForTransfer(t.id, 'settled');

    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('70.00'), pending_minor: '0', current_minor: usd('70.00') });
    expectBalance((await api.accounts.get(to.id)).body.balance, { current_minor: usd('30.00') });

    const entries = (await api.transfers.transactions(t.id)).body.data;
    expectSourceCost(entries, from.id, usd('30.00'));
    const credit = entries.filter((e) => e.account_id === to.id && e.type === 'principal');
    expect(credit.map((e) => e.amount_minor)).toEqual([usd('30.00')]);
  });

  test('insufficient funds is refused and nothing moves', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('10.00'));
    const to = await world.activeAccount(from.person_id);

    expectProblem(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('10.01')).build()), 422, 'insufficient_funds');
    expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('10.00'), pending_minor: '0', current_minor: usd('10.00') });
  });

  test('declined transfer releases the hold in full', { tag: ['@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('5.00'));
    const to = await world.activeAccount(from.person_id);
    // Sandbox: an internal transfer of 13 minor units is declined.
    const { body } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('13').build());

    const failed = await world.waitForTransfer(body.id, 'failed');
    expect(failed.failure?.code).toBe('payment_failed');
    expect(failed.settled_at).toBeNull();
    const bal = (await api.accounts.get(from.id)).body.balance;
    expectBalance(bal, { available_minor: usd('5.00'), pending_minor: '0', current_minor: usd('5.00') });

    const types = (await api.transfers.transactions(body.id)).body.data.map((e) => e.type);
    expect(types).toEqual(['hold', 'release']); // no principal entry: no money moved
  });

  // Amounts must be positive integer strings. Floats and numbers are where money bugs start.
  const badAmounts: [string, unknown][] = [
    ['negative', '-500'], ['zero', '0'], ['decimal string', '10.50'], ['JSON number', 1000],
    ['float number', 10.5], ['text', 'abc'], ['empty', ''], ['exponent', '1e3'],
  ];
  for (const [name, amount] of badAmounts) {
    test(`rejects ${name} amount: ${JSON.stringify(amount)}`, { tag: ['@p0', '@money', '@contract'] }, async ({ api, world }) => {
      const from = await world.fundedAccount(usd('100.00'));
      const to = await world.activeAccount(from.person_id);
      const res = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).with('amount_minor', amount).build());
      expectProblem(res, 422, 'validation');
      expect(res.problem!.violations!.map((v) => v.path)).toContain('amount_minor');
      expectBalance((await api.accounts.get(from.id)).body.balance, { available_minor: usd('100.00') });
    });
  }

  test('cannot send to the same account', { tag: ['@contract'] }, async ({ api, world }) => {
    const acct = await world.fundedAccount('1000');
    expectProblem(await api.transfers.create(aTransfer().from(acct.id).toAccount(acct.id).amount('100').build()), 422, 'validation');
  });
});
