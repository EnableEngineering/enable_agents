import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Usage.css';
import { authOptionalHeaders, authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { API_CONFIG } from '../config/apiConfig';
import { Spinner } from '../components';

const DAY_OPTIONS = [7, 30, 90];

const EMPTY_USAGE = {
  totalTokens: 0,
  totalCostUsd: 0,
  requestCount: 0,
  byAgent: [],
  byModel: [],
  byDay: [],
  byUser: null,
  byProject: null,
  byWorkflow: null,
};

function formatCost(value) {
  if (!value) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(2)}`;
}

function formatTokens(value) {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function SummaryCards({ usage }) {
  return (
    <div className="usage-summary-cards">
      <div className="usage-card">
        <span className="usage-card-value">{formatCost(usage.totalCostUsd)}</span>
        <span className="usage-card-label">Estimated cost</span>
      </div>
      <div className="usage-card">
        <span className="usage-card-value">{formatTokens(usage.totalTokens)}</span>
        <span className="usage-card-label">Tokens used</span>
      </div>
      <div className="usage-card">
        <span className="usage-card-value">{usage.requestCount}</span>
        <span className="usage-card-label">AI requests</span>
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows, keyField, emptyText }) {
  const maxCost = Math.max(1e-9, ...rows.map(r => r.costUsd));
  return (
    <section className="usage-card-section">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="usage-empty">{emptyText || 'No usage recorded in this period.'}</p>
      ) : (
        <div className="usage-breakdown-list">
          {rows.map((row) => (
            <div className="usage-breakdown-row" key={`${row[keyField]}-${row.projectId || row.instanceId || ''}`}>
              <div className="usage-breakdown-label">
                <span className="usage-breakdown-name" title={row[keyField]}>{row[keyField] || 'unknown'}</span>
                <span className="usage-breakdown-meta">{formatTokens(row.tokens)} tokens · {row.requestCount} req</span>
              </div>
              <div className="usage-breakdown-bar-track">
                <div
                  className="usage-breakdown-bar-fill"
                  style={{ width: `${Math.max(4, (row.costUsd / maxCost) * 100)}%` }}
                />
              </div>
              <span className="usage-breakdown-cost">{formatCost(row.costUsd)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const BUDGET_BADGES = {
  warning: { label: 'Nearing budget', className: 'warning' },
  over: { label: 'Over budget', className: 'error' },
};

/* Where spend stands against a monthly budget. `budget` is the status object
   from the API (core/budget.py): limitUsd, spendUsd, percentUsed, state.
   With `onSave` it's also where the budget is set/changed/removed. */
function BudgetCard({ title, budget, onSave, saving, editHint }) {
  const [input, setInput] = useState('');
  useEffect(() => {
    setInput(budget && budget.limitUsd != null ? String(budget.limitUsd) : '');
  }, [budget?.limitUsd]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!budget || (budget.state === 'none' && !onSave)) return null;
  const badge = BUDGET_BADGES[budget.state];
  const pct = budget.percentUsed == null ? 0 : Math.min(100, budget.percentUsed);

  return (
    <section className="usage-card-section">
      <h3>{title}</h3>
      {budget.limitUsd != null ? (
        <>
          <div className="usage-budget-row">
            <span className={`usage-budget-amounts ${budget.state === 'over' ? 'over' : ''}`}>
              {formatCost(budget.spendUsd)} of {formatCost(budget.limitUsd)} spent this month ({Math.round(budget.percentUsed)}%)
            </span>
            {badge && <span className={`status-badge ${badge.className}`}>{badge.label}</span>}
          </div>
          <div className="usage-breakdown-bar-track usage-budget-track">
            <div
              className={`usage-breakdown-bar-fill ${budget.state === 'over' ? 'over' : budget.state === 'warning' ? 'warn' : ''}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
        </>
      ) : (
        <p className="usage-empty">No monthly budget set. {formatCost(budget.spendUsd)} spent this month.</p>
      )}
      {onSave && (
        <div className="usage-budget-edit">
          <label htmlFor="usage-budget-input">Monthly budget (USD)</label>
          <div className="usage-budget-edit-row">
            <input
              id="usage-budget-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="No budget"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="button" className="usage-budget-save" disabled={saving} onClick={() => onSave(input)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="usage-budget-hint">{editHint}</p>
        </div>
      )}
    </section>
  );
}

