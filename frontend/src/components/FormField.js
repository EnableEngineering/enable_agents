import React from 'react';
import './FormField.css';

/**
 * FormField Component
 *
 * Wraps form inputs with label, error messages, and help text.
 *
 * Usage:
 *   <FormField
 *     label="Email"
 *     required
 *     error="Please enter a valid email"
 *     helpText="We'll never share your email"
 *   >
 *     <input type="email" className="input" />
 *   </FormField>
 *
 * Required/optional labeling (Reflection-aligned convention, 2026-09-13):
 * required fields get an asterisk (already existed); any field with a
 * label that ISN'T required gets "(Optional)" appended automatically -
 * pass hideOptionalLabel to opt a specific field out (e.g. a checkbox,
 * or a field where "optional" is already obvious from context).
 */

const icons = {
  error: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
};

function FormField({
  label,
  htmlFor,
  required = false,
  hideOptionalLabel = false,
  error,
  success,
  helpText,
  children,
  className = ''
}) {
  const hasError = Boolean(error);
  const hasSuccess = Boolean(success) && !hasError;

  // Clone children to add error/success classes
  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      const childClassName = child.props.className || '';
      let stateClass = '';
      if (hasError) stateClass = 'input-error';
      else if (hasSuccess) stateClass = 'input-success';

      return React.cloneElement(child, {
        className: `${childClassName} ${stateClass}`.trim(),
        'aria-invalid': hasError ? 'true' : undefined,
        'aria-describedby': hasError ? `${htmlFor}-error` : undefined
      });
    }
    return child;
  });

  return (
    <div className={`form-field ${hasError ? 'form-field-error' : ''} ${hasSuccess ? 'form-field-success' : ''} ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className={`form-field-label ${required ? 'form-field-required' : ''}`}
        >
          {label}
          {!required && !hideOptionalLabel && (
            <span className="form-field-optional"> (Optional)</span>
          )}
        </label>
      )}

      <div className="form-field-input">
        {enhancedChildren}

        {/* Success icon */}
        {hasSuccess && (
          <span className="form-field-icon form-field-icon-success" aria-hidden="true">
            {icons.success}
          </span>
        )}
      </div>

      {/* Error message */}
      {hasError && (
        <div id={`${htmlFor}-error`} className="form-field-error-message" role="alert">
          <span className="form-field-error-icon">{icons.error}</span>
          <span>{error}</span>
        </div>
      )}

      {/* Success message */}
      {hasSuccess && typeof success === 'string' && (
        <div className="form-field-success-message">
          <span>{success}</span>
        </div>
      )}

      {/* Help text */}
      {helpText && !hasError && (
        <div className="form-field-help">{helpText}</div>
      )}
    </div>
  );
}

/**
 * Inline form field (label and input on same row)
 */
FormField.Inline = function InlineFormField(props) {
  return <FormField {...props} className={`form-field-inline ${props.className || ''}`} />;
};

/**
 * Form group (for grouping related fields)
 */
function FormGroup({ title, description, children }) {
  return (
    <fieldset className="form-group">
      {title && <legend className="form-group-title">{title}</legend>}
      {description && <p className="form-group-description">{description}</p>}
      <div className="form-group-fields">{children}</div>
    </fieldset>
  );
}

/**
 * Form actions (submit/cancel buttons)
 */
function FormActions({ children, align = 'left' }) {
  return (
    <div className={`form-actions form-actions-${align}`}>
      {children}
    </div>
  );
}

FormField.Group = FormGroup;
FormField.Actions = FormActions;

export default FormField;
