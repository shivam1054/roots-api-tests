import { test, expect } from '../../src/fixtures/test';
import { aCustomer } from '../../src/builders/person.builder';
import { expectProblem, expectStatus } from '../../src/assertions/problem';

/** POST /persons/{id}/role and PATCH /persons/{id}: roles are set once; cleared files are closed to edits. */
test.describe('Person roles and edits', () => {
  test('a person without a role cannot hold an account until given one', { tag: ['@p0', '@compliance'] }, async ({ api, world }) => {
    const person = await world.activeCustomer(aCustomer().withoutRole());
    expect(person.role).toBeNull();
    expect((await api.accounts.create(person.id)).status).toBe(422);

    const res = await api.persons.setRole(person.id, 'customer');
    expectStatus(res, 200);
    expect(res.body.role).toBe('customer');
    expectStatus(await api.accounts.create(person.id), 201);
  });

  test('a role never changes once set; repeating it is a no-op', { tag: ['@compliance', '@contract'] }, async ({ api, world }) => {
    const person = await world.activeCustomer();
    expectStatus(await api.persons.setRole(person.id, 'customer'), 200);
    expectProblem(await api.persons.setRole(person.id, 'own'), 422, 'validation'); // an individual is never `own`
  });

  test('a cleared file is closed to edits: a change needs a new review', { tag: ['@p0', '@compliance'] }, async ({ api, world }) => {
    const person = await world.activeCustomer();
    expectProblem(await api.persons.patch(person.id, { details: { last_name: 'Changed' } }), 409, 'conflict');
    expect((await api.persons.get(person.id)).body).toMatchObject({ status: 'active' });
  });

  test('a person with an open file can be edited before review', { tag: ['@contract'] }, async ({ api }) => {
    const p = (await api.persons.create(aCustomer().without('email').build())).body;
    expectStatus(await api.persons.patch(p.id, { details: { email: 'sam@example.com' } }), 200);
  });
});
