import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../core/Header';
import { BackButton, EmptyState, ProjectSelector } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { STRINGS } from '../constants/strings';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import './WorkflowsPage.css';

// Maps template.icon identifiers (from backend template config) to actual icon files
const TEMPLATE_ICON_MAP = {
  truck: 'supply-chain-management',
  users: 'users',
  rocket: 'increase',
  'clipboard-check': 'checklist',
  workflow: 'process',
};

function WorkflowsPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [instances, setInstances] = useState([]);
  const [activeTab, setActiveTab] = useState('templates');
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const selectedProjectId = useSelectedProjectId();

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
  }, []);

  const fetchInstances = useCallback(async () => {
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
  }, [selectedProjectId]);

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
              {selectedProjectId && (
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
