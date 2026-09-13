import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AgentOutcomesStrip, AgentPrefillBanner, BackButton, ProjectGate, ProjectSelector, WorkflowExecutionBanner, WorkflowContextCard, Button } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { useWorkflowContext, usePendingAgentPrefill, notifyAgentCompleted } from '../hooks';
import AgentPrerequisiteGate from '../components/AgentPrerequisiteGate';
import './EmailOutreachAgent.css';

// Built-in starter email templates
const EMAIL_TEMPLATES = [
  { id: 1, name: 'RFQ Request', subject: 'Request for Quotation - {{component}}', body: 'Dear {{supplier_name}},\n\nWe are seeking quotations for {{component}}...' },
  { id: 2, name: 'Follow-up', subject: 'Following Up - {{company}}', body: 'Hi {{contact_name}},\n\nI wanted to follow up on our previous conversation...' },
  { id: 3, name: 'Introduction', subject: 'Introduction from {{company}}', body: 'Hello {{recipient_name}},\n\nI\'m reaching out to introduce {{company}}...' },
];

function EmailOutreachAgent() {
  // Workflow context - for saving results back to workflow
  const { isInWorkflow, isHistoryView, stageData, stageId, saveStageData, getContext, context: workflowContext } = useWorkflowContext();

  const [templates, setTemplates] = useState(EMAIL_TEMPLATES);
  const [recipients, setRecipients] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const { prefill, dismiss: dismissPrefill } = usePendingAgentPrefill('emailOutreach', (fields) => {
    if (isHistoryView) return;
    fields.forEach((f) => {
      if (f.field_key === 'subject') setEmailSubject(f.field_value);
      if (f.field_key === 'body') setEmailBody(f.field_value);
    });
  });
  const [sending, setSending] = useState(false);

  // Saved lead lists (from Market Research) - the real recipient source in live mode
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedSavedProject, setSelectedSavedProject] = useState(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);

  const getCurrentUserIdentifier = () =>
    localStorage.getItem('username') || localStorage.getItem('firstName') || 'anonymous';
  const getCurrentUserEmail = () => localStorage.getItem('userEmail') || '';

  const fetchSavedProjects = async () => {
    try {
      const response = await fetch(`${API_CONFIG.GET_SAVED_PROJECTS}?username=${encodeURIComponent(getCurrentUserIdentifier())}`, { headers: authOptionalHeaders() });
      const result = await response.json();
      if (result.success && Array.isArray(result.projects)) {
        setSavedProjects(result.projects);
      }
    } catch (error) {
      console.error('Error loading saved lead lists:', error);
    }
  };

  const loadSavedProjectLeads = async (projectId) => {
    if (!projectId) {
      setSelectedSavedProject(null);
      setRecipients([]);
      return;
    }
    try {
      setIsLoadingLeads(true);
      const response = await fetch(`${API_CONFIG.GET_SAVED_PROJECT_LEADS}/${projectId}/leads?username=${encodeURIComponent(getCurrentUserIdentifier())}`, { headers: authOptionalHeaders() });
      const result = await response.json();
      if (result.success) {
        setSelectedSavedProject(result.project);
        const hasRealEmail = (email) => email && email !== 'N/A' && email.includes('@');
        const leads = (result.leads || [])
          .filter(l => hasRealEmail(l.email) || (Array.isArray(l.emails) && hasRealEmail(l.emails[0])))
          .map((l, idx) => ({
            id: l.id || idx,
            name: l.name || 'Unknown',
            email: l.email || l.emails[0],
            status: 'pending',
          }));
        setRecipients(leads);
      } else {
        showToast(result.error || 'Failed to load leads', 'error');
      }
    } catch (error) {
      console.error('Error loading saved leads:', error);
      showToast('Failed to load leads', 'error');
    } finally {
      setIsLoadingLeads(false);
    }
  };

  useEffect(() => {
    fetchSavedProjects();
  }, []);

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    const data = stageData && Object.keys(stageData).length > 0 ? stageData : null;
    if (!data) return;

    console.log('[EmailOutreach] Loading workflow history:', { isHistoryView, stageData: data });

    // Show email outreach results from saved stageData
    if (data.emails_sent !== undefined) {
      // Load email subject and body if saved
      if (data.email_subject) {
        setEmailSubject(data.email_subject);
      }
      if (data.email_body) {
        setEmailBody(data.email_body);
      }

      // Mark recipients as sent and create list from saved data
      if (data.recipients && data.recipients.length > 0) {
        // Create recipients list from saved emails
        const savedRecipients = data.recipients.map((email, idx) => ({
          id: idx + 1,
          name: data.recipient_names?.[idx] || email.split('@')[0],
          email: email,
          status: 'sent',
        }));
        setRecipients(savedRecipients);
      } else {
        setRecipients(prev => prev.map(r => ({ ...r, status: 'sent' })));
      }

      // Set template if available (fallback for subject/body if not directly saved)
      if (data.template_used && !data.email_subject) {
        const template = templates.find(t => t.name === data.template_used);
        if (template) {
          setSelectedTemplate(template);
          setEmailSubject(template.subject);
          setEmailBody(template.body);
        }
      }
    }
  }, [isHistoryView, stageData, templates]);

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setEmailSubject(template.subject);
    setEmailBody(template.body);
  };

  const handleSendEmails = async () => {
    const pendingRecipients = recipients.filter(r => r.status === 'pending');
    if (pendingRecipients.length === 0) return;

    const userEmail = getCurrentUserEmail();
    if (!userEmail) {
      showToast('Please sign in with an email address before sending campaigns.', 'error');
      return;
    }

    setSending(true);
    try {
      const response = await fetch(API_CONFIG.SEND_BULK_EMAILS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          subject: emailSubject,
          body: emailBody,
          businesses: pendingRecipients.map(r => ({ name: r.name, email: r.email })),
          userEmail,
          username: getCurrentUserIdentifier(),
          campaignName: selectedSavedProject?.name || selectedTemplate?.name || 'Email Outreach Campaign',
        }),
      });
      const result = await response.json();

      if (!result.success) {
        showToast(result.error || 'Failed to send emails', 'error');
        setSending(false);
        return;
      }

      setRecipients(recipients.map(r =>
        r.status === 'pending' ? { ...r, status: 'sent' } : r
      ));

      showToast(result.message || `Sent ${result.count} emails`, 'success');
      notifyAgentCompleted('emailOutreach', `Sent ${result.count} emails`, [
        { field_key: 'inputMessage', field_value: `Help me rank replies to my "${emailSubject}" email campaign` },
      ]);

      // Save to workflow if in workflow context
      if (isInWorkflow) {
        saveStageData({
          emails_sent: result.count,
          template_used: selectedTemplate?.name,
          email_subject: emailSubject,
          email_body: emailBody,
          recipients: recipients.map(r => r.email),
          recipient_names: recipients.map(r => r.name),
          delivery_rate: pendingRecipients.length > 0 ? `${Math.round((result.count / pendingRecipients.length) * 100)}%` : '0%',
        });
      }
    } catch (err) {
      showToast('Error sending emails', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <AgentPrerequisiteGate agentId="email_outreach" hardBlockKeys={['gmail_connection']}>
    <>

      <div className="agent-page-header">
        <div className="agent-header-left">
          {!isInWorkflow && <BackButton />}
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Email Outreach</h1>
            </div>
            <p className="text-muted">
              Send bulk emails to suppliers, leads, or contacts
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector agentKey="emailOutreach" />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/mail.png', title: 'Bulk sending', description: 'Send personalized emails to a whole list at once.' },
          { iconSrc: '/assets/icons/checklist.png', title: 'Templates', description: 'Reusable templates for common outreach types.' },
          { iconSrc: '/assets/icons/monitoring.png', title: 'Delivery tracking', description: 'See what was sent, opened, and replied to.' },
        ]}
      />

      <AgentPrefillBanner
        prefill={prefill}
        onDismiss={dismissPrefill}
        labels={{ subject: 'Subject', body: 'Body' }}
      />

      <ProjectGate agentLabel="Email Outreach workspace">
        <div className="email-outreach-page">
          <WorkflowExecutionBanner />

          {/* Show context from previous workflow stages */}
          {isInWorkflow && !isHistoryView && (
            <WorkflowContextCard context={getContext()} currentStageId={stageId} />
          )}

          <div className="email-outreach-content">
            {/* Templates */}
            <div className="email-section">
              <h2>
                <img src="/assets/icons/document.png" alt="" />
                Email Templates
              </h2>
              <div className="template-list">
                {templates.map(template => (
                  <div
                    key={template.id}
                    className={`template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <span className="template-name">{template.name}</span>
                    <span className="template-subject">{template.subject}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Compose */}
            <div className="email-section">
              <h2>
                <img src="/assets/icons/mail.png" alt="" />
                Compose Email
              </h2>
              <div className="compose-form">
                <div className="form-field">
                  <label>Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Enter email subject..."
                    disabled={isHistoryView}
                  />
                </div>
                <div className="form-field">
                  <label>Body</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Enter email body..."
                    rows={8}
                    disabled={isHistoryView}
                  />
                </div>
                <p className="compose-hint">
                  Use {'{{variable}}'} syntax for personalization (e.g., {'{{supplier_name}}'})
                </p>
              </div>
            </div>

            {/* Recipients */}
            <div className="email-section">
              <h2>
                <img src="/assets/icons/users.png" alt="" />
                Recipients ({recipients.length})
              </h2>
              {!isHistoryView && (
                <div className="form-field" style={{ marginBottom: 'var(--space-3)' }}>
                  <label>Load a saved lead list (from Market Research)</label>
                  <select
                    value={selectedSavedProject?.id || ''}
                    onChange={(e) => loadSavedProjectLeads(e.target.value)}
                    disabled={isLoadingLeads}
                  >
                    <option value="">
                      {savedProjects.length === 0 ? 'No saved lists yet - create one in Market Research' : 'Choose a saved list...'}
                    </option>
                    {savedProjects.map(project => (
                      <option key={project.id} value={project.id}>{project.name} ({project.lead_count} leads)</option>
                    ))}
                  </select>
                </div>
              )}
              {isHistoryView && (
                <div style={{
                  background: 'rgba(var(--color-primary-rgb), 0.04)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '12px',
                  fontSize: '0.8125rem',
                  color: 'var(--color-primary)'
                }}>
                  <strong>📧 Campaign Summary:</strong> {recipients.filter(r => r.status === 'sent').length} emails marked as sent
                  {emailSubject && <div style={{marginTop: '4px'}}><strong>Subject:</strong> {emailSubject}</div>}
                  {!emailSubject && !emailBody && <div style={{marginTop: '4px', fontStyle: 'italic'}}>Note: Email content not recorded (demo/test mode). Scroll up to see the compose form.</div>}
                </div>
              )}
              <div className="recipients-list">
                {recipients.map(recipient => (
                  <div key={recipient.id} className={`recipient-row ${recipient.status}`}>
                    <div className="recipient-info">
                      <span className="recipient-name">{recipient.name}</span>
                      <span className="recipient-email">{recipient.email}</span>
                    </div>
                    <span className={`recipient-status ${recipient.status}`}>
                      {recipient.status === 'sent' ? '✓ Sent' : '○ Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="email-actions">
              <Button
                variant="primary"
                onClick={handleSendEmails}
                disabled={sending || !emailSubject || !emailBody || recipients.filter(r => r.status === 'pending').length === 0 || isHistoryView}
              >
                {sending ? 'Sending...' : `Send to ${recipients.filter(r => r.status === 'pending').length} Recipients`}
              </Button>
            </div>
          </div>
        </div>
      </ProjectGate>
    </>
    </AgentPrerequisiteGate>
  );
}

export default EmailOutreachAgent;
