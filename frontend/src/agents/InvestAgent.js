import React from 'react';
import { AgentPlaceholderShell } from '../components';

function InvestAgent() {
  return (
    <AgentPlaceholderShell
      title="Invest Agent"
      subtitle="Financial instrument assessment and portfolio analysis."
      outcomes={[
        { iconSrc: '/assets/icons/bar-chart.png', title: 'Instrument scoring', description: 'Evaluate financial instruments against your criteria.' },
        { iconSrc: '/assets/icons/reports.png', title: 'Risk reports', description: 'Generate assessment summaries and comparisons.' },
        { iconSrc: '/assets/icons/save-money.png', title: 'Portfolio fit', description: 'Match investments to your strategy and constraints.' },
      ]}
    >
      <div className="agent-placeholder-card">
        <span className="agent-placeholder-badge">Coming soon</span>
        <h2>Invest Agent Dashboard</h2>
        <p>Parameter-driven financial instrument assessment is under development. Check back for scoring models and portfolio tools.</p>
      </div>
    </AgentPlaceholderShell>
  );
}

export default InvestAgent;
