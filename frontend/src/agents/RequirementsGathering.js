import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BackButton, LiveModeHint, AgentOutcomesStrip, AgentPrefillBanner, ProjectSelector, ProjectGate, Modal, showConfirm, WorkflowExecutionBanner, Spinner, Button } from '../components';
import '../styles/RequirementsGathering.css';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { getAgentData, setAgentData, AGENT_KEYS } from '../utils';
import { formatDate } from '../utils/dateFormat';
import { showToast } from '../core/toast';
import { useWorkflowContext, usePendingAgentPrefill, notifyAgentCompleted } from '../hooks';
import { STRINGS } from '../constants';

const SUPPLIER_TEMPLATE = `Dear [Vendor Name / Sir / Madam],

Greetings from [Your Company Name].

We came across your company profile and would like to explore the possibility of working together for our ongoing and upcoming business requirements.

We are currently looking for reliable vendors/suppliers for the supply of [Product/Service Category]. We request you to share your company profile and the following details for our evaluation process:

* Product / Service Catalog
* Pricing / Quotation
* GST and Registration Details
* Payment Terms
* Delivery Timelines
* Major Clients / References
* Certifications (if applicable)

Company Details:

* Company Name: [Your Company Name]
* Industry: [Industry Type]
* Location: [Company Location]
* Contact Person: [Your Name]
* Contact Number: [Phone Number]
* Email: [Email Address]

Please feel free to contact us for any further clarification. We look forward to a mutually beneficial business relationship.

Best Regards,
[Your Company Name]
[Company Website]`;

const fillTemplate = (template, vars = {}) => {
  let out = template;
  const replacements = {
    '\\[Vendor Name \\/ Sir \\/ Madam\\]': vars.vendorName || 'Sir / Madam',
    '\\[Vendor Name\\]': vars.vendorName || 'Sir / Madam',
    '\\[Your Company Name\\]': vars.companyName || '',
    '\\[Industry Type\\]': vars.industry || '',
    '\\[Company Location\\]': vars.location || '',
    '\\[Your Name\\]': vars.contactName || '',
    '\\[Phone Number\\]': vars.phoneNumber || '',
    '\\[Email Address\\]': vars.emailAddress || '',
    '\\[Product\\/Service Category\\]': vars.productCategory || '',
    '\\[Company Website\\]': vars.companyWebsite || ''
  };
  Object.keys(replacements).forEach((pat) => {
    out = out.replace(new RegExp(pat, 'gi'), replacements[pat]);
  });
  return out;
};

// Research Type options - these drive two genuinely different behaviors,
// not just a text label passed to one generic prompt:
//   - 'search' types (Customer/Supplier Research) look up real businesses
//     via Google Business Search and return a results table you can save,
//     enrich, and outreach to.
//   - 'report' types generate a written, AI-structured document (each with
//     its own section structure - see RESEARCH_TYPE_STRUCTURES in app.py).
const RESEARCH_TYPE_OPTIONS = [
  { value: 'Customer Research', kind: 'search', description: 'Finds real prospect businesses matching your product and region, as a table you can save and reach out to.' },
  { value: 'Supplier Research', kind: 'search', description: 'Finds real supplier/vendor businesses matching your criteria, as a table you can save and send RFQs to.' },
  { value: 'Detailed PRD', kind: 'report', description: 'A formal PRD: problem statement, goals, personas, functional & non-functional requirements.' },
  { value: 'Product Requirements', kind: 'report', description: 'A lighter product brief: prioritized features, user stories, dependencies, acceptance criteria.' },
  { value: 'Industry Use Cases', kind: 'report', description: 'A survey of how this industry uses solutions like this today, with real-world examples and emerging trends.' },
  { value: 'Competitive Research', kind: 'report', description: 'A competitor landscape: feature & pricing comparison, differentiation gaps, SWOT, positioning.' },
];

