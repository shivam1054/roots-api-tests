import { test, expect } from '../../src/fixtures/test';
import { env } from '../../src/config/env';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectProblem } from '../../src/assertions/problem';

test.describe('Authentication', () => {
  const cases: [string, string | null][] = [
    ['no Authorization header', null],
    ['not an rts_live_ key', 'sk_test_123'],
    ['unknown rts_live_ key', 'rts_live_this_key_does_not_exist'],
  ];
  for (const [name, token] of cases) {
    test(`401 with ${name}`, { tag: ['@p0', '@security'] }, async ({ api }) => {
      expectProblem(await api.http.request('GET', '/api/v1/accounts/acct_00000000000000000000000000000000', { token }), 401, 'unauthorized');
    });
  }
});

test.describe('Client isolation (IDOR)', () => {
  test.skip(!env.otherClientToken, 'Set ROOTS_OTHER_CLIENT_TOKEN to a second client key to run this against the sandbox');

  test("another client cannot see my account or transfer: 404, not 403", { tag: ['@p0', '@security'] }, async ({ api, world, otherClientApi }) => {
    const from = await world.fundedAccount('5000');
    const to = await world.activeAccount(from.person_id);
    const { body: t } = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('1000').build());

    // 404 (not 403) so an attacker cannot even learn that the id exists.
    expectProblem(await otherClientApi.accounts.get(from.id), 404, 'not_found');
    expectProblem(await otherClientApi.transfers.get(t.id), 404, 'not_found');
    expectProblem(await otherClientApi.accounts.transactions(from.id), 404, 'not_found');
  });

  test('another client cannot move money out of my account', { tag: ['@p0', '@security', '@money'] }, async ({ api, world, otherClientApi }) => {
    const victim = await world.fundedAccount('5000');
    const res = await otherClientApi.transfers.create(aTransfer().from(victim.id).toAccount(victim.id).amount('5000').build());
    expect(res.status).toBe(404);
    expect((await api.accounts.get(victim.id)).body.balance.available_minor).toBe('5000');
  });
});
