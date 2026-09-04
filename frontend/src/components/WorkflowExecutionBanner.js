import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import './WorkflowExecutionBanner.css';

/**
 * WorkflowExecutionBanner - Minimal context indicator
 *
 * Shows a simple banner indicating the agent is being viewed from a workflow.
 * Does NOT display inputs/outputs - those should be shown in the agent's native UI.
 *
 * The agent should use useWorkflowContext hook to:
 * 1. Pre-fill its input fields with workflow context
 * 2. Show results in its existing output tables/displays
 */
function WorkflowExecutionBanner() {
  const [searchParams] = useSearchParams();
  const workflowId = searchParams.get('workflow');
  const stageId = searchParams.get('stage');
  const viewMode = searchParams.get('view'); // 'history' or 'run'

  const [workflowData, setWorkflowData] = useState(null);
  const [stageName, setStageName] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workflowId) return;

    setLoading(true);
    fetch(`${API_CONFIG.BASE_URL}/api/workflows/instances/${workflowId}`, {
      headers: authJsonHeaders(),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setWorkflowData({
            name: data.instance.name,
            templateName: data.instance.templateName,
          });
          // Find stage name
          const stage = data.instance.stages?.find(s => s.id === stageId);
          setStageName(stage?.name || stageId);
        }
      })
      .catch(err => console.error('Error loading workflow:', err))
      .finally(() => setLoading(false));
  }, [workflowId, stageId]);

  // Don't render if no workflow context
  if (!workflowId) return null;

  const isHistory = viewMode === 'history';

  return (
    <div className={`workflow-context-bar ${isHistory ? 'wcb-history' : ''}`}>
      <div className="wcb-left">
        <img src="/assets/icons/process.png" alt="" className="wcb-icon" />
        <div className="wcb-info">
          <span className="wcb-label">
            {isHistory ? 'Viewing Completed Stage (Read-Only)' : 'Running in Workflow'}
          </span>
          <span className="wcb-workflow">
            {loading ? 'Loading...' : workflowData?.name || 'Workflow'}
            {stageName && <span className="wcb-stage"> → {stageName}</span>}
          </span>
        </div>
      </div>
      <Link to={`/workflows/${workflowId}`} className="wcb-link">
        ← Back to Workflow
      </Link>
    </div>
  );
}

export default WorkflowExecutionBanner;
