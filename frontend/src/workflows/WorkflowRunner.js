import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BackButton, EmptyState, Spinner } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { confirmSendEmail } from '../core/emailActionWarnings';
import './WorkflowRunner.css';

// Templates whose instances run through the LangGraph orchestration engine
// (agents/workflow_orchestration/) instead of the plain manual
// start/complete-stage flow. Keep in sync with backend/routes/workflows.py's
// GRAPH_ORCHESTRATED_TEMPLATE_IDS.
const GRAPH_ORCHESTRATED_TEMPLATE_IDS = new Set(['supplier-qualification', 'vendor-evaluation', 'lead-nurture']);

// Task icons
const TASK_ICONS = {
  pending: '/assets/icons/process.png',
  in_progress: '/assets/icons/alerts.png',
  done: '/assets/icons/checklist.png',
  required: '/assets/icons/document.png',
  optional: '/assets/icons/reports.png',
};

// Helper to format snake_case keys to readable labels
const formatLabel = (key) => {
  if (!key) return '';
  return key
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// True for e.g. businesses: [{name, email}, ...] or audits: [{supplier_id,
// score}, ...] - a real list of records a person would recognize, as
// opposed to nested/mixed data nobody should be hand-editing as prose.
// Every stage's actual array fields across every template are exactly
// this shape (see graph.py's node propose() functions) except
// document_analysis's documents/nodes/edges, which are genuinely internal
// document-processing structures - those fall back to the JSON kind below.
const isFlatObjectArray = (value) => (
  Array.isArray(value) && value.length > 0 && value.every(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item)
      && Object.values(item).every((v) => v === null || typeof v !== 'object')
  )
);

// Default column set for a "rows" field that starts out empty (so there's
// nothing to infer columns from) - covers every array-of-records field
// that actually appears across all 3 orchestrated templates' stages (see
// graph.py). Anything not listed here falls back to a single generic
// column rather than guessing.
const DEFAULT_ROW_COLUMNS = {
  businesses: ['name', 'email'],
  audits: ['supplier_id', 'score'],
  tasks: ['title', 'description'],
};

// Business rows from a search carry a dozen columns (id, address, latitude,
// rating, ...) but never an email - which is the one column an email stage
// needs. Show only the columns a person would act on, always including
// Email so missing addresses can be typed in. Other keys on each row are
// kept as-is (rows are edited as copies) - they're just not displayed.
const BUSINESS_DISPLAY_COLUMNS = ['name', 'email', 'phone', 'website'];
const businessColumns = (rows) => {
  const present = new Set(rows.flatMap((item) => Object.keys(item)));
  return BUSINESS_DISPLAY_COLUMNS.filter((c) => c === 'name' || c === 'email' || present.has(c));
};

const hasValidEmail = (business) => {
  const email = business && business.email;
  return typeof email === 'string' && email !== 'N/A' && email.includes('@');
};
const countRecipients = (businesses) => (Array.isArray(businesses) ? businesses.filter(hasValidEmail).length : 0);

// Builds the per-field edit state for a pending-approval card's
// proposed_input - never raw JSON for the common cases:
//   - plain string/number -> 'text', a single-line text box.
//   - array of flat records (businesses, audits, tasks, ...), including
//     an empty one -> 'rows', a repeatable name/value row editor - see
//     RepeatableRowsField below.
//   - anything else (nested structures, arrays of plain strings) ->
//     'json', a textarea fallback - rare in practice (only
//     document_analysis's internal document/graph fields and
//     requirements' `frameworks` list hit this today).
// Values are pre-filled with the proposed value, not left blank, so
// "Save Edit & Approve" with zero changes still sends exactly what was
// proposed.
const buildEditFields = (proposedInput) => {
  const fields = {};
  Object.entries(proposedInput || {}).forEach(([key, value]) => {
    if (value === null || typeof value !== 'object') {
      const text = String(value ?? '');
      // A single-line <input> either hides or garbles a real newline -
      // generated email/content bodies routinely have them. Long values
      // get cramped in one line regardless. Both get a real textarea.
      const isLong = text.includes('\n') || text.length > 80;
      fields[key] = { kind: isLong ? 'multiline' : 'text', value: text };
    } else if (Array.isArray(value) && (value.length === 0 || isFlatObjectArray(value))) {
      const columns = key === 'businesses'
        ? businessColumns(value)
        : value.length > 0
          ? Array.from(new Set(value.flatMap((item) => Object.keys(item))))
          : (DEFAULT_ROW_COLUMNS[key] || ['value']);
      fields[key] = { kind: 'rows', columns, value: value.map((item) => ({ ...item })) };
    } else {
      fields[key] = { kind: 'json', value: JSON.stringify(value, null, 2) };
    }
  });
  return fields;
};

