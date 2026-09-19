# End-to-end suite

Real-browser (Playwright) and API checks against a running stack. Run with

    ./scripts/e2e.sh                       # all suites, local dev stack (docker compose dev profile up)
    ./scripts/e2e.sh smoke                 # one suite
    TARGET=prod ./scripts/e2e.sh           # production; needs `gcloud auth login` for the DB helper

| suite | what it proves | dev | prod |
|---|---|---|---|
| `smoke` | every page loads without JS errors / 5xx; a workflow runs through Co-pilot and Autopilot; Autopilot stops at the email stage | yes | yes |
| `member_limits` | team owner caps a member (locked for them), blocks reach the member with a reason, `$0` budgets, near-cap refusal | yes | yes |
| `concurrency` | 6 simultaneous real AI requests against a budget with room for 2: at most 2 run, the rest are refused, nothing stays reserved | yes | yes |
| `alerts` | a real call crossing an alert-only budget succeeds and records the alert (which is queued to Celery, not sent inline) | yes | yes |
| `budget_caps` | personal / team / project caps, a blocked workflow stage, per-stage cost view (seeds usage rows) | yes | skipped |

Also here: `./scripts/test_nginx_failover.sh` (needs docker, not part of `run.js`) loads the real host-nginx
config and proves the deploy protocol - drain a backend, restart it, restore it - loses no GET or POST while
traffic is flowing.

## Safety rules (read before adding a test)

- **Never email anyone but `@enableyou.co`.** Every account the suite creates is
  `e2e_<label>_<time>@enableyou.co` (`lib.js` enforces the domain), and no suite
  approves an email-sending stage: they skip it.
- Accounts, projects, workflow runs and their usage-log rows are deleted at the end
  of each suite (also when it fails).
- `smoke`, `alerts` and `concurrency` make a few real (cheap) AI calls: well under a
  cent, under a cent, and about two cents respectively. Everything that is *supposed to be blocked*
  is refused before any provider is reached.
- Adding a team member without an invite email is done with a direct insert
  (`lib.js` `db()`), which needs docker (dev) or `gcloud` (prod).

## Adding a suite

Create `e2e/tests/<name>.js` exporting `title`, optional `devOnly` (a reason), and
`run(t)`. `t` has `request`, `newUser`, `page(user)`, `db`, `seedUsage` (dev),
`check`, `log`, `onCleanup`. See `lib.js`.
