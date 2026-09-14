import React from 'react';
import Spinner from './Spinner';

/**
 * Button Component
 *
 * Thin wrapper around the global .btn/.btn-* classes in tokens.css (the
 * single source of truth for button color/shadow/hover behavior) - not a
 * new visual system. Exists so call sites stop hand-rolling their own
 * button classes/CSS and drift away from the token-driven look.
 *
 * Usage:
 *   <Button onClick={save}>Save</Button>
 *   <Button variant="secondary">Cancel</Button>
 *   <Button variant="danger" loading={isDeleting}>Delete</Button>
 *
 * Destructive actions, two tiers (Reflection-aligned convention,
 * documented 2026-09-13 - both tiers already existed, just not written
 * down as a deliberate pair until now):
 *   - Low-emphasis ("Remove" inline in a list/row): variant="danger" here
 *     (.btn-danger - light red background, red text).
 *   - High-emphasis (confirm-delete dialogs only, where the cost of a
 *     misclick is highest): ConfirmDialog/showConfirm's variant="danger"
 *     (.confirm-dialog-btn--danger - solid red gradient, white text). Do
 *     not use this Button's danger variant inside a confirm dialog, or
 *     ConfirmDialog's variant for an inline action - each tier's whole
 *     point is being visually distinct from the other.
 *
 * Height, two tiers (documented 2026-09-13 - both already existed too):
 *   - Default (no size prop, ~44px tall): standalone forms, primary
 *     page-level actions ("+ New Project", "Save Changes").
 *   - size="sm" (~33px tall): toolbars, table/list rows, anywhere several
 *     buttons sit close together (Card actions, dismiss buttons, per-row
 *     actions). Most of the app already uses size="sm" correctly in these
 *     spots - if a toolbar/row button looks oversized next to its
 *     siblings, it's almost always a missing size="sm", not a new size
 *     tier to invent.
 */
const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  danger: 'btn-danger',
};

const SPINNER_COLOR = {
  primary: 'white',
  danger: 'inherit',
  secondary: 'inherit',
  ghost: 'inherit',
  outline: 'inherit',
};

function Button({
  variant = 'primary',
  size,
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...props
}) {
  const classes = ['btn', VARIANT_CLASS[variant] || VARIANT_CLASS.primary];
  if (size) classes.push(`btn-${size}`);
  if (className) classes.push(className);

  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size="sm" color={SPINNER_COLOR[variant] || 'inherit'} /> : children}
    </button>
  );
}

export default Button;
