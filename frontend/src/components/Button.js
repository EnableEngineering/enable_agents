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
