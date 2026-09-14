"""Regression tests for validate_workflow_template_agents() (registry.py) -
the warn-only check, added 2026-09-14, that a WorkflowTemplate stage's
"agent" resolves to either a registered enabled agent or a known virtual
one. Catches a template stage referencing an agent id that doesn't exist
under either name - found two real (non-bug) cases while writing this
check: "sales_helper" (real code, no Flask blueprint - see
agents/sales_helper_core.py) and "data_insights" (the frontend's
consistent display id for the document_intelligence agent).
"""
from core.database import db
from models.workflow import WorkflowTemplate


def test_known_virtual_agent_ids_produce_no_warning(flask_app, capsys):
    from agents.registry import validate_workflow_template_agents

    with flask_app.app_context():
        tpl = WorkflowTemplate(
            template_id="test-virtual-agents", name="Test", is_system=True, is_active=True,
        )
        tpl.stages = [
            {"id": "a", "agent": "sales_helper"},
            {"id": "b", "agent": "data_insights"},
        ]
        db.session.add(tpl)
        db.session.commit()

        validate_workflow_template_agents()
        captured = capsys.readouterr()
        assert "test-virtual-agents" not in captured.out

        WorkflowTemplate.query.filter_by(template_id="test-virtual-agents").delete()
        db.session.commit()


def test_unknown_agent_id_produces_a_warning(flask_app, capsys):
    from agents.registry import validate_workflow_template_agents

    with flask_app.app_context():
        tpl = WorkflowTemplate(
            template_id="test-bad-agent", name="Test", is_system=True, is_active=True,
        )
        tpl.stages = [{"id": "broken_stage", "agent": "not_a_real_agent"}]
        db.session.add(tpl)
        db.session.commit()

        validate_workflow_template_agents()
        captured = capsys.readouterr()
        assert "test-bad-agent" in captured.out
        assert "broken_stage" in captured.out
        assert "not_a_real_agent" in captured.out

        WorkflowTemplate.query.filter_by(template_id="test-bad-agent").delete()
        db.session.commit()


def test_inactive_template_is_not_checked(flask_app, capsys):
    from agents.registry import validate_workflow_template_agents

    with flask_app.app_context():
        tpl = WorkflowTemplate(
            template_id="test-inactive-bad-agent", name="Test", is_system=True, is_active=False,
        )
        tpl.stages = [{"id": "broken_stage", "agent": "not_a_real_agent"}]
        db.session.add(tpl)
        db.session.commit()

        validate_workflow_template_agents()
        captured = capsys.readouterr()
        assert "test-inactive-bad-agent" not in captured.out

        WorkflowTemplate.query.filter_by(template_id="test-inactive-bad-agent").delete()
        db.session.commit()