function UsageDetail({ usage, showByUser, budgetTitle, budget, onSaveBudget, savingBudget, budgetHint }) {
  return (
    <>
      <SummaryCards usage={usage} />
      <BudgetCard title={budgetTitle} budget={budget} onSave={onSaveBudget} saving={savingBudget} editHint={budgetHint} />
      <div className="usage-breakdown-grid">
        <BreakdownTable title="By agent" rows={usage.byAgent} keyField="agent" />
        <BreakdownTable title="By model" rows={usage.byModel} keyField="model" />
        {usage.byProject && (
          <BreakdownTable title="By project" rows={usage.byProject} keyField="name" />
        )}
        {usage.byWorkflow && (
          <BreakdownTable
            title="By workflow run"
            rows={usage.byWorkflow}
            keyField="name"
            emptyText="No workflow runs have used AI in this period."
          />
        )}
        {showByUser && usage.byUser && (
          <BreakdownTable title="By member" rows={usage.byUser} keyField="userId" />
        )}
      </div>
    </>
  );
}

function Usage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('me');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState(EMPTY_USAGE);
  const [budget, setBudget] = useState(null);
  const [savingBudget, setSavingBudget] = useState(false);

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  useEffect(() => {
    fetch(`${API_CONFIG.BASE_URL}/api/projects`, { headers: authOptionalHeaders() })
      .then(res => res.ok ? res.json() : { projects: [] })
      .then(data => {
        const list = data.projects || [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(list[0].id);
      })
      .catch(() => setProjects([]));
  }, []);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let url;
      if (tab === 'me') {
        url = `${API_CONFIG.BASE_URL}/api/usage/me?days=${days}`;
      } else if (tab === 'team') {
        url = `${API_CONFIG.BASE_URL}/api/team/usage?days=${days}`;
      } else if (tab === 'project' && selectedProjectId) {
        url = `${API_CONFIG.BASE_URL}/api/projects/${selectedProjectId}/usage?days=${days}`;
      } else {
        setUsage(EMPTY_USAGE);
        setLoading(false);
        return;
      }

      const res = await fetch(url, { headers: authOptionalHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setUsage(data.usage);
        setBudget(data.budget || null);
      } else {
        setUsage(EMPTY_USAGE);
        setBudget(null);
        setError(data.error || 'Could not load usage data.');
      }
    } catch (err) {
      setUsage(EMPTY_USAGE);
      setBudget(null);
      setError('Could not load usage data.');
    } finally {
      setLoading(false);
    }
  }, [tab, days, selectedProjectId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Personal budget (My usage tab only - project budgets are set in the
  // project's own settings, by its owner or a team admin).
  const saveMyBudget = async (rawValue) => {
    const trimmed = String(rawValue).trim();
    setSavingBudget(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/usage/me/budget`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ monthlyBudgetUsd: trimmed === '' ? null : Number(trimmed) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBudget(data.budget);
        showToast(trimmed === '' ? 'Budget removed' : 'Monthly budget saved', 'success');
      } else {
        showToast(data.error || 'Failed to save budget', 'error');
      }
    } catch (err) {
      showToast('Failed to save budget', 'error');
    } finally {
      setSavingBudget(false);
    }
  };

  return (
    <div className="usage-page">
      <div className="usage-container">
        <header className="usage-header">
          <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="header-content">
            <h1>AI Usage &amp; Cost</h1>
            <p className="text-muted">Token usage and estimated spend across your AI actions</p>
          </div>
          <select className="usage-days-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map(d => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </select>
        </header>

        <div className="module-tabs">
          <button className={`module-tab ${tab === 'me' ? 'module-tab--active' : ''}`} onClick={() => setTab('me')}>My usage</button>
          <button className={`module-tab ${tab === 'project' ? 'module-tab--active' : ''}`} onClick={() => setTab('project')}>By project</button>
          <button className={`module-tab ${tab === 'team' ? 'module-tab--active' : ''}`} onClick={() => setTab('team')}>Team</button>
        </div>

        {tab === 'project' && (
          <div className="usage-project-picker">
            {projects.length === 0 ? (
              <p className="usage-empty">You don't have any projects yet.</p>
            ) : (
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {loading ? (
          <div className="loading"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="usage-card-section usage-error">
            <p>{error}</p>
          </div>
        ) : (
          <UsageDetail
            usage={usage}
            showByUser={tab !== 'me'}
            budgetTitle={tab === 'me' ? 'My monthly budget' : 'Project monthly budget'}
            budget={tab === 'team' ? null : budget}
            onSaveBudget={tab === 'me' ? saveMyBudget : null}
            savingBudget={savingBudget}
            budgetHint="Counts everything you spend across all projects. You'll get an email at 80% and again if you go over; Autopilot workflows pause once it's used up. Nothing is blocked."
          />
        )}
      </div>
    </div>
  );
}

export default Usage;
