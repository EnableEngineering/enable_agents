import React from 'react';
import './TypingIndicator.css';

/**
 * TypingIndicator
 *
 * Shared "assistant is working" bubble - three bouncing dots inside a
 * message-bubble shape, optionally with a short label. Renders as a chat
 * message so it sits in the thread exactly where the real reply will land,
 * instead of a spinner disconnected from the conversation.
 *
 * Usage:
 *   <TypingIndicator />
 *   <TypingIndicator label="Thinking..." />
 */
function TypingIndicator({ label }) {
  return (
    <div className="typing-indicator-bubble" role="status" aria-live="polite" aria-label={label || 'Loading'}>
      <span className="typing-indicator-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      {label && <span className="typing-indicator-label">{label}</span>}
    </div>
  );
}

export default TypingIndicator;
