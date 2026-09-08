import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BackButton, EmptyState, Spinner } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import './WorkflowRunner.css';

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
                        {isStageCompleted ? (
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
                {/* Action Panels */}
                {isPending && (
                  <div className="wf-action-panel">
                    <img src="/assets/icons/process.png" alt="" className="wf-action-icon" />
                    <h3>Ready to Start</h3>
                    <p>This workflow has {instance.totalStages} stages. Click to begin.</p>
                    <button className="wf-btn wf-btn-primary" onClick={handleStart}>
                      <img src="/assets/icons/process.png" alt="" /> Start Workflow
                    </button>
                  </div>
                )}

                {instance.status === 'running' && currentStage && (
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

                {instance.status === 'paused' && (
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
          {isCompleted ? 'Completed' : isCurrent ? 'In Progress' : 'Pending'}
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
