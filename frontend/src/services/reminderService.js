/**
 * Reminder Service - Reusable multi-channel reminder system
 * Supports: Email, SMS, WhatsApp
 * Can be used across all agent modules
 */

import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';

// Channel types
export const REMINDER_CHANNELS = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
};

// Channel display info
export const CHANNEL_INFO = {
  [REMINDER_CHANNELS.EMAIL]: {
    label: 'Email',
    icon: '/assets/icons/mail.png',
    requiresField: 'email',
  },
  [REMINDER_CHANNELS.SMS]: {
    label: 'SMS',
    icon: '/assets/icons/mobile-data.png',
    requiresField: 'phone',
  },
  [REMINDER_CHANNELS.WHATSAPP]: {
    label: 'WhatsApp',
    icon: '/assets/icons/whatsapp.png',
    requiresField: 'phone',
  },
};

/**
 * Get available channels for a recipient based on their contact info
 * @param {Object} recipient - { name, email?, phone? }
 * @returns {string[]} - Array of available channel keys
 */
export function getAvailableChannels(recipient) {
  const channels = [];
  if (recipient?.email) channels.push(REMINDER_CHANNELS.EMAIL);
  if (recipient?.phone) {
    channels.push(REMINDER_CHANNELS.SMS);
    channels.push(REMINDER_CHANNELS.WHATSAPP);
  }
  return channels;
}

/**
 * Send a reminder through the specified channel
 * @param {Object} options
 * @param {string} options.channel - 'email' | 'sms' | 'whatsapp'
 * @param {Object} options.recipient - { name, email?, phone? }
 * @param {string} options.subject - Subject/title of reminder
 * @param {string} options.message - Body of reminder
 * @returns {Promise<{ success: boolean, message: string, fallback?: boolean }>}
 */
export async function sendReminder({ channel, recipient, subject, message }) {
  // Validate recipient has required contact info
  const requiredField = CHANNEL_INFO[channel]?.requiresField;
  if (!recipient?.[requiredField]) {
    return {
      success: false,
      message: `Recipient has no ${requiredField} on file`,
    };
  }

  // Route to appropriate sender
  switch (channel) {
    case REMINDER_CHANNELS.EMAIL:
      return sendEmailReminder({ recipient, subject, message });
    case REMINDER_CHANNELS.SMS:
      return sendSmsReminder({ recipient, message });
    case REMINDER_CHANNELS.WHATSAPP:
      return sendWhatsAppReminder({ recipient, message });
    default:
      return { success: false, message: 'Unknown channel' };
  }
}

/**
 * Send email reminder via the backend (Gmail API if the sender has
 * connected their Google account, else system SMTP). Never silently opens
 * a mailto: and claims success - a real send either happened or it didn't,
 * and the caller needs to know which so it can show an honest toast.
 */
async function sendEmailReminder({ recipient, subject, message }) {
  try {
    const response = await fetch(`${API_CONFIG.API_URL}/emails/send_via_gmail`, {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({
        to: recipient.email,
        subject,
        body: message,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return {
        success: true,
        message: `Email sent to ${recipient.name}`,
      };
    }

    return {
      success: false,
      message: data.error || `Could not send email to ${recipient.name}`,
      offerMailto: true,
    };
  } catch (error) {
    return {
      success: false,
      message: `Could not reach the server: ${error.message}`,
      offerMailto: true,
    };
  }
}

/**
 * Manual fallback: open the recipient's email client with a pre-filled
 * draft. Only ever invoked explicitly by the user (e.g. clicking "Open in
 * email client" after a failed send) - never auto-triggered, since it
 * requires the user to click Send themselves and shouldn't be reported as
 * an automatic reminder having gone out.
 */
export function openMailtoDraft({ recipient, subject, message }) {
  const mailto = `mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  window.location.href = mailto;
}

/**
 * Send SMS reminder - opens SMS link (deep link on mobile)
 */
async function sendSmsReminder({ recipient, message }) {
  // Clean phone number for SMS
  const phone = recipient.phone.replace(/[^0-9+]/g, '');

  // Try SMS API if available
  const userEmail = localStorage.getItem('userEmail');
  if (userEmail) {
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: userEmail,
          to: phone,
          message,
        }),
      });
      if (response.ok) {
        return {
          success: true,
          message: `SMS sent to ${recipient.name}`,
        };
      }
    } catch (error) {
      console.error('SMS API not available, using sms: link:', error);
    }
  }

  // Fallback to sms: link
  const smsLink = `sms:${phone}?body=${encodeURIComponent(message)}`;
  window.location.href = smsLink;

  return {
    success: true,
    message: `Opening SMS to ${recipient.name}...`,
    fallback: true,
  };
}

/**
 * Send WhatsApp reminder - opens WhatsApp web/app
 */
async function sendWhatsAppReminder({ recipient, message }) {
  // Clean phone number - WhatsApp needs country code without +
  let phone = recipient.phone.replace(/[^0-9+]/g, '');
  if (phone.startsWith('+')) {
    phone = phone.substring(1);
  }

  // WhatsApp API link (works on web and mobile)
  const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(waLink, '_blank');

  return {
    success: true,
    message: `Opening WhatsApp to ${recipient.name}...`,
    fallback: true,
  };
}

/**
 * Build a reminder message from template
 * @param {Object} options
 * @param {string} options.recipientName - Name of recipient
 * @param {string} options.taskTitle - Task title (optional)
 * @param {string} options.customMessage - Custom message to include
 * @param {Object} options.taskDetails - { status, priority, dueDate } (optional)
 * @returns {string}
 */
export function buildReminderMessage({ recipientName, taskTitle, customMessage, taskDetails }) {
  let message = `Hi ${recipientName},\n\n`;

  if (customMessage) {
    message += `${customMessage}\n\n`;
  } else {
    message += taskTitle
      ? `Friendly reminder about your task: "${taskTitle}"\n\n`
      : `Just checking in on your progress.\n\n`;
  }

  if (taskTitle && taskDetails) {
    message += `Task: ${taskTitle}\n`;
    if (taskDetails.status) message += `Status: ${taskDetails.status}\n`;
    if (taskDetails.priority) message += `Priority: ${taskDetails.priority}\n`;
    if (taskDetails.dueDate) message += `Due: ${taskDetails.dueDate}\n`;
    message += '\n';
  }

  message += 'Best regards';
  return message;
}
