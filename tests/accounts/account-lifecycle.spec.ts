import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectProblem, expectStatus } from '../../src/assertions/problem';

test.describe('Account lifecycle', () => {
  test('new account provisions to active with zero balances as strings', { tag: ['@smoke'] }, async ({ api, world }) => {
    const person = await world.activeCustomer();
    const created = await api.accounts.create(person.id);
    expectStatus(created, 201);
    expect(created.body.id).toMatch(/^acct_/);

    const active = await world.waitForAccount(created.body.id, (a) => a.status === 'active');
    expect(active.status_detail).toBeNull();
    expect(active.capabilities).toEqual({ send: 'active', receive: 'active' });
    expect(active.balance).toEqual({ available_minor: '0', pending_minor: '0', current_minor: '0' });
  });

  test('account with money cannot be closed', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const acct = await world.fundedAccount('1000');
    expectProblem(await api.accounts.setStatus(acct.id, 'closed'), 409, 'account_has_balance');
  });

  test('frozen account cannot send money, and works again after unfreeze', { tag: ['@p0', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('5000');
    const to = await world.activeAccount(from.person_id);
    expectStatus(await api.accounts.setStatus(from.id, 'frozen'), 200);
    expect((await api.accounts.get(from.id)).body.capabilities.send).toBe('inactive');

    expectProblem(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('1000').build()), 409, 'account_not_active');

    expectStatus(await api.accounts.setStatus(from.id, 'active'), 200);
    expectStatus(await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('1000').build()), 201);
  });

  test('closed is terminal', { tag: ['@contract'] }, async ({ api, world }) => {
    const acct = await world.activeAccount();
    expectStatus(await api.accounts.setStatus(acct.id, 'closed'), 200);
    expectProblem(await api.accounts.setStatus(acct.id, 'active'), 409, 'illegal_transition');
  });
});
