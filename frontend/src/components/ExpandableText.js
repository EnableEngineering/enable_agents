import React, { useState } from 'react';
import './ExpandableText.css';

const DEFAULT_MAX_LENGTH = 160;

/**
 * Truncates long text (e.g. a full generated post used as an email body)
 * with a "Show more"/"Show less" toggle, instead of either dumping the
 * whole thing inline or cutting it off with no way to read the rest.
 */
function ExpandableText({ text, maxLength = DEFAULT_MAX_LENGTH, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const str = String(text ?? '');

  if (str.length <= maxLength) {
    return <span className={className}>{str}</span>;
  }

  return (
    <span className={className}>
      {expanded ? str : `${str.slice(0, maxLength).trimEnd()}…`}{' '}
      <button
        type="button"
        className="expandable-text-toggle"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  );
}

export default ExpandableText;
