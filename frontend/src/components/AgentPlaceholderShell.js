import React from 'react';
import Header from '../core/Header';
import BackButton from './BackButton';
import LiveModeHint from './LiveModeHint';
import AgentOutcomesStrip from './AgentOutcomesStrip';
import '../styles/agent-shell.css';
import './AgentPlaceholderShell.css';

/**
 * Standard shell for placeholder / coming-soon agent pages.
 */
function AgentPlaceholderShell({
  title,
  subtitle,
  agentKey,
  outcomes = [],
  children,
}) {
  return (
    <div className="agent-placeholder-page">
      <Header />
      <div className="agent-page-header">
        <BackButton />
        <div className="agent-header-content">
          <div className="agent-title-row">
            <h1>{title}</h1>
          </div>
          {subtitle && <p className="text-muted">{subtitle}</p>}
        </div>
      </div>

      {outcomes.length > 0 && <AgentOutcomesStrip items={outcomes} />}

      <LiveModeHint message="This agent is in preview. More ready agents are available from the catalog." />

      <div className="agent-placeholder-body">
        {children}
      </div>
    </div>
  );
}

export default AgentPlaceholderShell;
