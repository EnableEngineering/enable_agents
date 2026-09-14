import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './Projects.css';
import { showToast } from '../core/toast';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { BackButton, showConfirm, Modal, Spinner, Button } from '../components';
import { AGENTS } from '../config/agentsConfig';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const Icons = {
  ArrowLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Folder: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Users: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
};

const AI_KEY_FIELDS = [
  { key: 'openai_key', label: 'OpenAI API Key', placeholder: 'sk-...', type: 'password' },
  { key: 'anthropic_key', label: 'Anthropic API Key', placeholder: 'sk-ant-...', type: 'password' },
  {
    key: 'preferred_model', label: 'Preferred Model', type: 'select',
    options: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast, Cheap)' },
      { value: 'gpt-4o', label: 'GPT-4o (Powerful)' },
      { value: 'claude-3-haiku', label: 'Claude 3 Haiku (Fast)' },
      { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet (Balanced)' },
    ],
  },
];

function Projects() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const userEmail = localStorage.getItem('userEmail') || '';

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const emptyBusinessContext = { industry: '', role: '', productService: '' };

  // Pre-fill from Settings' Business Context tab if the user has already
  // set one - optional, not required to create a project (decision:
  // non-blocking, since making it mandatory would stop existing users
  // with no context from creating new projects at all).
  const loadStoredBusinessContext = () => {
    try {
      const stored = localStorage.getItem('enableAgentsBusinessContext');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          industry: parsed.industry || '',
          role: parsed.role || '',
          productService: parsed.productService || '',
        };
      }
    } catch {
      // keep defaults
    }
    return { ...emptyBusinessContext };
  };

  const [newProject, setNewProject] = useState(() => ({
    name: '',
    description: '',
    team_id: '',
    business_context: loadStoredBusinessContext(),
  }));
  const [creating, setCreating] = useState(false);
  const [teams, setTeams] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(false);

  // Project AI key settings
  const [settingsProject, setSettingsProject] = useState(null);
  const [projectSettings, setProjectSettings] = useState(null);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsEditValues, setSettingsEditValues] = useState({});
  const [settingsSavingKey, setSettingsSavingKey] = useState('');
  const [settingsTestingKey, setSettingsTestingKey] = useState('');
  const [settingsTestResults, setSettingsTestResults] = useState({});
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  // Deep link from the Dashboard's "Create New Project" button.
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowCreateModal(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch teams when create modal opens
  useEffect(() => {
    if (showCreateModal) {
      fetchTeams();
    }
  }, [showCreateModal]);

  const fetchTeams = async () => {
    setLoadingTeams(true);
    try {
      const res = await fetch(`${API_URL}/api/team`, {
        headers: authOptionalHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTeams(data.members ? [{ id: 'default', name: 'My Team' }] : []);
        // If there's a default team, select it
        if (data.team_id) {
          setNewProject(prev => ({ ...prev, team_id: data.team_id }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch teams:', err);
    } finally {
      setLoadingTeams(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        headers: authOptionalHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newProject.name.trim()) {
      showToast('Please enter a project name', 'warning');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(newProject),
      });

      if (res.ok) {
        showToast('Project created', 'success');
        setNewProject({ name: '', description: '', team_id: '', business_context: { ...emptyBusinessContext } });
        setShowCreateModal(false);
        fetchProjects();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to create', 'error');
      }
    } catch {
      showToast('Failed to create project', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (projectId) => {
    const project = projects.find(p => p.id === projectId);
    const confirmed = await showConfirm({
      title: 'Delete project?',
      message: `This will permanently remove "${project?.name || 'this project'}" and its agent data. This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        showToast('Project deleted', 'success');
        fetchProjects();
      }
    } catch {
      showToast('Failed to delete project', 'error');
    }
  };

  const getAgentName = (agentId) => {
    return AGENTS[agentId]?.name || agentId;
  };

  const openProjectSettings = async (project) => {
    setSettingsProject(project);
    setSettingsEditValues({});
    setBudgetInput(project.monthlyBudgetUsd != null ? String(project.monthlyBudgetUsd) : '');
    setSettingsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${project.id}/settings`, {
        headers: authOptionalHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setProjectSettings(data.settings?.ai?.settings || {});
        setCanManageSettings(Boolean(data.canManage));
      } else {
        showToast(data.error || 'Failed to load project settings', 'error');
        setProjectSettings({});
        setCanManageSettings(false);
      }
    } catch {
      showToast('Failed to load project settings', 'error');
      setProjectSettings({});
      setCanManageSettings(false);
    } finally {
      setSettingsLoading(false);
    }
  };

  const closeProjectSettings = () => {
    setSettingsProject(null);
    setProjectSettings(null);
    setSettingsEditValues({});
  };

  const handleSaveProjectSetting = async (key) => {
    const value = settingsEditValues[key];
    if (!value || !value.trim()) return;

    setSettingsSavingKey(key);
    try {
      const res = await fetch(`${API_URL}/api/projects/${settingsProject.id}/settings`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ key, value: value.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Project setting saved', 'success');
        setSettingsEditValues(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        openProjectSettings(settingsProject);
      } else {
        showToast(data.error || 'Failed to save setting', 'error');
      }
    } catch {
      showToast('Failed to save setting', 'error');
    } finally {
      setSettingsSavingKey('');
    }
  };

  const handleTestProjectSetting = async (key) => {
    const value = settingsEditValues[key];
    if (!value || !value.trim()) return;

    setSettingsTestingKey(key);
    setSettingsTestResults(prev => ({ ...prev, [key]: null }));
    try {
      const res = await fetch(`${API_URL}/api/projects/${settingsProject.id}/settings/test`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ key, value: value.trim() }),
      });
      const data = await res.json();
      setSettingsTestResults(prev => ({ ...prev, [key]: { success: data.success, message: data.message } }));
    } catch {
      setSettingsTestResults(prev => ({ ...prev, [key]: { success: false, message: 'Test request failed' } }));
    } finally {
      setSettingsTestingKey('');
    }
  };

  const handleRemoveProjectSetting = async (key) => {
    setSettingsSavingKey(key);
    try {
      const res = await fetch(`${API_URL}/api/projects/${settingsProject.id}/settings/${key}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Project setting removed', 'success');
        openProjectSettings(settingsProject);
      } else {
        showToast(data.error || 'Failed to remove setting', 'error');
      }
    } catch {
      showToast('Failed to remove setting', 'error');
    } finally {
      setSettingsSavingKey('');
    }
  };

  const handleSaveBudget = async () => {
    setSavingBudget(true);
    try {
      const value = budgetInput.trim();
      const res = await fetch(`${API_URL}/api/projects/${settingsProject.id}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ monthlyBudgetUsd: value === '' ? null : Number(value) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(value === '' ? 'Budget removed' : 'Monthly budget saved', 'success');
        setSettingsProject(data.project);
        fetchProjects();
      } else {
        showToast(data.error || 'Failed to save budget', 'error');
      }
    } catch {
      showToast('Failed to save budget', 'error');
    } finally {
      setSavingBudget(false);
    }
  };

  const Icon = ({ name }) => {
    const I = Icons[name];
    return I ? <I /> : null;
  };

  return (
    <div className="projects-page">
      <div className="projects-container">
        <header className="projects-header">
          <BackButton />
          <div className="header-content">
            <h1>Projects</h1>
            <p className="text-muted">
              Shared workspaces across agents and team members
            </p>
          </div>
          <button className="btn-create" onClick={() => setShowCreateModal(true)}>
            <Icon name="Plus" />
            New Project
          </button>
        </header>

        {loading ? (
          <div className="loading"><Spinner size="lg" /></div>
        ) : projects.length === 0 ? (
          <div className="empty-state-card">
            <Icon name="Folder" />
            <h3>No projects yet</h3>
            <p>Create a project to share work across agents and team members.</p>
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              Create First Project
            </Button>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map(project => (
              <div key={project.id} className="project-card">
                <div className="project-card-header">
                  <div className="project-icon">
                    <Icon name="Folder" />
                  </div>
                  <div className="project-title">
                    <h3 title={project.name}>{project.name}</h3>
                    <span className={`status-badge ${project.status}`}>
                      {project.status}
                    </span>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => openProjectSettings(project)}
                    title="AI provider settings"
                  >
                    <Icon name="Settings" />
                  </button>
                  <button
                    className="btn-icon danger"
                    onClick={() => handleDelete(project.id)}
                    title="Delete project"
                  >
                    <Icon name="Trash" />
                  </button>
                </div>

                {project.description && (
                  <p className="project-description">{project.description}</p>
                )}

                <div className="project-meta">
                  <span className="meta-item">
                    Created {project.createdAt}
                  </span>
                  {project.data && Object.keys(project.data).length > 0 && (
                    <div className="project-stats">
                      {project.data.tasks && <span>{project.data.tasks} tasks</span>}
                      {project.data.leads && <span>{project.data.leads} leads</span>}
                      {project.data.content && <span>{project.data.content} content</span>}
                      {project.data.attendees && <span>{project.data.attendees} attendees</span>}
                    </div>
                  )}
                </div>

                <div className="project-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      // Navigate to first enabled agent with this project
                      const firstAgent = project.agents[0];
                      const route = AGENTS[firstAgent]?.route;
                      if (route) {
                        navigate(`${route}?project=${project.id}`);
                      }
                    }}
                  >
                    Open Project
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Project"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!newProject.name.trim() || creating}
            >
              {creating ? 'Creating...' : 'Create Project'}
            </Button>
          </>
        }
      >
        <div className="field">
          <label>Project Name *</label>
          <input
            type="text"
            value={newProject.name}
            onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
            placeholder="e.g., Q3 Marketing Campaign"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Description <span className="field-optional-label">(Optional)</span></label>
          <textarea
            value={newProject.description}
            onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
            placeholder="Brief description of the project"
            rows={2}
          />
        </div>
        <div className="field">
          <label>Team <span className="field-optional-label">(Optional)</span></label>
          <div className="team-select-row">
            <select
              value={newProject.team_id}
              onChange={(e) => setNewProject({ ...newProject, team_id: e.target.value })}
              disabled={loadingTeams}
            >
              <option value="">Select team...</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-link"
              onClick={() => navigate('/team')}
            >
              Manage Team
            </button>
          </div>
        </div>

        <div className="field-group-divider">
          <span>Business context (optional)</span>
          <span className="field-hint">Helps the AI Assistant recommend agents for this project's workflows</span>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Industry</label>
            <input
              type="text"
              value={newProject.business_context.industry}
              onChange={(e) => setNewProject({
                ...newProject,
                business_context: { ...newProject.business_context, industry: e.target.value }
              })}
              placeholder="e.g., Manufacturing"
            />
          </div>
          <div className="field">
            <label>Your role</label>
            <input
              type="text"
              value={newProject.business_context.role}
              onChange={(e) => setNewProject({
                ...newProject,
                business_context: { ...newProject.business_context, role: e.target.value }
              })}
              placeholder="e.g., Sales Manager"
            />
          </div>
        </div>
        <div className="field">
          <label>Product / service</label>
          <input
            type="text"
            value={newProject.business_context.productService}
            onChange={(e) => setNewProject({
              ...newProject,
              business_context: { ...newProject.business_context, productService: e.target.value }
            })}
            placeholder="e.g., Industrial pumps for manufacturers"
          />
        </div>

        <p className="field-hint" style={{ marginTop: '8px', color: 'var(--color-text-muted)' }}>
          All agents will have access to this project.
        </p>
      </Modal>

      {/* Project AI Settings Modal */}
      <Modal
        open={!!settingsProject}
        onClose={closeProjectSettings}
        title={settingsProject ? `AI Settings: ${settingsProject.name}` : 'AI Settings'}
        size="lg"
        footer={<Button variant="secondary" onClick={closeProjectSettings}>Close</Button>}
      >
        {settingsProject && (
              settingsLoading ? (
                <Spinner size="md" />
              ) : (
                <>
                  <p className="field-hint" style={{ marginBottom: '12px', color: 'var(--color-text-muted)' }}>
                    {canManageSettings
                      ? 'Set a key here and every AI action inside this project uses it instead of a member\'s personal key or the platform default.'
                      : 'Only the project owner or a team admin can change these keys. Shown below is what this project currently uses.'}
                  </p>
                  <div className="field">
                    <label>Monthly AI Budget (USD)</label>
                    {canManageSettings ? (
                      <div className="project-setting-row">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="No budget set"
                          value={budgetInput}
                          onChange={(e) => setBudgetInput(e.target.value)}
                        />
                        <Button variant="primary" onClick={handleSaveBudget} disabled={savingBudget}>
                          {savingBudget ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    ) : (
                      <p className="field-hint">
                        {settingsProject.monthlyBudgetUsd != null
                          ? `$${settingsProject.monthlyBudgetUsd} - only the project owner or a team admin can change this.`
                          : 'No budget set.'}
                      </p>
                    )}
                    <p className="field-hint">
                      Informational only - AI actions are never blocked. The project owner gets a single email the first time spend crosses this in a calendar month.
                    </p>
                  </div>

                  {AI_KEY_FIELDS.map(field => {
                    const setting = projectSettings?.[field.key] || {};
                    const isEditing = field.key in settingsEditValues;
                    const isSaving = settingsSavingKey === field.key;
                    return (
                      <div className="field" key={field.key}>
                        <label>
                          {field.label}
                          {setting.configured && (
                            <span className="status-badge active" style={{ marginLeft: '8px' }}>
                              {field.type === 'select' ? `Set to ${setting.value}` : 'Configured'}
                            </span>
                          )}
                        </label>
                        {field.type === 'select' ? (
                          <div className="project-setting-row">
                            <select
                              value={isEditing ? settingsEditValues[field.key] : (setting.value || setting.default || field.options[0].value)}
                              onChange={(e) => setSettingsEditValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                              disabled={!canManageSettings}
                            >
                              {field.options.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {canManageSettings && isEditing && (
                              <Button
                                variant="primary"
                                onClick={() => handleSaveProjectSetting(field.key)}
                                disabled={isSaving}
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </Button>
                            )}
                          </div>
                        ) : (
                          canManageSettings && (
                            <>
                              <div className="project-setting-row">
                                <input
                                  type="password"
                                  placeholder={setting.configured ? setting.value : field.placeholder}
                                  value={settingsEditValues[field.key] || ''}
                                  onChange={(e) => {
                                    setSettingsEditValues(prev => ({ ...prev, [field.key]: e.target.value }));
                                    setSettingsTestResults(prev => ({ ...prev, [field.key]: null }));
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  onClick={() => handleTestProjectSetting(field.key)}
                                  disabled={settingsTestingKey === field.key || !settingsEditValues[field.key]?.trim()}
                                >
                                  {settingsTestingKey === field.key ? 'Testing...' : 'Test'}
                                </Button>
                                <Button
                                  variant="primary"
                                  onClick={() => handleSaveProjectSetting(field.key)}
                                  disabled={isSaving || !settingsEditValues[field.key]?.trim()}
                                >
                                  {isSaving ? 'Saving...' : 'Save'}
                                </Button>
                                {setting.configured && (
                                  <Button
                                    variant="secondary"
                                    onClick={() => handleRemoveProjectSetting(field.key)}
                                    disabled={isSaving}
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                              {settingsTestResults[field.key] && (
                                <p className={`field-hint ${settingsTestResults[field.key].success ? 'test-success' : 'test-error'}`}>
                                  {settingsTestResults[field.key].message}
                                </p>
                              )}
                            </>
                          )
                        )}
                        {!canManageSettings && !setting.configured && (
                          <p className="field-hint">Not configured. Falls back to each member's personal key or the platform default.</p>
                        )}
                      </div>
                    );
                  })}
                </>
              )
        )}
      </Modal>
    </div>
  );
}

export default Projects;
