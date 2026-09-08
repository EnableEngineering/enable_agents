import React from 'react';
import Button from './Button';
import ExpandableText from './ExpandableText';
import './AgentPrefillBanner.css';

/**
 * Confirmation banner shown on an agent page after usePendingAgentPrefill
 * has applied a payload from the AI Assistant - "here's what I filled in,
 * here's what's still needed", per the transparency the assistant's own
 * chat card already promises before the user ever gets here.
 */
function AgentPrefillBanner({ prefill, onDismiss, labels = {} }) {
  if (!prefill) return null;
  if (prefill.fields.length === 0 && prefill.missingFields.length === 0) return null;

  const labelFor = (key) => labels[key] || key;

  return (
    <div className="agent-prefill-banner-wrapper">
      <div className="agent-prefill-banner" role="status">
        <div className="agent-prefill-banner-text">
          {prefill.fields.length > 0 && (
            <>
              <p><strong>Filled in from AI Assistant:</strong></p>
              <ul className="agent-prefill-banner-fields">
                {prefill.fields.map((f) => (
                  <li key={f.field_key}>
                    {labelFor(f.field_key)}: <strong><ExpandableText text={f.field_value} /></strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          {prefill.missingFields.length > 0 && (
            <p className="agent-prefill-banner-missing">
              Still needs from you: {prefill.missingFields.join(', ')}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </Button>
      </div>
    </div>
  );
}

export default AgentPrefillBanner;
