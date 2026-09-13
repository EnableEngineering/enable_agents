import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import Button from './Button';
import './AgentPrerequisiteGate.css';

/**
 * AgentPrerequisiteGate - Shows required dependencies before using an agent.
 *
 * Props:
 *   - agentId: The agent identifier (e.g., 'content_marketing')
 *   - children: Content to render when dependencies are satisfied
 *   - onReady: Optional callback when dependencies check completes
 *   - hardBlockKeys: dependency keys that genuinely cannot be worked around
 *     (e.g. 'gmail_connection' - Sales Helper's reply-ranking and Email
 *     Outreach's sending have no fallback without a connected Gmail
 *     account). When any missing dependency's key is in this list, the
 *     "Continue Anyway" escape hatch is suppressed - unlike the default
 *     soft-advisory behavior below ("works best with... complete these
 *     steps for better results"), a hard-blocked dependency means the
 *     agent literally cannot function, not just that results improve.
 *
 * Usage:
 *   <AgentPrerequisiteGate agentId="content_marketing">
 *     <ContentMarketingContent />
 *   </AgentPrerequisiteGate>
 */
function AgentPrerequisiteGate({ agentId, children, onReady, hardBlockKeys = [] }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const checkDependencies = useCallback(async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/dependencies/status/${agentId}`, {
        headers: authJsonHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (onReady) {
          onReady(data.ready);
        }
      }
    } catch (err) {
      console.error('Error checking dependencies:', err);
      // On error, allow through (fail open)
      setStatus({ ready: true, missing: [] });
    } finally {
      setLoading(false);
    }
  }, [agentId, onReady]);

  useEffect(() => {
    checkDependencies();
  }, [checkDependencies]);

  // While loading, show nothing (brief flash)
  if (loading) {
    return null;
  }

  // If ready or dismissed, render children
  if (!status || status.ready || dismissed) {
    return <>{children}</>;
  }

  const blockingDep = status.missing.find((dep) => hardBlockKeys.includes(dep.key));
  const isHardBlocked = !!blockingDep;

  // Show prerequisite warning
  return (
    <div className="prerequisite-gate">
      <div className="prerequisite-card">
        <div className="prerequisite-header">
          <span className="prerequisite-icon">{isHardBlocked ? '🔒' : '⚠️'}</span>
          <h2>{isHardBlocked ? 'Gmail Connection Required' : 'Prerequisites Required'}</h2>
        </div>

        <p className="prerequisite-message">
          {isHardBlocked
            ? "This agent needs a connected Gmail account to work - there's no way around this one."
            : 'This agent works best with data from other agents. Complete these steps first for better results:'}
        </p>

        <div className="missing-dependencies">
          {status.missing.map((dep) => (
            <div key={dep.key} className="dependency-item">
              <div className="dependency-info">
                <span className="dependency-name">{formatDependencyName(dep.key)}</span>
                <span className="dependency-description">{dep.description}</span>
              </div>
              {dep.key !== 'gmail_connection' && dep.providers && dep.providers.length > 0 && (
                <div className="dependency-providers">
                  <span className="provider-label">Get from:</span>
                  {dep.providers.map((provider) => (
                    <Link
                      key={provider}
                      to={getAgentRoute(provider)}
                      className="provider-link"
                    >
                      {formatAgentName(provider)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="prerequisite-actions">
          {!isHardBlocked && (
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              Continue Anyway
            </Button>
          )}
          {isHardBlocked ? (
            <ConnectGmailButton />
          ) : (
            status.missing[0]?.providers?.[0] && (
              <Link
                to={getAgentRoute(status.missing[0].providers[0])}
                className="btn btn-primary"
              >
                Go to {formatAgentName(status.missing[0].providers[0])}
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Kicks off the same Google OAuth flow Login.js uses - re-consenting here
 * re-links (or freshly links) Gmail for the current account without
 * signing the user out. */
function ConnectGmailButton() {
  const [connecting, setConnecting] = useState(false);
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/auth/google/start`);
      const data = await res.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } finally {
      setConnecting(false);
    }
  };
  return (
    <Button variant="primary" onClick={handleConnect} disabled={connecting}>
      {connecting ? 'Redirecting…' : 'Connect Gmail'}
    </Button>
  );
}

function formatDependencyName(key) {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatAgentName(agentId) {
  const names = {
    market_research: 'Market Research',
    content_marketing: 'Content Marketing',
    email_outreach: 'Email Outreach',
    executive_assistant: 'Executive Assistant',
    settings: 'Settings',
    data_insights: 'Data Insights',
  };
  return names[agentId] || formatDependencyName(agentId);
}

function getAgentRoute(agentId) {
  const routes = {
    market_research: '/market-research',
    content_marketing: '/content-marketing',
    email_outreach: '/email-outreach',
    executive_assistant: '/executive-assistant',
    settings: '/settings',
    data_insights: '/datainsights',
  };
  return routes[agentId] || `/agents`;
}

export default AgentPrerequisiteGate;
