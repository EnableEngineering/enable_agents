import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { getAllAgents } from '../config/agentsConfig';
import './Dashboard.css';

// Featured agents for quick actions - top 4 most used
const QUICK_ACTION_AGENTS = [
  {
    id: 'data_insights',
    name: 'Data Insights',
    description: 'Analyze documents',
    icon: 'data-discovery',
    route: '/data-insights',
    gradient: 'linear-gradient(135deg, #C2410C 0%, #B45309 100%)'
  },
  {
    id: 'executive_assistant',
    name: 'Executive Assistant',
    description: 'Manage tasks',
    icon: 'hr',
    route: '/executive-assistant',
    gradient: 'linear-gradient(135deg, #1E3A5F 0%, #284A7A 100%)'
  },
  {
    id: 'supply_chain',
    name: 'Supply Chain',
    description: 'Qualify suppliers',
    icon: 'supply-chain-management',
    route: '/supply-chain-agent',
    gradient: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)'
  },
  {
    id: 'email_outreach',
    name: 'Email Outreach',
    description: 'Send campaigns',
    icon: 'mail',
    route: '/email-outreach',
    gradient: 'linear-gradient(135deg, #B45309 0%, #C2410C 100%)'
  }
];

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    projectCount: 0,
    totalWorkflows: 0,
    availableAgents: getAllAgents().length
  });
  const [featuredTemplates, setFeaturedTemplates] = useState([]);
  const [recentWorkflows, setRecentWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const headers = authJsonHeaders();
      let totalWorkflowCount = 0;
      let projectCount = 0;

      // Load project count
      try {
        const projectsRes = await fetch(`${API_CONFIG.BASE_URL}/api/projects`, { headers });
        if (projectsRes.ok) {
          const data = await projectsRes.json();
          projectCount = Array.isArray(data.projects) ? data.projects.length : 0;
        }
      } catch (err) {
        console.error('[Dashboard] Error loading projects:', err);
      }

      // Load workflow templates
      try {
        const templatesRes = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/templates`, { headers });
        if (templatesRes.ok) {
          const data = await templatesRes.json();
          console.log('[Dashboard] Raw response:', data);

          // Extract templates array from response object
          const templates = data.templates || data;
          console.log('[Dashboard] Templates array:', templates);

          // Take first 3 active templates
          const featured = Array.isArray(templates)
            ? templates.filter(t => t.isActive === true).slice(0, 3)
            : [];

          console.log('[Dashboard] Featured templates:', featured);
          setFeaturedTemplates(featured);
        } else {
          console.error('[Dashboard] Templates fetch failed:', templatesRes.status);
        }
      } catch (err) {
        console.error('[Dashboard] Error loading templates:', err);
      }

      // Load workflow instances for stats
      try {
        const instancesRes = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances`, { headers });
        if (instancesRes.ok) {
          const data = await instancesRes.json();

          // Extract instances array from response object
          const instances = data.instances || data;

          if (Array.isArray(instances)) {
            totalWorkflowCount = instances.length;

            const recent = [...instances]
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .slice(0, 3);
            setRecentWorkflows(recent);
          }
        }
      } catch (err) {
        console.error('[Dashboard] Error loading instances:', err);
      }

      setStats({
        projectCount,
        totalWorkflows: totalWorkflowCount,
        availableAgents: getAllAgents().length
      });

    } catch (err) {
      console.error('[Dashboard] Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartWorkflow = (templateId) => {
    navigate(`/workflows?template=${templateId}`);
  };

  const handleAgentClick = (route) => {
    navigate(route);
  };

  const handleViewWorkflow = (instanceId) => {
    navigate(`/workflows/${instanceId}`);
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { label: 'Pending', color: '#94a3b8' },
      in_progress: { label: 'In Progress', color: '#3b82f6' },
      completed: { label: 'Completed', color: '#10b981' },
      failed: { label: 'Failed', color: '#ef4444' }
    };
    return badges[status] || badges.pending;
  };

  const getCategoryGradient = (category) => {
    // Use theme colors - primary for most, accent variations for diversity
    const gradients = {
      sales: 'linear-gradient(135deg, #1E3A5F 0%, #284A7A 100%)',      // Primary blue
      marketing: 'linear-gradient(135deg, #C2410C 0%, #B45309 100%)',  // Accent orange
      procurement: 'linear-gradient(135deg, #1E3A5F 0%, #C2410C 100%)', // Primary to accent
      operations: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)'  // Success green
    };
    return gradients[category?.toLowerCase()] || 'linear-gradient(135deg, #475569 0%, #64748B 100%)';
  };

  const firstName = localStorage.getItem('firstName') || 'there';

  if (loading) {
    return (
      <>
        <div className="dashboard-page">
          <div className="dashboard-loading">
            <div className="loading-spinner"></div>
            <p>Loading your workspace...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="dashboard-page">
        {/* Page Header */}
        <div className="dashboard-header">
          <div className="dashboard-greeting-row">
            <div className="dashboard-greeting">
              <h1 className="greeting-title">Welcome back, {firstName}</h1>
              <p className="greeting-subtitle">Here's what's happening with your workspace today.</p>
            </div>
            <button type="button" className="btn-primary btn-create-project" onClick={() => navigate('/projects?new=true')}>
              + Create New Project
            </button>
          </div>
          <div className="stats-container">
            <div className="stat-card">
              <div className="stat-icon-wrapper stat-icon-wrapper-projects">
                <img src="/assets/icons/document.png" alt="" className="stat-icon-img" />
              </div>
              <div className="stat-info">
                <div className="stat-value">{stats.projectCount}</div>
                <div className="stat-label">Projects</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper stat-icon-wrapper-agents">
                <img src="/assets/icons/ai-chatbots.png" alt="" className="stat-icon-img" />
              </div>
              <div className="stat-info">
                <div className="stat-value">{stats.availableAgents}</div>
                <div className="stat-label">AI Agents</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper stat-icon-wrapper-workflows">
                <img src="/assets/icons/process.png" alt="" className="stat-icon-img" />
              </div>
              <div className="stat-info">
                <div className="stat-value">{stats.totalWorkflows}</div>
                <div className="stat-label">Workflows</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="dashboard-grid">
          {/* Workflows Section */}
          <section className="dashboard-section workflows-section">
            <div className="section-header">
              <div className="section-title-row">
                <h2 className="section-title">
                  <img src="/assets/icons/process.png" alt="" className="section-icon-img" />
                  Start a Workflow
                </h2>
                <button className="view-all-btn" onClick={() => navigate('/workflows')}>
                  View all <span className="arrow">→</span>
                </button>
              </div>
              <p className="section-subtitle">Automated multi-stage processes</p>
            </div>

            {featuredTemplates.length > 0 ? (
              <div className="templates-grid">
                {featuredTemplates.map(template => (
                  <div
                    key={template.id}
                    className="template-card"
                    onClick={() => handleStartWorkflow(template.id)}
                  >
                    <div className="template-gradient" style={{ background: getCategoryGradient(template.category) }}></div>
                    <div className="template-content">
                      <div className="template-header">
                        <div className="template-category">{template.category}</div>
                        <div className="template-stages">{template.stageCount} stages</div>
                      </div>
                      <h3 className="template-name">{template.name}</h3>
                      <p className="template-description">{template.description}</p>
                    </div>
                    <div className="template-footer">
                      <button className="template-start-btn">Start workflow</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <img src="/assets/icons/document.png" alt="" className="empty-icon-img" />
                <p className="empty-text">No workflow templates available</p>
                <button className="btn-primary" onClick={() => navigate('/workflows')}>
                  Browse templates
                </button>
              </div>
            )}
          </section>

          {/* Quick Actions Section */}
          <section className="dashboard-section agents-section">
            <div className="section-header">
              <div className="section-title-row">
                <h2 className="section-title">
                  <img src="/assets/icons/ai-chatbots.png" alt="" className="section-icon-img" />
                  Quick Actions
                </h2>
                <button className="view-all-btn" onClick={() => navigate('/agents')}>
                  View all <span className="arrow">→</span>
                </button>
              </div>
              <p className="section-subtitle">AI assistants for specific tasks</p>
            </div>

            <div className="agents-grid">
              {QUICK_ACTION_AGENTS.map(agent => (
                <div
                  key={agent.id}
                  className="agent-card"
                  onClick={() => handleAgentClick(agent.route)}
                >
                  <div className="agent-gradient" style={{ background: agent.gradient }}></div>
                  <div className="agent-icon-wrapper">
                    <img src={`/assets/icons/${agent.icon}.png`} alt="" className="agent-icon" />
                  </div>
                  <div className="agent-content">
                    <h4 className="agent-name">{agent.name}</h4>
                    <p className="agent-description">{agent.description}</p>
                  </div>
                  <div className="agent-arrow">→</div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent Activity */}
          {recentWorkflows.length > 0 && (
          <section className="dashboard-section recent-section">
            <div className="section-header">
              <div className="section-title-row">
                <h2 className="section-title">
                  <img src="/assets/icons/dashboards.png" alt="" className="section-icon-img" />
                  Recent Activity
                </h2>
                <button className="view-all-btn" onClick={() => navigate('/workflows')}>
                  View all <span className="arrow">→</span>
                </button>
              </div>
            </div>

            <div className="recent-workflows-list">
              {recentWorkflows.map(workflow => {
                const badge = getStatusBadge(workflow.status);
                const progress = workflow.totalStages > 0
                  ? Math.round((workflow.currentStageIndex / workflow.totalStages) * 100)
                  : 0;

                return (
                  <div
                    key={workflow.id}
                    className="recent-workflow-card"
                    onClick={() => handleViewWorkflow(workflow.id)}
                  >
                    <div className="workflow-main">
                      <div className="workflow-header-row">
                        <h4 className="workflow-name">{workflow.name}</h4>
                        <span className="workflow-badge" style={{ background: badge.color }}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="workflow-template">{workflow.templateName}</p>
                      {workflow.status === 'in_progress' && (
                        <div className="workflow-progress-section">
                          <div className="progress-bar-wrapper">
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                          </div>
                          <span className="progress-label">
                            Stage {workflow.currentStageIndex + 1} of {workflow.totalStages}
                          </span>
                        </div>
                      )}
                    </div>
                    <button className="workflow-view-btn">View →</button>
                  </div>
                );
              })}
            </div>
          </section>
          )}
        </div>
      </div>
    </>
  );
}

export default Dashboard;
