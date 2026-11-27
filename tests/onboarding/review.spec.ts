import { test, expect } from '../../src/fixtures/test';
import { aCustomer } from '../../src/builders/person.builder';
import { expectProblem, expectStatus } from '../../src/assertions/problem';

test.describe('Onboarding and compliance review', () => {
  test('incomplete file is refused with every gap listed', { tag: ['@p0', '@contract'] }, async ({ api }) => {
    const p = await api.persons.create(aCustomer().without('date_of_birth').without('tax_number').build());
    expectStatus(p, 201);

    const res = await api.persons.submitReview(p.body.id);
    expectProblem(res, 422, 'review_not_ready');
    const paths = res.problem!.violations!.map((v) => v.path);
    // One 422 lists every gap, so the client can fix everything in one go.
    expect(paths).toEqual(expect.arrayContaining(['details.date_of_birth', 'details.tax_number']));
    expect(paths.some((x) => x.includes('documents'))).toBe(true);
  });

  test('sanctioned person is denied and cannot open an account', { tag: ['@p0', '@compliance'] }, async ({ api }) => {
    const p = (await api.persons.create(aCustomer().sanctioned().build())).body;
    await api.documents.upload(p.id, 'passport');
    await api.documents.upload(p.id, 'utility_bill');
    await api.persons.submitReview(p.id);

    const person = (await api.persons.get(p.id)).body;
    expect(person).toMatchObject({ status: 'inactive', status_detail: 'review_denied' });
    expectProblem(await api.accounts.create(p.id), 422, 'person_review_not_cleared');
  });

  test('referred person waits for a manual decision, then can be cleared', { tag: ['@compliance'] }, async ({ api, world }) => {
    const p = (await api.persons.create(aCustomer().referred().build())).body;
    await api.documents.upload(p.id, 'passport');
    await api.documents.upload(p.id, 'utility_bill');
    await api.persons.submitReview(p.id);

    expect((await api.persons.get(p.id)).body).toMatchObject({ status: 'pending', status_detail: 'in_review' });
    expectProblem(await api.accounts.create(p.id), 422, 'person_review_not_cleared');

    expectStatus(await api.sandbox.decideReview(p.id, 'cleared'), 202);
    await world.waitForPerson(p.id, 'active');
    expectStatus(await api.accounts.create(p.id), 201);
  });

  test('a cleared file is locked: no new documents', { tag: ['@compliance'] }, async ({ api, world }) => {
    const person = await world.activeCustomer();
    expectProblem(await api.documents.upload(person.id, 'bank_statement'), 409, 'conflict');
  });
});
