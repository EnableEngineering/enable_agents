import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../core/Header';
import { BackButton, EmptyState, ProjectSelector } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { STRINGS } from '../constants/strings';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { useMode } from '../contexts';
import './WorkflowsPage.css';

// Maps template.icon identifiers (from backend template config) to actual icon files
const TEMPLATE_ICON_MAP = {
  truck: 'supply-chain-management',
  users: 'users',
  rocket: 'increase',
  'clipboard-check': 'checklist',
  workflow: 'process',
};

// Demo data for showcasing workflows without backend
const DEMO_TEMPLATES = [
  {
    id: 'supplier-qualification',
    name: 'Supplier Qualification Pipeline',
    description: 'End-to-end workflow for qualifying suppliers for OEM requirements. Covers requirement capture, supplier research, RFQ management, and final selection.',
    category: 'procurement',
    icon: 'truck',
    stageCount: 6,
    stages: [
      { name: 'Requirement Capture' }, { name: 'Supplier Research' }, { name: 'Document Analysis' },
      { name: 'RFQ Outreach' }, { name: 'Response Analysis' }, { name: 'Final Selection' },
    ],
    isSystem: true,
  },
  {
    id: 'lead-nurture',
    name: 'Lead Nurturing',
    description: 'Multi-touch campaign to convert leads into customers through personalized outreach.',
    category: 'marketing',
    icon: 'users',
    stageCount: 4,
    stages: [
      { name: 'Lead Research' }, { name: 'Content Personalization' }, { name: 'Outreach' }, { name: 'Follow-up' },
    ],
    isSystem: true,
  },
  {
    id: 'market-launch',
    name: 'New Market Launch',
    description: 'Complete workflow for launching into a new market: research, content creation, and outreach.',
    category: 'marketing',
    icon: 'rocket',
    stageCount: 3,
    stages: [
      { name: 'Market Research' }, { name: 'Content Creation' }, { name: 'Outreach' },
    ],
    isSystem: true,
  },
  {
    id: 'vendor-evaluation',
    name: 'Vendor Evaluation',
    description: 'Research and evaluate potential vendors/suppliers for your business needs.',
    category: 'procurement',
    icon: 'clipboard-check',
    stageCount: 4,
    stages: [
      { name: 'Vendor Discovery' }, { name: 'Document Review' }, { name: 'Comparison & Scoring' }, { name: 'Recommendation' },
    ],
    isSystem: true,
  },
];

const DEMO_INSTANCES = [
  {
    id: 'demo-instance-1',
    name: 'Apex Manufacturing - Aluminum Housing Sourcing',
    templateId: 'supplier-qualification',
    templateName: 'Supplier Qualification Pipeline',
    status: 'completed',
    currentStageIndex: 6,
    totalStages: 6,
    currentStage: null,
    context: {
      client_name: 'Apex Manufacturing Inc.',
      selected_supplier: 'Bharat Precision Engineering',
      quote: '$12.80/unit',
    },
    createdAt: '2026-07-15T10:00:00Z',
    completedAt: '2026-07-20T14:30:00Z',
  },
  {
    id: 'demo-instance-2',
    name: 'TechCorp Q3 Lead Campaign',
    templateId: 'lead-nurture',
    templateName: 'Lead Nurturing',
    status: 'running',
    currentStageIndex: 2,
    totalStages: 4,
    currentStage: { id: 'outreach', name: 'Personalized Outreach', agent: 'content_marketing' },
    context: {
      total_leads: 156,
      emails_sent: 89,
    },
    createdAt: '2026-07-18T09:00:00Z',
  },
  {
    id: 'demo-instance-3',
    name: 'Southeast Asia Market Entry',
    templateId: 'market-launch',
    templateName: 'New Market Launch',
    status: 'pending',
    currentStageIndex: 0,
    totalStages: 3,
    currentStage: { id: 'research', name: 'Market Research', agent: 'market_research' },
    context: {},
    createdAt: '2026-07-20T08:00:00Z',
  },
];

function WorkflowsPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [instances, setInstances] = useState([]);
  const [activeTab, setActiveTab] = useState('templates');
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const selectedProjectId = useSelectedProjectId();

  // Demo mode from shared context
  const { isDemoMode } = useMode();

  // AI agent suggestions for the selected project, based on its business
  // context (set at project creation) - fetched on demand, not
  // automatically, since it's a real LLM call. Purely informational: never
  // auto-applied to a template, the user still picks and configures
  // manually.
  const [agentSuggestions, setAgentSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const handleGetSuggestions = async () => {
    if (!selectedProjectId) return;
    setLoadingSuggestions(true);
    setAgentSuggestions(null);
    try {
      const projectRes = await fetch(`${API_CONFIG.BASE_URL}/api/projects/${selectedProjectId}`, {
        headers: authJsonHeaders(),
      });
      const projectData = await projectRes.json();
      const businessContext = projectData?.project?.data?.business_context;

      if (!businessContext || (!businessContext.industry && !businessContext.productService && !businessContext.role)) {
        showToast('This project has no business context yet - add one from the project settings to get agent suggestions.', 'warning');
        return;
      }

      const recRes = await fetch(`${API_CONFIG.BASE_URL}/recommend_agents`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          industry: businessContext.industry || '',
          product_service: businessContext.productService || '',
          role: businessContext.role || '',
        }),
      });
      const recData = await recRes.json();
      const toolNames = (recData?.recommendations?.recommended_tools || [])
        .map((tool) => tool.name || tool.tool_name)
        .filter(Boolean);

      if (toolNames.length) {
        setAgentSuggestions(toolNames);
      } else {
        showToast('Could not generate agent suggestions right now. Please try again shortly.', 'warning');
      }
    } catch (err) {
      showToast('Could not generate agent suggestions right now. Please try again shortly.', 'warning');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Clear stale suggestions when the selected project changes
  useEffect(() => {
    setAgentSuggestions(null);
  }, [selectedProjectId]);

  const fetchTemplates = useCallback(async () => {
    // Use demo data in demo mode
    if (isDemoMode) {
      setTemplates(DEMO_TEMPLATES);
      return;
    }

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/templates`, {
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }, [isDemoMode]);

  const fetchInstances = useCallback(async () => {
    // Use demo data in demo mode
    if (isDemoMode) {
      setInstances(DEMO_INSTANCES);
      return;
    }

    try {
      const url = selectedProjectId
        ? `${API_CONFIG.BASE_URL}/api/workflows/instances?project_id=${selectedProjectId}`
        : `${API_CONFIG.BASE_URL}/api/workflows/instances`;
      const res = await fetch(url, { headers: authJsonHeaders() });
      const data = await res.json();
      if (data.success) {
        setInstances(data.instances || []);
      }
    } catch (err) {
      console.error('Error fetching instances:', err);
    }
  }, [selectedProjectId, isDemoMode]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchTemplates(), fetchInstances()]);
      setLoading(false);
    };
    load();
  }, [fetchTemplates, fetchInstances]);

  const handleStartWorkflow = async (templateId) => {
    if (!selectedProjectId) {
      showToast('Pick a project from the dropdown above first (or create one if you don\'t have one yet)', 'warning');
      return;
    }

    // Demo mode: simulate starting workflow, then go straight into it - a
    // template card should feel like "enter this workflow", not "create a
    // list item I then have to click again to actually begin."
    if (isDemoMode) {
      const template = templates.find((t) => t.id === templateId);
      const newInstance = {
        id: `demo-${Date.now()}`,
        name: `${template?.name || 'New Workflow'} - Demo`,
        templateId,
        templateName: template?.name || 'Workflow',
        status: 'pending',
        currentStageIndex: 0,
        totalStages: template?.stageCount || 3,
        currentStage: { id: 'step-1', name: 'First Stage', agent: 'requirements_gathering' },
        context: {},
        createdAt: new Date().toISOString(),
      };
      setInstances((prev) => [newInstance, ...prev]);
      navigate(`/workflows/${newInstance.id}`);
      return;
    }

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          templateId,
          projectId: selectedProjectId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Go straight into the runner instead of parking the user on this
        // list with a "Workflow started" toast that's immediately
        // contradicted by the instance card still saying "Not Started."
        navigate(`/workflows/${data.instance.id}`);
      } else {
        showToast(data.error || 'Failed to start workflow', 'error');
      }
    } catch (err) {
      showToast('Error starting workflow', 'error');
    }
  };

  const handleDeleteInstance = async (instanceId) => {
    // Demo mode: just remove from state
    if (isDemoMode) {
      setInstances((prev) => prev.filter((i) => i.id !== instanceId));
      showToast('Demo workflow deleted', 'success');
      return;
    }

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${instanceId}`, {
        method: 'DELETE',
        headers: authJsonHeaders(),
      });
      if (res.ok) {
        setInstances((prev) => prev.filter((i) => i.id !== instanceId));
        showToast('Workflow deleted', 'success');
      }
    } catch (err) {
      showToast('Error deleting workflow', 'error');
    }
  };

  const categories = [...new Set(templates.map((t) => t.category))];
  const filteredTemplates =
    selectedCategory === 'all'
      ? templates
      : templates.filter((t) => t.category === selectedCategory);

  const activeInstances = instances.filter((i) => ['pending', 'running', 'paused'].includes(i.status));
  const completedInstances = instances.filter((i) => i.status === 'completed');

  if (loading) {
    return (
      <>
        <Header />
        <div className="workflows-page">
          <div className="workflows-loading">{STRINGS.LOADING.WORKFLOWS}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="workflows-page">
        <div className="workflows-header">
          <div className="workflows-header-left">
            <BackButton />
            <h1>Workflows</h1>
          </div>
          <ProjectSelector />
        </div>

        <div className="workflows-tabs">
            <button
              className={`workflow-tab ${activeTab === 'templates' ? 'active' : ''}`}
              onClick={() => setActiveTab('templates')}
              title="Browse available workflow templates"
            >
              Templates
            </button>
            <button
              className={`workflow-tab ${activeTab === 'active' ? 'active' : ''}`}
              onClick={() => setActiveTab('active')}
              title="View workflows currently in progress"
            >
              Active ({activeInstances.length})
            </button>
            <button
              className={`workflow-tab ${activeTab === 'completed' ? 'active' : ''}`}
              onClick={() => setActiveTab('completed')}
              title="View completed workflows and their results"
            >
              Completed ({completedInstances.length})
            </button>
          </div>

          {activeTab === 'templates' && (
            <div className="workflows-content">
              {selectedProjectId && !isDemoMode && (
                <div className="agent-suggestions-bar">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleGetSuggestions}
                    disabled={loadingSuggestions}
                  >
                    {loadingSuggestions ? 'Thinking...' : 'Get AI Agent Suggestions'}
                  </button>
                  {agentSuggestions && (
                    <div className="agent-suggestions-result">
                      <span>Based on this project's business context, consider: </span>
                      <strong>{agentSuggestions.join(', ')}</strong>
                      <span className="agent-suggestions-hint"> - pick any template below and configure agents manually as needed.</span>
                    </div>
                  )}
                </div>
              )}
              <div className="category-filter">
                <button
                  className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>

              {filteredTemplates.length === 0 ? (
                <EmptyState
                  iconType="document"
                  title="No templates available"
                  description="Workflow templates will appear here."
                />
              ) : (
                <div className="templates-grid">
                  {filteredTemplates.map((template) => (
                    <div key={template.id} className="template-card">
                      <div className="template-header">
                        <img
                          src={`/assets/icons/${TEMPLATE_ICON_MAP[template.icon] || 'process'}.png`}
                          alt=""
                          className="template-icon"
                        />
                        <span className="template-category">{template.category}</span>
                      </div>
                      <h3>{template.name}</h3>
                      <p>{template.description}</p>
                      {template.stages?.length > 0 ? (
                        <ol className="template-stage-list">
                          {template.stages.map((stage, idx) => (
                            <li key={stage.stage_id || stage.id || idx}>{stage.name}</li>
                          ))}
                        </ol>
                      ) : (
                        <div className="template-stages">
                          {template.stageCount} stages
                        </div>
                      )}
                      <button
                        className="btn btn-primary"
                        onClick={() => handleStartWorkflow(template.id)}
                      >
                        Start Workflow
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'active' && (
            <div className="workflows-content">
              {activeInstances.length === 0 ? (
                <EmptyState
                  iconType="data"
                  title="No active workflows"
                  description="Start a workflow from the Templates tab."
                  action={{ label: 'Browse Templates', onClick: () => setActiveTab('templates') }}
                />
              ) : (
                <div className="instances-list">
                  {activeInstances.map((instance) => (
                    <InstanceCard
                      key={instance.id}
                      instance={instance}
                      onDelete={() => handleDeleteInstance(instance.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'completed' && (
            <div className="workflows-content">
              {completedInstances.length === 0 ? (
                <EmptyState
                  iconType="message"
                  title="No completed workflows"
                  description="Completed workflows will appear here."
                />
              ) : (
                <div className="instances-list">
                  {completedInstances.map((instance) => (
                    <InstanceCard
                      key={instance.id}
                      instance={instance}
                      onDelete={() => handleDeleteInstance(instance.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </>
  );
}

function InstanceCard({ instance, onDelete }) {
  const progress = instance.totalStages > 0
    ? Math.round((instance.currentStageIndex / instance.totalStages) * 100)
    : 0;

  const statusConfig = {
    pending: { label: '○ Not Started', bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
    running: { label: '● In Progress', bg: '#dbeafe', color: '#2563eb' },
    paused: { label: '⏸ Paused', bg: 'var(--color-background)', color: 'var(--color-text-muted)' },
    completed: { label: '✓ Completed', bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
    failed: { label: '✕ Failed', bg: 'var(--color-error-bg)', color: 'var(--color-error)' },
  };

  const status = statusConfig[instance.status] || statusConfig.pending;

  return (
    <div className="instance-card">
      <div className="instance-header">
        <div className="instance-title-row">
          <h3>{instance.name}</h3>
          <span
            className="instance-status"
            style={{ backgroundColor: status.bg, color: status.color }}
          >
            {status.label}
          </span>
        </div>
        <p className="instance-template">{instance.templateName}</p>
      </div>

      <div className="instance-progress">
        <div className="progress-info">
          <span className="progress-label">Progress</span>
          <span className="progress-text">
            {instance.currentStageIndex}/{instance.totalStages}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {instance.currentStage && instance.status === 'running' && (
        <div className="current-stage">
          <span className="current-stage-label">Current:</span> {instance.currentStage.name}
        </div>
      )}

      <div className="instance-actions">
        {instance.status === 'running' && (
          <a href={`/workflows/${instance.id}`} className="btn btn-primary btn-sm" title="Continue working on this workflow">
            Continue →
          </a>
        )}
        {instance.status === 'pending' && (
          <a href={`/workflows/${instance.id}`} className="btn btn-primary btn-sm" title="Start this workflow">
            Start →
          </a>
        )}
        {instance.status === 'paused' && (
          <a href={`/workflows/${instance.id}`} className="btn btn-primary btn-sm" title="Resume this paused workflow">
            Resume →
          </a>
        )}
        {instance.status === 'completed' && (
          <a href={`/workflows/${instance.id}`} className="btn btn-primary btn-sm" title="View workflow details and results">
            View
          </a>
        )}
        <button className="btn btn-icon btn-sm" onClick={onDelete} title="Delete this workflow permanently" aria-label="Delete workflow">
          🗑️
        </button>
      </div>
    </div>
  );
}

export default WorkflowsPage;
