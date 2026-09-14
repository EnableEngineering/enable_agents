"""Workflow Templates — SQLAlchemy models."""
from datetime import datetime
import json
from typing import Dict, Any, List, Optional
from core.database import db


class WorkflowTemplate(db.Model):
    """
    Template for a multi-stage workflow.
    Templates define the stages and their order, but instances track execution.
    """
    __tablename__ = "workflow_templates"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    template_id = db.Column(db.String(100), unique=True, nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category = db.Column(db.String(100), nullable=True, index=True)  # marketing, sales, research, etc.
    icon = db.Column(db.String(50), default="workflow")
    is_system = db.Column(db.Boolean, default=False)  # System templates can't be deleted
    is_active = db.Column(db.Boolean, default=True, index=True)
    _stages = db.Column("stages", db.Text, nullable=False, default="[]")  # JSON array
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    instances = db.relationship("WorkflowInstance", back_populates="template", cascade="all, delete-orphan")

    @property
    def stages(self) -> List[Dict[str, Any]]:
        """
        Parse stages JSON. Each stage has:
        {
            "stage_id": "research",
            "name": "Market Research",
            "agent": "market_research",
            "description": "...",
            "required_inputs": ["industry"],
            "outputs": ["company_profile"],
            "config": {}
        }
        """
        return json.loads(self._stages or "[]")

    @stages.setter
    def stages(self, value: List[Dict[str, Any]]):
        self._stages = json.dumps(value)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.template_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "icon": self.icon,
            "isSystem": self.is_system,
            "isActive": self.is_active,
            "stages": self.stages,
            "stageCount": len(self.stages),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class WorkflowInstance(db.Model):
    """
    Running or completed instance of a workflow template.
    Tracks which stages are done, current stage, and accumulated data.
    """
    __tablename__ = "workflow_instances"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    instance_id = db.Column(db.String(36), unique=True, nullable=False, index=True)
    template_id = db.Column(db.String(100), db.ForeignKey("workflow_templates.template_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    project_id = db.Column(db.String(36), nullable=True, index=True)  # Optional link to platform Project
    name = db.Column(db.String(255), nullable=False)  # User can name their instance
    status = db.Column(db.String(50), default="pending", index=True)  # pending | running | paused | completed | failed
    current_stage_index = db.Column(db.Integer, default=0)
    _stage_states = db.Column("stage_states", db.Text, default="{}")  # JSON: {stage_id: {status, data, completedAt}}
    _context = db.Column("context", db.Text, default="{}")  # Accumulated data passed between stages
    # Suggest | co-pilot | autopilot - read by agents/workflow_orchestration/graph.py
    # to decide whether a stage's node pauses on interrupt() for human review.
    autonomy_mode = db.Column(db.String(20), nullable=True, default="co-pilot")
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    template = db.relationship("WorkflowTemplate", back_populates="instances")

    @property
    def stage_states(self) -> Dict[str, Dict[str, Any]]:
        return json.loads(self._stage_states or "{}")

    @stage_states.setter
    def stage_states(self, value: Dict[str, Dict[str, Any]]):
        self._stage_states = json.dumps(value, default=str)

    @property
    def context(self) -> Dict[str, Any]:
        return json.loads(self._context or "{}")

    @context.setter
    def context(self, value: Dict[str, Any]):
        self._context = json.dumps(value, default=str)

    def get_current_stage(self) -> Optional[Dict[str, Any]]:
        """Get the current stage definition from the template."""
        stages = self.template.stages if self.template else []
        if 0 <= self.current_stage_index < len(stages):
            return stages[self.current_stage_index]
        return None

    def advance_stage(self, stage_data: Dict[str, Any] = None):
        """Mark current stage complete and advance to next."""
        stages = self.template.stages if self.template else []
        if self.current_stage_index < len(stages):
            current = stages[self.current_stage_index]
            current_id = current.get("stage_id") or current.get("id")
            states = self.stage_states

            # Merge with any data the agent already persisted mid-stage via
            # save_stage_data (e.g. saveStageData() from the agent page) -
            # don't let an empty/partial completion payload wipe it out.
            merged_data = dict(states.get(current_id, {}).get("data") or {})
            merged_data.update(stage_data or {})

            states[current_id] = {
                "status": "completed",
                "data": merged_data,
                "completedAt": datetime.utcnow().isoformat(),
            }
            self.stage_states = states

            # Merge stage outputs into context
            if merged_data:
                ctx = self.context
                ctx.update(merged_data)
                self.context = ctx

            self.current_stage_index += 1
            if self.current_stage_index >= len(stages):
                self.status = "completed"
                self.completed_at = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        template = self.template
        stages = template.stages if template else []
        current = self.get_current_stage()
        return {
            "id": self.instance_id,
            "templateId": self.template_id,
            "templateName": template.name if template else None,
            "projectId": self.project_id,
            "name": self.name,
            "status": self.status,
            "currentStageIndex": self.current_stage_index,
            "totalStages": len(stages),
            "currentStage": current,
            "stages": stages,  # Include all stage definitions for frontend
            "stageStates": self.stage_states,
            "context": self.context,
            "autonomyMode": self.autonomy_mode or "co-pilot",
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }
