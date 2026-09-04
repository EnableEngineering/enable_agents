import React from 'react';
import './PageLayout.css';

/**
 * PageLayout Component
 *
 * Consistent page structure for authenticated pages.
 * Includes Header and content area with optional page header.
 *
 * @param {string} title - Page title
 * @param {string} subtitle - Optional subtitle/description
 * @param {React.ReactNode} actions - Optional action buttons for header
 * @param {React.ReactNode} children - Page content
 * @param {boolean} narrow - Use narrower content width (for forms, settings)
 * @param {boolean} noPadding - Remove content padding
 */
export function PageLayout({
  title,
  subtitle,
  actions,
  children,
  narrow = false,
  noPadding = false,
  className = '',
  ...props
}) {
  return (
    <div className={`page-layout ${className}`} {...props}>
      <main className="page-main">
        {(title || actions) && (
          <div className="page-header">
            <div className="page-header-content">
              {title && (
                <div className="page-header-text">
                  <h1 className="page-title">{title}</h1>
                  {subtitle && <p className="page-subtitle">{subtitle}</p>}
                </div>
              )}
              {actions && (
                <div className="page-header-actions">
                  {actions}
                </div>
              )}
            </div>
          </div>
        )}
        <div className={`page-content ${narrow ? 'page-content--narrow' : ''} ${noPadding ? 'page-content--no-padding' : ''}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * PageSection Component
 *
 * Section within a page with optional title.
 *
 * @param {string} title - Section title
 * @param {string} description - Optional description
 * @param {React.ReactNode} actions - Optional action buttons
 * @param {React.ReactNode} children - Section content
 */
export function PageSection({
  title,
  description,
  actions,
  children,
  className = '',
  ...props
}) {
  return (
    <section className={`page-section ${className}`} {...props}>
      {(title || actions) && (
        <div className="page-section-header">
          <div className="page-section-header-text">
            {title && <h2 className="page-section-title">{title}</h2>}
            {description && <p className="page-section-description">{description}</p>}
          </div>
          {actions && (
            <div className="page-section-actions">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className="page-section-content">
        {children}
      </div>
    </section>
  );
}

export default PageLayout;
