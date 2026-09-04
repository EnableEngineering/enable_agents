/**
 * ReminderModal - Reusable multi-channel reminder modal
 * Can be used by any agent module
 */
import React, { useState, useMemo } from 'react';
import { Textarea } from './index';
import {
  sendReminder,
  buildReminderMessage,
  getAvailableChannels,
  openMailtoDraft,
  REMINDER_CHANNELS,
  CHANNEL_INFO,
} from '../services/reminderService';
import { showToast } from '../core/toast';
import './ReminderModal.css';

function ReminderModal({
  isOpen,
  onClose,
  recipient,      // { name, email?, phone? }
  context,        // { taskTitle?, taskDetails?, projectName? }
}) {
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [failedDraft, setFailedDraft] = useState(null);

  // Get available channels based on recipient contact info
  const availableChannels = useMemo(() => {
    return getAvailableChannels(recipient);
  }, [recipient]);

  // Auto-select first available channel
  React.useEffect(() => {
    if (availableChannels.length > 0 && !selectedChannel) {
      setSelectedChannel(availableChannels[0]);
    }
  }, [availableChannels, selectedChannel]);

  if (!isOpen || !recipient) return null;

  const handleSend = async () => {
    if (!selectedChannel) {
      showToast('Please select a channel', 'warning');
      return;
    }

    setSending(true);
    setFailedDraft(null);

    const subject = context?.taskTitle
      ? `Reminder: ${context.taskTitle}`
      : context?.projectName
        ? `Reminder: ${context.projectName}`
        : 'Quick reminder';

    const message = buildReminderMessage({
      recipientName: recipient.name,
      taskTitle: context?.taskTitle,
      customMessage,
      taskDetails: context?.taskDetails,
    });

    const result = await sendReminder({
      channel: selectedChannel,
      recipient,
      subject,
      message,
    });

    setSending(false);

    if (result.success) {
      showToast(result.message, 'success');
      setCustomMessage('');
      setSelectedChannel(null);
      onClose();
    } else {
      showToast(result.message, 'error');
      if (result.offerMailto && selectedChannel === REMINDER_CHANNELS.EMAIL) {
        setFailedDraft({ recipient, subject, message });
      }
    }
  };

  const handleOpenMailto = () => {
    if (!failedDraft) return;
    openMailtoDraft(failedDraft);
    setFailedDraft(null);
  };

  const handleClose = () => {
    setCustomMessage('');
    setSelectedChannel(null);
    setFailedDraft(null);
    onClose();
  };

  return (
    <div className="reminder-modal-overlay" onClick={handleClose}>
      <div className="reminder-modal" onClick={(e) => e.stopPropagation()}>
        <div className="reminder-modal-header">
          <h3>Send Reminder</h3>
          <button type="button" className="btn-close" onClick={handleClose}>×</button>
        </div>

        <div className="reminder-modal-body">
          {/* Recipient */}
          <div className="reminder-recipient">
            <span className="reminder-label">To:</span>
            <strong>{recipient.name}</strong>
          </div>

          {/* Context (task/project) */}
          {context?.taskTitle && (
            <div className="reminder-context">
              <span className="reminder-label">Re:</span>
              <strong>{context.taskTitle}</strong>
              {context.taskDetails?.priority && (
                <span className={`priority-tag ${context.taskDetails.priority.toLowerCase()}`}>
                  {context.taskDetails.priority}
                </span>
              )}
            </div>
          )}

          {/* Channel Selection */}
          <div className="reminder-channels">
            <span className="reminder-label">Via:</span>
            <div className="channel-options">
              {availableChannels.length === 0 ? (
                <p className="no-channels">No contact info available</p>
              ) : (
                availableChannels.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    className={`channel-btn ${selectedChannel === channel ? 'active' : ''}`}
                    onClick={() => setSelectedChannel(channel)}
                  >
                    <img
                      src={CHANNEL_INFO[channel].icon}
                      alt=""
                      className="channel-icon"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <span>{CHANNEL_INFO[channel].label}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Custom Message */}
          <div className="reminder-message">
            <label className="reminder-label">Message (optional):</label>
            <Textarea
              placeholder="Add a personal note..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {failedDraft && (
          <div className="reminder-fallback-note">
            Couldn't send automatically. You can open a draft in your own email client instead.
          </div>
        )}

        <div className="reminder-modal-footer">
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          {failedDraft ? (
            <button type="button" className="btn-primary" onClick={handleOpenMailto}>
              Open in email client
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={handleSend}
              disabled={sending || availableChannels.length === 0}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReminderModal;
