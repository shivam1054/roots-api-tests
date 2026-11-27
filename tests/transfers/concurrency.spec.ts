import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectBalanceInvariant } from '../../src/assertions/money';
import { toBig, usd } from '../../src/money/money';

test.describe('Concurrency', () => {
  test('two $80 transfers at once from $100: the balance never goes negative', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const send = () => api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount(usd('80.00')).build());

    const results = await Promise.all([send(), send()]);
    const accepted = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status !== 201);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Either the account lock (429 + Retry-After) or the funds check stops the second one.
    expect(['rate_limited', 'insufficient_funds']).toContain(refused[0].problem?.code);
    if (refused[0].problem?.code === 'rate_limited') {
      expect(refused[0].headers['retry-after']).toBeTruthy();
      // Retrying after Retry-After must still be refused for funds.
      const retry = await send();
      expect(retry.problem?.code).toBe('insufficient_funds');
    }

    const bal = (await api.accounts.get(from.id)).body.balance;
    expect(toBig(bal.available_minor)).toBe(toBig(usd('20.00')));
    expectBalanceInvariant(bal);
  });

  test('ten small transfers in parallel: totals add up to the cent', { tag: ['@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const to = await world.activeAccount(from.person_id);
    const body = () => aTransfer().from(from.id).toAccount(to.id).amount('333').build(); // $3.33, awkward on purpose

    // Locked accounts answer 429 with Retry-After, so retry politely until each one is accepted.
    const sendWithRetry = async () => {
      for (let i = 0; i < 20; i++) {
        const r = await api.transfers.create(body());
        if (r.status !== 429) return r;
        await new Promise((res) => setTimeout(res, Number(r.headers['retry-after'] ?? 1) * 50));
      }
      throw new Error('still rate limited after 20 tries');
    };
    const results = await Promise.all(Array.from({ length: 10 }, sendWithRetry));
    expect(results.every((r) => r.status === 201)).toBe(true);
    await Promise.all(results.map(async (r) => { await world.waitForTransfer(r.body.id, 'submitted'); await api.sandbox.settle(r.body.id); }));
    await Promise.all(results.map((r) => world.waitForTransfer(r.body.id, 'settled')));

    expect((await api.accounts.get(from.id)).body.balance.current_minor).toBe(usd('66.70'));
    expect((await api.accounts.get(to.id)).body.balance.current_minor).toBe(usd('33.30'));
  });

  test('two withdrawals that together exceed the balance cannot both be accepted', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount(usd('100.00'));
    const cpty = await world.counterparty(from.person_id);
    const results = await Promise.all([world.withdrawal(from.id, cpty.id, usd('70.00')), world.withdrawal(from.id, cpty.id, usd('70.00'))]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const loser = results.find((r) => r.status !== 201)!;
    expect(['rate_limited', 'insufficient_funds']).toContain(loser.problem?.code);
    if (loser.problem?.code === 'rate_limited') expect((await world.withdrawal(from.id, cpty.id, usd('70.00'))).problem?.code).toBe('insufficient_funds');

    const winner = results.find((r) => r.status === 201)!;
    await world.waitForTransfer(winner.body.id, 'settled');
    const bal = (await api.accounts.get(from.id)).body.balance;
    expect(toBig(bal.current_minor)).toBeGreaterThanOrEqual(0n);
    expectBalanceInvariant(bal);
  });
});
