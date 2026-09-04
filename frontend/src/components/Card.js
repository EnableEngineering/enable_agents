import React from 'react';
import './Card.css';

/**
 * Card Component
 *
 * A reusable card container that follows the design system.
 *
 * @param {boolean} elevated - Apply elevated shadow
 * @param {string} padding - Padding size: 'none' | 'sm' | 'md' | 'lg' (default: 'md')
 * @param {function} onClick - Click handler (makes card interactive)
 * @param {React.ReactNode} header - Optional header content
 * @param {React.ReactNode} footer - Optional footer content
 * @param {string} className - Additional CSS classes
 * @param {React.ReactNode} children - Card body content
 */
export function Card({
  elevated = false,
  padding = 'md',
  onClick,
  header,
  footer,
  className = '',
  children,
  ...props
}) {
  const classes = [
    'card-component',
    elevated && 'card-elevated',
    onClick && 'card-interactive',
    `card-padding-${padding}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(e) : undefined}
      {...props}
    >
      {header && <div className="card-header">{header}</div>}
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

/**
 * CardGrid Component
 *
 * Responsive grid layout for cards.
 *
 * @param {string} columns - Grid columns: '2' | '3' | '4' | 'auto' (default: 'auto')
 * @param {string} gap - Gap size: 'sm' | 'md' | 'lg' (default: 'md')
 */
export function CardGrid({
  columns = 'auto',
  gap = 'md',
  className = '',
  children,
  ...props
}) {
  const classes = [
    'card-grid',
    `card-grid-cols-${columns}`,
    `card-grid-gap-${gap}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}

/**
 * ModuleCard Component
 *
 * Specialized card for agent/module display in catalog.
 *
 * @param {string} icon - Icon URL
 * @param {string} title - Module title
 * @param {string} description - Short module description (optional)
 * @param {string} department - Department label shown above the title (e.g. "Sales")
 * @param {string} departmentColor - Dot color for the department label
 * @param {string} status - 'ready' | 'in-progress' | 'unavailable'
 * @param {string} price - Price string (e.g., '$29/month'), shown next to the action when ready
 * @param {function} onOpen - "Open agent" button handler (ready modules only)
 * @param {boolean} locked - If true, shows "Coming soon" and a disabled "Notify me" button instead
 * @param {string} badge - Optional small label chip (e.g. "Recommended")
 */
export function ModuleCard({
  icon,
  title,
  description,
  department,
  departmentColor = 'var(--color-text-subtle)',
  status = 'ready',
  price,
  onOpen,
  locked = false,
  badge,
  className = '',
  ...props
}) {
  const isReady = status === 'ready' && !locked;

  const classes = [
    'module-card-component',
    !isReady && 'module-card-locked',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} {...props}>
      <div className="module-card-header">
        {icon && <img src={icon} alt="" className="module-card-icon" />}
        <div className="module-card-heading">
          {department && (
            <div className="module-card-department">
              <span className="module-card-dot" style={{ background: departmentColor }} />
              <span>{department}</span>
            </div>
          )}
          <span className="module-card-title">{title}</span>
        </div>
        {badge && <span className="module-card-badge">{badge}</span>}
        {!isReady && <span className="module-card-coming-soon">Coming soon</span>}
      </div>

      {description && <p className="module-card-description">{description}</p>}

      <div className="module-card-footer">
        {isReady ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={onOpen} title={`Open ${title}`}>
              Open agent
            </button>
            {price && <span className="module-card-price">{price}</span>}
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" disabled title="Not available yet">
            Notify me
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * StatusIndicator Component
 *
 * Icon-based status display with tooltip.
 *
 * @param {string} status - 'ready' | 'in-progress' | 'unavailable'
 * @param {boolean} showLabel - Show text label alongside icon
 */
export function StatusIndicator({
  status = 'ready',
  showLabel = false,
  className = '',
  ...props
}) {
  const config = {
    'ready': {
      icon: '✓',
      label: 'Ready',
      className: 'status-ready'
    },
    'in-progress': {
      icon: '◷',
      label: 'In Progress',
      className: 'status-progress'
    },
    'unavailable': {
      icon: '⊘',
      label: 'Not Available',
      className: 'status-unavailable'
    }
  };

  const { icon, label, className: statusClass } = config[status] || config['unavailable'];

  return (
    <span
      className={`status-indicator ${statusClass} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <span className="status-icon" aria-hidden="true">{icon}</span>
      {showLabel && <span className="status-label">{label}</span>}
    </span>
  );
}

export default Card;