// Renders any stage/context value as readable text - agent outputs aren't
// always flat strings/numbers (e.g. { best_price: '...', best_capacity: '...' }
// or a list of findings), so a plain String(value) would just print "[object Object]".
const formatContextValue = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value.map(v => (v !== null && typeof v === 'object') ? formatContextValue(v) : String(v)).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${formatLabel(k)}: ${(v !== null && typeof v === 'object') ? formatContextValue(v) : v}`)
      .join(' · ');
  }
  return String(value);
};

// Icon mapping for stages and context
const ICONS = {
  // Stage icons
  requirement: '/assets/icons/checklist.png',
  capture: '/assets/icons/checklist.png',
  research: '/assets/icons/search-analysis.png',
  market: '/assets/icons/bar-chart.png',
  outreach: '/assets/icons/mail.png',
  supplier: '/assets/icons/supply-chain-management.png',
  response: '/assets/icons/message.png',
  tracking: '/assets/icons/monitoring.png',
  qualification: '/assets/icons/agreement.png',
  audit: '/assets/icons/document.png',
  selection: '/assets/icons/checklist.png',
  final: '/assets/icons/agreement.png',
  default: '/assets/icons/process.png',

  // Context icons
  client: '/assets/icons/user.png',
  company: '/assets/icons/user.png',
  location: '/assets/icons/networking.png',
  component: '/assets/icons/settings.png',
  material: '/assets/icons/inventory.png',
  volume: '/assets/icons/orders.png',
  supplier_ctx: '/assets/icons/supply-chain-management.png',
  quote: '/assets/icons/invoices.png',
  lead_time: '/assets/icons/process.png',
  backup: '/assets/icons/data-security.png',
  email: '/assets/icons/mail.png',
  phone: '/assets/icons/mobile-data.png',
  name: '/assets/icons/user.png',
  analysis: '/assets/icons/reports.png',
  criteria: '/assets/icons/checklist.png',
  score: '/assets/icons/bar-chart.png',
  result: '/assets/icons/agreement.png',
  status: '/assets/icons/agreement.png',
  auditor: '/assets/icons/user.png',
  date: '/assets/icons/monitoring.png',
  found: '/assets/icons/search-analysis.png',
  count: '/assets/icons/bar-chart.png',
  total: '/assets/icons/bar-chart.png',
  document: '/assets/icons/document.png',
  campaign: '/assets/icons/bullhorn.png',
  recommendation: '/assets/icons/checklist.png',
  content: '/assets/icons/bullhorn.png',
  channel: '/assets/icons/mail.png',
};

const getStageIcon = (stageName) => {
  const lower = (stageName || '').toLowerCase();
  for (const [key, icon] of Object.entries(ICONS)) {
    if (key !== 'default' && !key.includes('_ctx') && lower.includes(key)) return icon;
  }
  return ICONS.default;
};

const getContextIcon = (key) => {
  const lower = (key || '').toLowerCase();
  if (lower.includes('client') || lower.includes('company')) return ICONS.client;
  if (lower.includes('location')) return ICONS.location;
  if (lower.includes('component')) return ICONS.component;
  if (lower.includes('material')) return ICONS.material;
  if (lower.includes('volume')) return ICONS.volume;
  if (lower.includes('supplier')) return ICONS.supplier_ctx;
  if (lower.includes('quote') || lower.includes('price')) return ICONS.quote;
  if (lower.includes('backup')) return ICONS.backup;
  if (lower.includes('email')) return ICONS.email;
  if (lower.includes('phone')) return ICONS.phone;
  if (lower.includes('date')) return ICONS.date;
  if (lower.includes('score')) return ICONS.score;
  if (lower.includes('criteria')) return ICONS.criteria;
  if (lower.includes('result') || lower.includes('status')) return ICONS.result;
  if (lower.includes('auditor')) return ICONS.auditor;
  if (lower.includes('analysis') || lower.includes('summary')) return ICONS.analysis;
  if (lower.includes('found') || lower.includes('recommendation')) return ICONS.found;
  if (lower.includes('count') || lower.includes('total') || lower.includes('audited')) return ICONS.count;
  if (lower.includes('campaign')) return ICONS.campaign;
  if (lower.includes('content') || lower.includes('channel')) return ICONS.content;
  if (lower.includes('document')) return ICONS.document;
  if (lower.includes('lead') || lower.includes('time')) return ICONS.lead_time;
  return ICONS.default;
};

// Agent icon mapping
const AGENT_ICONS = {
  requirements_gathering: '/assets/icons/checklist.png',
  market_research: '/assets/icons/data-discovery.png',
  data_insights: '/assets/icons/data-discovery.png',
  email_outreach: '/assets/icons/mail.png',
  sales_helper: '/assets/icons/bar-chart.png',
  supply_chain: '/assets/icons/supply-chain-management.png',
  executive_assistant: '/assets/icons/ai-chatbots.png',
  content_marketing: '/assets/icons/bullhorn.png',
  community_network: '/assets/icons/networking.png',
  event_networking: '/assets/icons/networking.png',
  default: '/assets/icons/ai-chatbots.png',
};

const getAgentIcon = (agentId) => AGENT_ICONS[agentId] || AGENT_ICONS.default;

// Agent routes - maps workflow agent IDs to actual agent pages
// Format: agentId: { route, label, type: 'agent'|'placeholder'|'form' }
const AGENT_CONFIG = {
  requirements_gathering: { route: '/market-research', label: 'Market Research', type: 'agent' },
  data_insights: { route: '/data-insights', label: 'Data Insights', type: 'agent' },
  market_research: { route: '/data-insights', label: 'Data Insights', type: 'agent' }, // Legacy - maps old ID to new route
  content_marketing: { route: '/content-marketing', label: 'Content Marketing', type: 'agent' },
  sales_helper: { route: '/sales-helper', label: 'Sales Helper', type: 'agent' },
  executive_assistant: { route: '/executive-assistant', label: 'Executive Assistant', type: 'agent' },
  email_outreach: { route: '/email-outreach', label: 'Email Outreach', type: 'agent' },
  campaign_dashboard: { route: '/market-research/campaigns', label: 'Campaign Dashboard', type: 'agent' },
  supply_chain: { route: '/supply-chain-agent', label: 'Supply Chain Audit', type: 'agent' },
};

const getAgentRoute = (agentId) => AGENT_CONFIG[agentId]?.route || null;
const getAgentType = (agentId) => AGENT_CONFIG[agentId]?.type || 'form';
const getAgentLabel = (agentId) => AGENT_CONFIG[agentId]?.label || formatLabel(agentId);

function WorkflowRunner() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const [instance, setInstance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stageData, setStageData] = useState({});
  const [completing, setCompleting] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const [allTasks, setAllTasks] = useState([]);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [runningGraph, setRunningGraph] = useState(false);
  const [resumingAction, setResumingAction] = useState(null);
  // Per-field edit state for the pending-approval card, keyed by
  // proposed_input's top-level field names. Each entry holds the current
  // text-box value plus whether that field's original value was an
  // array/object (rendered as a JSON textarea) vs a plain string
  // (rendered as a labeled text input) - see buildEditFields() below.
  const [editFields, setEditFields] = useState({});
  const [editedStageId, setEditedStageId] = useState(null);
  const [settingAutonomy, setSettingAutonomy] = useState(false);
  const [showAutonomyInfo, setShowAutonomyInfo] = useState(false);

  const fetchInstance = useCallback(async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}`, {
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setInstance(data.instance);
      } else {
        showToast(data.error || 'Workflow not found', 'error');
        navigate('/workflows');
      }
    } catch (err) {
      showToast('Error loading workflow', 'error');
      navigate('/workflows');
    } finally {
      setLoading(false);
    }
  }, [instanceId, navigate]);

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  // Every task across every stage (not scoped to whichever stage is
  // currently selected) - the source for the activity lane's timeline.
  // Re-fetched whenever StageDetailView's task list changes so the
  // timeline reflects the same data without a full page reload.
  const fetchAllTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/tasks`, {
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) setAllTasks(data.tasks);
    } catch (err) {
      // Non-critical - the activity lane just shows fewer events.
    }
  }, [instanceId]);

  useEffect(() => {
    fetchAllTasks();
  }, [fetchAllTasks]);

  // Supplier Qualification instances run through the LangGraph orchestration
  // engine (agents/workflow_orchestration/) instead of the plain manual
  // start/complete-stage flow every other template still uses - see the
  // approved orchestration plan. Everything below this comment (autonomy
  // mode, /run, /pending-approval polling, /resume) is scoped to that one
  // template and touches nothing else.
  const isGraphOrchestrated = GRAPH_ORCHESTRATED_TEMPLATE_IDS.has(instance?.templateId);

  const fetchPendingApproval = useCallback(async () => {
    if (!isGraphOrchestrated) return null;
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/pending-approval`, {
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) setPendingApproval(data);
      return data;
    } catch (err) {
      // Non-critical - next poll tick will retry.
      return null;
    }
  }, [instanceId, isGraphOrchestrated]);

  useEffect(() => {
    fetchPendingApproval();
  }, [fetchPendingApproval]);

  // Reset the per-field edit boxes whenever a *different* stage becomes
  // pending (not on every poll tick, which would wipe out in-progress
  // edits on the same stage while waiting for a slow network response).
  useEffect(() => {
    const stageId = pendingApproval?.interrupt?.stage_id;
    if (!stageId || stageId === editedStageId) return;
    setEditedStageId(stageId);
    setEditFields(buildEditFields(pendingApproval.interrupt.proposed_input));
  }, [pendingApproval, editedStageId]);

  // The graph runs asynchronously via Celery - a run/resume call only
  // kicks it off, it doesn't wait for the next pause. Poll while there's
  // still something in flight so autopilot's own progress (and the
  // instance status flipping to "completed") shows up without a reload.
  useEffect(() => {
    if (!isGraphOrchestrated) return;
    if (instance?.status !== 'running') return;
    const id = setInterval(() => {
      fetchInstance();
      fetchPendingApproval();
    }, 3000);
    return () => clearInterval(id);
  }, [isGraphOrchestrated, instance?.status, fetchInstance, fetchPendingApproval]);

  const handleSetAutonomy = async (mode) => {
    setSettingAutonomy(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/autonomy`, {
        method: 'PATCH',
        headers: authJsonHeaders(),
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.success) {
        setInstance(data.instance);
      } else {
        showToast(data.error || 'Failed to set autonomy mode', 'error');
      }
    } catch (err) {
      showToast('Error setting autonomy mode', 'error');
    } finally {
      setSettingAutonomy(false);
    }
  };

  const handleRunGraph = async () => {
    setRunningGraph(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/run`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        // The response body is the instance as it was *before* the graph
        // task ran (status still "pending") - the task itself flips it to
        // "running" (and possibly straight to a paused interrupt) shortly
        // after, asynchronously via Celery. Re-fetch both, not just
        // pending-approval, or the UI stays stuck on the "Ready to Run"
        // panel since isPending never turns false.
        setInstance(data.instance);
        showToast('Workflow running', 'success');
        setTimeout(() => { fetchInstance(); fetchPendingApproval(); }, 1000);
      } else {
        showToast(data.error || 'Failed to run workflow', 'error');
      }
    } catch (err) {
      showToast('Error running workflow', 'error');
    } finally {
      setRunningGraph(false);
    }
  };

  const handleResume = async (action) => {
    // Any stage backed by the email_outreach agent sends real email on
    // approve/edit (skip never calls the real function - run_stage()
    // short-circuits before it). Checking the agent id (not a hardcoded
    // stage_id list) means any future orchestrated template's email stage
    // gets this warning automatically, no per-template wiring needed.
    if (action !== 'skip' && pendingApproval?.interrupt) {
      const stageId = pendingApproval.interrupt.stage_id;
      const stage = (instance?.stages || []).find((s) => (s.id || s.stage_id) === stageId);
      if (stage?.agent === 'email_outreach') {
        // What will actually go out: the rows as edited on "Save Edit &
        // Approve", the server's proposal on plain Approve - and only rows
        // with a usable address (the rest are ignored by the send). Zero
        // means approving just records a skip, so there's nothing to warn about.
        const businesses = action === 'edit' && editFields.businesses
          ? editFields.businesses.value
          : pendingApproval.interrupt.proposed_input?.businesses;
        const recipientCount = countRecipients(businesses);
        if (recipientCount > 0) {
          const confirmed = await confirmSendEmail({
            recipientCount,
            context: `the "${stage.name || formatLabel(stageId)}" stage`,
          });
          if (!confirmed) return;
        }
      }
    }

    const stageBefore = pendingApproval?.interrupt?.stage_id;
    setResumingAction(action);
    try {
      let data = {};
      if (action === 'edit') {
        data = {};
        for (const [key, field] of Object.entries(editFields)) {
          if (field.kind === 'text' || field.kind === 'multiline') {
            data[key] = field.value;
          } else if (field.kind === 'rows') {
            data[key] = field.value;
          } else {
            try {
              data[key] = field.value.trim() ? JSON.parse(field.value) : null;
            } catch (err) {
              showToast(`"${formatLabel(key)}" must be valid JSON`, 'error');
              setResumingAction(null);
              return;
            }
          }
        }
      }
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/resume`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ action, data }),
      });
      const resData = await res.json();
      if (!res.ok) {
        showToast(resData.error || 'Failed to resume workflow', 'error');
        return;
      }

      // /resume only enqueues the graph step (202) - it doesn't wait for it
      // to actually run, so the real outcome (advanced, completed, or the
      // same stage re-pausing with a validation error) is only known once
      // polling catches up. Poll briefly for one of those instead of
      // claiming success the moment the request is accepted - a stage that
      // fails validation on execute() now re-pauses on itself with an
      // `error` field (rendered as a banner above the fields) rather than
      // silently advancing, so this has a real distinction to report.
      const outcome = await (async () => {
        const start = Date.now();
        while (Date.now() - start < 20000) {
          const polled = await fetchPendingApproval();
          if (!polled?.pending) return 'completed';
          if (polled.interrupt?.stage_id !== stageBefore) return 'advanced';
          if (polled.interrupt?.error) return 'error';
          await new Promise((r) => setTimeout(r, 1200));
        }
        return 'timeout';
      })();
      await fetchInstance();

      if (outcome === 'error') {
        showToast('That attempt failed - see the error above', 'error');
      } else if (outcome === 'completed') {
        showToast('Workflow completed!', 'success');
      } else if (outcome === 'advanced') {
        showToast(`Stage ${action === 'skip' ? 'skipped' : action === 'edit' ? 'updated and approved' : 'approved'}`, 'success');
      } else {
        showToast('Still processing - check back in a moment', 'info');
      }
    } catch (err) {
      showToast('Error resuming workflow', 'error');
    } finally {
      setResumingAction(null);
    }
  };

  const handleStart = async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/start`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setInstance(data.instance);
        showToast('Workflow started', 'success');
      } else {
        showToast(data.error || 'Failed to start', 'error');
      }
    } catch (err) {
      showToast('Error starting workflow', 'error');
    }
  };

  const handleCompleteStage = async () => {
    setCompleting(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/complete-stage`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ data: stageData }),
      });
      const data = await res.json();
      if (data.success) {
        setInstance(data.instance);
        setStageData({});
        showToast(data.instance.status === 'completed' ? 'Workflow completed!' : 'Stage completed', 'success');
      } else if (data.missing_inputs?.length) {
        showToast(`Please fill in: ${data.missing_inputs.map(formatLabel).join(', ')}`, 'error');
      } else {
        showToast(data.error || 'Failed to complete stage', 'error');
      }
    } catch (err) {
      showToast('Error completing stage', 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handlePause = async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}/pause`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setInstance(data.instance);
        showToast('Workflow paused', 'info');
      }
    } catch (err) {
      showToast('Error pausing workflow', 'error');
    }
  };

  if (loading) {
    return (
      <>
        <div className="workflow-runner">
          <div className="workflow-loading">
            <Spinner size="lg" />
            <span>Loading workflow...</span>
          </div>
        </div>
      </>
    );
  }

  if (!instance) {
    return (
      <>
        <div className="workflow-runner">
          <EmptyState
            iconType="search"
            title="Workflow not found"
            description="This workflow may have been deleted."
            action={{ label: 'Back to Workflows', onClick: () => navigate('/workflows') }}
          />
        </div>
      </>
    );
  }

  const stages = (instance.stages || []).map(s => ({ ...s, id: s.id || s.stage_id }));
  const stageStates = instance.stageStates || {};
  const currentStage = instance.currentStage;

  // Find which earlier stage's `outputs` produces a given `required_inputs`
  // key, so the current stage's form can show where a value is expected to
  // come from instead of a bare field label. Purely informational - stage
  // agents are fixed per template today, there's no UI to add/remove a
  // stage, so this can't gate anything, only surface the relationship.
  const getInputSourceStage = (inputKey) => {
    const priorStages = stages.slice(0, instance.currentStageIndex);
    return priorStages.find((s) => s.outputs?.includes(inputKey)) || null;
  };
  const isCompleted = instance.status === 'completed';
  const isPending = instance.status === 'pending';
  const progress = instance.totalStages > 0
    ? Math.round((instance.currentStageIndex / instance.totalStages) * 100)
    : 0;

  // Real, timestamped events only - workflow/stage lifecycle timestamps and
  // task completions already tracked by the backend. No fabricated
  // "proposed action" entries - if the data isn't real, it isn't shown.
  const activityEvents = (() => {
    const events = [];
    if (instance.startedAt) {
      events.push({ id: 'started', time: instance.startedAt, title: 'Workflow started', detail: `${instance.totalStages} stages` });
    }
    stages.forEach((stage) => {
      const state = stageStates[stage.id];
      if (state?.completedAt) {
        events.push({
          id: `stage-${stage.id}`,
          time: state.completedAt,
          title: `${stage.name} completed`,
          detail: getAgentLabel(stage.agent),
        });
      }
    });
    allTasks.forEach((task) => {
      if (task.status === 'done' && task.completed_at) {
        events.push({
          id: `task-${task.id}`,
          time: task.completed_at,
          title: `Task completed: ${task.title}`,
          detail: task.completed_by ? `by ${task.completed_by.split('@')[0]}` : null,
        });
      }
    });
    if (instance.completedAt) {
      events.push({ id: 'completed', time: instance.completedAt, title: 'Workflow completed', detail: null });
    }
    return events.sort((a, b) => new Date(a.time) - new Date(b.time));
  })();

  const formatEventTime = (iso) => new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return (
    <>
      <div className="workflow-runner">
        {/* Header */}
        <div className="wf-header">
          <div className="wf-header-left">
            <BackButton to="/workflows" label="Workflows" />
            <div className="wf-title-block">
              <h1>{instance.name}</h1>
              <span className="wf-template">{instance.templateName}</span>
            </div>
          </div>
          <span className={`wf-status wf-status-${instance.status}`}>
            {instance.status === 'completed' && <img src="/assets/icons/checklist.png" alt="" />}
            {instance.status === 'running' && <img src="/assets/icons/process.png" alt="" />}
            {instance.status === 'paused' && <img src="/assets/icons/alerts.png" alt="" />}
            {instance.status === 'pending' && <img src="/assets/icons/process.png" alt="" />}
            {formatLabel(instance.status)}
          </span>
        </div>

        <div className="wf-layout">
          {/* Lane 1: persistent workflow progress - always visible, never
              replaced by the stage detail view, so you always know where
              you are in the workflow while working in Lane 2. */}
          <div className="wf-progress-lane">
            <div className="wf-progress-section">
              <div className="wf-progress-info">
                <span className="wf-progress-label">Progress</span>
                <span className="wf-progress-value">{instance.currentStageIndex} of {instance.totalStages} stages complete</span>
              </div>
              <div className="wf-progress-bar">
                <div className="wf-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="wf-stages-panel">
              <div className="wf-panel-header">
                <img src="/assets/icons/process.png" alt="" className="wf-panel-icon" />
                <h2>Workflow Stages</h2>
              </div>
              <p className="wf-panel-subtitle">Select a stage to view inputs, outputs, and agent details</p>

              <div className="wf-stages-list">
                {stages.map((stage, idx) => {
                  const state = stageStates[stage.id] || {};
                  const isStageCompleted = idx < instance.currentStageIndex;
                  const isCurrent = idx === instance.currentStageIndex && instance.status === 'running';
                  const isPendingStage = idx > instance.currentStageIndex || instance.status === 'pending';
                  const isSelected = selectedStage?.id === stage.id;

                  return (
                    <div
                      key={stage.id}
                      className={`wf-stage-row ${isStageCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isPendingStage ? 'pending' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedStage({ ...stage, index: idx, state })}
                    >
                      <div className="wf-stage-indicator">
                        {isStageCompleted && state.outcome === 'skipped' ? (
                          <div className="wf-stage-check wf-stage-skipped" title="Skipped">
                            –
                          </div>
                        ) : isStageCompleted ? (
                          <div className="wf-stage-check">
                            ✓
                          </div>
                        ) : isCurrent ? (
                          <div className="wf-stage-current">
                            <div className="wf-stage-pulse" />
                            {idx + 1}
                          </div>
                        ) : (
                          <div className="wf-stage-pending">{idx + 1}</div>
                        )}
                        {idx < stages.length - 1 && (
                          <div className={`wf-stage-line ${isStageCompleted ? 'completed' : ''}`} />
                        )}
                      </div>

                      <div className="wf-stage-content">
                        <div className="wf-stage-header">
                          <img src={getStageIcon(stage.name)} alt="" className="wf-stage-icon" />
                          <span className="wf-stage-name">{stage.name}</span>
                          {isStageCompleted && state.completedAt && (
                            <span className="wf-stage-date">
                              {new Date(state.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div className="wf-stage-agent">
                          <img src={getAgentIcon(stage.agent)} alt="" />
                          <span>{getAgentLabel(stage.agent)}</span>
                        </div>
                        {isStageCompleted && state.outcome === 'skipped' && (
                          <div className="wf-stage-skipped-note">
                            Skipped{state.data?.reason && state.data.reason !== 'paused' ? ` - ${state.data.reason}` : state.data?.reason === 'paused' ? ' - workflow was paused' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Lane 2: the main work surface - the action panel for the
              workflow's current status, or the selected stage's detail. */}
          <div className="wf-main-lane">
            {!selectedStage ? (
              <>
                {isGraphOrchestrated && !isCompleted && (
                  <div className="wf-autonomy-panel">
                    <div className="wf-autonomy-label-row">
                      <div className="wf-autonomy-label">Autonomy mode</div>
                      <button
                        type="button"
                        className="wf-autonomy-info-toggle"
                        aria-label="What do these modes mean?"
                        aria-expanded={showAutonomyInfo}
                        onClick={() => setShowAutonomyInfo((v) => !v)}
                      >
                        i
                      </button>
                    </div>
                    {showAutonomyInfo && (
                      <div className="wf-autonomy-info-popover" role="note">
                        <div>
                          <strong>Suggest</strong> - every stage pauses and shows you what it's about to do. Nothing runs until you approve, edit, or skip it.
                        </div>
                        <div>
                          <strong>Co-pilot</strong> - behaves the same as Suggest today: every stage pauses for your review.
                        </div>
                        <div>
                          <strong>Autopilot</strong> - stages run on their own with no pause, except: stages that send email always wait for you (a sent email can't be taken back), a stage that fails stops for correction, and once the project's monthly AI budget is over its cap the next stage stops too.
                        </div>
                      </div>
                    )}
                    <div className="wf-autonomy-options">
                      {['suggest', 'co-pilot', 'autopilot'].map((mode) => (
                        <button
                          key={mode}
                          className={`wf-autonomy-option ${instance.autonomyMode === mode ? 'active' : ''}`}
                          disabled={settingAutonomy}
                          onClick={() => handleSetAutonomy(mode)}
                        >
                          {mode === 'co-pilot' ? 'Co-pilot' : formatLabel(mode)}
                        </button>
                      ))}
                    </div>
                    <p className="wf-autonomy-hint">
                      {instance.autonomyMode === 'autopilot'
                        ? "Stages run on their own - but any stage that sends email, fails, or hits the AI budget cap still waits for you."
                        : 'Every stage pauses for your review before it runs.'}
                    </p>
                  </div>
                )}

                {/* Action Panels */}
                {isPending && isGraphOrchestrated && (
                  <div className="wf-action-panel">
                    <img src="/assets/icons/process.png" alt="" className="wf-action-icon" />
                    <h3>Ready to Run</h3>
                    <p>This workflow has {instance.totalStages} stages, run in {instance.autonomyMode || 'co-pilot'} mode.</p>
                    <button className="wf-btn wf-btn-primary" onClick={handleRunGraph} disabled={runningGraph}>
                      <img src="/assets/icons/process.png" alt="" /> {runningGraph ? 'Starting...' : 'Run Workflow'}
                    </button>
                  </div>
                )}

                {isPending && !isGraphOrchestrated && (
                  <div className="wf-action-panel">
                    <img src="/assets/icons/process.png" alt="" className="wf-action-icon" />
                    <h3>Ready to Start</h3>
                    <p>This workflow has {instance.totalStages} stages. Click to begin.</p>
                    <button className="wf-btn wf-btn-primary" onClick={handleStart}>
                      <img src="/assets/icons/process.png" alt="" /> Start Workflow
                    </button>
                  </div>
                )}

                {isGraphOrchestrated && (instance.status === 'running' || instance.status === 'paused') && pendingApproval?.pending && (() => {
                  const pendingStageId = pendingApproval.interrupt.stage_id;
                  const pendingStage = (instance.stages || []).find((s) => (s.id || s.stage_id) === pendingStageId);
                  const pendingStageName = pendingStage?.name || formatLabel(pendingStageId);
                  const fieldEntries = Object.entries(editFields);
                  return (
                  <div className="wf-action-panel wf-current-panel">
                    <div className="wf-current-badge">Pending Approval</div>
                    <div className="wf-current-header">
                      <img src={getStageIcon(pendingStageName)} alt="" />
                      <div>
                        <h3>{pendingStageName}</h3>
                        <p>Proposed input for this stage - approve it as-is, edit it below, or skip the stage entirely.</p>
                      </div>
                    </div>

                    {pendingApproval.interrupt.autopilot_pause_reason && pendingApproval.interrupt.autopilot_pause_reason !== 'error' && (
                      <div className="wf-stage-notice" role="note">
                        <strong>Autopilot paused here:</strong>{' '}
                        {pendingApproval.interrupt.autopilot_pause_reason === 'irreversible'
                          ? "this stage sends real email, and a sent email can't be taken back - so Autopilot always waits for you before it."
                          : "the project's monthly AI budget is at its cap."}
                      </div>
                    )}

                    {pendingApproval.interrupt.side_effect === 'irreversible' && editFields.businesses
                      && countRecipients(editFields.businesses.value) === 0 && (
                      <div className="wf-stage-notice" role="note">
                        <strong>No email addresses yet:</strong> none of these businesses has an email, so approving as-is will skip sending.
                        Type addresses into the Email column below and use Save Edit &amp; Approve, or skip this stage.
                      </div>
                    )}

                    {pendingApproval.interrupt.error && (
                      <div className="wf-stage-error" role="alert">
                        <strong>That attempt failed:</strong> {pendingApproval.interrupt.error}. Fix the fields below and try again, or skip this stage.
                      </div>
                    )}

                    {fieldEntries.length > 0 ? (
                      <div className="wf-form wf-proposed-fields">
                        {fieldEntries.map(([key, field]) => (
                          <div key={key} className="wf-form-field">
                            <label htmlFor={field.kind === 'rows' ? undefined : `wf-edit-${key}`}>{formatLabel(key)}</label>
                            {field.kind === 'rows' && (
                              <RepeatableRowsField
                                columns={field.columns}
                                rows={field.value}
                                onChange={(rows) => setEditFields((prev) => ({ ...prev, [key]: { ...prev[key], value: rows } }))}
                              />
                            )}
                            {field.kind === 'json' && (
                              <textarea
                                id={`wf-edit-${key}`}
                                className="wf-proposed-field-json"
                                rows={8}
                                value={field.value}
                                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: { ...prev[key], value: e.target.value } }))}
                              />
                            )}
                            {field.kind === 'multiline' && (
                              <textarea
                                id={`wf-edit-${key}`}
                                rows={5}
                                value={field.value}
                                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: { ...prev[key], value: e.target.value } }))}
                              />
                            )}
                            {field.kind === 'text' && (
                              <input
                                id={`wf-edit-${key}`}
                                type="text"
                                value={field.value}
                                onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: { ...prev[key], value: e.target.value } }))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="wf-empty-text">This stage needs no input - approve to run it, or skip it.</p>
                    )}

                    <div className="wf-action-buttons">
                      <button className="wf-btn wf-btn-secondary" onClick={handlePause} disabled={instance.status === 'paused'}>
                        <img src="/assets/icons/alerts.png" alt="" /> Pause
                      </button>
                      <button className="wf-btn wf-btn-secondary" onClick={() => handleResume('skip')} disabled={!!resumingAction}>
                        {resumingAction === 'skip' ? 'Skipping...' : 'Skip'}
                      </button>
                      {fieldEntries.length > 0 && (
                        <button className="wf-btn wf-btn-secondary" onClick={() => handleResume('edit')} disabled={!!resumingAction}>
                          {resumingAction === 'edit' ? 'Saving...' : 'Save Edit & Approve'}
                        </button>
                      )}
                      <button className="wf-btn wf-btn-primary" onClick={() => handleResume('approve')} disabled={!!resumingAction}>
                        {resumingAction === 'approve' ? 'Approving...' : 'Approve'}
                        {resumingAction !== 'approve' && <img src="/assets/icons/checklist.png" alt="" />}
                      </button>
                    </div>
                  </div>
                  );
                })()}

                {isGraphOrchestrated && instance.status === 'running' && !pendingApproval?.pending && (
                  <div className="wf-action-panel">
                    <Spinner size="md" />
                    <h3>Running</h3>
                    <p>Autopilot is working through the remaining stages.</p>
                    <button className="wf-btn wf-btn-secondary" onClick={handlePause}>
                      <img src="/assets/icons/alerts.png" alt="" /> Pause
                    </button>
                  </div>
                )}

                {isGraphOrchestrated && instance.status === 'paused' && !pendingApproval?.pending && (
                  <div className="wf-action-panel">
                    <img src="/assets/icons/alerts.png" alt="" className="wf-action-icon" />
                    <h3>Workflow Paused</h3>
                    <p>Any stage still to come will be skipped rather than run automatically. Run again to restart the pipeline from the top using what's already been gathered.</p>
                    <button className="wf-btn wf-btn-primary" onClick={handleRunGraph} disabled={runningGraph}>
                      <img src="/assets/icons/process.png" alt="" /> {runningGraph ? 'Starting...' : 'Run Again'}
                    </button>
                  </div>
                )}

                {instance.status === 'running' && !isGraphOrchestrated && currentStage && (
                  <div className="wf-action-panel wf-current-panel">
                    <div className="wf-current-badge">Current Stage</div>
                    <div className="wf-current-header">
                      <img src={getStageIcon(currentStage.name)} alt="" />
                      <div>
                        <h3>{currentStage.name}</h3>
                        <p>{currentStage.description}</p>
                      </div>
                    </div>

                    {currentStage.required_inputs?.length > 0 && (
                      <div className="wf-form">
                        {currentStage.required_inputs.map((input) => {
                          const sourceStage = getInputSourceStage(input);
                          return (
                            <div key={input} className="wf-form-field">
                              <label>
                                {formatLabel(input)}
                                {sourceStage && (
                                  <span className="wf-input-source">
                                    {' '}&middot; from {sourceStage.name}
                                  </span>
                                )}
                              </label>
                              <input
                                type="text"
                                value={stageData[input] || instance.context[input] || ''}
                                onChange={(e) => setStageData({ ...stageData, [input]: e.target.value })}
                                placeholder={`Enter ${formatLabel(input).toLowerCase()}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="wf-action-buttons">
                      <button className="wf-btn wf-btn-secondary" onClick={handlePause}>
                        <img src="/assets/icons/alerts.png" alt="" /> Pause
                      </button>
                      <button className="wf-btn wf-btn-primary" onClick={handleCompleteStage} disabled={completing}>
                        {completing ? 'Saving...' : 'Complete Stage'}
                        {!completing && <img src="/assets/icons/checklist.png" alt="" />}
                      </button>
                    </div>
                  </div>
                )}

                {instance.status === 'paused' && !isGraphOrchestrated && (
                  <div className="wf-action-panel">
                    <img src="/assets/icons/alerts.png" alt="" className="wf-action-icon" />
                    <h3>Workflow Paused</h3>
                    <p>Resume to continue from stage {instance.currentStageIndex + 1}.</p>
                    <button className="wf-btn wf-btn-primary" onClick={handleStart}>
                      <img src="/assets/icons/process.png" alt="" /> Resume
                    </button>
                  </div>
                )}

                {isCompleted && (
                  <div className="wf-action-panel wf-success-panel">
                    <img src="/assets/icons/checklist.png" alt="" className="wf-action-icon" />
                    <h3>Workflow Complete</h3>
                    <p>All {instance.totalStages} stages finished successfully.</p>
                    <button className="wf-btn wf-btn-secondary" onClick={() => navigate('/workflows')}>
                      Back to Workflows
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Stage Detail View */
              <StageDetailView
                stage={selectedStage}
                stageState={stageStates[selectedStage.id]}
                instance={instance}
                onBack={() => setSelectedStage(null)}
                onTasksChange={fetchAllTasks}
              />
            )}
          </div>

          {/* Lane 3: real activity timeline - workflow/stage lifecycle
              timestamps and task completions the backend already tracks.
              Each stage's own inputs/outputs remain visible in its detail
              view (Lane 2); this lane is about *when* things happened. */}
          <div className="wf-activity-lane">
            <div className="wf-activity-header">
              <img src="/assets/icons/monitoring.png" alt="" />
              <h3>Activity</h3>
            </div>
            {activityEvents.length === 0 ? (
              <p className="wf-empty-text">
                {isPending ? 'Nothing yet - start the workflow to begin.' : 'No activity recorded yet.'}
              </p>
            ) : (
              <div className="wf-activity-list">
                {activityEvents.map((event, idx) => (
                  <div key={event.id} className="wf-activity-item">
                    <div className="wf-activity-dot-col">
                      <span className="wf-activity-dot" />
                      {idx < activityEvents.length - 1 && <span className="wf-activity-line" />}
                    </div>
                    <div className="wf-activity-body">
                      <div className="wf-activity-title-row">
                        <span className="wf-activity-title">{event.title}</span>
                        <span className="wf-activity-time">{formatEventTime(event.time)}</span>
                      </div>
                      {event.detail && <p className="wf-activity-detail">{event.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* Repeatable-row editor for an array-of-records field in the
   pending-approval panel (e.g. businesses: [{name, email}, ...]) - the
   human-readable alternative to a raw JSON textarea for the one shape
   that actually accounts for nearly every array field across every
   orchestrated stage. `columns` is fixed for the field's lifetime (set
   once in buildEditFields), so removing every row doesn't lose track of
   what an "Add" row should contain. */
function RepeatableRowsField({ columns, rows, onChange }) {
  const updateCell = (idx, col, val) => {
    onChange(rows.map((row, i) => (i === idx ? { ...row, [col]: val } : row)));
  };
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const addRow = () => onChange([...rows, Object.fromEntries(columns.map((c) => [c, '']))]);

  return (
    <div className="wf-rows-field">
      {rows.length === 0 && <p className="wf-empty-text">None yet.</p>}
      {rows.map((row, idx) => (
        <div key={idx} className="wf-rows-field-row">
          {columns.map((col) => (
            <input
              key={col}
              type="text"
              aria-label={formatLabel(col)}
              placeholder={formatLabel(col)}
              value={row[col] ?? ''}
              onChange={(e) => updateCell(idx, col, e.target.value)}
            />
          ))}
          <button type="button" className="wf-rows-field-remove" onClick={() => removeRow(idx)} aria-label={`Remove row ${idx + 1}`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="wf-rows-field-add" onClick={addRow}>
        + Add
      </button>
    </div>
  );
}

/* Stage Detail View - Shows inputs, outputs, tasks, and agent info */
function StageDetailView({ stage, stageState, instance, onBack, onTasksChange }) {
  const [tasks, setTasks] = useState([]);
  const [taskStats, setTaskStats] = useState({ total: 0, done: 0, required_pending: 0, can_complete: true });
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskRequired, setNewTaskRequired] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);

  const isCompleted = stageState?.status === 'completed';
  const isCurrent = stage.index === instance.currentStageIndex && instance.status === 'running';
  const isPending = stage.index > instance.currentStageIndex;

  // Fetch team members for the assignee picker - only relevant if this
  // workflow is linked to a project (assigning to someone else only works
  // if they're on that project's team, per get_accessible_instance's
  // owner-or-team-member access model on the backend).
  useEffect(() => {
    if (!instance.projectId) {
      setTeamMembers([]);
      return;
    }
    fetch(`${API_CONFIG.BASE_URL}/api/team`, { headers: authJsonHeaders() })
      .then(res => res.json())
      .then(data => setTeamMembers(data.members || []))
      .catch(() => setTeamMembers([]));
  }, [instance.projectId]);

  // Fetch tasks for this stage
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch(
          `${API_CONFIG.BASE_URL}/api/workflows/instances/${instance.id}/stages/${stage.id}/tasks`,
          { headers: authJsonHeaders() }
        );
        const data = await res.json();
        if (data.success) {
          setTasks(data.tasks);
          setTaskStats(data.stats);
        }
      } catch (err) {
        console.error('Error fetching tasks:', err);
      } finally {
        setLoadingTasks(false);
      }
    };
    fetchTasks();
  }, [instance.id, stage.id, isCompleted]);

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instance.id}/tasks`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          stage_id: stage.id,
          title: newTaskTitle.trim(),
          is_required: newTaskRequired,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTasks([...tasks, data.task]);
        setTaskStats(prev => ({
          ...prev,
          total: prev.total + 1,
          required_pending: newTaskRequired ? prev.required_pending + 1 : prev.required_pending,
          can_complete: newTaskRequired ? false : prev.can_complete,
        }));
        setNewTaskTitle('');
        setNewTaskRequired(false);
        setShowAddTask(false);
        showToast('Task added', 'success');
        if (onTasksChange) onTasksChange();
      } else {
        showToast(data.error || 'Failed to add task', 'error');
      }
    } catch (err) {
      showToast('Error adding task', 'error');
    } finally {
      setSavingTask(false);
    }
  };

  const handleToggleTask = async (task) => {
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instance.id}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authJsonHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setTasks(tasks.map(t => t.id === task.id ? data.task : t));
        // Update stats
        const wasDone = task.status === 'done';
        setTaskStats(prev => {
          const newDone = wasDone ? prev.done - 1 : prev.done + 1;
          const newRequiredPending = task.is_required
            ? (wasDone ? prev.required_pending + 1 : prev.required_pending - 1)
            : prev.required_pending;
          return {
            ...prev,
            done: newDone,
            required_pending: newRequiredPending,
            can_complete: newRequiredPending === 0,
          };
        });
        if (onTasksChange) onTasksChange();
      }
    } catch (err) {
      showToast('Error updating task', 'error');
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instance.id}/tasks/${taskId}`, {
        method: 'DELETE',
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        const deletedTask = tasks.find(t => t.id === taskId);
        setTasks(tasks.filter(t => t.id !== taskId));
        setTaskStats(prev => ({
          ...prev,
          total: prev.total - 1,
          done: deletedTask?.status === 'done' ? prev.done - 1 : prev.done,
          required_pending: deletedTask?.is_required && deletedTask?.status !== 'done'
            ? prev.required_pending - 1
            : prev.required_pending,
          can_complete: prev.can_complete || (deletedTask?.is_required && deletedTask?.status !== 'done'),
        }));
        showToast('Task deleted', 'success');
        if (onTasksChange) onTasksChange();
      }
    } catch (err) {
      showToast('Error deleting task', 'error');
    }
  };

  const handleAssignTask = async (task, assignee) => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instance.id}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: authJsonHeaders(),
        body: JSON.stringify({ assigned_to: assignee || null }),
      });
      const data = await res.json();
      if (data.success) {
        setTasks(tasks.map(t => t.id === task.id ? data.task : t));
      } else {
        showToast(data.error || 'Failed to update assignee', 'error');
      }
    } catch (err) {
      showToast('Error updating assignee', 'error');
    }
  };

  return (
    <div className="wf-stage-detail">
      <button className="wf-back-btn" onClick={onBack}>
        <img src="/assets/icons/process.png" alt="" style={{ transform: 'rotate(180deg)' }} />
        Back to stages
      </button>

      <div className="wf-detail-header">
        <img src={getStageIcon(stage.name)} alt="" className="wf-detail-icon" />
        <div>
          <h2>{stage.name}</h2>
          <p>{stage.description}</p>
        </div>
        <span className={`wf-detail-status ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}>
          {isCompleted ? (stageState?.outcome === 'skipped' ? 'Skipped' : 'Completed') : isCurrent ? 'In Progress' : 'Pending'}
        </span>
      </div>

      {/* Inputs & Outputs - what this agent needs and what it produces */}
      {(stage.required_inputs?.length > 0 || stage.outputs?.length > 0) && (
        <div className="wf-detail-section wf-io-section">
          <h3>
            <img src="/assets/icons/import-export.png" alt="" /> Inputs &amp; Outputs
          </h3>
          <div className="wf-io-grid">
            {stage.required_inputs?.map((key) => {
              const value = stageState?.data?.[key] ?? instance.context?.[key];
              return (
                <div className="wf-io-item" key={`in-${key}`}>
                  <img src={getContextIcon(key)} alt="" />
                  <div>
                    <span className="wf-io-label">
                      {formatLabel(key)}
                      <span className="wf-io-badge wf-io-badge-input">Input</span>
                    </span>
                    <span className={`wf-io-value ${value === undefined ? 'wf-io-empty' : ''}`}>
                      {value !== undefined ? formatContextValue(value) : 'Not yet provided'}
                    </span>
                  </div>
                </div>
              );
            })}
            {stage.outputs?.map((key) => {
              const value = stageState?.data?.[key];
              return (
                <div className="wf-io-item" key={`out-${key}`}>
                  <img src={getContextIcon(key)} alt="" />
                  <div>
                    <span className="wf-io-label">
                      {formatLabel(key)}
                      <span className="wf-io-badge wf-io-badge-output">Output</span>
                    </span>
                    <span className={`wf-io-value ${value === undefined ? 'wf-io-empty' : ''}`}>
                      {value !== undefined ? formatContextValue(value) : isCompleted ? '-' : 'Not yet generated'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tasks Section */}
      <div className="wf-detail-section wf-tasks-section">
        <div className="wf-tasks-header">
          <h3>
            <img src="/assets/icons/checklist.png" alt="" /> Tasks
            <span className="wf-task-count">
              {taskStats.done}/{taskStats.total} complete
            </span>
          </h3>
          {!isCompleted && !isPending && (
            <button className="wf-add-task-btn" onClick={() => setShowAddTask(!showAddTask)}>
              <img src="/assets/icons/plus.png" alt="" /> Add Task
            </button>
          )}
        </div>

        {/* Required tasks warning */}
        {!taskStats.can_complete && !isCompleted && (
          <div className="wf-tasks-warning">
            <img src="/assets/icons/alerts.png" alt="" />
            <span>{taskStats.required_pending} required task{taskStats.required_pending > 1 ? 's' : ''} must be completed before this stage can finish</span>
          </div>
        )}

        {/* Add task form */}
        {showAddTask && (
          <div className="wf-add-task-form">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Enter task title..."
              className="wf-task-input"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
            />
            <label className="wf-task-required-toggle">
              <input
                type="checkbox"
                checked={newTaskRequired}
                onChange={(e) => setNewTaskRequired(e.target.checked)}
              />
              <span>Required (blocks stage completion)</span>
            </label>
            <div className="wf-add-task-actions">
              <button className="wf-btn-cancel" onClick={() => { setShowAddTask(false); setNewTaskTitle(''); }}>
                Cancel
              </button>
              <button className="wf-btn-save" onClick={handleAddTask} disabled={savingTask || !newTaskTitle.trim()}>
                {savingTask ? 'Adding...' : 'Add Task'}
              </button>
            </div>
          </div>
        )}

        {/* Task list */}
        {loadingTasks ? (
          <div className="wf-tasks-loading">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <p className="wf-empty-text">No tasks for this stage</p>
        ) : (
          <div className="wf-tasks-list">
            {tasks.map(task => (
              <div key={task.id} className={`wf-task-item ${task.status === 'done' ? 'done' : ''} ${task.is_required ? 'required' : 'optional'}`}>
                <button
                  className="wf-task-checkbox"
                  onClick={() => handleToggleTask(task)}
                  disabled={isCompleted}
                >
                  {task.status === 'done' ? (
                    <img src={TASK_ICONS.done} alt="Done" />
                  ) : (
                    <span className="wf-checkbox-empty" />
                  )}
                </button>
                <div className="wf-task-content">
                  <span className="wf-task-title">{task.title}</span>
                  <div className="wf-task-meta">
                    {task.is_required ? (
                      <span className="wf-task-badge required">Required</span>
                    ) : (
                      <span className="wf-task-badge optional">Optional</span>
                    )}
                    {teamMembers.length > 0 && !isCompleted ? (
                      <span className="wf-task-assignee wf-task-assignee--picker">
                        <img src="/assets/icons/user.png" alt="" />
                        <select
                          value={task.assigned_to || ''}
                          onChange={(e) => handleAssignTask(task, e.target.value)}
                          aria-label={`Assign "${task.title}"`}
                        >
                          <option value="">Unassigned</option>
                          {teamMembers.map((m) => (
                            <option key={m.email} value={m.email}>{m.name}</option>
                          ))}
                        </select>
                      </span>
                    ) : task.assigned_to && (
                      <span className="wf-task-assignee">
                        <img src="/assets/icons/user.png" alt="" />
                        {task.assigned_to.split('@')[0]}
                      </span>
                    )}
                  </div>
                </div>
                {!isCompleted && (
                  <button className="wf-task-delete" onClick={() => handleDeleteTask(task.id)} title="Delete task">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Info */}
      <div className="wf-detail-section">
        <h3>Stage Handler</h3>
        <div className="wf-agent-card">
          <img src={getAgentIcon(stage.agent)} alt="" className="wf-agent-icon" />
          <div className="wf-agent-info">
            <span className="wf-agent-name">{getAgentLabel(stage.agent)}</span>
            <span className={`wf-agent-type wf-agent-type-${getAgentType(stage.agent)}`}>
              {getAgentType(stage.agent) === 'agent' ? 'Agent' : 'Form'}
            </span>
          </div>
          {getAgentRoute(stage.agent) && getAgentType(stage.agent) === 'agent' && (
            <>
              {/* Show "View Details" only if stage has saved data, otherwise "Open Agent" */}
              {isCompleted && stageState?.data && Object.keys(stageState.data).length > 0 ? (
                <a
                  href={`${getAgentRoute(stage.agent)}?workflow=${instance.id}&stage=${stage.id}&view=history${instance.projectId ? `&project=${instance.projectId}` : ''}`}
                  className="wf-btn wf-btn-secondary wf-btn-sm"
                >
                  View Details
                </a>
              ) : (
                <a
                  href={`${getAgentRoute(stage.agent)}?workflow=${instance.id}&stage=${stage.id}&view=run${instance.projectId ? `&project=${instance.projectId}` : ''}`}
                  className={`wf-btn ${isCompleted ? 'wf-btn-secondary' : 'wf-btn-primary'} wf-btn-sm`}
                >
                  {isCompleted ? 'Open Agent' : 'Launch Agent'}
                </a>
              )}
            </>
          )}
        </div>
      </div>


      {/* Completion Info */}
      {isCompleted && stageState?.completedAt && (
        <div className="wf-detail-footer">
          <img src="/assets/icons/checklist.png" alt="" />
          <span>
            Completed on {new Date(stageState.completedAt).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>
      )}
    </div>
  );
}

export default WorkflowRunner;
