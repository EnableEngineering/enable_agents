/**
 * Platform toast notifications — replaces browser alert() / confirm() dialogs.
 *
 * Usage (anywhere in the app, no context/provider needed):
 *   import { showToast } from '../core/toast';
 *   showToast('Saved!');                          // default: info, 3 s
 *   showToast('Login failed', 'error');
 *   showToast('Email sent', 'success');
 *   showToast('Check your settings', 'warning');
 */

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

let _container = null;

function getContainer() {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.id = 'ea-toast-root';
  document.body.appendChild(_container);

  const style = document.createElement('style');
  style.textContent = `
    #ea-toast-root {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
      transition: right 0.2s ease;
    }
    /* The AI Assistant panel docks at the same top-right corner (see
       AiAssistantPanel.js, which toggles this class on <body>) - without
       this offset every toast renders on top of the panel's header. */
    body.ai-panel-open #ea-toast-root {
      right: calc(var(--ai-panel-width, 360px) + 20px);
    }
    @media (max-width: 1024px) {
      /* Panel becomes a full-viewport overlay below this breakpoint - offsetting
         would push toasts off-screen instead of just under the panel header. */
      body.ai-panel-open #ea-toast-root {
        right: 20px;
      }
    }
    .ea-toast {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 300px;
      max-width: 420px;
      padding: 14px 16px;
      border-radius: var(--radius-lg, 12px);
      border: 1px solid var(--color-border, #E5E7EB);
      border-left: 4px solid var(--ea-toast-accent);
      font-family: var(--font-body, inherit);
      font-size: var(--text-body, 0.9375rem);
      line-height: 1.45;
      background: var(--color-surface, #fff);
      color: var(--color-text, #181C23);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(15, 23, 42, 0.10));
      pointer-events: all;
      animation: ea-toast-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      position: relative;
      overflow: hidden;
    }
    .ea-toast.ea-toast-out {
      animation: ea-toast-out 0.2s ease forwards;
    }
    .ea-toast--success { --ea-toast-accent: var(--color-success, #16A34A); }
    .ea-toast--error   { --ea-toast-accent: var(--color-error, #DC2626); }
    .ea-toast--warning { --ea-toast-accent: var(--color-warning, #F59E0B); }
    .ea-toast--info    { --ea-toast-accent: var(--color-primary, #181C23); }
    .ea-toast__icon {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      margin-top: 1px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      background: var(--ea-toast-accent);
    }
    .ea-toast__msg {
      flex: 1;
      word-break: break-word;
      padding-top: 3px;
    }
    .ea-toast__close {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      margin: -2px -4px 0 0;
      border: none;
      background: transparent;
      color: var(--color-text-muted, #6B7280);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      border-radius: var(--radius-sm, 6px);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .ea-toast__close:hover {
      background: var(--color-surface-alt, #F8F9FA);
      color: var(--color-text, #181C23);
    }
    .ea-toast__progress {
      position: absolute;
      bottom: 0; left: 0;
      height: 2.5px;
      background: var(--ea-toast-accent);
      opacity: 0.35;
      animation: ea-progress linear forwards;
    }
    @keyframes ea-toast-in {
      from { opacity: 0; transform: translateX(24px) scale(0.98); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes ea-toast-out {
      from { opacity: 1; transform: translateX(0); }
      to   { opacity: 0; transform: translateX(24px); }
    }
    @keyframes ea-progress {
      from { width: 100%; }
      to   { width: 0%; }
    }
  `;
  document.head.appendChild(style);
  return _container;
}

/**
 * Show a platform toast notification.
 * Position/duration convention (Reflection-aligned, 2026-09-13): top-right,
 * 3000ms default - position already matched, duration is the change here.
 * @param {string} message  - Text to display
 * @param {'success'|'error'|'warning'|'info'} type - Visual variant
 * @param {number} duration - Auto-dismiss delay in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = getContainer();

  const toast = document.createElement('div');
  toast.className = `ea-toast ea-toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  // Build with safe DOM APIs (not innerHTML) - error messages routinely
  // contain raw exception text (e.g. Python's "<HttpError 403 ...>" repr),
  // and innerHTML would parse that as markup, silently mangling the message.
  const icon = document.createElement('span');
  icon.className = 'ea-toast__icon';
  icon.textContent = ICONS[type] ?? ICONS.info;
  icon.setAttribute('aria-hidden', 'true');

  const msg = document.createElement('span');
  msg.className = 'ea-toast__msg';
  msg.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ea-toast__close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';

  const progress = document.createElement('span');
  progress.className = 'ea-toast__progress';
  progress.style.animationDuration = `${duration}ms`;

  toast.append(icon, msg, close, progress);

  const dismiss = () => {
    toast.classList.add('ea-toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  close.addEventListener('click', dismiss);
  container.appendChild(toast);
  const timer = setTimeout(dismiss, duration);
  close.addEventListener('click', () => clearTimeout(timer));
}

export default showToast;
