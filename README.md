# Roots API test automation

API test framework for the [Roots](https://docs.roots.finance) USD accounts API, built with **Playwright Test + TypeScript**.

The suite runs in two modes:

- **Mock (default).** A local mock server built from the public Roots docs starts automatically. No API key is needed, so anyone can clone the repo and get a green run.
- **Sandbox.** The same tests run against the real Roots sandbox: `ROOTS_TARGET=sandbox`.

```bash
npm install
npm test                # full suite against the mock (about 25 s)
npm run test:smoke      # smoke only
npm run test:p0         # P0: what blocks a merge
npm run test:money      # everything that moves balances
npm run report          # open the HTML report

cp .env.example .env    # fill in ROOTS_API_TOKEN
npm run test:sandbox    # same suite against the real sandbox
```

## What is covered

| Area | Example checks |
|---|---|
| Smoke | Onboard a customer, open and fund an account, move money, check both balances |
| Onboarding and compliance | `review_not_ready` lists every gap. A sanctioned person is denied and can't open an account. A referred person waits for a manual decision. A cleared file is locked. |
| Accounts | Provisioning to active, close refused while there's a balance, frozen accounts can't send, closed is terminal |
| Internal transfers | Hold while in flight (available ↓, pending ↑, current unchanged), moves exactly once, insufficient funds, a decline releases the hold, 8 invalid amount formats |
| Withdrawals | ACH settles and the fee posts once. Rejected at submission. **Settled then returned (R03): principal back, fee kept, `settled_at` kept.** Blocked counterparty. Unsupported rail. Account number masked. |
| Idempotency | Replay returns the same transfer (`Idempotent-Replayed`). Different body gives 409. Byte-exact comparison. Missing key gives 422. The same key twice in parallel creates one transfer. A refusal is replayed. |
| Concurrency | Two $80 transfers from $100 at once: exactly one wins and the balance never goes negative. 10 parallel transfers add up to the cent. |
| Security | 401 for missing, malformed or unknown keys. **Another client gets 404 (not 403)** for my accounts and transfers and can't move my money. Error bodies never leak stack traces. |
| Webhooks | HMAC-SHA256 signature check, tampered body, wrong secret, stale timestamp, a forged timestamp, malformed headers, duplicate events |

## Structure

```
src/
  config/env.ts            mock or sandbox, base URL, tokens, poll timeout
  http/RootsHttp.ts        auth + Idempotency-Key headers, keeps the exact bytes sent, parses problem+json
  clients/                 one typed client per resource: persons, documents, accounts, counterparties, transfers, sandbox
  models/types.ts          types from the Roots docs
  money/money.ts           BigInt money helpers: no floats anywhere
  builders/                test data builders (aCustomer().sanctioned(), aTransfer().from(a).toAccount(b))
  fixtures/test.ts         Playwright fixtures: api, otherClientApi, world (activeCustomer, fundedAccount, waitForTransfer)
  assertions/              expectProblem, expectBalance, expectBalanceInvariant, expectSourceCost, expectFeeMatchesLedger
  utils/poll.ts            wait on state, never sleep
  webhooks/signature.ts    Roots-Signature verification + event dedupe
tests/                     smoke, onboarding, accounts, transfers, idempotency, security, webhooks
mock-server/server.ts      local mock of the documented Roots behaviour
```

## Design decisions

- **Money is never a float.** Amounts are integer minor-unit strings, compared with BigInt and printed in dollars on failure (`expected $70.00, got $69.99`).
- **Every money test checks the ledger, not just the status code.** For example: `current = available + pending`, the source's principal and fee entries equal the cost, the fee entries equal `fee_charged_minor`, and hold and release entries are never counted as cost.
- **Wait on state, never sleep.** A `201` means accepted, not settled, so tests poll for the status they need.
- **Each test creates its own data**, so tests run in parallel and never depend on each other.
- **No automatic retries** (`retries: 0`). A retried money test hides real bugs. A flaky test is fixed or quarantined.
- **Clients never throw on 4xx or 5xx.** Tests assert status codes and stable error `code`s explicitly, as the Roots docs recommend (branch on `code`, never on `detail`).
- **Sandbox test values are named constants** (`SANDBOX_ACCOUNTS.settlesThenReturnedR03`), not magic strings.

## Tags and CI gates

| Tag | Meaning |
|---|---|
| `@smoke` | Under a minute, proves the main path works |
| `@p0` | Money or security critical: blocks merge |
| `@money` | Moves or checks balances |
| `@security`, `@compliance`, `@contract`, `@webhooks` | By area |
| `@mock-only` | Relies on mock behaviour. Excluded from sandbox runs. |

| When | What runs | Where |
|---|---|---|
| Every pull request | typecheck + `@smoke` and `@p0` against the mock | blocks merge |
| Merge to main | full suite against the mock | blocks deploy |
| Nightly | full suite against the real Roots sandbox | alerts the team |

Pipelines are provided for both GitHub Actions (`.github/workflows/api-tests.yml`) and GitLab (`.gitlab-ci.yml`).

## Limits of the mock

The mock follows the Roots docs, but it is a simulation:

- Fee amounts (ACH $0.25, same-day $1.00, Fedwire $15.00) and timings are invented. Tests read fees from the API instead of hard-coding them.
- Internal transfers place a hold while in flight. The docs describe holds for withdrawals, so this needs confirming against the sandbox.
- Business onboarding, webhook delivery, reserves, billing and fees endpoints aren't simulated yet.

Running `npm run test:sandbox` is the real check. Any difference between the mock and the sandbox is either a mock fix or a question for the Roots team.

## Next steps

1. Run against the real sandbox and align the mock with any differences.
2. Generate types from the Roots OpenAPI spec and validate every response against it.
3. A webhook receiver test that subscribes to sandbox events and checks `transfer.status.changed` against the API.
4. Business onboarding (associations, UBOs, asynchronous review).
5. k6 load tests on `POST /transfers` for locking and rate limits under load.

## Mock vs real sandbox

| | Mock (default) | Roots sandbox |
|---|---|---|
| Needs an API key | No | Yes (`ROOTS_API_TOKEN` in `.env`) |
| Command | `npm test` | `npm run test:sandbox` |
| Fees and timings | Assumed values, see "Limits of the mock" | Real |
| Cross-client isolation test | Runs (two mock clients) | Runs only if `ROOTS_OTHER_CLIENT_TOKEN` is set |
