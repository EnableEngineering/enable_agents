/**
 * statusColors — canonical status/priority → color mapping.
 *
 * The single source of truth for "what color does this status/priority
 * mean" across the app (Reflection-aligned convention, added 2026-09-13
 * as part of the theme-consistency pass — see docs/todo.md). Before this,
 * at least four different, partly-inconsistent status/priority color
 * systems existed independently (WorkflowsPage's local statusConfig,
 * ExecutiveAssistantPage's .priority-pill/.priority-dot/.status-pill/
 * .status-badge, SalesHelperAgent's .high-priority, etc) - some of them
 * disagreeing on what the same word should look like (e.g. a "pending"
 * task and a "cancelled" one were both rendered in error-red in one
 * place). New status/priority UI should read from here instead of
 * inventing another local mapping; existing call sites can migrate
 * incrementally rather than all at once.
 *
 * Semantic tiers (all backed by tokens.css, never a raw hex):
 *   neutral  - not started / no signal yet            (--color-text-muted family)
 *   info     - new / active / in progress             (--color-accent family)
 *   warning  - needs attention / medium / on hold      (--color-warning family)
 *   success  - completed / low priority / passed       (--color-success family)
 *   error    - failed / high-urgent priority / closed  (--color-error family)
 *
 * Usage:
 *   import { getStatusColor, getPriorityColor } from '../utils/statusColors';
 *   const { bg, text } = getStatusColor('in_progress');
 *   <span style={{ background: bg, color: text }}>{label}</span>
 *
 *   // or read the CSS class name to add via className instead of inline style:
 *   const { className } = getStatusColor('completed');
 */

const TIERS = {
  neutral: { bg: 'var(--color-background)', text: 'var(--color-text-muted)', className: 'status-tier-neutral' },
  info: { bg: 'var(--color-accent-bg)', text: 'var(--color-accent)', className: 'status-tier-info' },
  warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)', className: 'status-tier-warning' },
  success: { bg: 'var(--color-success-bg)', text: 'var(--color-success-text)', className: 'status-tier-success' },
  error: { bg: 'var(--color-error-bg)', text: 'var(--color-error)', className: 'status-tier-error' },
};

// Every status value seen across the app today, mapped to one tier.
// Add new values here rather than inventing a parallel mapping elsewhere.
const STATUS_TIER = {
  // Generic lifecycle (workflows, campaigns, projects)
  pending: 'neutral',
  not_started: 'neutral',
  new: 'info',
  running: 'info',
  in_progress: 'info',
  'in-progress': 'info',
  // "Active" reads as a positive/healthy state in most of the app's real
  // usage (an active team member, an active subscription) - closer to
  // "working as intended" than "in progress right now".
  active: 'success',
  paused: 'warning',
  on_hold: 'warning',
  'on-hold': 'warning',
  quoted: 'warning',
  completed: 'success',
  passed: 'success',
  accepted: 'success',
  failed: 'error',
  cancelled: 'error',
  closed: 'error',
  // Notifications
  unread: 'info',
  read: 'neutral',
};

// Priority is its own scale - low..urgent, always the same 4 tiers.
const PRIORITY_TIER = {
  low: 'success',
  medium: 'warning',
  high: 'error',
  urgent: 'error',
};

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * @param {string} status - any status value (case/spacing-insensitive)
 * @returns {{bg: string, text: string, className: string}}
 */
export function getStatusColor(status) {
  const tier = STATUS_TIER[normalize(status)] || 'neutral';
  return TIERS[tier];
}

/**
 * @param {string} priority - 'low' | 'medium' | 'high' | 'urgent'
 * @returns {{bg: string, text: string, className: string}}
 */
export function getPriorityColor(priority) {
  const tier = PRIORITY_TIER[normalize(priority)] || 'medium';
  return TIERS[tier];
}
