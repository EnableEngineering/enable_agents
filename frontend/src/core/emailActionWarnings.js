import { showConfirm } from '../components/ConfirmDialog';

/**
 * Centralized email safety warnings - the single place standardized
 * copy/styling for "this sends real email" and "this reads your inbox"
 * confirmations live. Every surface in the app that sends email or reads
 * a connected Gmail inbox calls one of these two functions instead of
 * writing its own confirmation dialog, so the wording and visual
 * treatment can't drift apart between surfaces (and only needs updating
 * in one place).
 *
 * Both build on the existing showConfirm() utility (ConfirmDialog.js) -
 * the app's one promise-based, accessible confirmation dialog - rather
 * than introducing a second dialog implementation.
 */

const recipientPhrase = (recipientCount) => {
  if (!recipientCount || recipientCount < 1) return 'the recipient(s)';
  return recipientCount === 1 ? '1 recipient' : `${recipientCount} recipients`;
};

/**
 * Confirm before sending real email. Sending is irreversible - once the
 * message leaves, there's no undo - so this uses the high-emphasis
 * "danger" (solid red) treatment.
 *
 * @param {Object} options
 * @param {number} [options.recipientCount] - how many people will receive this email, if known
 * @param {string} [options.context] - short description of what's being sent, e.g. "this RFQ outreach"
 * @returns {Promise<boolean>} true if the user confirmed, false if they cancelled
 */
export function confirmSendEmail({ recipientCount, context } = {}) {
  const who = recipientPhrase(recipientCount);
  return showConfirm({
    title: `Send email to ${who}?`,
    message: `This sends${context ? ` ${context}` : ' real email'} to ${who} right now. Once sent, it can't be recalled or undone.`,
    confirmLabel: 'Send email',
    cancelLabel: 'Cancel',
    variant: 'danger',
  });
}

/**
 * Confirm before reading the user's connected Gmail inbox. Reading is
 * reversible and already covered by the Gmail access the user granted
 * when they connected their account - so this uses the lower-emphasis
 * "warning" (amber) treatment: a heads-up, not a red-alert.
 *
 * @param {Object} options
 * @param {string} [options.context] - why the inbox is being read, e.g. "to rank vendor responses"
 * @returns {Promise<boolean>} true if the user confirmed, false if they cancelled
 */
export function confirmReadInbox({ context } = {}) {
  return showConfirm({
    title: 'Read your Gmail inbox?',
    message: `This checks your connected Gmail inbox for replies${context ? ` ${context}` : ''}, using the access you already granted when you connected your account.`,
    confirmLabel: 'Continue',
    cancelLabel: 'Cancel',
    variant: 'warning',
  });
}
