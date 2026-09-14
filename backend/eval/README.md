# Evaluation Framework

Regression fixtures for the 6 functions in this codebase that call an LLM
and produce output worth judging for quality (see `docs/todo/active-priorities.md`
Section 9 — "10-15 real input/output pairs... as a CI regression fixture").
Everything else in the 7 agent packages is CRUD with nothing to evaluate.

## What this covers

| Function | Fixture file | Cases |
|---|---|---|
| `generate_content_marketing()` (`app.py`) | `fixtures/generate_content_marketing.yaml` | 12 |
| `content_marketing_chat()` (`app.py`) | `fixtures/content_marketing_chat.yaml` | 12 |
| `DomainSpecializationAnalyzer.analyze_documents()` (`app.py`) | `fixtures/analyze_documents.yaml` | 7 |
| `DocumentService.chat()` (document_intelligence) | `fixtures/document_intelligence_chat.yaml` | 14 |
| `DocumentService.get_document_insight()` (document_intelligence) | `fixtures/document_intelligence_insight.yaml` | 7 |
| `generate_email_content()` (`app.py`) | `fixtures/generate_email_content.yaml` | 12 |

**Two files have 7 cases, not 10-15**: `analyze_documents` and
`document_intelligence_insight` both take a single document as their
entire input (no query/message parameter) — there's no way to get 10-15
non-redundant cases without inventing near-duplicate documents just to
hit a number. Both use one real, distinct document per industry instead
(matching the 7 industries in `DomainSpecializationAnalyzer`'s own
`industry_keywords` dict) — a more meaningful eval than padding.

**Excluded, not silently dropped**: `market_research`'s
`generate_requirements()`/`recommend_agents()` are real LLM-calling
functions but are unrelated to that agent's actual (currently stubbed)
research pipeline — flagged in the plan, easy to add later if wanted; they'd
follow the same plain-payload (Group A) pattern as `generate_email_content`.

## Running locally

Needs a real Postgres instance and real `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`
— every case makes a real LLM call, nothing is mocked. Costs a small amount
of real money per run (~55 LLM calls total across all fixtures).

```bash
createdb enable_agents_eval   # once
cd backend
mv ../.env /tmp/_env_bak 2>/dev/null; mv ../.env.docker /tmp/_env_docker_bak 2>/dev/null
DATABASE_URI=postgresql://localhost:5432/enable_agents_eval \
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
python eval/runner.py
mv /tmp/_env_bak ../.env 2>/dev/null; mv /tmp/_env_docker_bak ../.env.docker 2>/dev/null
```

The `.env` shuffle is only needed if you have real dev `.env` files checked
out locally — `app.py` loads them with `override=True` at import time,
which clobbers the env vars set above. See `runner.py`'s module docstring.
Not a concern in CI (clean checkout, no such files).

## Running in CI

Manual only for now (`workflow_dispatch` on the `eval-suite` job in
`.github/workflows/ci.yml`) — not on every push/PR, given the real API
cost and latency of ~55 LLM calls per run. Requires `OPENAI_API_KEY`/
`ANTHROPIC_API_KEY` configured as GitHub Actions secrets (not set up by
this change — a real prerequisite for whoever runs this job).

## Scoring

Deterministic only: case-insensitive keyword presence, and JSON-key
presence for structured outputs (`backend/eval/scoring.py`). No LLM-as-
judge — every function here runs at a non-zero temperature (0.7 for
content_marketing/email, 0.3 for document_intelligence, `temperature=0`
only for `analyze_documents`), so keyword/structural checks are the
"start tiny" gate; exact-string-match would never pass reliably regardless
of scoring sophistication. LLM-as-judge is a real, deliberately deferred
next step, not an oversight — it needs its own design pass (which judge
model, how to keep the judge itself from being the flaky part).

## Output

`report.json` and `report.md` (gitignored, regenerated each run) — pass/fail
per case, the actual response for failures, and which model/provider/cost
served each call (read back from `AIUsageLog` right after each call, since
`ai_chat_completion()`'s return value doesn't expose this uniformly across
providers — see `runner.py::latest_usage()`).

## What this is not

No CI gating on every push (by design, see above), no quality dashboard,
no failure-category taxonomy. Those are what this unblocks (Section 16/17
of the same checklist), not what this builds.
