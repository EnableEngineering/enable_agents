import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { getAllAgents } from '../config/agentsConfig';
import './Dashboard.css';

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    projectCount: 0,
    totalWorkflows: 0,
    availableAgents: getAllAgents().length
  });
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
          {/* Recent Activity */}
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

            {recentWorkflows.length > 0 ? (
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
            ) : (
              <div className="empty-state">
                <img src="/assets/icons/dashboards.png" alt="" className="empty-icon-img" />
                <p className="empty-text">No recent activity yet — start a workflow to see it here.</p>
                <button className="btn-primary" onClick={() => navigate('/workflows')}>
                  Browse workflows
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
