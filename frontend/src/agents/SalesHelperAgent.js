import React, { useState, useRef, useEffect } from 'react';
import { BackButton, ProjectSelector, LiveModeHint, AgentPrefillBanner, ProjectGate, AgentOutcomesStrip, WorkflowExecutionBanner, WorkflowContextCard, Spinner, EmptyState, TypingIndicator } from '../components';
import '../styles/SalesHelperAgent.css';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { confirmReadInbox } from '../core/emailActionWarnings';
import { useAgentChat } from '../hooks/useAgentChat';
import MessageContent from '../components/MessageContent';
import { formatTime, getRelativeDateLabel, isSameDay } from '../utils/dateFormat';
import { useWorkflowContext, usePendingAgentPrefill, notifyAgentCompleted } from '../hooks';
import AgentPrerequisiteGate from '../components/AgentPrerequisiteGate';

function SalesHelperAgent() {
  const selectedProjectId = useSelectedProjectId();
  const { isInWorkflow, isHistoryView, stageData, stageId, saveStageData, getContext } = useWorkflowContext();
  const {
    messages, inputMessage, setInputMessage,
    isLoading, setIsLoading, messagesEndRef,
    addMessage,
  } = useAgentChat(
    "Welcome to the Sales Helper Agent! I can help you analyze prospects, track leads, and optimize your sales pipeline!",
    'sales_data'
  );

  const [csvData] = useState(null);
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedSavedProject, setSelectedSavedProject] = useState(null);
  const [selectedSavedProjectLeads, setSelectedSavedProjectLeads] = useState([]);
  const [savedProjectSelection, setSavedProjectSelection] = useState('');
  const [isLoadingSavedProjects, setIsLoadingSavedProjects] = useState(false);
  const [isLoadingSavedProjectLeads, setIsLoadingSavedProjectLeads] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedRankingCampaignId, setSelectedRankingCampaignId] = useState('');
  const [rankingCriteria, setRankingCriteria] = useState(
    'Cost / Pricing, Quality of Materials or Products, Reliability & Delivery Performance, Vendor Reputation & Experience, Production Capacity, Compliance & Legal Requirements, Communication & Support, Location & Logistics, Technology & Innovation, Risk Factors, Sustainability & ESG Factors, Payment Terms, Lead Time, After-Sales Service, Customization Capability, Financial Stability, Scalability, Warranty & Return Policies, Inventory Availability, Contract Flexibility, Industry Certifications, Data Security & Confidentiality, Ethical Business Practices, Existing Client References, Supply Chain Stability'
  );
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [isRankingVendors, setIsRankingVendors] = useState(false);
  const [rankedVendors, setRankedVendors] = useState([]);
  const [activeTab, setActiveTab] = useState('leads'); // 'leads' or 'ranking'
  const [isChatOpen, setIsChatOpen] = useState(false);

  const { prefill, dismiss: dismissPrefill } = usePendingAgentPrefill('salesHelper', (fields) => {
    if (isHistoryView) return;
    const msg = fields.find((f) => f.field_key === 'inputMessage');
    if (msg) {
      setInputMessage(msg.field_value);
      setIsChatOpen(true);
    }
  });
  const rankingResultsRef = useRef(null);
  const [defaultUserId] = useState('user_001');

  // Product catalog / document upload
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [showDocUploadModal, setShowDocUploadModal] = useState(false);
  const fileInputRef = useRef(null);
  // eslint-disable-next-line no-unused-vars
  const selectedRankingCampaign = campaigns.find((campaign) => String(campaign.id) === String(selectedRankingCampaignId));
  const savedLeadsCount = selectedSavedProjectLeads.length;

  const getCurrentUserIdentifier = () =>
    localStorage.getItem('userEmail') ||
    localStorage.getItem('username') ||
    localStorage.getItem('firstName') ||
    defaultUserId ||
    'anonymous';

  // Reload data when mode or project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setSavedProjects([]);
      setCampaigns([]);
      setSelectedSavedProject(null);
      setSelectedSavedProjectLeads([]);
      setRankedVendors([]);
      setUploadedDocuments([]);
      return;
    }
    setSavedProjects([]);
    setCampaigns([]);
    setSelectedSavedProject(null);
    setSelectedSavedProjectLeads([]);
    setRankedVendors([]);
    setUploadedDocuments([]);
    fetchSavedProjects();
    fetchCampaigns();
    fetchUploadedDocuments();
  }, [selectedProjectId]);

  const fetchUploadedDocuments = async () => {
    try {
      const userId = getCurrentUserIdentifier();
      const response = await fetch(`${API_CONFIG.API_URL}/api/sales-helper/documents?user_id=${encodeURIComponent(userId)}`, {
        headers: authOptionalHeaders(),
      });
      const result = await response.json();
      if (result.success) {
        setUploadedDocuments(result.documents || []);
      }
    } catch (error) {
      console.error('Error loading uploaded documents:', error);
      showToast('Could not load your uploaded documents.', 'error');
    }
  };

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    const data = stageData && Object.keys(stageData).length > 0 ? stageData : null;
    if (!data) return;

    console.log('[SalesHelper] Loading workflow history:', { isHistoryView, stageData: data });

    // Load vendor ranking results from stageData
    if (data.vendors_ranked !== undefined || data.top_vendor) {
      // Build ranked vendors from saved data
      const workflowVendors = [];
      if (data.top_vendor) {
        workflowVendors.push({
          rank: 1,
          vendor_name: data.top_vendor,
          score: data.top_score || 95,
          reason: `Campaign: ${data.campaign_name || 'N/A'} | ${data.shortlisted_count || 0} vendors passed threshold`,
        });
      }
      if (workflowVendors.length > 0) {
        setRankedVendors(workflowVendors);
        setActiveTab('ranking');
      }
    }

    // Load prospect matching results if available
    if (data.leads_analyzed !== undefined || data.matched_prospects !== undefined || data.match_scores) {
      // Switch to leads tab to show the results
      setActiveTab('leads');

      // Build message with match scores if available
      let messageContent = `**Workflow History Loaded**\n\nPreviously analyzed ${data.leads_analyzed || 0} leads from **${data.project_name || 'Unknown Project'}**.`;

      if (data.match_scores && data.match_scores.length > 0) {
        messageContent += '\n\n**Match Results:**\n';
        messageContent += data.match_scores.map((m, i) =>
          `${i + 1}. **${m.name}** - ${m.score}% match`
        ).join('\n');
      } else if (data.top_match) {
        messageContent += `\n\nTop match: ${data.top_match}`;
      }

      addMessage(messageContent, 'agent', null, 'markdown');
    }
  }, [isHistoryView, stageData, addMessage]);

  // Document upload handler
  const handleDocumentUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];

    if (!allowedTypes.includes(file.type)) {
      addMessage('Please upload a PDF, Word document, or text file.', 'agent', null, 'markdown');
      return;
    }

    try {
      setIsUploadingDoc(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', getCurrentUserIdentifier());
      formData.append('type', 'product_catalog');

      const response = await fetch(`${API_CONFIG.API_URL}/api/sales-helper/documents`, {
        method: 'POST',
        headers: authOptionalHeaders(),
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        setUploadedDocuments([...uploadedDocuments, result.document]);
        setShowDocUploadModal(false);
        addMessage(`**Document uploaded:** ${file.name}\n\nI can now use this document to match prospects with your products and services.`, 'agent', null, 'markdown');
      } else {
        addMessage(`Failed to upload document: ${result.error || 'Unknown error'}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Document upload error:', error);
      addMessage('Error uploading document. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove document
  const handleRemoveDocument = async (docId) => {
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/sales-helper/documents/${docId}?user_id=${encodeURIComponent(getCurrentUserIdentifier())}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });
      const result = await response.json();
      if (result.success) {
        setUploadedDocuments(uploadedDocuments.filter(d => d.id !== docId));
      }
    } catch (error) {
      console.error('Error removing document:', error);
      showToast('Could not remove that document.', 'error');
    }
  };

  // Match prospects with documents
  const handleMatchProspects = async () => {
    if (uploadedDocuments.length === 0) {
      addMessage('Please upload a product catalog first.', 'agent', null, 'markdown');
      return;
    }

    if (selectedSavedProjectLeads.length === 0) {
      addMessage('Please load a leads list first to match prospects.', 'agent', null, 'markdown');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/sales-helper/match-prospects`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          user_id: getCurrentUserIdentifier(),
          leads: selectedSavedProjectLeads.slice(0, 20),
          document_ids: uploadedDocuments.map(d => d.id),
        }),
      });

      const result = await response.json();
      if (result.success) {
        addMessage(result.analysis || 'Matching complete. See results above.', 'agent', null, 'markdown');

        if (isInWorkflow) {
          saveStageData({
            leads_analyzed: selectedSavedProjectLeads.length,
            project_name: selectedSavedProject?.name,
            analysis: result.analysis,
          });
        }
      } else {
        addMessage(`Matching failed: ${result.error || 'Unknown error'}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Prospect matching error:', error);
      addMessage('Error matching prospects. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsLoading(false);
    }
  };

  // Messages added while the chat panel is closed (e.g. background vendor
  // ranking or prospect matching) don't scroll into view since the panel
  // isn't mounted yet - jump to the latest message once it's opened.
  useEffect(() => {
    if (!isChatOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [isChatOpen, messagesEndRef]);

  // Scroll to ranking results when they appear
  useEffect(() => {
    if (rankedVendors.length === 0) return;

    const scrollTimer = window.requestAnimationFrame(() => {
      rankingResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    return () => window.cancelAnimationFrame(scrollTimer);
  }, [rankedVendors.length]);

  const fetchCampaigns = async () => {
    try {
      setIsLoadingCampaigns(true);
      const userId = getCurrentUserIdentifier();
      const response = await fetch(`${API_CONFIG.GET_CAMPAIGNS_STATS}?username=${encodeURIComponent(userId)}`, {
        headers: authOptionalHeaders(),
      });
      const result = await response.json();

      if (result.success && Array.isArray(result.campaigns)) {
        setCampaigns(result.campaigns);
        if (!selectedRankingCampaignId && result.campaigns.length > 0) {
          setSelectedRankingCampaignId(String(result.campaigns[0].id));
        }
      } else {
        setCampaigns([]);
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      setCampaigns([]);
      showToast('Could not load campaigns.', 'error');
    } finally {
      setIsLoadingCampaigns(false);
    }
  };

  // Ask about CSV-uploaded leads using the sales helper chat backend
  const handleAskCsvLeads = async (question) => {
    if (!csvData || csvData.length === 0) {
      addMessage('Please upload sales data first.', 'agent', null, 'markdown');
      return;
    }

    try {
      setIsLoading(true);
      const sampleLeads = csvData.slice(0, 25);
      const userId = getCurrentUserIdentifier();
      const response = await fetch(API_CONFIG.SALES_HELPER_CHAT, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ question, project: { name: 'Uploaded Sales Data' }, leads: sampleLeads, user_id: userId })
      });

      const result = await response.json();
      if (result.success && result.answer) {
        addMessage(result.answer, 'agent', null, 'markdown');
      } else {
        addMessage(result.error || 'I could not analyze the uploaded leads right now.', 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('CSV leads chat error:', error);
      addMessage('Error analyzing the uploaded leads. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSavedProjects = async () => {
    try {
      setIsLoadingSavedProjects(true);
      const userId = getCurrentUserIdentifier();
      const response = await fetch(`${API_CONFIG.GET_SAVED_PROJECTS}?username=${encodeURIComponent(userId)}`, {
        headers: authOptionalHeaders(),
      });
      const result = await response.json();

      if (result.success && Array.isArray(result.projects)) {
        setSavedProjects(result.projects);
        if (result.projects.length > 0 && !savedProjectSelection) {
          setSavedProjectSelection(String(result.projects[0].id));
        }
      } else {
        setSavedProjects([]);
      }
    } catch (error) {
      console.error('Error loading saved projects:', error);
      setSavedProjects([]);
      showToast('Could not load saved lists.', 'error');
    } finally {
      setIsLoadingSavedProjects(false);
    }
  };

  const loadSavedProjectLeads = async (projectId) => {
    if (!projectId) return;

    try {
      setIsLoadingSavedProjectLeads(true);
      const userId = getCurrentUserIdentifier();
      const response = await fetch(`${API_CONFIG.GET_SAVED_PROJECT_LEADS}/${projectId}/leads?username=${encodeURIComponent(userId)}`, {
        headers: authOptionalHeaders(),
      });
      const result = await response.json();

      if (result.success) {
        setSelectedSavedProject(result.project);
        setSelectedSavedProjectLeads(result.leads || []);
        setSavedProjectSelection(String(projectId));
        addMessage(
          `**Loaded saved leads list:** ${result.project?.name || 'Untitled'}\n\nI can now answer questions about these ${result.leads?.length || 0} leads.`,
          'agent',
          null,
          'markdown'
        );
      } else {
        addMessage(`Unable to load saved list: ${result.error || 'Unknown error'}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Error loading saved project leads:', error);
      addMessage('Error loading the selected saved leads list. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsLoadingSavedProjectLeads(false);
    }
  };

  const handleAskSavedLeads = async (question) => {
    if (!selectedSavedProjectLeads || selectedSavedProjectLeads.length === 0) {
      addMessage('Please open a saved leads list first.', 'agent', null, 'markdown');
      return;
    }

    try {
      setIsLoading(true);
      const userId = getCurrentUserIdentifier();
      const response = await fetch(API_CONFIG.SALES_HELPER_CHAT, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          question,
          project: selectedSavedProject,
          leads: selectedSavedProjectLeads,
          user_id: userId
        })
      });

      const result = await response.json();

      if (result.success && result.answer) {
        addMessage(result.answer, 'agent', null, 'markdown');
      } else {
        addMessage(result.error || 'I could not analyze the selected leads list right now.', 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Saved leads chat error:', error);
      addMessage('Error analyzing the saved leads list. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRankVendorReplies = async () => {
    if (!selectedRankingCampaignId) {
      addMessage('Please select a campaign with vendor replies first.', 'agent', null, 'markdown');
      return;
    }

    const confirmed = await confirmReadInbox({ context: 'to rank vendor responses' });
    if (!confirmed) return;

    try {
      setIsRankingVendors(true);
      addMessage('Ranking vendor replies by your criteria...', 'agent', null, 'markdown');

      const userId = getCurrentUserIdentifier();
      const response = await fetch(API_CONFIG.RANK_CAMPAIGN_VENDORS.replace('{campaignId}', selectedRankingCampaignId), {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          criteria: rankingCriteria,
          user_id: userId,
          project_id: selectedProjectId,
        }),
      });

      const result = await response.json();
      if (result.success && Array.isArray(result.vendors)) {
        setRankedVendors(result.vendors);
        const campaignName = result.campaign?.name || 'selected campaign';
        addMessage(
          `**Vendor ranking completed for ${campaignName}:**\n\n${result.vendors.map(v => `${v.rank}. ${v.vendor_name} - ${v.score}/100\n${v.reason || v.reply_summary || ''}`).join('\n\n')}`,
          'agent',
          null,
          'markdown'
        );
        notifyAgentCompleted('salesHelper', `Ranked ${result.vendors.length} vendors for ${campaignName}`, [
          { field_key: 'subject', field_value: `Following up - ${campaignName}` },
          { field_key: 'body', field_value: `Hi {{company}},\n\nThanks for your response to our "${campaignName}" outreach - we've ranked it among our top prospects.\n\n[Add a line here about next steps or what you'd like to discuss.]\n\nDo you have 15 minutes this week for a quick call?\n\nBest,\n[Your name]` },
        ]);

        // Save to workflow if in workflow context
        if (isInWorkflow) {
          saveStageData({
            campaign_name: campaignName,
            vendors_ranked: result.vendors.length,
            top_vendor: result.vendors[0]?.vendor_name,
            top_score: result.vendors[0]?.score,
            shortlisted_count: result.vendors.filter(v => v.score >= 70).length,
          });
        }
      } else {
        setRankedVendors([]);
        addMessage(result.error || 'Unable to rank vendor replies right now.', 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Vendor ranking error:', error);
      addMessage('Error ranking vendor replies. Please try again.', 'agent', null, 'markdown');
    } finally {
      setIsRankingVendors(false);
    }
  };

  // Handle message sending
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const message = inputMessage.trim();
    setInputMessage('');

    // Add user message
    addMessage(message, 'user', null, 'markdown');

    if (selectedSavedProjectLeads && selectedSavedProjectLeads.length > 0) {
      await handleAskSavedLeads(message);
      return;
    }
    // If CSV data is loaded, route the question to the sales-helper-chat LLM
    if (csvData && csvData.length > 0) {
      await handleAskCsvLeads(message);
    } else {
      addMessage("Please upload your sales data (CSV/XLSX) or open a saved leads list first, then I can help you search and analyze prospects!", 'agent', null, 'markdown');
    }
  };

  // Global functions for prospect actions
  useEffect(() => {
    window.salesHelper = {
      contactProspect: (index) => {
        const prospect = csvData[index];
        addMessage(`**Initiating contact with ${prospect.company || prospect.name}**\n\n**Contact Details:**\n${prospect.email ? `Email: ${prospect.email}` : ''}\n${prospect.phone ? `Phone: ${prospect.phone}` : ''}\n${prospect.linkedin ? `LinkedIn: ${prospect.linkedin}` : ''}`, 'agent', null, 'markdown');
      },
      addToFavorites: (index) => {
        const prospect = csvData[index];
        addMessage(`Added ${prospect.company || prospect.name} to favorites!`, 'agent', null, 'markdown');
      },
      addNotes: (index) => {
        const prospect = csvData[index];
        addMessage(`**Add notes for ${prospect.company || prospect.name}:**\n\nYou can track:\n• Last contact date\n• Discussion points\n• Next follow-up action\n• Decision makers involved`, 'agent', null, 'markdown');
      }
    };

    return () => {
      delete window.salesHelper;
    };
  }, [csvData, addMessage]);

  return (
    <AgentPrerequisiteGate agentId="sales_helper" hardBlockKeys={['gmail_connection']}>
    <div className="sales-helper-agent">

      <div className="agent-page-header">
        <div className="agent-header-left">
          {!isInWorkflow && <BackButton />}
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Sales Helper</h1>
            </div>
            <p className="text-muted">
              Analyze prospects, rank vendors, and match leads with your product catalog.
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector
            agentKey="salesHelper"
            onProjectChange={(project) => {
              if (project) {
                console.log('Project selected:', project.name);
              }
            }}
          />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/search-analysis.png', title: 'Lead analysis', description: 'Load saved lead lists and explore prospect data.' },
          { iconSrc: '/assets/icons/message.png', title: 'AI assistant', description: 'Ask questions about vendors and product fit.' },
          { iconSrc: '/assets/icons/bar-chart.png', title: 'Vendor ranking', description: 'Score and compare vendors for your RFP.' },
        ]}
      />

      <LiveModeHint
        requireProject
        message="Choose a project above, or create one with + New Project."
      />

      <AgentPrefillBanner
        prefill={prefill}
        onDismiss={dismissPrefill}
        labels={{ inputMessage: 'Message' }}
      />

      <div className="main-container">
        <ProjectGate agentLabel="Sales Helper workspace">
          <WorkflowExecutionBanner />

          {/* Show context from previous workflow stages */}
          {isInWorkflow && !isHistoryView && (
            <WorkflowContextCard context={getContext()} currentStageId={stageId} />
          )}

          <div className="sales-helper-content">
            <div className="assistant-workspace tabbed-layout">
          {/* Tab Navigation */}
          <div className="module-tabs">
            <button
              className={`module-tab ${activeTab === 'leads' ? 'module-tab--active' : ''}`}
              onClick={() => setActiveTab('leads')}
            >
              Saved Leads
              <span className="tab-badge">{savedProjects.length} lists</span>
              {savedLeadsCount > 0 && <span className="tab-badge accent">{savedLeadsCount} loaded</span>}
            </button>
            <button
              className={`module-tab ${activeTab === 'ranking' ? 'module-tab--active' : ''}`}
              onClick={() => setActiveTab('ranking')}
            >
              Vendor Ranking
              <span className="tab-badge">{campaigns.length} campaigns</span>
              {rankedVendors.length > 0 && <span className="tab-badge accent">{rankedVendors.length} ranked</span>}
            </button>
          </div>

          {/* Tab Content */}
          <div className="workspace-tab-content">
            {/* Saved Leads Tab */}
            {activeTab === 'leads' && (
              <div className="tab-panel leads-panel">
                <div className="panel-header-row">
                  <button type="button" className="panel-action-btn" onClick={fetchSavedProjects} disabled={isLoadingSavedProjects} title="Refresh lists">
                    {isLoadingSavedProjects ? <Spinner size="sm" /> : 'Refresh'}
                  </button>
                </div>

                {/* Main content area */}
                <div className="leads-main">
                {!selectedSavedProject ? (
                  <div className="leads-grid-container">
                    {isLoadingSavedProjects ? (
                      <div className="empty-saved-state"><Spinner size="sm" /></div>
                    ) : savedProjects.length === 0 ? (
                      <EmptyState
                        iconType="data"
                        title="No saved lists yet"
                        description="Create lead lists from Market Research."
                        size="sm"
                      />
                    ) : (
                      <div className="leads-list-grid">
                        {savedProjects.map((project) => (
                          <button
                            key={project.id}
                            className="lead-list-card"
                            onClick={() => loadSavedProjectLeads(project.id)}
                          >
                            <div className="lead-list-card-header">
                              <span className="lead-count">{project.lead_count}</span>
                              <span className="lead-count-label">leads</span>
                            </div>
                            <div className="lead-list-card-body">
                              <h4 className="lead-list-name">{project.name}</h4>
                              <p className="lead-list-query">{project.query_used || 'No query specified'}</p>
                            </div>
                            <div className="lead-list-card-footer">
                              <span className="view-leads-link">View leads →</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="selected-list-header">
                      <button
                        className="back-to-lists-btn"
                        onClick={() => {
                          setSelectedSavedProject(null);
                          setSelectedSavedProjectLeads([]);
                        }}
                      >
                        ← All Lists
                      </button>
                      <div className="selected-list-info">
                        <h3>{selectedSavedProject?.name}</h3>
                        <span className="lead-count-badge">{selectedSavedProjectLeads.length} leads</span>
                      </div>
                    </div>

                    <div className="leads-card-grid">
                      {selectedSavedProjectLeads.map((lead, index) => (
                        <div key={`${lead.id || index}`} className="lead-card">
                          <div className="lead-card-header">
                            <h4 className="lead-name">{lead.name || 'Unknown'}</h4>
                            {lead.website && (
                              <a href={lead.website} target="_blank" rel="noopener noreferrer" className="lead-website-btn">
                                Website
                              </a>
                            )}
                          </div>
                          <div className="lead-card-details">
                            {lead.phone && (
                              <div className="lead-detail">
                                <span className="detail-label">Phone</span>
                                <span className="detail-value">{lead.phone}</span>
                              </div>
                            )}
                            {(lead.email || (Array.isArray(lead.emails) && lead.emails[0])) && (
                              <div className="lead-detail">
                                <span className="detail-label">Email</span>
                                <span className="detail-value">{lead.email || lead.emails[0]}</span>
                              </div>
                            )}
                            {lead.address && (
                              <div className="lead-detail">
                                <span className="detail-label">Location</span>
                                <span className="detail-value">{lead.address}</span>
                              </div>
                            )}
                          </div>
                          {lead.summary && (
                            <p className="lead-summary">{lead.summary}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Documents Section - Redesigned */}
                <div className="catalog-section">
                  <div className="catalog-header">
                    <div>
                      <h4>Product Catalogs</h4>
                      <p className="catalog-subtitle">Upload documents to match prospects with your offerings</p>
                    </div>
                  </div>

                  <div className="catalog-content">
                    {/* Upload Zone */}
                    <div
                      className={`upload-dropzone ${isUploadingDoc ? 'uploading' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <img src="/assets/icons/document.png" alt="" className="dropzone-icon-img" />
                      <div className="dropzone-text">
                        <span className="dropzone-title">
                          {isUploadingDoc ? 'Uploading...' : 'Drop files or click to upload'}
                        </span>
                        <span className="dropzone-hint">PDF, Word, TXT up to 10MB</span>
                      </div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleDocumentUpload}
                        accept=".pdf,.doc,.docx,.txt"
                        style={{ display: 'none' }}
                      />
                    </div>

                    {/* Document List */}
                    {uploadedDocuments.length > 0 && (
                      <div className="document-list">
                        {uploadedDocuments.map(doc => (
                          <div key={doc.id} className="document-card">
                            <div className="doc-card-top">
                              <img src="/assets/icons/document.png" alt="" className="doc-card-icon" />
                              <div className="doc-card-info">
                                <span className="doc-card-name">{doc.name}</span>
                                <span className="doc-card-meta">{doc.size} · {doc.uploadedAt}</span>
                              </div>
                            </div>
                            <div className="doc-card-actions">
                              <button
                                className="doc-text-btn"
                                onClick={() => window.open(doc.url || `${API_CONFIG.API_URL}/api/sales-helper/documents/${doc.id}/view?user_id=${encodeURIComponent(getCurrentUserIdentifier())}`, '_blank')}
                              >
                                View
                              </button>
                              <a
                                className="doc-text-btn"
                                href={doc.url || `${API_CONFIG.API_URL}/api/sales-helper/documents/${doc.id}/download?user_id=${encodeURIComponent(getCurrentUserIdentifier())}`}
                                download={doc.name}
                              >
                                Download
                              </a>
                              <button
                                className="doc-text-btn danger"
                                onClick={() => handleRemoveDocument(doc.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Match Button */}
                    {uploadedDocuments.length > 0 && selectedSavedProjectLeads.length > 0 && (
                      <button className="match-prospects-btn" onClick={handleMatchProspects} disabled={isLoading}>
                        {isLoading ? 'Matching prospects...' : 'Match with Prospects'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              </div>
            )}

            {/* Vendor Ranking Tab - Redesigned */}
            {activeTab === 'ranking' && (
              <div className="tab-panel ranking-panel-redesigned">
                {/* Step 1: Select Campaign */}
                <div className="ranking-step">
                  <div className="step-header">
                    <span className="step-number">1</span>
                    <div className="step-info">
                      <h4>Select Campaign</h4>
                      <p>Choose a campaign with vendor responses to rank</p>
                    </div>
                    <button type="button" className="refresh-btn-small" onClick={fetchCampaigns} disabled={isLoadingCampaigns} aria-label="Refresh campaigns">
                      {isLoadingCampaigns ? <Spinner size="sm" /> : '↻'}
                    </button>
                  </div>

                  {campaigns.length === 0 ? (
                    <EmptyState
                      iconType="data"
                      title="No campaigns with responses yet"
                      size="sm"
                    />
                  ) : (
                    <div className="campaign-cards">
                      {campaigns.map((campaign) => (
                        <button
                          key={campaign.id}
                          className={`campaign-card ${selectedRankingCampaignId === campaign.id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedRankingCampaignId(campaign.id);
                            setRankedVendors([]);
                          }}
                        >
                          <div className="campaign-card-main">
                            <span className="campaign-name">{campaign.name}</span>
                            <span className="campaign-date">{campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : ''}</span>
                          </div>
                          <div className="campaign-stats">
                            <div className="stat">
                              <span className="stat-value">{campaign.totalReplied || 0}</span>
                              <span className="stat-label">replies</span>
                            </div>
                            <div className="stat">
                              <span className="stat-value">{campaign.totalSent || 0}</span>
                              <span className="stat-label">sent</span>
                            </div>
                          </div>
                          {selectedRankingCampaignId === campaign.id && (
                            <div className="selected-check">✓</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Step 2: Define Criteria */}
                <div className={`ranking-step ${!selectedRankingCampaignId ? 'disabled' : ''}`}>
                  <div className="step-header">
                    <span className="step-number">2</span>
                    <div className="step-info">
                      <h4>Define Ranking Criteria</h4>
                      <p>What factors matter most for your decision?</p>
                    </div>
                  </div>

                  <div className="criteria-input-area">
                    <textarea
                      value={rankingCriteria}
                      onChange={(e) => setRankingCriteria(e.target.value)}
                      rows={4}
                      className="criteria-textarea"
                      placeholder="e.g., Price competitiveness, delivery timeline, quality certifications, customer support..."
                      disabled={!selectedRankingCampaignId}
                    />
                    <div className="criteria-suggestions">
                      <span className="suggestion-label">Quick add:</span>
                      {['Price', 'Quality', 'Reliability', 'Speed', 'Support'].map(tag => (
                        <button
                          key={tag}
                          type="button"
                          className="criteria-tag"
                          onClick={() => setRankingCriteria(prev => prev ? `${prev}, ${tag}` : tag)}
                          disabled={!selectedRankingCampaignId}
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="rank-vendors-btn"
                    onClick={handleRankVendorReplies}
                    disabled={!selectedRankingCampaignId || isRankingVendors || isLoadingCampaigns}
                  >
                    {isRankingVendors ? (
                      <>
                        <Spinner size="sm" color="white" />
                        Analyzing responses...
                      </>
                    ) : 'Rank Vendors'}
                  </button>
                </div>

                {/* Ranked Results */}
                {rankedVendors.length > 0 && (
                  <div className="ranked-results" ref={rankingResultsRef}>
                    <div className="results-header">
                      <h4>Ranking Results</h4>
                      <span className="results-count">{rankedVendors.length} vendors scored</span>
                    </div>

                    {/* Top 3 Podium */}
                    {rankedVendors.length >= 3 && (
                      <div className="podium">
                        <div className="podium-item silver">
                          <div className="podium-rank">2</div>
                          <div className="podium-name">{rankedVendors[1]?.vendor_name}</div>
                          <div className="podium-score">{rankedVendors[1]?.score}</div>
                        </div>
                        <div className="podium-item gold">
                          <div className="podium-rank">1</div>
                          <div className="podium-name">{rankedVendors[0]?.vendor_name}</div>
                          <div className="podium-score">{rankedVendors[0]?.score}</div>
                        </div>
                        <div className="podium-item bronze">
                          <div className="podium-rank">3</div>
                          <div className="podium-name">{rankedVendors[2]?.vendor_name}</div>
                          <div className="podium-score">{rankedVendors[2]?.score}</div>
                        </div>
                      </div>
                    )}

                    {/* Full list with score bars */}
                    <div className="ranked-list-visual">
                      {rankedVendors.map((v) => (
                        <div key={v.rank} className={`ranked-item-visual ${v.rank <= 3 ? 'top-three' : ''}`}>
                          <div className="rank-header">
                            <span className="rank-position">#{v.rank}</span>
                            <span className="rank-vendor-name">{v.vendor_name}</span>
                            <span className="rank-score-value">{v.score}</span>
                          </div>
                          <div className="score-bar-container">
                            <div
                              className="score-bar-fill"
                              style={{ width: `${v.score}%` }}
                            />
                          </div>
                          {(v.reason || v.reply_summary) && (
                            <p className="rank-summary">{v.reason || v.reply_summary}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Floating Chat Button */}
        {!isChatOpen && (
          <button className="floating-chat-btn" onClick={() => setIsChatOpen(true)} aria-label="Open chat">
            <img src="/assets/icons/message.png" alt="" className="chat-btn-icon" />
          </button>
        )}

        {/* Chat Interface */}
        {isChatOpen && (
            <div className="chat-section">
              <div className="chat-header">
                <div className="chat-header-content">
                  <h2>Sales Assistant</h2>
                  <p>
                    {selectedSavedProject
                      ? `Asking questions about ${selectedSavedProject.name}`
                      : 'Search prospects, analyze deals, and get sales insights'}
                  </p>
                </div>
                <button
                  className="chat-close-btn"
                  onClick={() => setIsChatOpen(false)}
                  aria-label="Close chat"
                >
                  Close
                </button>
              </div>

              <div className="messages-container">
                {messages.map((message, index) => {
                  const prevMessage = messages[index - 1];
                  const showDateSeparator = !prevMessage || !isSameDay(message.timestamp, prevMessage.timestamp);
                  return (
                    <React.Fragment key={message.id}>
                      {showDateSeparator && (
                        <div className="date-separator">
                          <span>{getRelativeDateLabel(message.timestamp)}</span>
                        </div>
                      )}
                      <div className={`message ${message.sender}`}>
                        <div className="message-content">
                          <MessageContent message={message} />
                          <span className="timestamp">{formatTime(message.timestamp)}</span>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {isLoading && (
                  <div className="message agent">
                    <TypingIndicator />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form className="message-form" onSubmit={handleSendMessage}>
                <div className="input-container">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder={
                      isHistoryView
                        ? 'Viewing completed stage - inputs disabled'
                        : selectedSavedProject
                        ? 'Ask a question about the selected saved leads list...'
                        : 'Search prospects, ask for insights, or analyze deals...'
                    }
                    disabled={isLoading || isHistoryView}
                    className="message-input"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !inputMessage.trim() || isHistoryView}
                    className="send-button"
                  >
                    {isLoading ? <Spinner size="sm" color="white" /> : '→'}
                  </button>
                </div>
              </form>
            </div>
          )}
          </div>
        </ProjectGate>
      </div>
    </div>
    </AgentPrerequisiteGate>
  );
}

export default SalesHelperAgent;
