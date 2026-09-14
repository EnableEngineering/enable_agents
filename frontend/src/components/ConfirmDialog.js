import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ConfirmDialog.css';

/**
 * ConfirmDialog Component
 *
 * Platform-native confirmation dialog replacing browser confirm()/alert().
 * Accessible, focus-trapped, keyboard navigable.
 *
 * Usage as component:
 *   <ConfirmDialog
 *     open={showDialog}
 *     title="Delete item?"
 *     message="This action cannot be undone."
 *     confirmLabel="Delete"
 *     cancelLabel="Cancel"
 *     variant="danger"
 *     onConfirm={() => handleDelete()}
 *     onCancel={() => setShowDialog(false)}
 *   />
 *
 * This is the HIGH-emphasis destructive tier (solid red, white text) -
 * reserved for confirm-delete dialogs, where the cost of a misclick is
 * highest. For a low-emphasis inline "Remove" action in a list/row, use
 * Button's variant="danger" instead (.btn-danger - light red background,
 * red text) - see Button.js's doc comment for the full two-tier
 * convention this pairs with.
 *
 * Usage via imperative API (see showConfirm export below):
 *   const confirmed = await showConfirm({
 *     title: 'Purchase Agent?',
 *     message: 'Price: $29/month',
 *     confirmLabel: 'Buy Now',
 *     variant: 'primary'
 *   });
 *   if (confirmed) { ... }
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'primary', // 'primary' | 'danger' | 'warning'
  showCancel = true,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const previousFocus = useRef(null);

  // Store previous focus and focus confirm button on open
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement;
      setTimeout(() => confirmBtnRef.current?.focus(), 0);
    } else if (previousFocus.current) {
      previousFocus.current.focus();
    }
  }, [open]);

  // Focus trap
  const handleKeyDown = useCallback((e) => {
    if (!open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [open, onCancel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && onCancel?.()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        {title && (
          <h2 id="confirm-dialog-title" className="confirm-dialog-title">
            {title}
          </h2>
        )}
        {message && (
          <div id="confirm-dialog-message" className="confirm-dialog-message">
            {typeof message === 'string' ? (
              message.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))
            ) : message}
          </div>
        )}
        <div className="confirm-dialog-actions">
          {showCancel && (
            <button
              type="button"
              className="confirm-dialog-btn confirm-dialog-btn--cancel"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`confirm-dialog-btn confirm-dialog-btn--${variant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Imperative API — use like: const confirmed = await showConfirm({ title, message })
// ─────────────────────────────────────────────────────────────────────────────

let _container = null;
let _root = null;

function getContainer() {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.id = 'ea-confirm-root';
  document.body.appendChild(_container);
  return _container;
}

/**
 * Show a platform confirmation dialog (promise-based).
 *
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message (supports \n for line breaks)
 * @param {string} options.confirmLabel - Confirm button text (default: 'OK')
 * @param {string} options.cancelLabel - Cancel button text (default: 'Cancel')
 * @param {'primary'|'danger'|'warning'} options.variant - Button style
 * @param {boolean} options.showCancel - Show cancel button (default: true)
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled
 */
export function showConfirm({
  title = '',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'primary',
  showCancel = true,
} = {}) {
  return new Promise((resolve) => {
    const container = getContainer();

    const cleanup = () => {
      if (_root) {
        _root.unmount();
        _root = null;
      }
    };

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Dynamic import to avoid circular deps
    import('react-dom/client').then(({ createRoot }) => {
      if (_root) _root.unmount();
      _root = createRoot(container);
      _root.render(
        <ConfirmDialog
          open={true}
          title={title}
          message={message}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          variant={variant}
          showCancel={showCancel}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );
    });
  });
}

/**
 * Show a platform alert dialog (no cancel, just OK).
 *
 * @param {string} message - Message to display
 * @param {string} title - Optional title
 * @returns {Promise<void>}
 */
export function showAlert(message, title = '') {
  return showConfirm({
    title,
    message,
    confirmLabel: 'OK',
    showCancel: false,
    variant: 'primary',
  });
}

export default ConfirmDialog;
