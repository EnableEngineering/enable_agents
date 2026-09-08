import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import './Home.css';

export const EXAMPLE_PROMPTS = [
  'Find new customers',
  'Qualify a supplier',
  'Draft an outreach campaign',
  'Analyze a document',
];

function Home() {
  const navigate = useNavigate();
  const firstName = localStorage.getItem('firstName') || '';
  const [task, setTask] = useState('');
  const [recent, setRecent] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances`, {
          headers: authJsonHeaders(),
        });
        const data = await res.json();
        const instances = Array.isArray(data.instances) ? data.instances : [];
        const sorted = [...instances]
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 3);
        if (!cancelled) setRecent(sorted);
      } catch (err) {
        console.error('Error loading recent activity:', err);
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submitTask = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sessionStorage.setItem('pendingTaskRoute', trimmed);
    navigate('/route');
  };

  const handleSend = () => submitTask(task);

  const statusLabel = (status) => {
    const labels = {
      pending: 'Not started',
      running: 'In progress',
      completed: 'Completed',
      paused: 'Paused',
    };
    return labels[status] || status;
  };

  const statusColorVar = (status) => {
    if (status === 'completed') return 'var(--color-success-text)';
    if (status === 'running') return 'var(--color-accent-dark)';
    return 'var(--color-text-muted)';
  };

  return (
    <div className="home-page">
      <div className="home-content">
        <h1 className="home-title">
          What do you need help with{firstName ? `, ${firstName}` : ''}?
        </h1>
        <p className="home-subtitle">
          Describe the task in plain English. Enable will find the right agent, or start a guided workflow if it's a bigger job.
        </p>

        <div className="home-chat-input">
          <textarea
            rows={1}
            className="home-chat-textarea"
            placeholder='e.g. "Find 50 potential customers for our SaaS product in the healthcare industry"'
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="button"
            className="home-chat-send"
            onClick={handleSend}
            disabled={!task.trim()}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="home-examples">
          {EXAMPLE_PROMPTS.map((label) => (
            <button key={label} type="button" className="home-example-chip" onClick={() => submitTask(label)}>
              {label}
            </button>
          ))}
        </div>

        <div className="home-secondary-links">
          <button type="button" onClick={() => navigate('/agents')}>Browse all agents</button>
          <span>·</span>
          <button type="button" onClick={() => navigate('/workflows')}>Browse workflows</button>
          <span>·</span>
          <button type="button" onClick={() => navigate('/projects')}>Go to your projects</button>
        </div>

        {!loadingRecent && recent.length > 0 && (
          <div className="home-recent">
            <p className="home-recent-label">Pick up where you left off</p>
            <div className="home-recent-list">
              {recent.map((r) => (
                <div key={r.id} className="home-recent-item" onClick={() => navigate(`/workflows/${r.id}`)}>
                  <div className="home-recent-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="18" cy="12" r="2" />
                      <path d="M7 6h5a3.5 3.5 0 0 1 3.5 3.5M7 18h5a3.5 3.5 0 0 0 3.5-3.5" />
                    </svg>
                  </div>
                  <div className="home-recent-text">
                    <p className="home-recent-title">{r.name}</p>
                    <p className="home-recent-meta">
                      {r.templateName}
                      {r.status === 'running' && r.totalStages ? ` · Stage ${r.currentStageIndex + 1} of ${r.totalStages}` : ''}
                    </p>
                  </div>
                  <span className="home-recent-status" style={{ color: statusColorVar(r.status) }}>
                    {statusLabel(r.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
