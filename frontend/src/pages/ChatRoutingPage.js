import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import './ChatRoutingPage.css';

// Steps: project -> routing -> recap -> result -> none
function ChatRoutingPage() {
  const navigate = useNavigate();
  const [task] = useState(() => sessionStorage.getItem('pendingTaskRoute') || '');
  const [step, setStep] = useState('project');

  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectMode, setProjectMode] = useState('existing'); // 'existing' | 'new'
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [resolvedProject, setResolvedProject] = useState(null); // { id, name }

  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!task) {
      navigate('/home', { replace: true });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/projects`, { headers: authJsonHeaders() });
        const data = await res.json();
        const list = Array.isArray(data.projects) ? data.projects : [];
        setProjects(list);
        if (list.length > 0) {
          setSelectedProjectId(list[0].id);
        } else {
          setProjectMode('new');
        }
      } catch (err) {
        console.error('Error loading projects:', err);
        setProjectMode('new');
      } finally {
        setLoadingProjects(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirmProject = async () => {
    if (projectMode === 'existing') {
      const project = projects.find((p) => p.id === selectedProjectId);
      if (!project) {
        showToast('Please select a project', 'warning');
        return;
      }
      setResolvedProject({ id: project.id, name: project.name });
      runRouting();
      return;
    }

    if (!newProjectName.trim()) {
      showToast('Please enter a project name', 'warning');
      return;
    }
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/projects`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || 'Failed to create project', 'error');
        return;
      }
      setResolvedProject({ id: data.project.id, name: data.project.name });
      runRouting();
    } catch (err) {
      showToast('Failed to create project', 'error');
    }
  };

  const runRouting = async () => {
    setStep('routing');
    setRouteError('');
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/route-task`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!data.success) {
        setRouteError(data.error || 'Could not route this task.');
        setStep('none');
        return;
      }
      if (data.route.type === 'none') {
        setStep('none');
        return;
      }
      setRoute(data.route);
      setStep('recap');
    } catch (err) {
      setRouteError('Error contacting the routing service.');
      setStep('none');
    }
  };

  const handleStart = async () => {
    if (!route || !resolvedProject) return;
    setStarting(true);
    try {
      if (route.type === 'workflow') {
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances`, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({ templateId: route.template.id, projectId: resolvedProject.id }),
        });
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || 'Failed to start workflow', 'error');
          setStarting(false);
          return;
        }
        sessionStorage.removeItem('pendingTaskRoute');
        navigate(`/workflows/${data.instance.id}`);
      } else if (route.type === 'agent') {
        sessionStorage.removeItem('pendingTaskRoute');
        navigate(`${route.agent.route}?project=${resolvedProject.id}`);
      }
    } catch (err) {
      showToast('Error starting - please try again', 'error');
      setStarting(false);
    }
  };

  const handleRephrase = () => {
    sessionStorage.removeItem('pendingTaskRoute');
    navigate('/home');
  };

  if (!task) return null;

  return (
    <div className="chatroute-page">
      <div className="chatroute-content">
        <div className="chatroute-bubble-row user">
          <div className="chatroute-bubble user">{task}</div>
        </div>

        <div className="chatroute-bubble-row assistant">
          <div className="chatroute-avatar" />
          <div className="chatroute-bubble assistant">
            {loadingProjects
              ? 'One moment...'
              : 'Which project should this go under, or should I start a new one?'}
          </div>
        </div>

        {!loadingProjects && (
          <div className="chatroute-bubble-row user">
            <div className="chatroute-project-picker">
              {projects.length > 0 && (
                <div className="chatroute-project-tabs">
                  <button
                    type="button"
                    className={projectMode === 'existing' ? 'active' : ''}
                    onClick={() => setProjectMode('existing')}
                    disabled={step !== 'project'}
                  >
                    Existing project
                  </button>
                  <button
                    type="button"
                    className={projectMode === 'new' ? 'active' : ''}
                    onClick={() => setProjectMode('new')}
                    disabled={step !== 'project'}
                  >
                    New project
                  </button>
                </div>
              )}
              {projectMode === 'existing' && projects.length > 0 ? (
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={step !== 'project'}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="New project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  disabled={step !== 'project'}
                />
              )}
              {step === 'project' && (
                <button type="button" className="chatroute-btn-primary" onClick={handleConfirmProject}>
                  Continue
                </button>
              )}
              {resolvedProject && step !== 'project' && (
                <span className="chatroute-project-confirmed">{resolvedProject.name}</span>
              )}
            </div>
          </div>
        )}

        {step === 'routing' && (
          <div className="chatroute-bubble-row assistant">
            <div className="chatroute-avatar" />
            <div className="chatroute-bubble assistant chatroute-thinking">
              <span className="chatroute-dots"><span>.</span><span>.</span><span>.</span></span> Thinking about the best way to handle this
            </div>
          </div>
        )}

        {(step === 'recap' || step === 'result') && route && (
          <div className="chatroute-bubble-row assistant">
            <div className="chatroute-avatar" />
            <div className="chatroute-recap-block">
              <div className="chatroute-bubble assistant">
                {route.type === 'workflow'
                  ? "Here's what I've got — this is a multi-step process, so I'd recommend a guided workflow:"
                  : `Here's what I've got — ${route.agent.name} can help with this:`}
              </div>
              {route.recap?.length > 0 && (
                <div className="chatroute-recap-fields">
                  <div className="chatroute-recap-row">
                    <span className="chatroute-recap-label">Project</span>
                    <span className="chatroute-recap-value">{resolvedProject?.name}</span>
                  </div>
                  {route.recap.map((f, idx) => (
                    <div key={idx} className="chatroute-recap-row">
                      <span className="chatroute-recap-label">{f.label}</span>
                      <span className="chatroute-recap-value">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {step === 'recap' && (
                <div className="chatroute-recap-actions">
                  <button type="button" className="chatroute-btn-ghost" onClick={handleRephrase}>
                    That's not quite right
                  </button>
                  <button type="button" className="chatroute-btn-confirm" onClick={() => setStep('result')}>
                    Looks right ✓
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'result' && route && (
          <div className="chatroute-bubble-row assistant">
            <div className="chatroute-avatar" style={{ visibility: 'hidden' }} />
            <div className="chatroute-result">
              {route.type === 'workflow' ? (
                <div className="chatroute-card">
                  <div className="chatroute-card-header">
                    <span className="chatroute-card-kicker">Recommended workflow</span>
                    <span className="chatroute-card-stages">{route.template.stageCount} stages</span>
                  </div>
                  <h3 className="chatroute-card-title">{route.template.name}</h3>
                  <div className="chatroute-stage-list">
                    {route.template.stages.map((s, i) => (
                      <div key={s.stage_id || i} className="chatroute-stage-item">
                        <span className="chatroute-stage-num">{i + 1}</span>
                        <span className="chatroute-stage-name">{s.name}</span>
                        <span className="chatroute-stage-agent">{s.agent}</span>
                      </div>
                    ))}
                  </div>
                  <div className="chatroute-card-footer">
                    <button type="button" className="chatroute-btn-primary" onClick={handleStart} disabled={starting}>
                      {starting ? 'Starting...' : 'Start this workflow'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="chatroute-card">
                  <span className="chatroute-card-kicker">Recommended agent</span>
                  <div className="chatroute-agent-row">
                    <div className="chatroute-agent-icon" />
                    <div>
                      <h3 className="chatroute-card-title" style={{ margin: 0 }}>{route.agent.name}</h3>
                      <p className="chatroute-agent-desc">{route.agent.description}</p>
                    </div>
                  </div>
                  <div className="chatroute-card-footer">
                    <button type="button" className="chatroute-btn-primary" onClick={handleStart} disabled={starting}>
                      {starting ? 'Opening...' : `Open ${route.agent.name}`}
                    </button>
                  </div>
                </div>
              )}
              <p className="chatroute-footnote">
                Not what you meant?{' '}
                <button type="button" className="chatroute-link" onClick={handleRephrase}>Try rephrasing</button>, or{' '}
                <button type="button" className="chatroute-link" onClick={() => navigate('/agents')}>browse manually</button>.
              </p>
            </div>
          </div>
        )}

        {step === 'none' && (
          <div className="chatroute-bubble-row assistant">
            <div className="chatroute-avatar" />
            <div className="chatroute-recap-block">
              <div className="chatroute-bubble assistant">
                {routeError || "I couldn't find a great match for this in what's available yet."}
              </div>
              <p className="chatroute-footnote">
                <button type="button" className="chatroute-link" onClick={handleRephrase}>Try rephrasing</button>, or{' '}
                <button type="button" className="chatroute-link" onClick={() => navigate('/agents')}>browse manually</button>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatRoutingPage;
