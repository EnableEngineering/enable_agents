import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './LiveModeHint.css';

const DISMISS_KEY = 'enableAgentsLiveHintDismissed';

function LiveModeHint({ message, requireProject = false }) {
  const [searchParams] = useSearchParams();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  );

  if (dismissed) return null;

  // Only shown when requireProject is set and no project is selected
  if (!requireProject) return null;
  const hasProject = searchParams.get('project');
  if (hasProject) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div className="live-mode-hint-wrapper">
      <div className="live-mode-hint" role="status">
        <p>{message || 'Select a project to get started'}</p>
        <div className="live-mode-hint-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleDismiss}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default LiveModeHint;
