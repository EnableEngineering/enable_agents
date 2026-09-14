"""
Evaluation harness — runs the 10-15-pairs-per-function regression fixtures
against the real, live app.py routes and scores the results.

Usage (from backend/):
    python eval/runner.py

Needs a real Postgres instance (DATABASE_URI/DATABASE_URL) and real
OPENAI_API_KEY/ANTHROPIC_API_KEY - every case here makes a real LLM call,
there is no mocking. Costs real (small) money per run.

LOCAL RUNS ONLY - if you have real .env/.env.docker/backend/.env files
checked out, app.py loads them with override=True at import time, which
will clobber the env vars this script sets below. Move them aside first:
    mv .env /tmp/_env_bak && mv .env.docker /tmp/_env_docker_bak
    python backend/eval/runner.py
    mv /tmp/_env_bak .env && mv /tmp/_env_docker_bak .env.docker
CI (workflow_dispatch, see .github/workflows/ci.yml) checks out a clean
tree with no such files, so this isn't a concern there.
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import yaml

EVAL_DIR = Path(__file__).parent
FIXTURES_DIR = EVAL_DIR / "fixtures"
DOCUMENTS_DIR = FIXTURES_DIR / "documents"
BACKEND_DIR = EVAL_DIR.parent

os.environ.setdefault("DATABASE_URI", os.environ.get("DATABASE_URL") or "postgresql://localhost:5432/enable_agents_eval")
os.environ.setdefault("SECRET_KEY", "eval-harness-secret-key")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("PUBLIC_URL", "http://localhost:5000")
os.environ.setdefault("GOOGLE_CLIENT_ID", "eval-harness")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "eval-harness")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")
# Avoids picking up real local AWS SSO credentials when boto3.client('s3')
# is constructed at app.py import time - unrelated to this eval, but
# app.py does it unconditionally at module load.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "eval-harness")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "eval-harness")

sys.path.insert(0, str(BACKEND_DIR))

from app import app  # noqa: E402
from core.celery_app import celery  # noqa: E402
from core.database import db  # noqa: E402
from core.models import AIUsageLog, Project, Team  # noqa: E402
from core.session_token import issue_browser_session_token  # noqa: E402

sys.path.insert(0, str(EVAL_DIR))
from scoring import score_case  # noqa: E402

celery.conf.task_always_eager = True
celery.conf.task_eager_propagates = True

EVAL_USER_ID = "eval-harness@enableyou.co"

# Which response fields to check `expect.keywords` against, and which
# sub-dict path (dotted, None = root) to check `expect.json_keys` against,
# per function. See backend/eval/scoring.py.
FUNCTION_CONFIG = {
    "generate_content_marketing": {"text_fields": ["content"], "json_keys_path": None},
    "content_marketing_chat": {"text_fields": ["response"], "json_keys_path": None},
    "analyze_documents": {
        "text_fields": ["industry", "sector", "function", "role", "target_audience", "value_proposition", "tone", "key_themes"],
        "json_keys_path": None,
    },
    "document_intelligence_chat": {"text_fields": ["answer"], "json_keys_path": None},
    "document_intelligence_insight": {"text_fields": ["summary", "keyFacts", "recommendations"], "json_keys_path": None},
    "generate_email_content": {"text_fields": ["subject", "body"], "json_keys_path": None},
}


def load_fixtures(name):
    with open(FIXTURES_DIR / f"{name}.yaml") as f:
        return yaml.safe_load(f)


def bearer_headers():
    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], EVAL_USER_ID)
    return {"Authorization": f"Bearer {token}"}


def latest_usage(agent_name):
    with app.app_context():
        row = (
            AIUsageLog.query.filter_by(agent=agent_name)
            .order_by(AIUsageLog.created_at.desc())
            .first()
        )
        if not row:
            return None
        return {"provider": row.provider, "model": row.model, "cost_usd": round(row.estimated_cost_usd, 6)}


def create_cm_project(client, headers, name):
    res = client.post("/api/content-marketing/projects", json={"project_name": name}, headers=headers)
    assert res.status_code in (200, 201), f"create_cm_project failed: {res.status_code} {res.get_json()}"
    return res.get_json()["project_id"]


def upload_cm_document(client, headers, project_id, doc_filename):
    doc_path = DOCUMENTS_DIR / doc_filename
    with open(doc_path, "rb") as f:
        res = client.post(
            "/api/content-marketing/documents/upload",
            data={"project_id": project_id, "files": (f, doc_filename)},
            headers=headers,
        )
    assert res.status_code == 201, f"upload_cm_document({doc_filename}) failed: {res.status_code} {res.get_json()}"
    return res.get_json()


def create_platform_project(user_id):
    with app.app_context():
        team = Team(team_id=f"eval-team-{uuid4().hex[:10]}", owner_id=user_id, name="Eval Harness Team")
        project = Project(project_id=f"eval-proj-{uuid4().hex[:10]}", team_id=team.team_id, owner_id=user_id, name="Eval Harness Project")
        db.session.add(team)
        db.session.add(project)
        db.session.commit()
        return project.project_id


def upload_di_document(client, headers, project_id, doc_filename):
    doc_path = DOCUMENTS_DIR / doc_filename
    with open(doc_path, "rb") as f:
        res = client.post(
            "/api/document-intelligence/upload",
            data={"project_id": project_id, "file": (f, doc_filename)},
            headers=headers,
        )
    assert res.status_code == 201, f"upload_di_document({doc_filename}) failed: {res.status_code} {res.get_json()}"
    document_id = res.get_json()["document_id"]

    status = None
    for attempt in range(10):
        status_res = client.get(f"/api/document-intelligence/status/{document_id}?project_id={project_id}", headers=headers)
        status = (status_res.get_json() or {}).get("status")
        if status == "completed":
            break
        time.sleep(1)
    return document_id, status


def run_offline_scored(cases, values_by_doc, function_key):
    config = FUNCTION_CONFIG[function_key]
    results = []
    for case in cases:
        response_json = values_by_doc.get(case["fixture_document"], {})
        score = score_case(response_json, config["text_fields"], case["expect"], config["json_keys_path"])
        results.append({
            "name": case["name"],
            "passed": score["passed"],
            "checks": score["checks"],
            "response": response_json,
            "usage": None,  # scored from setup-time data, not its own call
        })
    return results


def run_http_scored(client, headers, cases, function_key, agent_name, method, build_path, build_payload=None):
    config = FUNCTION_CONFIG[function_key]
    results = []
    for case in cases:
        path = build_path(case)
        if method == "get":
            res = client.get(path, headers=headers)
        else:
            payload = build_payload(case)
            res = client.post(path, json=payload, headers=headers)

        response_json = res.get_json() or {}
        if res.status_code >= 400:
            results.append({
                "name": case["name"],
                "passed": False,
                "checks": {"http_status": {"passed": False, "detail": f"HTTP {res.status_code}: {response_json}"}},
                "response": response_json,
                "usage": None,
            })
            continue

        score = score_case(response_json, config["text_fields"], case["expect"], config["json_keys_path"])
        results.append({
            "name": case["name"],
            "passed": score["passed"],
            "checks": score["checks"],
            "response": response_json,
            "usage": latest_usage(agent_name),
        })
    return results


def run():
    headers = bearer_headers()
    client = app.test_client()

    report = {"generated_at": datetime.utcnow().isoformat(), "functions": {}}

    # ---- content_marketing: one project per unique fixture document ----
    gcm_cases = load_fixtures("generate_content_marketing")
    cmc_cases = load_fixtures("content_marketing_chat")
    ad_cases = load_fixtures("analyze_documents")

    cm_docs_needed = sorted({c["fixture_document"] for c in gcm_cases + cmc_cases + ad_cases})
    cm_project_by_doc = {}
    domain_specialization_by_doc = {}
    print(f"[setup] Creating {len(cm_docs_needed)} content_marketing project(s)...")
    for doc_filename in cm_docs_needed:
        project_id = create_cm_project(client, headers, f"eval-{doc_filename}")
        upload_result = upload_cm_document(client, headers, project_id, doc_filename)
        cm_project_by_doc[doc_filename] = project_id
        domain_specialization_by_doc[doc_filename] = upload_result.get("domain_specialization") or {}
        print(f"  {doc_filename} -> project {project_id}")

    report["functions"]["analyze_documents"] = run_offline_scored(ad_cases, domain_specialization_by_doc, "analyze_documents")

    print(f"[run] generate_content_marketing ({len(gcm_cases)} cases)...")
    report["functions"]["generate_content_marketing"] = run_http_scored(
        client, headers, gcm_cases, "generate_content_marketing", "content_marketing.generate_content",
        method="post", build_path=lambda c: "/api/content-marketing/generate-content",
        build_payload=lambda c: {"project_id": cm_project_by_doc[c["fixture_document"]], **c["input"]},
    )

    print(f"[run] content_marketing_chat ({len(cmc_cases)} cases)...")
    report["functions"]["content_marketing_chat"] = run_http_scored(
        client, headers, cmc_cases, "content_marketing_chat", "content_marketing.chat",
        method="post", build_path=lambda c: "/api/content-marketing/chat",
        build_payload=lambda c: {"project_id": cm_project_by_doc[c["fixture_document"]], **c["input"]},
    )

    # ---- document_intelligence: one project per unique fixture document ----
    dic_cases = load_fixtures("document_intelligence_chat")
    dii_cases = load_fixtures("document_intelligence_insight")

    di_docs_needed = sorted({c["fixture_document"] for c in dic_cases + dii_cases})
    di_project_by_doc = {}
    di_document_id_by_doc = {}
    print(f"[setup] Creating {len(di_docs_needed)} document_intelligence project(s)...")
    for doc_filename in di_docs_needed:
        project_id = create_platform_project(EVAL_USER_ID)
        document_id, status = upload_di_document(client, headers, project_id, doc_filename)
        di_project_by_doc[doc_filename] = project_id
        di_document_id_by_doc[doc_filename] = document_id
        print(f"  {doc_filename} -> project {project_id}, document {document_id}, status={status}")
        if status != "completed":
            print(f"  WARNING: {doc_filename} did not reach 'completed' (got {status!r}) - its chat/insight cases will likely fail")

    print(f"[run] document_intelligence_chat ({len(dic_cases)} cases)...")
    report["functions"]["document_intelligence_chat"] = run_http_scored(
        client, headers, dic_cases, "document_intelligence_chat", "document_intelligence.chat",
        method="post", build_path=lambda c: "/api/document-intelligence/chat",
        build_payload=lambda c: {
            "project_id": di_project_by_doc[c["fixture_document"]],
            "document_ids": [di_document_id_by_doc[c["fixture_document"]]],
            **c["input"],
        },
    )

    print(f"[run] document_intelligence_insight ({len(dii_cases)} cases)...")
    report["functions"]["document_intelligence_insight"] = run_http_scored(
        client, headers, dii_cases, "document_intelligence_insight", "document_intelligence.document_insight",
        method="get",
        build_path=lambda c: f"/api/document-intelligence/documents/{di_document_id_by_doc[c['fixture_document']]}/insight?project_id={di_project_by_doc[c['fixture_document']]}",
    )

    # ---- generate_email_content: Group A, no setup needed ----
    gec_cases = load_fixtures("generate_email_content")
    print(f"[run] generate_email_content ({len(gec_cases)} cases)...")
    report["functions"]["generate_email_content"] = run_http_scored(
        client, headers, gec_cases, "generate_email_content", "sales_helper.generate_email_content",
        method="post", build_path=lambda c: "/api/generate-email",
        build_payload=lambda c: c["input"],
    )

    return report


def write_report(report):
    json_path = EVAL_DIR / "report.json"
    md_path = EVAL_DIR / "report.md"

    with open(json_path, "w") as f:
        json.dump(report, f, indent=2)

    lines = [f"# Eval Report — {report['generated_at']}", ""]
    total_passed = total_cases = 0
    for function_name, results in report["functions"].items():
        passed = sum(1 for r in results if r["passed"])
        total = len(results)
        total_passed += passed
        total_cases += total
        lines.append(f"## {function_name}: {passed}/{total} passed")
        lines.append("")
        for r in results:
            status = "✅" if r["passed"] else "❌"
            usage = r.get("usage")
            usage_str = f" ({usage['provider']}/{usage['model']}, ${usage['cost_usd']})" if usage else ""
            lines.append(f"- {status} `{r['name']}`{usage_str}")
            if not r["passed"]:
                lines.append(f"  - checks: `{json.dumps(r['checks'])}`")
                lines.append(f"  - response: `{json.dumps(r['response'])[:500]}`")
        lines.append("")

    lines.insert(1, f"**Overall: {total_passed}/{total_cases} passed**")
    lines.insert(2, "")
    lines.append("---")
    lines.append("_LLM-as-judge scoring, a quality dashboard, and failure-category taxonomy are deliberately not part of this v1 - see backend/eval/README.md._")

    with open(md_path, "w") as f:
        f.write("\n".join(lines))

    print(f"\nReport written to {json_path} and {md_path}")
    print(f"Overall: {total_passed}/{total_cases} passed")
    return total_passed, total_cases


if __name__ == "__main__":
    report = run()
    passed, total = write_report(report)
    sys.exit(0 if passed == total else 1)