function RequirementsGathering() {
  // Workflow context - for loading/saving workflow data
  const { isInWorkflow, isHistoryView, stageData, context: workflowContext, saveStageData } = useWorkflowContext();

  // Track if initial load is done (don't save during initial load or mode transitions)
  const isInitialLoadRef = React.useRef(true);

  const [overview, setOverview] = useState('');
  const [context, setContext] = useState('');
  const [countries, setCountries] = useState('');
  const [industries, setIndustries] = useState('');

  const { prefill, dismiss: dismissPrefill } = usePendingAgentPrefill('marketResearch', (fields) => {
    if (isHistoryView) return; // don't build phantom state while viewing a read-only past workflow stage
    fields.forEach((f) => {
      if (f.field_key === 'overview') setOverview(f.field_value);
      if (f.field_key === 'industries') setIndustries(f.field_value);
      if (f.field_key === 'countries') setCountries(f.field_value);
    });
  });
  const [businessFunctions, setBusinessFunctions] = useState('');
  const [analysisFrameworks, setAnalysisFrameworks] = useState('');
  const [responseFormat, setResponseFormat] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [aiRequirements, setAiRequirements] = useState([]);
  const [previousPrompts, setPreviousPrompts] = useState([]);
  const [showPromptsPopup, setShowPromptsPopup] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [googleBusinessConnected, setGoogleBusinessConnected] = useState(false);
  // Note: These are initialized to null/false and loaded by useEffect based on mode
  const [customerResearchResults, setCustomerResearchResults] = useState(null);
  const [showCustomerResearchTable, setShowCustomerResearchTable] = useState(false);
  const [minimizedCustomerResearch, setMinimizedCustomerResearch] = useState(false);

  // Email Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState({});
  const [selectedLead, setSelectedLead] = useState(null);
  const [useAiBulk, setUseAiBulk] = useState(false);
  const [existingCampaigns, setExistingCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAddingNewCampaign, setIsAddingNewCampaign] = useState(false);
  const [emailImages, setEmailImages] = useState([]);

  // Save market research data to local storage
  // Only save after initial load is complete
  useEffect(() => {
    if (isInitialLoadRef.current) return;

    if (customerResearchResults !== null) {
      setAgentData(AGENT_KEYS.MARKET_RESEARCH, {
        results: customerResearchResults,
        showTable: showCustomerResearchTable,
        minimized: minimizedCustomerResearch,
        overview,
        industries,
        countries,
        responseFormat,
      });
    }
  }, [customerResearchResults, showCustomerResearchTable, minimizedCustomerResearch, overview, industries, countries, responseFormat]);

  // Load saved data on mount
  useEffect(() => {
    const savedData = getAgentData(AGENT_KEYS.MARKET_RESEARCH);

    if (savedData?.results) {
      setCustomerResearchResults(savedData.results);
      setShowCustomerResearchTable(savedData.showTable || false);
      setMinimizedCustomerResearch(savedData.minimized || false);
      if (savedData.overview) setOverview(savedData.overview);
      if (savedData.industries) setIndustries(savedData.industries);
      if (savedData.countries) setCountries(savedData.countries);
      if (savedData.responseFormat) setResponseFormat(savedData.responseFormat);
    }

    // Mark initial load as complete after state updates
    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 100);
  }, []);

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    // Use stageData first, fall back to workflowContext for older workflows
    const data = (stageData && Object.keys(stageData).length > 0) ? stageData : workflowContext;
    const hasData = data && Object.keys(data).length > 0;

    console.log('[RequirementsGathering] Loading workflow history:', {
      isHistoryView,
      stageData,
      workflowContext,
      usingData: hasData ? data : 'none',
    });

    if (!hasData) return;

    // Pre-fill inputs from data (what was saved when stage completed)
    if (data.search_query) setOverview(data.search_query);
    if (data.location) setCountries(data.location);
    if (data.industry) setIndustries(data.industry);
    if (data.component_type) setResponseFormat(data.component_type);

    // If there are saved results, show them
    if (data.businesses_found || data.top_businesses) {
      setCustomerResearchResults({
        query: data.search_query || '',
        location: data.location || '',
        industry: data.industry || '',
        totalResults: data.businesses_found || 0,
        businesses: data.top_businesses?.map((name, i) => ({
          name,
          index: i,
        })) || [],
      });
      setShowCustomerResearchTable(true);
    }
  }, [isHistoryView, stageData, workflowContext]);

  // Fetch existing campaigns when email modal opens
  useEffect(() => {
    if (showEmailModal && !selectedLead) {
      fetchExistingCampaigns();
    }
  }, [showEmailModal]);

  const fetchExistingCampaigns = async () => {
    try {
      const resp = await fetch(`${API_CONFIG.GET_CAMPAIGNS}?username=${encodeURIComponent(getCurrentUsername())}`, {
        method: 'GET',
        headers: authOptionalHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.campaigns) {
          setExistingCampaigns(data.campaigns);
        }
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
    }
  };

  const handleCampaignSelect = async (campaignId) => {
    if (campaignId === 'new') {
      setIsAddingNewCampaign(true);
      setSelectedCampaignId('');
      setCampaignName('');
      setEmailSubject('');
    } else {
      setIsAddingNewCampaign(false);
      const campaign = existingCampaigns.find(c => c.id === campaignId);
      if (campaign) {
        setSelectedCampaignId(campaignId);
        setCampaignName(campaign.name);
        setEmailSubject(campaign.subject || '');
      }
    }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setEmailImages(prev => [...prev, {
          name: file.name,
          data: event.target?.result
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeEmailImage = (index) => {
    setEmailImages(prev => prev.filter((_, i) => i !== index));
  };

  const insertImageIntoBody = (index) => {
    if (emailImages[index]) {
      const imageMarkdown = `\n<img src="${emailImages[index].data}" alt="${emailImages[index].name}" style="max-width: 100%; height: auto; border-radius: 4px;" />\n`;
      setEmailBody(prev => prev + imageMarkdown);
    }
  };

  const [isLoadingResearch, setIsLoadingResearch] = useState(false);
  // Rotating status text for the research-loader below - the real scrape+
  // analyze job genuinely takes a while, and a single static line the whole
  // time reads as stuck. Purely cosmetic (not tied to real progress), so it
  // resets and cycles independently of how long the actual request takes.
  const RESEARCH_LOADING_STEPS = [
    'Searching directories...',
    'Extracting business details...',
    'Verifying contact info...',
    'Ranking by relevance...',
  ];
  const [researchLoadingStep, setResearchLoadingStep] = useState(0);
  useEffect(() => {
    if (!isLoadingResearch) { setResearchLoadingStep(0); return; }
    const interval = setInterval(() => {
      setResearchLoadingStep((i) => (i + 1) % RESEARCH_LOADING_STEPS.length);
    }, 2200);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingResearch]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [extractingEmailRows, setExtractingEmailRows] = useState({})
  const [extractingLinkedInRows, setExtractingLinkedInRows] = useState({});
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSaveListModal, setShowSaveListModal] = useState(false);
  const [saveListName, setSaveListName] = useState('');
  const [saveListMode, setSaveListMode] = useState('create');
  const [selectedAppendProjectId, setSelectedAppendProjectId] = useState('');
  const [isSavingList, setIsSavingList] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [scoreQueryText, setScoreQueryText] = useState('');
  const [isScoring, setIsScoring] = useState(false);
  const [showSavedListsView, setShowSavedListsView] = useState(false);
  const [savedLists, setSavedLists] = useState([]);
  const [isLoadingSavedLists, setIsLoadingSavedLists] = useState(false);
  const [activeSavedList, setActiveSavedList] = useState(null);
  const [activeSavedListLeads, setActiveSavedListLeads] = useState([]);
  const [deletingListId, setDeletingListId] = useState(null);

  const [extractionUsage, setExtractionUsage] = useState(null);
  const [googleBusinessForm, setGoogleBusinessForm] = useState({
    clientId: '',
    redirectUri: '',
    hasCredentials: false
  });

  const getCurrentUsername = () => {
    return localStorage.getItem('username') || localStorage.getItem('firstName') || 'anonymous';
  };
  const getCurrentUserEmail = () => {
    return localStorage.getItem('userEmail') || '';
  };

  const getResearchEntityMeta = () => {
    const mode = customerResearchResults?.researchType || activeSavedList?.researchType || responseFormat;
    return mode === 'Supplier Research'
      ? { singular: 'vendor', plural: 'vendors', title: 'Vendors' }
      : { singular: 'lead', plural: 'leads', title: 'Leads' };
  };

  // Check URL params for tab and Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Handle tab param from Campaign Dashboard navigation
    if (params.get('tab') === 'saved') {
      setShowSavedListsView(true);
      fetchSavedLists();
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (params.get('google_connected') === 'true') {
      setGoogleBusinessConnected(true);
      showToast('Google Business Account connected successfully!', 'success');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Fetch pre-configured Google credentials from .env
    const fetchCredentials = async () => {
      try {
        const response = await fetch(API_CONFIG.GET_GOOGLE_CREDENTIALS, { headers: authOptionalHeaders() });
        const data = await response.json();
        
        if (data.success && data.credentials) {
          setGoogleBusinessForm({
            clientId: data.credentials.clientId || '',
            redirectUri: data.credentials.redirectUri || '',
            hasCredentials: data.credentials.hasCredentials || false
          });
          
          // If credentials are configured in .env, mark as connected
          if (data.credentials.hasCredentials) {
            setGoogleBusinessConnected(true);
          }
        }
      } catch (error) {
        console.error('Error fetching credentials:', error);
      }
    };
    
    fetchCredentials();

    const fetchEmailUsage = async () => {
      try {
        const username = getCurrentUsername();
        const response = await fetch(`${API_CONFIG.EMAIL_EXTRACTION_USAGE}?username=${encodeURIComponent(username)}`, { headers: authOptionalHeaders() });

        const data = await response.json();
        if (response.ok && data.success && data.usageSummary) {
          setExtractionUsage(data.usageSummary);
        }
      } catch (error) {
        console.error('Error fetching email extraction usage:', error);
      }
    };

    fetchEmailUsage();
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    setUploadedFile(file);
    console.log('Uploaded file:', file);
  };

  const handleGenerateAnalysisFrameworks = (e) => {
    setAnalysisFrameworks(e.target.value);
  };

  // Wipes every piece of state a previous research run could have left behind,
  // regardless of which research type produced it, so a new run (or a type switch)
  // never renders alongside stale results.
  const clearResearchResults = () => {
    setCustomerResearchResults(null);
    setAiRequirements([]);
    setShowCustomerResearchTable(false);
    setMinimizedCustomerResearch(false);
    setActiveSavedList(null);
    setActiveSavedListLeads([]);
    setShowSavedListsView(false);
  };

  const handleGenerate = async () => {
    try {
      if (!responseFormat) {
        showToast('Please select a Research Type first', 'warning');
        return;
      }

      // Check if Customer Research or Supplier Research format is selected
      if (responseFormat === 'Customer Research' || responseFormat === 'Supplier Research') {
        // Allow customer research even when OAuth is not connected.
        // Backend can run this flow via Google Places API key.

        // Validate required inputs for research
        if (!overview || !industries || !countries) {
          showToast('Please fill in Overview, Industries, and Region/Countries for research', 'warning');
          return;
        }

        // A search result should never render alongside a leftover result of any kind.
        clearResearchResults();

        setIsLoadingResearch(true);

        // Call the search-google-businesses API
        const searchResponse = await fetch(API_CONFIG.SEARCH_GOOGLE_BUSINESSES, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            query: overview, // Use overview as the search query
            location: countries, // Use countries as location
            page_size: 200 // Get 200 matching businesses
          }),
        });

        if (!searchResponse.ok) {
          const errorData = await searchResponse.json();
          const errorMessage = errorData.error || 'Failed to fetch research data';
          console.error('Search API error:', errorData);
          throw new Error(errorMessage);
        }

        const searchData = await searchResponse.json();

        if (!searchData.success) {
          showToast(`Error: ${searchData.error}`, 'error');
          setIsLoadingResearch(false);
          return;
        }

        // Store results and show table
        const liveResults = {
          query: overview,
          location: countries,
          industry: industries,
          context: context,
          researchType: responseFormat,
          businesses: searchData.businesses || [],
          totalResults: searchData.totalResults || 0
        };
        setCustomerResearchResults(liveResults);
        setShowCustomerResearchTable(true);
        setIsLoadingResearch(false);
        notifyAgentCompleted('marketResearch', `Found ${liveResults.businesses.length} results${industries ? ` in ${industries}` : ''}`, [
          { field_key: 'subject', field_value: `Quick question for {{company}}` },
          { field_key: 'body', field_value: `Hi {{company}} team,\n\nWe recently researched ${industries || 'your industry'}${countries ? ` in ${countries}` : ''} and came across ${liveResults.businesses.length} companies worth reaching out to - yours included.\n\n[Add a line here about what you offer and why it's relevant to them.]\n\nWould you be open to a quick call this week to explore if there's a fit?\n\nBest,\n[Your name]` },
        ]);

        // Save to workflow if in workflow context
        if (isInWorkflow) {
          saveStageData({
            client_name: overview,
            component_type: responseFormat,
            search_query: overview,
            location: countries,
            industry: industries,
            businesses_found: liveResults.totalResults,
            top_businesses: (searchData.businesses || []).slice(0, 5).map(b => b.name),
          });
        }
        return;
      }

      // Original behavior for other response formats
      // A report should never render alongside a leftover result of any kind.
      clearResearchResults();
      setIsLoadingResearch(true);
      const googleData = await fetchGoogleBusinessData();

      const payload = {
        overview,
        context,
        countries,
        industries,
        businessFunctions,
        analysisFrameworks,
        responseFormat,
        googleBusinessData: googleData,
      };

      const response = await fetch(API_CONFIG.GENERATE_REQUIREMENTS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to generate requirements');
      }

      const data = await response.json();
      setAiRequirements(data.requirements.split('\n'));
      setIsLoadingResearch(false);
    } catch (error) {
      console.error('Error generating requirements:', error);
      showToast('Error: ' + error.message, 'error');
      setIsLoadingResearch(false);
    }
  };

  



  const handleFetchPreviousPrompts = async () => {
    try {
      const response = await fetch(API_CONFIG.PREVIOUS_PROMPTS, {
        method: 'GET',
        headers: authOptionalHeaders(),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch previous prompts');
      }

      const data = await response.json();
      setPreviousPrompts(data.prompts);
      setShowPromptsPopup(true);
    } catch (error) {
      console.error('Error fetching previous prompts:', error);
    }
  };

  const handleGetEmails = async () => {
    if (!customerResearchResults || !customerResearchResults.businesses || customerResearchResults.businesses.length === 0) {
      const { plural } = getResearchEntityMeta();
      showToast(`No ${plural} to enrich with emails`, 'warning');
      return;
    }

    setIsLoadingEmails(true);

    try {
      const response = await fetch(API_CONFIG.ENRICH_BUSINESSES_WITH_EMAILS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          businesses: customerResearchResults.businesses,
          username: getCurrentUsername()
        }),
      });

      if (!response.ok) {
        // A gateway timeout (or any proxy-level failure) returns an HTML
        // error page, not JSON - parsing that as JSON throws a confusing
        // raw SyntaxError instead of telling the user what happened.
        if (response.status === 504) {
          throw new Error('This is taking longer than expected. Click Extract Emails again in a moment - already-found emails are kept, so it will pick up where it left off.');
        }
        let errorMessage = 'Failed to enrich businesses with emails';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          // Non-JSON error body (e.g. an HTML error page) - keep the generic message.
        }
        throw new Error(errorMessage);
      }

      const enrichedData = await response.json();
      if (enrichedData.usageSummary) {
        setExtractionUsage(enrichedData.usageSummary);
      }

      if (enrichedData.success && enrichedData.businesses) {
        // Update the research results with enriched businesses
        setCustomerResearchResults({
          ...customerResearchResults,
          businesses: enrichedData.businesses
        });
        const usageLine = enrichedData.usageSummary
          ? ` (Used: ${enrichedData.usageSummary.usedCount}/${enrichedData.usageSummary.totalAllowed})`
          : '';
        if (enrichedData.remainingUnenrichedCount > 0) {
          showToast(`Enriched ${enrichedData.newlyProcessedCount} more businesses.${usageLine} ${enrichedData.remainingUnenrichedCount} still need emails - click Extract Emails again to continue.`, 'info');
        } else {
          showToast(`Successfully enriched ${enrichedData.enrichedCount} businesses with email data!${usageLine}`, 'success');
        }
      } else {
        showToast('Failed to enrich businesses with emails', 'error');
      }
    } catch (error) {
      console.error('Error getting emails:', error);
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      setIsLoadingEmails(false);
    }
  };

  const handleExtractLinkedInForBusiness = async (business, index) => {
    if (!business) return;

    setExtractingLinkedInRows((prev) => ({ ...prev, [index]: true }));
    console.log(`[LINKEDIN_EXTRACTION] Starting extraction for ${business.name}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[LINKEDIN_EXTRACTION] Request timeout after 30s');
        controller.abort();
      }, 30000); // 30 second timeout

      console.log(`[LINKEDIN_EXTRACTION] Calling ${API_CONFIG.ENRICH_BUSINESSES_WITH_LINKEDIN}`);

      const response = await fetch(API_CONFIG.ENRICH_BUSINESSES_WITH_LINKEDIN, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ businesses: [business], username: getCurrentUsername() }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log(`[LINKEDIN_EXTRACTION] Response status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `HTTP ${response.status}`;
        console.error(`[LINKEDIN_EXTRACTION] API Error: ${errorMsg}`);
        throw new Error(`Failed to extract LinkedIn: ${errorMsg}`);
      }

      const data = await response.json();
      console.log('[LINKEDIN_EXTRACTION] Response received:', data);

      if (data.success && data.data && data.data.businesses && data.data.businesses.length > 0) {
        const enrichedBusiness = data.data.businesses[0];
        console.log(`[LINKEDIN_EXTRACTION] Extracted LinkedIn: ${enrichedBusiness.linkedin}`);
        
        // Update either saved list or customer research results
        if (activeSavedList && activeSavedListLeads.length > 0) {
          setActiveSavedListLeads(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], linkedin: enrichedBusiness.linkedin };
            return updated;
          });
          console.log('[LINKEDIN_EXTRACTION] Updated saved list leads');
        } else {
          setCustomerResearchResults(prev => {
            if (!prev) {
              console.warn('[LINKEDIN_EXTRACTION] No customer research results to update');
              return prev;
            }
            const updatedBusinesses = [...prev.businesses];
            updatedBusinesses[index] = { ...updatedBusinesses[index], linkedin: enrichedBusiness.linkedin };
            console.log('[LINKEDIN_EXTRACTION] Updated customer research results');
            return { ...prev, businesses: updatedBusinesses };
          });
        }
      } else {
        const errorMsg = data.error || 'No LinkedIn profile found.';
        console.warn(`[LINKEDIN_EXTRACTION] ${errorMsg}`);
        showToast(errorMsg, 'warning');
      }
    } catch (error) {
      console.error('[LINKEDIN_EXTRACTION] Error extracting LinkedIn:', error);
      console.error('[LINKEDIN_EXTRACTION] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      
      if (error.name === 'AbortError') {
        showToast('LinkedIn extraction timed out. Please try again.', 'error');
      } else {
        showToast('Error extracting LinkedIn. Please try again.', 'error');
      }
    } finally {
      setExtractingLinkedInRows((prev) => ({ ...prev, [index]: false }));
      console.log(`[LINKEDIN_EXTRACTION] Finished extraction for ${business.name}`);
    }
  };

  const handleExtractEmailForBusiness = async (business, index) => {
    if (!business || !business.website) {
      showToast('Website not available for this business.', 'warning');
      return;
    }

    setExtractingEmailRows((prev) => ({ ...prev, [index]: true }));
    console.log(`[EMAIL_EXTRACTION] Starting extraction for ${business.name}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[EMAIL_EXTRACTION] Request timeout after 30s');
        controller.abort();
      }, 30000); // 30 second timeout

      console.log(`[EMAIL_EXTRACTION] Calling ${API_CONFIG.ENRICH_BUSINESSES_WITH_EMAILS}`);
      
      const response = await fetch(API_CONFIG.ENRICH_BUSINESSES_WITH_EMAILS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          businesses: [business],
          username: getCurrentUsername()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[EMAIL_EXTRACTION] Response status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `HTTP ${response.status}`;
        console.error(`[EMAIL_EXTRACTION] API Error: ${errorMsg}`);
        throw new Error(`Failed to extract email: ${errorMsg}`);
      }

      const enrichedData = await response.json();
      console.log('[EMAIL_EXTRACTION] Response received:', enrichedData);
      
      if (enrichedData.usageSummary) {
        setExtractionUsage(enrichedData.usageSummary);
      }
      
      const enrichedBusiness = enrichedData?.businesses?.[0];

      if (!enrichedBusiness) {
        console.error('[EMAIL_EXTRACTION] No enriched business data in response');
        throw new Error('No enriched business data returned');
      }

      console.log(`[EMAIL_EXTRACTION] Extracted email: ${enrichedBusiness.email}`);

      // Update either customer research results or activated list
      if (activeSavedList && activeSavedListLeads.length > 0) {
        setActiveSavedListLeads((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            email: enrichedBusiness.email || 'N/A'
          };
          return updated;
        });
        console.log('[EMAIL_EXTRACTION] Updated saved list leads');
      } else {
        setCustomerResearchResults((prev) => {
          if (!prev || !prev.businesses) {
            console.warn('[EMAIL_EXTRACTION] No customer research results to update');
            return prev;
          }

          const updatedBusinesses = [...prev.businesses];
          updatedBusinesses[index] = {
            ...updatedBusinesses[index],
            email: enrichedBusiness.email || 'N/A'
          };

          console.log('[EMAIL_EXTRACTION] Updated customer research results');
          return {
            ...prev,
            businesses: updatedBusinesses
          };
        });
      }
    } catch (error) {
      console.error('[EMAIL_EXTRACTION] Error extracting email for business:', error);
      console.error('[EMAIL_EXTRACTION] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      
      if (error.name === 'AbortError') {
        showToast('Email extraction timed out. Please try again.', 'error');
      } else {
        showToast(`Error: ${error.message}`, 'error');
      }
    } finally {
      setExtractingEmailRows((prev) => ({ ...prev, [index]: false }));
      console.log(`[EMAIL_EXTRACTION] Finished extraction for ${business.name}`);
    }
  };

  const handleCopyToClipboard = () => {
    if (!customerResearchResults || !customerResearchResults.businesses || customerResearchResults.businesses.length === 0) {
      showToast('No data to copy.', 'warning');
      return;
    }

    try {
      // Create tab-separated values format for easy pasting into Excel
      const headers = ['Business Name', 'Address', 'Phone', 'Website', 'Email'];
      const rows = customerResearchResults.businesses.map(business => [
        business.name || 'N/A',
        business.address || 'N/A',
        (business.phone || 'N/A').replace(/^\+/, ''),
        business.website || 'N/A',
        business.email || 'N/A'
      ]);

      // Create TSV (tab-separated values) content
      const tsvContent = [
        headers.join('\t'),
        ...rows.map(row => row.join('\t'))
      ].join('\n');

      // Copy to clipboard
      navigator.clipboard.writeText(tsvContent).then(() => {
        showToast(`Successfully copied ${customerResearchResults.businesses.length} businesses to clipboard!`, 'success');
      }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy to clipboard', 'error');
      });
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      showToast('Failed to copy data to clipboard', 'error');
    }
  };

  const getCustomerResearchRows = () => {
    if (!customerResearchResults || !customerResearchResults.businesses || customerResearchResults.businesses.length === 0) {
      return [];
    }

    return customerResearchResults.businesses.map((business) => ({
      businessName: business.name || 'N/A',
      address: business.address || 'N/A',
      phone: business.phone || 'N/A',
      website: business.website || 'N/A',
      email: business.email || 'N/A',
      linkedin: business.linkedin || (business.linkedin_urls && business.linkedin_urls[0]) || 'N/A',
      summary: business.summary || business.description || 'N/A'
    }));
  };

  const downloadTextFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  const escapeCsvValue = (value) => {
    const safeValue = String(value ?? '');
    if (safeValue.includes('"') || safeValue.includes(',') || safeValue.includes('\n')) {
      return `"${safeValue.replace(/"/g, '""')}"`;
    }
    return safeValue;
  };

  const buildCsvContent = (rows) => {
    const headers = ['Business Name', 'Address', 'Phone', 'Website', 'Email', 'LinkedIn', 'Summary'];
    const csvRows = rows.map((row) => [
      row.businessName,
      row.address,
      row.phone,
      row.website,
      row.email,
      row.linkedin,
      row.summary
    ].map(escapeCsvValue).join(','));

    return [headers.join(','), ...csvRows].join('\n');
  };

  const handleSaveList = async () => {
    const rows = getCustomerResearchRows();
    if (rows.length === 0) {
      const { plural } = getResearchEntityMeta();
      showToast(`No ${plural} available to save.`, 'warning');
      return;
    }

    const payloadLeads = (customerResearchResults?.businesses || []).map((business) => ({
      name: business.name || 'N/A',
      website: business.website || '',
      phone: business.phone || 'N/A',
      address: business.address || 'N/A',
      email: business.email || 'N/A',
      linkedin: business.linkedin || 'N/A',
      linkedin_urls: business.linkedin ? [business.linkedin] : [],
      social_links: business.social_links || {},
      summary: business.summary || business.description || 'N/A',
      raw_data: business
    }));

    setIsSavingList(true);
    try {
      const isAppendMode = saveListMode === 'append';
      if (isAppendMode) {
        if (!selectedAppendProjectId) {
          showToast('Please select a list to append to.', 'warning');
          setIsSavingList(false);
          return;
        }

        const response = await fetch(API_CONFIG.APPEND_PROJECT, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            username: getCurrentUsername(),
            projectId: selectedAppendProjectId,
            businesses: payloadLeads
          })
        });

        const data = await response.json();
        if (data.success) {
          showToast(data.message || 'Leads appended successfully!', 'success');
          setShowSaveListModal(false);
          setSaveListName('');
          setSaveListMode('create');
          setSelectedAppendProjectId('');
          await fetchSavedLists();
          if (activeSavedList && Number(activeSavedList.id) === Number(selectedAppendProjectId)) {
            await loadSavedListDetails(selectedAppendProjectId);
          }
        } else {
          showToast('Error appending list: ' + (data.error || 'Unknown error'), 'error');
        }
      } else {
        if (!saveListName.trim()) {
          showToast('Please provide a name for the list.', 'warning');
          return;
        }

        const response = await fetch(API_CONFIG.SAVE_PROJECT, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            username: getCurrentUsername(),
            name: saveListName,
            query: customerResearchResults?.query || '',
            query_used: customerResearchResults?.query || '',
            businesses: payloadLeads
          })
        });
        const data = await response.json();
        console.log('Save project response:', data);
        if (data.success) {
          const { title } = getResearchEntityMeta();
          showToast(`${title} list saved successfully!`, 'success');
          console.log('Refreshing saved lists...');
          await fetchSavedLists();
          setShowSaveListModal(false);
          setSaveListName('');
          setSaveListMode('create');
          setSelectedAppendProjectId('');
        } else {
          console.error('Error saving list:', data.error);
          showToast('Error saving list: ' + data.error, 'error');
        }
      }
    } catch (e) {
      console.error('Exception while saving:', e);
      showToast('An error occurred while saving the list: ' + e.message, 'error');
    }
    setIsSavingList(false);
  };

  const handleScoreLeads = async () => {
    const text = (scoreQueryText || '').trim();
    if (!text) {
      showToast('Please provide a short description of what you want to match for.', 'warning');
      return;
    }

    const isSavedListContext = activeSavedList && activeSavedListLeads && activeSavedListLeads.length > 0;

    // Gather businesses from current view (saved list or live research)
    const sourceBusinesses = (activeSavedList && activeSavedListLeads && activeSavedListLeads.length) ? activeSavedListLeads : (customerResearchResults?.businesses || []);
    if (!sourceBusinesses || sourceBusinesses.length === 0) {
      const { plural } = getResearchEntityMeta();
      showToast(`No ${plural} available to score.`, 'warning');
      return;
    }

    setIsScoring(true);
    try {
      const payload = sourceBusinesses.map(b => ({
        name: b.name || '',
        website: b.website || '',
        phone: b.phone || '',
        address: b.address || '',
        summary: b.summary || b.description || '',
        raw_data: b.raw_data || b
      }));

      const response = await fetch(API_CONFIG.SCORE_LEADS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ username: getCurrentUsername(), requirement: text, businesses: payload })
      });
      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        console.error('[ScoreLeads] failed to parse JSON response', parseErr);
        showToast('Scoring failed: invalid JSON response from server', 'error');
        setIsScoring(false);
        return;
      }
      
      if (data.success && Array.isArray(data.results)) {
        // Map results back into UI, attach scores/summaries, then sort descending by match_score
        const results = data.results;
        const resultsByIndex = new Map(results.map((item) => [Number(item.index), item]));

        // Pair results with the current sourceBusinesses using the stable backend index
        const paired = sourceBusinesses.map((b, i) => {
          const scored = resultsByIndex.get(i) || {};
          return {
            ...(b || {}),
            match_score: scored.match_score ?? null,
            short_summary: scored.short_summary ?? b.short_summary
          };
        });

        // Sort descending: highest match_score first (null/undefined treated as -1)
        const sorted = paired.slice().sort((a, b) => ( (b.match_score != null ? b.match_score : -1) - (a.match_score != null ? a.match_score : -1) ));

        // Apply to saved-list context or research view accordingly
        if (isSavedListContext) {
          setActiveSavedListLeads(sorted);
        }

        if (customerResearchResults) {
          const newCR = { ...customerResearchResults, businesses: sorted };
          setCustomerResearchResults(newCR);
          try { sessionStorage.setItem('customerResearchResults', JSON.stringify(newCR)); } catch (e) { /* ignore */ }
        }

        if (!isSavedListContext) {
          setShowCustomerResearchTable(true);
          setMinimizedCustomerResearch(false);
        }

        const { plural } = getResearchEntityMeta();
        showToast(`Scoring complete: updated ${results.length} ${plural} (sorted by score)`, 'success');
        setShowScoreModal(false);
        setScoreQueryText('');
      } else {
        showToast('Scoring failed: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('An error occurred while scoring leads: ' + e.message, 'error');
    }
    setIsScoring(false);
  };

  const handleDeleteSavedList = async (projectId) => {
    const confirmed = await showConfirm({
      title: STRINGS.DIALOGS.DELETE_LIST_TITLE,
      message: STRINGS.DIALOGS.DELETE_LIST_CONFIRM,
      confirmLabel: STRINGS.COMMON.DELETE,
      variant: 'danger'
    });
    if (!confirmed) return;

    setDeletingListId(projectId);
    try {
      const response = await fetch(`${API_CONFIG.DELETE_SAVED_PROJECT}/${projectId}?username=${encodeURIComponent(getCurrentUsername())}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });

      const data = await response.json();
      if (data.success) {
        showToast(data.message || 'Saved list deleted successfully.', 'success');
        if (activeSavedList && Number(activeSavedList.id) === Number(projectId)) {
          setActiveSavedList(null);
          setActiveSavedListLeads([]);
        }
        await fetchSavedLists();
      } else {
        showToast('Error deleting list: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error deleting saved list:', error);
      showToast('An error occurred while deleting the list: ' + error.message, 'error');
    } finally {
      setDeletingListId(null);
    }
  };

  const fetchSavedLists = async () => {
     setIsLoadingSavedLists(true);

     try {
       const userIdentifier = getCurrentUsername();
       const res = await fetch(`${API_CONFIG.GET_SAVED_PROJECTS}?username=${encodeURIComponent(userIdentifier)}`, {
        headers: authOptionalHeaders(),
       });
       const data = await res.json();
       console.log('Fetched saved lists response:', data);
       if (data.success) {
          setSavedLists(data.projects || []);
       } else {
          console.error("Error fetching saved lists:", data.error);
          setSavedLists([]);
       }
     } catch (e) {
       console.error("Error fetching saved lists", e);
       setSavedLists([]);
     }
     setIsLoadingSavedLists(false);
  };

  useEffect(() => {
    if (showSaveListModal && savedLists.length === 0) {
      fetchSavedLists();
    }
  }, [showSaveListModal]);

  const loadSavedListDetails = async (projectId) => {
     try {
        const userIdentifier = getCurrentUsername();
        const res = await fetch(`${API_CONFIG.GET_SAVED_PROJECT_LEADS}/${projectId}/leads?username=${encodeURIComponent(userIdentifier)}`, {
          headers: authOptionalHeaders(),
        });
        const data = await res.json();
        if (data.success) {
           const leads = data.leads.map(l => ({
            name: l.name,
            website: l.website,
            phone: l.phone,
            address: l.address,
            email: Array.isArray(l.emails) ? (l.emails[0] || 'N/A') : (l.emails || 'N/A'),
            emails: l.emails,
            linkedin: Array.isArray(l.linkedin_urls) ? (l.linkedin_urls[0] || '') : (l.linkedin_urls || ''),
            linkedin_urls: l.linkedin_urls,
            social_links: l.social_links,
            summary: l.summary || l.description || 'N/A',
            has_extracted: l.has_extracted
           }));

           // Set customer research results to display in regular leads view
           setCustomerResearchResults({
             query: data.project.query_used || data.project.name,
             researchType: data.project.researchType || 'Customer Research',
             businesses: leads
           });
           try {
             sessionStorage.setItem('customerResearchResults', JSON.stringify({
               query: data.project.query_used || data.project.name,
               researchType: data.project.researchType || 'Customer Research',
               businesses: leads
             }));
           } catch (e) { /* ignore */ }

           // Store saved list info for context
           setActiveSavedList(data.project);
           setActiveSavedListLeads(leads);

           // Switch to leads view (not saved lists view)
           setShowSavedListsView(false);
           setShowCustomerResearchTable(true);
           setMinimizedCustomerResearch(false);
        }
     } catch(e) {
        console.error(e);
     }
  };

  const handleExport = async (format) => {
    const rows = getCustomerResearchRows();
    if (rows.length === 0) {
      showToast('No data available to export.', 'warning');
      return;
    }

    const fileBaseName = `market_research_${new Date().toISOString().slice(0, 10)}`;
    const csvContent = buildCsvContent(rows);

    try {
      if (format === 'excel') {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Market Research');
        XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
      }

      if (format === 'csv') {
        downloadTextFile(`${fileBaseName}.csv`, csvContent, 'text/csv;charset=utf-8;');
      }

      if (format === 'json') {
        downloadTextFile(`${fileBaseName}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8;');
      }

      if (format === 'pdf') {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        doc.setFontSize(12);
        doc.text('Market Research Export', 40, 36);

        autoTable(doc, {
          startY: 50,
          head: [['Business Name', 'Address', 'Phone', 'Website', 'Email', 'LinkedIn', 'Summary']],
          body: rows.map((row) => [
            row.businessName,
            row.address,
            row.phone,
            row.website,
            row.email,
            row.linkedin,
            row.summary
          ]),
          styles: { fontSize: 8, cellPadding: 4 },
          headStyles: { fillColor: [30, 58, 95] }
        });

        doc.save(`${fileBaseName}.pdf`);
      }

      if (format === 'sheets') {
        const headers = ['Business Name', 'Address', 'Phone', 'Website', 'Email'];
        const matrixRows = rows.map((row) => [
          row.businessName,
          row.address,
          row.phone,
          row.website,
          row.email
        ]);

        const toSheetsSafeValue = (value) => {
          const strValue = String(value ?? '');
          return /^[=+\-@]/.test(strValue) ? `'${strValue}` : strValue;
        };

        const tsvContent = [
          headers.join('\t'),
          ...matrixRows.map((row) => row.map(toSheetsSafeValue).join('\t'))
        ].join('\n');

        await navigator.clipboard.writeText(tsvContent);
        window.open('https://docs.google.com/spreadsheets/create', '_blank', 'noopener,noreferrer');
        showToast('Google Sheets opened. Data is copied to clipboard, paste with Ctrl+V.', 'info');
      }
    } catch (error) {
      console.error('Export failed:', error);
      showToast('Export failed. Please try again.', 'error');
    } finally {
      setShowExportModal(false);
    }
  };

  const closePopup = () => {
    setShowPopup(false);
  };

  const handleGoogleBusinessInputChange = (e) => {
    const { name, value } = e.target;
    setGoogleBusinessForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleGoogleBusinessConnect = async () => {
    // Check if server has credentials configured
    if (!googleBusinessForm.hasCredentials && !googleBusinessForm.clientId) {
      showToast('Google credentials not configured. Contact administrator.', 'warning');
      return;
    }

    try {
      // Server uses its own credentials from .env - don't send secrets from frontend
      const response = await fetch(API_CONFIG.CONNECT_GOOGLE_BUSINESS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          clientId: googleBusinessForm.clientId,
          redirectUri: googleBusinessForm.redirectUri
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.authUrl) {
        // Open Google authorization URL in new window
        setShowIntegrationModal(false);
        window.open(data.authUrl, 'google_auth', 'width=500,height=600');

        // After user authorizes, the app will redirect to localhost:3000?google_connected=true
        // We'll handle that with a URL parameter check in useEffect
      } else {
        showToast(data.error || 'Failed to generate authorization URL', 'error');
      }
    } catch (error) {
      console.error('Error connecting Google Business:', error);
      showToast('Error connecting to Google Business', 'error');
    }
  };

  const fetchGoogleBusinessData = async () => {
    try {
      const response = await fetch(API_CONFIG.GET_GOOGLE_BUSINESS_DATA, {
        method: 'GET',
        headers: authOptionalHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        return data;
      } else {
        console.log('Google Business not connected or data unavailable');
        return null;
      }
    } catch (error) {
      console.error('Error fetching Google Business data:', error);
        return null;
      }
    };

    const handleGeneratePersonalizedEmail = async (business, index) => {
    setIsGeneratingEmail(prev => ({ ...prev, [index]: true }));
    try {
      if (responseFormat === 'Supplier Research') {
        prepareSupplierEmailDraft(business);
        setShowEmailModal(true);
        return;
      }

      const response = await fetch(API_CONFIG.GENERATE_EMAIL, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          business: business,
          sender_name: getCurrentUsername()
        })
      });
      const data = await response.json();
      if (response.ok && data.subject && data.body) {
        setEmailSubject(data.subject);
        setEmailBody(data.body);
        setCampaignName('Personalized: ' + (business.name || 'Company'));
        setSelectedLead(business);
        setShowEmailModal(true);
      } else {
        showToast('Failed to generate personalized email.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error generating email.', 'error');
    } finally {
      setIsGeneratingEmail(prev => ({ ...prev, [index]: false }));
    }
  };

  const getSenderCompanyData = useCallback(() => {
    return {
      companyName: localStorage.getItem('companyName') || localStorage.getItem('company') || '',
      companyWebsite: localStorage.getItem('companyWebsite') || '',
      industry: localStorage.getItem('companyIndustry') || industries || '',
      location: localStorage.getItem('companyLocation') || countries || '',
      contactName: getCurrentUsername() || localStorage.getItem('firstName') || '',
      phoneNumber: localStorage.getItem('phoneNumber') || '',
      emailAddress: getCurrentUserEmail() || localStorage.getItem('userEmail') || ''
    };
  }, [countries, industries]);

  const prepareSupplierEmailDraft = (business = null) => {
    const vars = getSenderCompanyData();
    vars.productCategory = industries || overview || '';
    vars.vendorName = business?.name || business?.businessName || 'Sir / Madam';

    setSelectedLead(business);
    setEmailSubject(`Supplier Inquiry${vars.productCategory ? ' - ' + vars.productCategory : ''}`);
    setEmailBody(fillTemplate(SUPPLIER_TEMPLATE, vars));
  };

  const handleSendEmails = async () => {
    if (!useAiBulk && (!emailSubject || !emailBody)) {
      showToast('Subject and Body required unless using AI Personalization', 'warning');
      return;
    }


    const registeredEmail = getCurrentUserEmail();
    if (!registeredEmail) {
      showToast('Registered email not found. Please log in again so the campaign can be sent from your account.', 'warning');
      return;
    }

    let validEmails = [];
    if (selectedLead) {
      validEmails = selectedLead.email && selectedLead.email !== 'N/A' && selectedLead.email.includes('@')
        ? [{ ...selectedLead }]
        : [];
    } else {
      validEmails = (customerResearchResults?.businesses || [])
        .filter(b => b)
        .map(b => ({
          ...b,
        }));
    }
    
    if (validEmails.length === 0) {
      showToast('No valid emails found to send to', 'warning');
      return;
    }

    setIsSendingEmails(true);
    try {
      const response = await fetch(API_CONFIG.SEND_BULK_EMAILS, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          userId: localStorage.getItem("firstName") || "",
          userEmail: registeredEmail,
          campaignName: campaignName || (selectedLead ? 'Test Outreach - 1-on-1' : 'Test Outreach - Bulk'),
          subject: emailSubject,
          body: emailBody,
          businesses: validEmails,
          use_ai_personalization: useAiBulk
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        showToast('Successfully sent ' + validEmails.length + ' emails!', 'success');
        setShowEmailModal(false);
        setEmailSubject('');
        setEmailBody('');
        setSelectedLead(null);
      } else {
        showToast('Error: ' + data.error, 'error');
      }
    } catch (e) {
      showToast('Error sending emails: ' + e.message, 'error');
    } finally {
      setIsSendingEmails(false);
    }
  };

    return (
    <div className="requirements-page">
      <div className="requirements-container">

        <div className="agent-page-header">
          <div className="agent-header-left">
            {!isInWorkflow && <BackButton />}
            <div className="agent-header-content">
              <div className="agent-title-row">
                <h1>Market Research</h1>
              </div>
              <p className="text-muted">
                Discover leads, competitors, and market opportunities for your product or service.
              </p>
            </div>
          </div>
          <div className="agent-header-right">
            <ProjectSelector agentKey="marketResearch" />
          </div>
        </div>

        <AgentOutcomesStrip
          items={[
            { iconSrc: '/assets/icons/search-analysis.png', title: 'Lead lists', description: 'Find prospects matched to your product and region.' },
            { iconSrc: '/assets/icons/bar-chart.png', title: 'Market analysis', description: 'Competitors, trends, and industry use cases.' },
            { iconSrc: '/assets/icons/document.png', title: 'Export formats', description: 'PRD, supplier research, competitive reports.' },
          ]}
        />

        <LiveModeHint
          requireProject
          message="Choose a project above, or create one with + New Project."
        />

        <AgentPrefillBanner
          prefill={prefill}
          onDismiss={dismissPrefill}
          labels={{ overview: 'Project context', industries: 'Industry', countries: 'Region' }}
        />

        <ProjectGate agentLabel="Market Research workspace">
        <WorkflowExecutionBanner />
        <div className="requirements-header-bar">
          <div className="header-bar-top">
            <div className="overview-title">
              <span>Research configuration</span>
            </div>
            <div className="integration-badge">
              <span className="dot"></span> 3rd-party integration ready
            </div>
          </div>
          <div className="header-bar-inputs">
            <div className="input-block flex-grow">
              <label>Project context & description</label>
              <input
                type="text"
                placeholder="What is the product or service you need research on?"
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                disabled={isHistoryView}
              />
            </div>
            <div className="input-block">
              <label>Industry</label>
              <input
                type="text"
                placeholder="e.g., Fintech"
                value={industries}
                onChange={(e) => setIndustries(e.target.value)}
                disabled={isHistoryView}
              />
            </div>
            <div className="input-block">
              <label>Region</label>
              <input
                type="text"
                placeholder="e.g., North America"
                value={countries}
                onChange={(e) => setCountries(e.target.value)}
                disabled={isHistoryView}
              />
            </div>
            <div className="input-block">
              <label>Research Type</label>
              <select
                value={responseFormat}
                onChange={(e) => {
                  setResponseFormat(e.target.value);
                  // Switching research type starts a clean results panel -
                  // a leads table from one type shouldn't linger under a report from another.
                  clearResearchResults();
                }}
                disabled={isHistoryView}
              >
                 <option value="">Select research type...</option>
                 {RESEARCH_TYPE_OPTIONS.map((opt) => (
                   <option key={opt.value} value={opt.value}>{opt.value}</option>
                 ))}
              </select>
            </div>
            <div className="input-block button-block">
              <input type="file" id="file-input" onChange={handleFileUpload} style={{ display: 'none' }} disabled={isHistoryView} />
              <button className="upload-btn" onClick={() => document.getElementById('file-input').click()} disabled={isHistoryView}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                {uploadedFile ? uploadedFile.name : 'Upload Ref'}
              </button>
            </div>
            <div className="input-block button-block">
              <button className="generate-req-btn" onClick={handleGenerate} disabled={isLoadingResearch || isHistoryView}>
                {isLoadingResearch ? (
                  <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                    <Spinner size="sm" color="white" /> Generating...
                  </span>
                ) : 'Get Research Insights'}
              </button>
            </div>
          </div>
          {responseFormat && (
            <p className="research-type-caption">
              <span className={`research-type-kind research-type-kind--${RESEARCH_TYPE_OPTIONS.find(o => o.value === responseFormat)?.kind}`}>
                {RESEARCH_TYPE_OPTIONS.find(o => o.value === responseFormat)?.kind === 'search' ? 'Finds real businesses' : 'Generates a written report'}
              </span>
              {' '}{RESEARCH_TYPE_OPTIONS.find(o => o.value === responseFormat)?.description}
            </p>
          )}
        </div>

        <div className="main-workspace-area">

          <div className="tabs-container">
            <div className="workspace-view-tabs module-tabs">
              <button
                type="button"
                className={`module-tab ${!showSavedListsView ? 'module-tab--active' : ''}`}
                onClick={() => {
                  setShowSavedListsView(false);
                  setActiveSavedList(null);
                  setActiveSavedListLeads([]);
                }}
              >
                {responseFormat === 'Supplier Research' ? 'All Vendors' : 'All Leads'}
              </button>
              <button
                type="button"
                className={`module-tab ${showSavedListsView ? 'module-tab--active' : ''}`}
                onClick={() => {
                  setShowSavedListsView(true);
                  fetchSavedLists();
                }}
              >
                {responseFormat === 'Supplier Research' ? 'Saved Vendors' : 'Saved Leads'}
              </button>
            </div>
            <a href="/market-research/campaigns" className="workspace-link">
              Campaign Dashboard →
            </a>
          </div>

          <div className="workspace-content-box workspace-content-box--flex">
             {showSavedListsView ? (
               <div className="saved-lists-container">
                 {activeSavedList && (
                    <button
                      type="button"
                      className="saved-lists-back-btn"
                      onClick={() => { setActiveSavedList(null); setActiveSavedListLeads([]); fetchSavedLists(); }}
                    >
                      Back to all lists
                    </button>
                 )}
                 {activeSavedList && (
                   <h2 className="saved-lists-detail-title">
                     {activeSavedList.name}
                   </h2>
                 )}
                 {isLoadingSavedLists ? (
                    <div className="saved-lists-loading"><Spinner size="sm" /> Loading lists...</div>
                 ) : !activeSavedList ? (
                    savedLists.length === 0 ? (
                      <div className="saved-lists-empty">No saved lists found.</div>
                    ) : (
                      <div className="saved-lists-table-scroll">
                        <table className="businesses-table saved-lists-table">
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left' }}>List Name</th>
                              <th style={{ textAlign: 'left' }}>Query</th>
                              <th style={{ textAlign: 'center' }}>Results</th>
                              <th style={{ textAlign: 'center' }}>Created</th>
                              <th style={{ textAlign: 'center' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {savedLists.map((list) => (
                              <tr key={list.id}>
                                <td>{list.name}</td>
                                <td>{list.query_used || 'N/A'}</td>
                                <td style={{ textAlign: 'center' }}>{list.lead_count}</td>
                                <td style={{ textAlign: 'center' }}>{list.created_at ? formatDate(list.created_at) : 'N/A'}</td>
                                <td>
                                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="btn-open-list"
                                      onClick={() => loadSavedListDetails(list.id)}
                                    >
                                      Open List
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSavedList(list.id)}
                                      disabled={deletingListId === list.id}
                                      className="btn-delete-list"
                                    >
                                      {deletingListId === list.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                 ) : (
                    <div className="saved-list-leads-scroll">
                      <table className="businesses-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th>Business Name</th>
                            <th>Address</th>
                            <th>Phone</th>
                            <th>Website</th>
                            <th>Email</th>
                            <th>LinkedIn</th>
                            <th>Send Email</th>
                            <th style={{ width: '120px' }}>Match</th>
                            <th>Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeSavedListLeads?.map((business, index) => (
                            <tr key={index}>
                              <td>{business.name || 'N/A'}</td>
                              <td>{business.address || 'N/A'}</td>
                              <td className="phone-cell">{business.phone || 'N/A'}</td>
                              <td>{business.website ? <a href={business.website} target="_blank" rel="noopener noreferrer">Visit</a> : 'N/A'}</td>
                              <td>{business.email && business.email !== 'N/A' ? <span>{business.email}</span> : <span className="text-na">N/A</span>}</td>
                              <td>{business.linkedin ? (business.linkedin !== 'N/A' ? <a href={business.linkedin} target="_blank" rel="noopener noreferrer" className="link-profile">View Profile</a> : <span className="text-na-italic">Not Found</span>) : <span className="text-na">N/A</span>}</td>
                              <td>{business.email && business.email !== 'N/A' ? <button onClick={() => handleGeneratePersonalizedEmail(business, index)} disabled={!!isGeneratingEmail[index]} className="table-btn-primary">{isGeneratingEmail[index] ? 'Drafting...' : 'Draft Email'}</button> : <span className="text-na">-</span>}</td>
                              <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                {business.match_score != null ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div className={`match-score ${business.match_score >= 70 ? 'match-score--high' : (business.match_score >= 40 ? 'match-score--medium' : 'match-score--low')}`}>{business.match_score}%</div>
                                  </div>
                                ) : <span className="text-na">-</span>}
                              </td>
                              <td style={{ maxWidth: '320px', whiteSpace: 'pre-line', lineHeight: '1.4' }} title={business.short_summary || business.summary || business.description || 'N/A'}>{business.short_summary || business.summary || business.description || 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                 )}
               </div>
            ) : (
            <div className="ai-assisted" style={{ background: 'transparent', boxShadow: 'none' }}>
              {isLoadingResearch ? (
                  <div className="research-loader">
                    <div className="research-loader-glow">
                      <Spinner size="lg" color="accent" />
                    </div>
                    <p className="research-loader-text">
                      Scraping and analyzing {getResearchEntityMeta().plural}...
                    </p>
                    <p className="research-loader-step">{RESEARCH_LOADING_STEPS[researchLoadingStep]}</p>
                  </div>
              ) : (!aiRequirements && !customerResearchResults) ? (
                <div className="awaiting-config">
                  <div className="awaiting-config-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                    </svg>
                  </div>
                  <h2>Awaiting Configuration</h2>
                  <p>
                    Refine the requirements in the bar above to generate structured architectural specifications. Our AI will analyze your context, industry, and region to produce a precise specification.
                  </p>
                  <div className="awaiting-config-badges">
                    <div className="awaiting-badge">READY TO ANALYZE</div>
                    <div className="awaiting-badge">SECURE END-TO-END</div>
                    <div className="awaiting-badge">ENTERPRISE LLM</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Show Customer Research Results */}
                  {customerResearchResults && (
                      <div className="minimized-customer-research-box">
                        <div className="research-summary-row minimized">
                          <div className="summary-badges">
                            {activeSavedList && (
                              <button 
                                onClick={() => { 
                                  setActiveSavedList(null); 
                                  setActiveSavedListLeads([]); 
                                  setShowSavedListsView(true); 
                                  setShowCustomerResearchTable(false);
                                }} 
                                style={{ marginRight: '12px', padding: '8px 16px', background: 'none', border: '1px solid var(--color-primary)', borderRadius: '5px', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600 }}
                              >
                                ← Back to Saved Lists
                              </button>
                            )}
                            <div className="summary-badge">
                              <span className="badge-label">Search</span>
                              <span className="badge-value">{customerResearchResults.query}</span>
                            </div>
                            <div className="summary-badge">
                              <span className="badge-label">Location</span>
                              <span className="badge-value">{customerResearchResults.location}</span>
                            </div>
                            <div className="summary-badge">
                              <span className="badge-label">Industry</span>
                              <span className="badge-value">{customerResearchResults.industry}</span>
                            </div>
                            <div className="summary-badge results-badge">
                              <span className="badge-label">Results</span>
                              <span className="badge-value">{customerResearchResults.totalResults}</span>
                            </div>
                          </div>
                          
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <div className="summary-badge emails-badge">
                                <span className="badge-label">Extracted</span>
                                <span className="badge-value">
                                  {customerResearchResults.businesses ? customerResearchResults.businesses.filter(b => b.email && b.email !== 'N/A').length : 0}/100
                                </span>
                              </div>
                              <button
                                className="get-emails-button compact"
                                onClick={handleGetEmails}
                                disabled={isLoadingEmails || isHistoryView}
                                style={{ margin: 0, padding: '8px 16px' }}
                              >
                                {isLoadingEmails ? (
                                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                    <Spinner size="sm" color="white" />
                                    Extracting...
                                  </span>
                                ) : 'Extract Emails'}
                              </button>
                              <button
                                className="action-icon-button"
                                onClick={handleCopyToClipboard}
                                title="Copy to Clipboard"
                                aria-label="Copy to Clipboard"
                              >
                                <img src="/assets/icons/copy.png" alt="Copy to Clipboard" />
                              </button>
                              <button
                                className="action-icon-button"
                                onClick={() => setShowExportModal(true)}
                                title="Export Data"
                                aria-label="Export Data"
                              >
                                <img src="/assets/icons/import-export.png" alt="Export Data" />
                              </button>
                              <button
                                className="action-icon-button"
                                onClick={() => {
                                  setSaveListMode('create');
                                  setSelectedAppendProjectId('');
                                  setShowSaveListModal(true);
                                }}
                                title={responseFormat === 'Supplier Research' ? 'Save Vendors List' : 'Save Leads List'}
                                aria-label={responseFormat === 'Supplier Research' ? 'Save Vendors List' : 'Save Leads List'}
                              >
                                <img src="/assets/icons/document.png" alt={responseFormat === 'Supplier Research' ? 'Save Vendors' : 'Save Leads'} />
                              </button>
                              <button
                                className="action-icon-button"
                                onClick={() => { setScoreQueryText(''); setShowScoreModal(true); }}
                                title={responseFormat === 'Supplier Research' ? 'Score Vendors' : 'Score Leads'}
                                aria-label={responseFormat === 'Supplier Research' ? 'Score Vendors' : 'Score Leads'}
                              >
                                <img src="/assets/icons/bar-chart.png" alt={responseFormat === 'Supplier Research' ? 'Score Vendors' : 'Score Leads'} />
                              </button>
                              <button
                                className="action-icon-button"
                                onClick={() => { prepareSupplierEmailDraft(null); setShowEmailModal(true); }}
                                title="Send Emails"
                                aria-label="Send Emails"
                                disabled={isHistoryView}
                              >
                                <img src="/assets/icons/mail.png" alt="Send Emails" />
                              </button>
                          </div>
                        </div>
                        <div className="minimized-content-scroll">
                          {customerResearchResults.businesses && customerResearchResults.businesses.length > 0 ? (
                            <div className="table-wrapper minimized-table-wrapper">
                              <table className="businesses-table">
                                <thead>
                                  <tr>
                                      <th>Business Name</th>
                                      <th>Address</th>
                                      <th>Phone</th>
                                      <th>Website</th>
                                      <th>Email</th>
                                      <th>LinkedIn</th>
                                      <th>Send Email</th>
                                      <th style={{ width: '120px' }}>Match</th>
                                      <th>Summary</th>
                                    </tr>
                                </thead>
                                <tbody>
                                  {customerResearchResults.businesses.map((business, index) => (
                                    <tr key={index}>
                                      <td>{business.name || 'N/A'}</td>
                                      <td>{business.address || 'N/A'}</td>
                                      <td className="phone-cell">{business.phone || 'N/A'}</td>
                                      <td>
                                        {business.website ? (
                                          <a href={business.website} target="_blank" rel="noopener noreferrer">
                                            Visit
                                          </a>
                                        ) : (
                                          'N/A'
                                        )}
                                      </td>
                                      <td>
                                        {business.email && business.email !== 'N/A' ? (
                                          <span>{business.email}</span>
                                        ) : (
                                          <button
                                            className="extract-email-button"
                                            onClick={() => handleExtractEmailForBusiness(business, index)}
                                            disabled={!!extractingEmailRows[index]}
                                          >
                                            {extractingEmailRows[index] ? 'Extracting...' : 'Extract Email'}
                                          </button>
                                        )}
                                      </td>
                                      <td>
                                        {business.linkedin ? (
                                          business.linkedin !== 'N/A' ? (
                                            <a href={business.linkedin} target="_blank" rel="noopener noreferrer" className="table-link">
                                              View Profile
                                            </a>
                                          ) : (
                                            <span className="table-na">Not Found</span>
                                          )
                                        ) : (
                                          <button
                                            className="table-btn-secondary"
                                            onClick={() => handleExtractLinkedInForBusiness(business, index)}
                                            disabled={!!extractingLinkedInRows[index]}
                                          >
                                            {extractingLinkedInRows[index] ? 'Extracting...' : 'Extract LinkedIn'}
                                          </button>
                                        )}
                                      </td>
                                      <td>
                                        {business.email && business.email !== 'N/A' ? (
                                          <button
                                            className="table-btn-primary"
                                            onClick={() => handleGeneratePersonalizedEmail(business, index)}
                                            disabled={!!isGeneratingEmail[index] || isHistoryView}
                                          >
                                            {isGeneratingEmail[index] ? 'Drafting...' : 'Draft Email'}
                                          </button>
                                        ) : (
                                          <span className="table-muted">-</span>
                                        )}
                                      </td>
                                      <td className="match-cell">
                                        {business.match_score != null ? (
                                          <span className={`match-score ${business.match_score >= 70 ? 'match-score--high' : business.match_score >= 40 ? 'match-score--medium' : 'match-score--low'}`}>
                                            {business.match_score}%
                                          </span>
                                        ) : <span className="table-muted">-</span>}
                                      </td>
                                      <td className="summary-cell" title={business.short_summary || business.summary || business.description || 'N/A'}>
                                        {business.short_summary || business.summary || business.description || 'N/A'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="no-results">No businesses found matching your search criteria.</div>
                          )}
                        </div>
                      </div>
                  )}

                  {/* Show AI Requirements */}
                  {aiRequirements.length > 0 && (
                    <div className="requirements-list-section">
                      <h3>Generated Requirements</h3>
                      <div className="requirements-markdown">
                        <ReactMarkdown>{aiRequirements.join('\n')}</ReactMarkdown>
                      </div>
                    </div>
                  )}

                  {aiRequirements.length === 0 && !customerResearchResults && (
                    <div className="empty-state-container">
                      <div className="empty-state-icon">
                        <img src="/assets/icons/search-analysis.png" alt="" width={48} height={48} />
                      </div>
                      <h3 className="empty-state-title">Ready to Research</h3>
                      <p className="empty-state-description">
                        {responseFormat
                          ? RESEARCH_TYPE_OPTIONS.find(o => o.value === responseFormat)?.description
                          : 'Describe your product or service, select an industry and region, then click "Get Research Insights" to discover leads, competitors, and market opportunities.'}
                      </p>
                      <div className="empty-state-steps">
                        <div className="empty-state-step">
                          <span className="step-number">1</span>
                          <span className="step-text">Enter project context</span>
                        </div>
                        <div className="empty-state-step">
                          <span className="step-number">2</span>
                          <span className="step-text">Select industry, region & research type</span>
                        </div>
                        <div className="empty-state-step">
                          <span className="step-number">3</span>
                          <span className="step-text">Get AI-powered insights</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          </div>

          <Modal
            open={showIntegrationModal}
            onClose={() => setShowIntegrationModal(false)}
            title={googleBusinessConnected ? 'Reconnect Google Business Account' : 'Connect Google Business Account'}
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowIntegrationModal(false)}>Cancel</Button>
                <button type="button" className="connect-submit-button" onClick={handleGoogleBusinessConnect}>Connect</button>
              </>
            }
          >
            <div className="integration-form">
              <div className="form-group">
                <label>Client ID</label>
                <input type="text" name="clientId" value={googleBusinessForm.clientId} onChange={handleGoogleBusinessInputChange} placeholder="Enter Client ID" />
              </div>
              <div className="form-group">
                <label>Redirect URI</label>
                <input type="text" name="redirectUri" value={googleBusinessForm.redirectUri} onChange={handleGoogleBusinessInputChange} placeholder="Enter Redirect URI" />
              </div>
            </div>
          </Modal>

          <Modal open={showPopup} onClose={closePopup} title="Export Options" footer={<Button variant="secondary" onClick={closePopup}>Close</Button>}>
            <div className="export-icons">
              <img src="/assets/icons/gmail.png" alt="Gmail" title="Gmail" />
              <img src="/assets/icons/word.png" alt="Word" title="Word" />
              <img src="/assets/icons/pdf.png" alt="PDF" title="PDF" />
              <img src="/assets/icons/canva.png" alt="Canva" title="Canva" />
              <img src="/assets/icons/figma.png" alt="Figma" title="Figma" />
              <img src="/assets/icons/powerpoint.png" alt="PowerPoint" title="PowerPoint" />
            </div>
          </Modal>

          <Modal open={showPromptsPopup} onClose={() => setShowPromptsPopup(false)} title="Previous Prompts" size="lg" footer={<Button variant="secondary" onClick={() => setShowPromptsPopup(false)}>Close</Button>}>
            <ul className="prompts-list">
              {previousPrompts.map((prompt, index) => (
                <li key={index}>
                  <strong>Prompt ID:</strong> {prompt.id}<br />
                  <strong>Overview:</strong> {prompt.overview}<br />
                  <strong>Context:</strong> {prompt.context}<br />
                  <strong>Countries:</strong> {prompt.countries}<br />
                  <strong>Industries:</strong> {prompt.industries}<br />
                  <strong>Business Functions:</strong> {prompt.businessFunctions}<br />
                  <strong>Frameworks:</strong> {prompt.analysisFrameworks.join(', ')}<br />
                  <strong>Response Format:</strong> {prompt.responseFormat}
                </li>
              ))}
            </ul>
          </Modal>

          <Modal
            open={showExportModal}
            onClose={() => setShowExportModal(false)}
            title="Export Market Research"
            footer={<Button variant="secondary" onClick={() => setShowExportModal(false)}>Close</Button>}
          >
            <div className="export-options-grid">
              <button type="button" onClick={() => handleExport('excel')}>Download Excel (.xlsx)</button>
              <button type="button" onClick={() => handleExport('csv')}>Download CSV (.csv)</button>
              <button type="button" onClick={() => handleExport('pdf')}>Download PDF (.pdf)</button>
              <button type="button" onClick={() => handleExport('json')}>Download JSON (.json)</button>
              <button type="button" onClick={() => handleExport('sheets')}>Open in Google Sheets</button>
            </div>
          </Modal>
          <Modal
            open={showEmailModal}
            onClose={() => {
              setShowEmailModal(false);
              setSelectedLead(null);
              setEmailImages([]);
              setIsAddingNewCampaign(false);
            }}
            title="Draft Email Campaign"
            size="xl"
            footer={
              <>
                <button type="button" className="email-cancel-button" onClick={() => {
                  setShowEmailModal(false);
                  setSelectedLead(null);
                  setEmailImages([]);
                  setIsAddingNewCampaign(false);
                }}>Cancel</button>
                <button type="button" className="email-send-button" onClick={handleSendEmails} disabled={isSendingEmails}>
                  {isSendingEmails ? 'Sending...' : 'Send Email'}
                </button>
              </>
            }
          >
                <div className="email-modal-body">
                  {/* Campaign Name - Dropdown with Add New Option */}
                  {!selectedLead && (
                    <div className="input-group">
                      <label>Campaign Name</label>
                      {existingCampaigns.length > 0 && !isAddingNewCampaign ? (
                        <div className="campaign-selector">
                          <select 
                            value={selectedCampaignId} 
                            onChange={(e) => handleCampaignSelect(e.target.value)}
                            className="campaign-dropdown"
                          >
                            <option value="">Select an existing campaign...</option>
                            {existingCampaigns.map(campaign => (
                              <option key={campaign.id} value={campaign.id}>
                                {campaign.name}
                              </option>
                            ))}
                            <option value="new">+ Add New Campaign</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <input 
                            type="text" 
                            value={campaignName} 
                            onChange={(e) => setCampaignName(e.target.value)} 
                            placeholder="e.g., Tech Startups Dec 2026"
                            className="campaign-input"
                          />
                          {!isAddingNewCampaign && existingCampaigns.length > 0 && (
                            <button 
                              className="use-existing-btn"
                              onClick={() => setIsAddingNewCampaign(false)}
                            >
                              Use Existing Campaign
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Personalization Checkbox - Properly Aligned */}
                  {!selectedLead && (
                    <div className="checkbox-group">
                      <input 
                        type="checkbox" 
                        checked={useAiBulk} 
                        onChange={(e) => setUseAiBulk(e.target.checked)} 
                        id="useAiBulkCheck"
                        className="checkbox-input"
                      />
                      <label htmlFor="useAiBulkCheck" className="checkbox-label">
                        Use AI Personalization for Bulk Emails
                      </label>
                    </div>
                  )}

                  {/* Subject Field */}
                  <div className="input-group">
                    <label>Subject Line</label>
                    <input 
                      type="text" 
                      value={emailSubject} 
                      onChange={(e) => setEmailSubject(e.target.value)} 
                      placeholder="Email Subject"
                      className="subject-input"
                    />
                  </div>

                  {/* Email Body with Image Support */}
                  <div className="input-group">
                    <div className="body-label-row">
                      <label>Email Body</label>
                      <span className="body-helper-text">You can use {"{"}Company{"}"} for dynamic content</span>
                    </div>
                    <textarea 
                      value={emailBody} 
                      onChange={(e) => setEmailBody(e.target.value)} 
                      placeholder="Type your email body here..." 
                      rows={10}
                      className="body-textarea"
                    ></textarea>

                    {/* Image Upload Section */}
                    <div className="image-upload-section">
                      <label className="image-label">Add Images to Email</label>
                      <div className="image-upload-controls">
                        <input 
                          type="file" 
                          multiple 
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="image-file-input"
                          id="emailImageInput"
                        />
                        <label htmlFor="emailImageInput" className="image-upload-button">
                          Choose Images
                        </label>
                      </div>

                      {emailImages.length > 0 && (
                        <div className="image-gallery">
                          <p className="gallery-title">Selected Images ({emailImages.length}):</p>
                          <div className="image-list">
                            {emailImages.map((img, index) => (
                              <div key={index} className="image-item">
                                <div className="image-preview">
                                  <img src={img.data} alt={img.name} />
                                </div>
                                <div className="image-actions">
                                  <button 
                                    type="button"
                                    className="image-insert-btn"
                                    onClick={() => insertImageIntoBody(index)}
                                    title="Insert into body"
                                  >
                                    Insert
                                  </button>
                                  <button 
                                    type="button"
                                    className="image-remove-btn"
                                    onClick={() => removeEmailImage(index)}
                                    title="Remove image"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
          </Modal>

          <Modal
            open={showSaveListModal}
            onClose={() => { setShowSaveListModal(false); setSaveListMode('create'); setSelectedAppendProjectId(''); }}
            title={`${getResearchEntityMeta().title} List`}
            footer={
              <>
                <Button variant="secondary" onClick={() => { setShowSaveListModal(false); setSaveListMode('create'); setSelectedAppendProjectId(''); }}>Cancel</Button>
                <Button variant="primary" onClick={handleSaveList} disabled={isSavingList || (saveListMode === 'append' && !selectedAppendProjectId)}>
                  {isSavingList ? 'Saving...' : (saveListMode === 'append' ? `Append ${getResearchEntityMeta().title}` : `Save ${getResearchEntityMeta().title} List`)}
                </Button>
              </>
            }
          >
            <div className="field">
              <label>Action</label>
              <select value={saveListMode} onChange={(e) => setSaveListMode(e.target.value)}>
                <option value="create">Create new list</option>
                <option value="append">Append to existing list</option>
              </select>
            </div>
            {saveListMode === 'append' ? (
              <>
                <div className="field">
                  <label>Select List to Append</label>
                  <select value={selectedAppendProjectId} onChange={(e) => setSelectedAppendProjectId(e.target.value)}>
                    <option value="">Choose a saved list...</option>
                    {savedLists.map((list) => (
                      <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                  </select>
                </div>
                <p className="field-hint">Duplicate {getResearchEntityMeta().plural} are removed automatically when appending.</p>
              </>
            ) : (
              <div className="field">
                <label>List Name</label>
                <input type="text" value={saveListName} onChange={e => setSaveListName(e.target.value)} placeholder="e.g., NY Dentists Campaign" autoFocus />
              </div>
            )}
          </Modal>

          <Modal
            open={showScoreModal}
            onClose={() => { setShowScoreModal(false); setScoreQueryText(''); }}
            title={`Score ${getResearchEntityMeta().title}`}
            footer={
              <>
                <Button variant="secondary" onClick={() => { setShowScoreModal(false); setScoreQueryText(''); }}>Cancel</Button>
                <Button variant="primary" onClick={handleScoreLeads} disabled={isScoring}>
                  {isScoring ? 'Scoring...' : `Score ${getResearchEntityMeta().title}`}
                </Button>
              </>
            }
          >
            <div className="field">
              <label>Describe what you're trying to sell or match</label>
              <textarea value={scoreQueryText} onChange={(e) => setScoreQueryText(e.target.value)} rows={4} placeholder="e.g., We sell fleet telematics hardware and software to logistics companies; looking for mid-size fleet operators in North America" />
              <p className="field-hint">A concise description helps rank {getResearchEntityMeta().plural}. Results will add a Match score and a two-line summary for each company.</p>
            </div>
          </Modal>

        </div>
        </ProjectGate>   
      </div>
    </div>
  );
}

export default RequirementsGathering;
