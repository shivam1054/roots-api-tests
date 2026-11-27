import { test, expect } from '../../src/fixtures/test';
import { aTransfer } from '../../src/builders/transfer.builder';
import { expectProblem, expectStatus } from '../../src/assertions/problem';

test.describe('List transfers', () => {
  test('page envelope, account filter matches either leg, and paging adds up', { tag: ['@contract', '@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('10000');
    const to = await world.activeAccount(from.person_id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('100').build())).body.id);

    // The receiving account sees the same internal transfers.
    const page1 = await api.transfers.list({ account_id: to.id, page: '1', page_size: '2' });
    expectStatus(page1, 200);
    expect(page1.body).toMatchObject({ page: 1, page_size: 2, total: 3 });
    expect(page1.body.data).toHaveLength(2);
    const page2 = (await api.transfers.list({ account_id: to.id, page: '2', page_size: '2' })).body;
    const seen = [...page1.body.data, ...page2.data].map((t) => t.id);
    expect(new Set(seen)).toEqual(new Set(ids)); // no duplicates, nothing missing across pages
  });

  test('status filter returns only that status; refused attempts are listed as failed', { tag: ['@money'] }, async ({ api, world }) => {
    const from = await world.fundedAccount('500');
    const to = await world.activeAccount(from.person_id);
    const refused = await api.transfers.create(aTransfer().from(from.id).toAccount(to.id).amount('900').build());
    expectProblem(refused, 422, 'insufficient_funds');

    const failed = (await api.transfers.list({ account_id: from.id, status: 'failed' })).body.data;
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((t) => t.status === 'failed')).toBe(true);
    expect(failed[0].failure).toMatchObject({ code: 'insufficient_funds' });
  });

  test('invalid page size or status is a 422', { tag: ['@contract'] }, async ({ api }) => {
    expectProblem(await api.transfers.list({ page_size: '101' }), 422, 'validation');
    expectProblem(await api.transfers.list({ page: '0' }), 422, 'validation');
    expectProblem(await api.transfers.list({ status: 'done' }), 422, 'validation');
  });
});
