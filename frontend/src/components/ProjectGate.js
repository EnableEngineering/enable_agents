import React from 'react';
import { useSearchParams } from 'react-router-dom';
import EmptyState from './EmptyState';
import './ProjectGate.css';

/**
 * Blocks agent workspace content until a global project is selected (?project= in URL).
 * Shell (header, outcomes, tabs) stays visible; only gated children are hidden.
 */
function ProjectGate({ children, agentLabel = 'agent' }) {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');

  if (!projectId) {
    return (
      <div className="project-gate">
        <EmptyState
          iconType="document"
          title="Select a project to begin"
          description={`Use the project dropdown above, or click + New Project to create one. Each project keeps its own ${agentLabel} data across agents.`}
        />
      </div>
    );
  }

  return children;
}

export default ProjectGate;
