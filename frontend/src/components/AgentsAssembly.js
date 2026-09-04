import axios from 'axios';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../core/Header';
import '../styles/AgentsAssembly.css';
import { API_CONFIG } from '../config/apiConfig';
import { getRouteByModuleName } from '../config/agentsConfig';
import { fetchAgents } from '../agents/agentRegistry';
import { showConfirm, showAlert } from './ConfirmDialog';
import { Modal, ModalTabs } from './Modal';
import { CardGrid, StatusIndicator } from './Card';
import Select from './Select';
import LiveModeHint from './LiveModeHint';
import { STRINGS } from '../constants/strings';




function AgentsAssembly() {
  // Department/function options for second question
  const departmentOptions = [
    'Sales', 'Marketing', 'Finance', 'Operations', 'HR', 'Customer Service', 'Product', 'IT', 'Legal', 'Procurement', 'R&D', 'Strategy', 'Supply Chain', 'Admin', 'Executive'
  ];
  const [departmentPrompted, setDepartmentPrompted] = useState(() => {
    return localStorage.getItem('agentsAssemblyDeptPrompted') === 'true';
  });
  // Industry options for initial selection
  const industryOptions = [
    'Retail', 'Food Service', 'Manufacturing', 'Healthcare', 'Finance', 'Technology', 'Consulting',
    'Education', 'Transportation', 'Hospitality', 'Real Estate', 'Media', 'Nonprofit', 'Legal', 'Construction'
  ];
  const [industryPrompted, setIndustryPrompted] = useState(() => {
    return localStorage.getItem('agentsAssemblyIndPrompted') === 'true';
  });
  const [showDetailedReport, setShowDetailedReport] = useState(false);
  const [detailedReportData, setDetailedReportData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [selectedProcess, setSelectedProcess] = useState('');
  const [businessPage, setBusinessPage] = useState(1);
  const [businessesPerPage] = useState(50); // Show 50 per page
  const [allBusinesses, setAllBusinesses] = useState([]);
  const [filteredModules, setFilteredModules] = useState([]);
  const [userMessage, setUserMessage] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [inputHighlighted, setInputHighlighted] = useState(false);
  const [chatState, setChatState] = useState(() => {
    const saved = localStorage.getItem('agentsAssemblyChatState');
    return saved ? JSON.parse(saved) : {};
  });
  const [chatHistory, setChatHistory] = useState(() => {
    const saved = localStorage.getItem('agentsAssemblyChatHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [nextQuestion, setNextQuestion] = useState(() => {
    const saved = localStorage.getItem('agentsAssemblyNextQuestion');
    return saved || "Tell us more about your business to get agent recommendations";
  });
  const [nextQuestionKey, setNextQuestionKey] = useState(() => {
    const saved = localStorage.getItem('agentsAssemblyNextQuestionKey');
    return saved || "";
  });
  const [completed, setCompleted] = useState(() => {
    const saved = localStorage.getItem('agentsAssemblyCompleted');
    return saved === 'true';
  });
  const [isBuffering, setIsBuffering] = useState(false);
  const [recommendedModules, setRecommendedModules] = useState([]);
  const [moduleTab, setModuleTab] = useState(() => {
    return sessionStorage.getItem('agentsAssemblyModuleTab') || 'business';
  });
  const [showChatbot, setShowChatbot] = useState(false);
  const [registryAgents, setRegistryAgents] = useState([]);

  const navigate = useNavigate();
  const chatHistoryRef = useRef(null);
  const carouselRef = useRef(null);

  // Carousel state - persist selected agent
  const [carouselIndex, setCarouselIndex] = useState(() => {
    const saved = sessionStorage.getItem('agentsAssemblySelectedAgent');
    return saved ? parseInt(saved, 10) : 0;
  });
  const cardsPerView = 4; // Number of cards visible at once

  // Persist carousel index when it changes
  useEffect(() => {
    sessionStorage.setItem('agentsAssemblySelectedAgent', carouselIndex.toString());
  }, [carouselIndex]);

  // Persist module tab when it changes
  useEffect(() => {
    sessionStorage.setItem('agentsAssemblyModuleTab', moduleTab);
  }, [moduleTab]);

  // Load enabled agents from the backend registry on mount
  useEffect(() => {
    fetchAgents().then((agents) => {
      if (agents.length > 0) setRegistryAgents(agents);
    });
  }, []);

  // Persist chat state to localStorage
  useEffect(() => {
    localStorage.setItem('agentsAssemblyChatHistory', JSON.stringify(chatHistory));
  }, [chatHistory]);

  useEffect(() => {
    localStorage.setItem('agentsAssemblyChatState', JSON.stringify(chatState));
  }, [chatState]);

  useEffect(() => {
    localStorage.setItem('agentsAssemblyNextQuestion', nextQuestion);
  }, [nextQuestion]);

  useEffect(() => {
    localStorage.setItem('agentsAssemblyNextQuestionKey', nextQuestionKey);
  }, [nextQuestionKey]);

  useEffect(() => {
    localStorage.setItem('agentsAssemblyCompleted', completed.toString());
  }, [completed]);

  // Clear chat session
  const clearChatSession = () => {
    setChatHistory([]);
    setChatState({});
    setNextQuestion("Tell us more about your business to get agent recommendations");
    setNextQuestionKey("");
    setCompleted(false);
    setIndustryPrompted(false);
    setDepartmentPrompted(false);
    setRecommendedModules([]);
    setDetailedReportData(null);
    localStorage.removeItem('agentsAssemblyChatHistory');
    localStorage.removeItem('agentsAssemblyChatState');
    localStorage.removeItem('agentsAssemblyNextQuestion');
    localStorage.removeItem('agentsAssemblyNextQuestionKey');
    localStorage.removeItem('agentsAssemblyCompleted');
    localStorage.removeItem('agentsAssemblyIndPrompted');
    localStorage.removeItem('agentsAssemblyDeptPrompted');
  };

  // Persist industry/department prompted state
  useEffect(() => {
    localStorage.setItem('agentsAssemblyIndPrompted', industryPrompted.toString());
  }, [industryPrompted]);

  useEffect(() => {
    localStorage.setItem('agentsAssemblyDeptPrompted', departmentPrompted.toString());
  }, [departmentPrompted]);

  // Auto-scroll chat history to bottom when new messages arrive
  useEffect(() => {
    if (chatHistoryRef.current) {
      // Use setTimeout to ensure DOM has updated before scrolling
      setTimeout(() => {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }, 0);
    }
  }, [chatHistory, isBuffering]);

  // Auto-scroll chat history to bottom when new messages arrive
  useEffect(() => {
    if (chatHistoryRef.current) {
      // Use setTimeout to ensure DOM has updated before scrolling
      setTimeout(() => {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }, 0);
    }
  }, [chatHistory, isBuffering]);

  // Only show working/functional modules
  const businessModules = [
    {
      name: 'Market Research',
      icon: '/assets/icons/search-analysis.png',
      price: '$29/month',
      status: 'ready',
      description: 'Discover market trends, analyze competitors, and gather customer insights to make data-driven decisions.',
      keywords: ['market analysis', 'competitor research', 'customer insights', 'business intelligence', 'market trends'],
      businessContext: ['retail', 'ecommerce', 'startup', 'product launch', 'competitive analysis'],
      industries: ['retail', 'technology', 'healthcare', 'finance', 'manufacturing'],
      useCases: ['understanding market', 'competitive analysis', 'customer research', 'market validation']
    },
    {
      name: 'Sales Helper Agent',
      icon: '/assets/icons/increase.png',
      price: '$45/month',
      status: 'ready',
      description: 'Supercharge your sales with lead management, CRM integration, and intelligent sales strategy recommendations.',
      keywords: ['sales', 'sales enablement', 'CRM', 'lead management', 'sales strategy'],
      businessContext: ['sales', 'lead generation', 'customer acquisition', 'sales optimization', 'business growth'],
      industries: ['retail', 'technology', 'ecommerce', 'services', 'consulting'],
      useCases: ['sales optimization', 'lead management', 'sales strategy', 'revenue growth']
    },
    {
      name: 'Content Marketing Agent',
      icon: '/assets/icons/bullhorn.png',
      price: '$49/month',
      status: 'ready',
      description: 'Create compelling content, manage campaigns, and boost your brand presence with AI-powered marketing.',
      keywords: ['content marketing', 'content creation', 'marketing strategy', 'brand content', 'SEO'],
      businessContext: ['content marketing', 'brand building', 'digital marketing', 'social media', 'marketing strategy'],
      industries: ['retail', 'technology', 'media', 'education', 'ecommerce'],
      useCases: ['creating marketing content', 'content strategy', 'brand engagement', 'digital marketing']
    },
    {
      name: 'Community Network',
      icon: '/assets/icons/community.png',
      price: '$38/month',
      status: 'ready',
      description: 'Build and engage your community, manage relationships, and grow customer loyalty organically.',
      keywords: ['community management', 'network building', 'customer engagement', 'social platform', 'relationship management'],
      businessContext: ['customer engagement', 'brand building', 'social media', 'community building', 'customer loyalty'],
      industries: ['retail', 'technology', 'media', 'nonprofit', 'education'],
      useCases: ['building community', 'customer engagement', 'network management', 'brand loyalty']
    },
    {
      name: 'Executive Assistant Agent',
      icon: '/assets/icons/checklist.png',
      price: 'Free',
      status: 'ready',
      description: 'Your AI-powered executive assistant for task management, reminders, and stakeholder coordination via email.',
      keywords: ['executive assistant', 'task management', 'reminders', 'email', 'stakeholder updates'],
      businessContext: ['executive', 'management', 'personal productivity', 'team coordination'],
      industries: ['all industries'],
      useCases: ['task reminders', 'stakeholder follow-up', 'email integration', 'executive support']
    },
    {
      name: 'Event Networking Agent',
      icon: '/assets/icons/networking.png',
      price: '$30/month',
      status: 'ready',
      description: 'Maximize event ROI with smart attendee matching and follow-up automation.',
      keywords: ['event networking', 'attendee matching', 'follow-up', 'event ROI'],
      businessContext: ['events', 'networking', 'conferences', 'trade shows'],
      industries: ['all industries'],
      useCases: ['event networking', 'attendee engagement', 'follow-up automation']
    },
    {
      name: 'Email Outreach',
      icon: '/assets/icons/mail.png',
      price: '$25/month',
      status: 'ready',
      description: 'Send personalized bulk emails to suppliers, leads, or contacts with templates and tracking.',
      keywords: ['email outreach', 'bulk email', 'RFQ', 'supplier outreach', 'email campaigns'],
      businessContext: ['sales', 'procurement', 'supplier management', 'lead nurturing'],
      industries: ['manufacturing', 'retail', 'technology', 'consulting'],
      useCases: ['sending RFQs', 'supplier outreach', 'lead nurturing', 'bulk email']
    },
    {
      name: 'Supply Chain Audit',
      icon: '/assets/icons/supply-chain-management.png',
      price: '$40/month',
      status: 'ready',
      description: 'Qualify suppliers through capability and compliance audits with weighted scoring.',
      keywords: ['supply chain', 'supplier audit', 'qualification', 'compliance', 'vendor management'],
      businessContext: ['procurement', 'supplier management', 'quality assurance', 'vendor qualification'],
      industries: ['manufacturing', 'retail', 'automotive', 'aerospace'],
      useCases: ['supplier qualification', 'compliance audits', 'vendor scoring', 'supply chain management']
    }
  ];

  useEffect(() => {
    if (selectedIndustry) {
      setIndustryPrompted(true);
    }
  }, [selectedIndustry]);

  // Ready technical modules, plus coming-soon ones shown as locked cards
  // (previously fully hidden - Try/Buy are already disabled by isNotReady
  // for any non-'ready' status, this just stops omitting the cards)
  const technicalModules = [
    {
      name: 'Data Insights',
      icon: '/assets/icons/data-discovery.png',
      price: '$48/month',
      status: 'ready',
      description: 'Explore your data, uncover hidden patterns, and generate actionable business insights with AI-powered document analysis.',
      keywords: ['data analysis', 'data mining', 'insights', 'data exploration', 'RAG'],
      businessContext: ['data analysis', 'business intelligence', 'analytics'],
      industries: ['all industries', 'technology', 'finance'],
      useCases: ['data exploration', 'business insights', 'data analysis', 'document Q&A']
    },
    {
      name: 'Investment Agent',
      icon: '/assets/icons/save-money.png',
      price: '$65/month',
      status: 'coming_soon',
      description: 'Make smarter investment decisions with AI-powered market analysis and portfolio recommendations.',
      keywords: ['investment', 'portfolio', 'market analysis', 'risk assessment'],
      businessContext: ['investment', 'portfolio management', 'financial planning'],
      industries: ['finance', 'all industries'],
      useCases: ['market analysis', 'portfolio tracking', 'risk assessment']
    },
    {
      name: 'Team Performance',
      icon: '/assets/icons/performance.png',
      price: '$39/month',
      status: 'coming_soon',
      description: 'Track team productivity, evaluate performance, and identify areas for improvement with analytics.',
      keywords: ['team performance', 'productivity', 'performance analytics', 'goal management'],
      businessContext: ['team management', 'performance review', 'productivity'],
      industries: ['all industries'],
      useCases: ['performance tracking', 'team analytics', 'goal management']
    }
  ];

  // FIXED: Use useEffect to handle filtering instead of calling setState during render
  useEffect(() => {
    // Fetch businesses from backend with pagination
    const fetchBusinesses = async () => {
      try {
        const res = await axios.get(`${API_CONFIG.API_URL}/search_businesses`, {
          params: {
            query: searchTerm,
            location: selectedIndustry,
            max_results: 500,
            page: businessPage,
            per_page: businessesPerPage
          }
        });
        setAllBusinesses(res.data.businesses || []);
      } catch (err) {
        setAllBusinesses([]);
      }
    };
    if (searchTerm.trim() || selectedIndustry) {
      fetchBusinesses();
    }
    // Keep all modules
    const allModules = [...businessModules, ...technicalModules];
    setFilteredModules(allModules);

    // Sort function (same as displayModules sort)
    const sortByStatus = (a, b) => {
      if (a.status === 'ready' && b.status !== 'ready') return -1;
      if (a.status !== 'ready' && b.status === 'ready') return 1;
      return 0;
    };

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchesSearch = (module) =>
        module.name.toLowerCase().includes(term) ||
        (module.keywords && module.keywords.some(k => k.toLowerCase().includes(term)));

      // Sort business modules same as carousel
      const sortedBusiness = [...businessModules].sort(sortByStatus);
      const businessIdx = sortedBusiness.findIndex(matchesSearch);

      if (businessIdx !== -1) {
        setModuleTab('business');
        setCarouselIndex(businessIdx);
        return;
      }

      // Sort technical modules same as carousel
      const sortedTech = [...technicalModules].sort(sortByStatus);
      const techIdx = sortedTech.findIndex(matchesSearch);

      if (techIdx !== -1) {
        setModuleTab('technical');
        setCarouselIndex(techIdx);
        return;
      }
    }

    // No search - preserve sessionStorage index (don't reset)
  }, [searchTerm, selectedIndustry, selectedProcess, businessPage]);

  // Rest of your handlers remain the same...
  const handleCardClick = (moduleName) => {
    const route = getRouteByModuleName(moduleName);
    if (route) {
      navigate(route);
    }
  };

  const handleTryModule = (moduleName) => {
    const route = getRouteByModuleName(moduleName);
    if (route) {
      navigate(route);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Handle file upload logic here (show preview, send to backend, etc.)
    }
  };

  const handleBuyModule = async (module) => {
    console.log('Requesting demo for:', module.name);
    await showAlert(
      `Interested in ${module.name}? We'd love to show you how it can help your business.\n\nContact our sales team:\n📧 sales@enableagents.com\n🌐 enableagents.com/demo`,
      'Request a Demo'
    );
  };


const handleEnterpriseChat = async (userInput) => {
  let localChatState = { ...chatState };
  let lastAnswer = userInput;
  let lastQuestionKey = nextQuestionKey;

  // Store previous chat history to append user answers after each system prompt
  let updatedChatHistory = [...chatHistory];

  setIsBuffering(true);
  while (!completed) {
    try {
      // Show buffering message
      setChatHistory(prev => [
        ...prev,
        { type: 'buffer', text: STRINGS.COMMON.THINKING }
      ]);

      const res = await axios.post(`${API_CONFIG.API_URL}/enterprise_chat`, {
        chat_state: localChatState,
        last_answer: lastAnswer,
        last_question_key: lastQuestionKey
      });

      const data = res.data;
      setChatState(data.chat_state || {});
      setCompleted(data.completed);

      // Remove buffering message
      setChatHistory(prev => prev.filter(msg => msg.type !== 'buffer'));

      const now = new Date().toISOString();

      // If there was a system prompt before, add the user reply after it
      if (updatedChatHistory.length > 0 && lastAnswer) {
        let lastSystemIdx = updatedChatHistory.map(msg => msg.type).lastIndexOf('system');
        if (lastSystemIdx !== -1) {
          updatedChatHistory.splice(lastSystemIdx + 1, 0, { type: 'user', text: lastAnswer, timestamp: now });
        } else {
          updatedChatHistory.push({ type: 'user', text: lastAnswer, timestamp: now });
        }
      } else if (lastAnswer) {
        updatedChatHistory.push({ type: 'user', text: lastAnswer, timestamp: now });
      }

      // Add next system prompt if not completed
      if (data.next_question && !data.completed) {
        updatedChatHistory.push({ type: 'system', text: data.next_question, timestamp: now });
        // Insert department options marker only if the question asks about role or department
        if (
          (data.next_question.toLowerCase().includes('role') || data.next_question.toLowerCase().includes('department')) &&
          !updatedChatHistory.some(msg => msg.text === '__DEPARTMENT_OPTIONS__')
        ) {
          updatedChatHistory.push({ type: 'system', text: '__DEPARTMENT_OPTIONS__' });
        }
      }

      // Add summary if completed
      if (data.completed && data.search_summary) {
        updatedChatHistory.push({ type: 'system', text: data.search_summary, timestamp: now });
      }

      setChatHistory(updatedChatHistory);

      if (data.completed) {
        setNextQuestion("Thank you! Here is the summary of your business context.");

        // Show buffering for recommendations
        setChatHistory(prev => [
          ...prev,
          { type: 'buffer', text: 'Finding recommendations...' }
        ]);

        try {
          const recRes = await axios.post(`${API_CONFIG.API_URL}/recommend_agents`, data.chat_state);
          const recData = recRes.data;

          // Remove buffering message
          setChatHistory(prev => prev.filter(msg => msg.type !== 'buffer'));

          let toolNames = [];
          if (
            recData &&
            recData.recommendations &&
            Array.isArray(recData.recommendations.recommended_tools)
          ) {
            toolNames = recData.recommendations.recommended_tools
              .map((tool) => tool.name || tool.tool_name)
              .filter(Boolean);
          }

          setRecommendedModules(toolNames);
          setDetailedReportData(recData);

          if (!toolNames.length) {
            setChatHistory((prev) => [
              ...prev,
              { type: 'system', text: 'We could not identify recommended modules from the response. Please try refining your answers.', timestamp: new Date().toISOString() }
            ]);
          }
        } catch (recErr) {
          setRecommendedModules([]);
          setDetailedReportData(null);
          setChatHistory((prev) => [
            ...prev.filter(msg => msg.type !== 'buffer'),
            { type: 'system', text: 'Recommendation service is currently unavailable. Please try again shortly.', timestamp: new Date().toISOString() }
          ]);
        }

        setIsBuffering(false);
        break;
      } else {
        setNextQuestion(data.next_question);
        setNextQuestionKey(data.next_question_key);
        lastAnswer = ""; // Wait for next user input
        setIsBuffering(false);
        break; // Exit loop, wait for next user input
      }
    } catch (err) {
      setChatHistory(prev => [...prev.filter(msg => msg.type !== 'buffer'), { type: 'system', text: "Error contacting chat API.", timestamp: new Date().toISOString() }]);
      setIsBuffering(false);
      break;
    }
  }
};






  // Process Map Popup State
  const [showProcessMap, setShowProcessMap] = useState(false);
  const [processMapTab, setProcessMapTab] = useState('visual');
  const [processMapData, setProcessMapData] = useState(null);

  // Dummy process map generator
  const generateProcessMapData = () => {
    return {
      industry: selectedIndustry || 'Generic',
      department: chatState.department || 'General',
      responsibilities: chatState.responsibilities || ['Planning', 'Execution', 'Reporting'],
      steps: [
        { name: 'Initiate', description: 'Start the process', owner: 'Manager' },
        { name: 'Plan', description: 'Plan activities', owner: 'Team Lead' },
        { name: 'Execute', description: 'Carry out tasks', owner: 'Staff' },
        { name: 'Report', description: 'Report outcomes', owner: 'Analyst' }
      ]
    };
  };

  // Handler for process icon click
  const handleProcessClick = () => {
    setProcessMapData(generateProcessMapData());
    setShowProcessMap(true);
    setProcessMapTab('visual');
  };

  // Close popup
  const handleCloseProcessMap = () => {
    setShowProcessMap(false);
  };

  return (
    <div className="agents-page">
      <Header onProcessClick={handleProcessClick} />
      <div className="agents-assembly">
        <div className="agents-hub-banner">
          <LiveModeHint message="Browse agents below. Switch to Demo to explore sample data, or Live to connect your own." />
        </div>
        {/* Process Map Modal */}
        <Modal
          open={showProcessMap}
          onClose={handleCloseProcessMap}
          title="Process Map"
          size="lg"
        >
          <ModalTabs
            tabs={[
              {
                id: 'visual',
                label: 'Visual',
                content: processMapData && (
                  <div className="process-map-visual">
                    <div className="process-map-info">
                      <p><strong>Industry:</strong> {processMapData.industry}</p>
                      <p><strong>Department:</strong> {processMapData.department}</p>
                      <p><strong>Responsibilities:</strong> {Array.isArray(processMapData.responsibilities) ? processMapData.responsibilities.join(', ') : processMapData.responsibilities}</p>
                    </div>
                    <div className="process-map-steps">
                      <h4>Process Steps</h4>
                      <ol>
                        {processMapData.steps.map((step, idx) => (
                          <li key={idx}>
                            <strong>{step.name}</strong>: {step.description}
                            <span className="process-step-owner">({step.owner})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )
              }
            ]}
            activeTab={processMapTab}
            onTabChange={setProcessMapTab}
          />
        </Modal>
        <div className="page-header-row">
          <h2>Agents Assembly</h2>
        </div>

        {/* Floating Chat Widget */}
        <div className={`floating-chat-widget ${showChatbot ? 'floating-chat-widget--open' : ''}`}>
          {/* Floating trigger button */}
          {!showChatbot && (
            <button
              className="floating-chat-trigger"
              onClick={() => setShowChatbot(true)}
              title="Ask AI Assistant"
              aria-label="Ask AI Assistant"
            >
              <img src="/assets/icons/chat.png" alt="" className="floating-chat-trigger-icon" />
            </button>
          )}

          {/* Chat panel */}
          <div className={`floating-chat-panel ${showChatbot ? 'floating-chat-panel--open' : ''}`}>
            <div className="floating-chat-header">
              <span className="floating-chat-title">AI Assistant</span>
              <div className="floating-chat-actions">
                <button
                  className="floating-chat-clear"
                  onClick={clearChatSession}
                  title="Clear chat"
                  aria-label="Clear chat"
                >
                  ↻
                </button>
                <button
                  className="floating-chat-close"
                  onClick={() => setShowChatbot(false)}
                  aria-label="Close chat"
                >
                  ×
                </button>
              </div>
            </div>
            <div ref={chatHistoryRef} className="chat-history" role="log" aria-live="polite" aria-label="Chat messages">
              {chatHistory.length === 0 && (
                <>
                  <div className="chat-row system">
                    <span className="chat-sender">AI Assistant</span>
                    <div className="chat-message system">
                      <span>{nextQuestion}</span>
                    </div>
                  </div>
{/* Industry filter hint removed - filter always visible in toolbar */}
                </>
              )}
              {chatHistory.map((msg, idx) => {
                if (msg.text === '__DEPARTMENT_OPTIONS__') {
                  // Skip if already selected
                  if (departmentPrompted) return null;
                  // Render department options as a separate chat row
                  return (
                    <div key={idx} className="chat-row system">
                      <span className="chat-sender">AI Assistant</span>
                      <div className="chat-message system">
                        <span>Select your department:</span>
                        <div className="industry-options-list">
                          {departmentOptions.map((option, didx) => (
                            <button
                              key={option}
                              className="industry-option-btn"
                              onClick={() => {
                                setInputValue(`I am in the ${option}`);
                                setInputHighlighted(true);
                                setDepartmentPrompted(true);
                              }}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                } else if (msg.text === '' && msg.type === 'system') {
                  // Skip empty system messages (if any)
                  return null;
                } else {
                  // Render chat messages with sender and timestamp
                  const senderLabel = msg.type === 'user' ? 'You' : 'AI Assistant';
                  const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div key={idx} className={`chat-row ${msg.type}`}>
                      <span className="chat-sender">{senderLabel}</span>
                      <div className={`chat-message ${msg.type}`}>
                        {msg.type === 'buffer' ? (
                          <span className="buffering">
                            <span className="loading-dots">
                              <span>.</span><span>.</span><span>.</span>
                            </span> {msg.text}
                          </span>
                        ) : (
                          <span>{msg.text}</span>
                        )}
                      </div>
                      {timeStr && <span className="chat-timestamp">{timeStr}</span>}
                    </div>
                  );
                }
              })}
              {isBuffering && (
                <div className="chat-row buffer-row">
                  <span className="chat-sender">AI Assistant</span>
                  <div className="chat-message system">
                    <span className="buffering">
                      <span className="loading-dots">
                        <span>.</span><span>.</span><span>.</span>
                      </span> Thinking ...
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="enhanced-input">
              <input
                id="chat-file-input"
                type="file"
                style={{ display: 'none' }}
                accept="image/*,.pdf,.doc,.docx,.xlsx,.ppt,.pptx"
                onChange={handleFileChange}
              />
              <button
                className="chat-attach-btn"
                onClick={() => document.getElementById('chat-file-input').click()}
                title="Attach file"
                aria-label="Attach file"
              >
                +
              </button>
              <input
                type="text"
                className={`chat-input enhanced${inputHighlighted ? ' highlighted' : ''}`}
                placeholder={completed ? "Conversation complete" : isBuffering ? STRINGS.COMMON.THINKING : "Message AI Assistant..."}
                value={inputValue}
                onChange={e => {
                  setInputValue(e.target.value);
                  if (inputHighlighted) setInputHighlighted(false);
                }}
                onKeyDown={e => {
                  if (inputHighlighted) setInputHighlighted(false);
                  if (e.key === 'Enter' && !completed && !isBuffering && inputValue.trim()) {
                    e.preventDefault();
                    handleEnterpriseChat(inputValue);
                    setInputValue('');
                  }
                }}
                disabled={completed || isBuffering}
                autoFocus
                aria-label="Type your message"
              />
              <button
                onClick={() => {
                  if (inputValue.trim()) {
                    handleEnterpriseChat(inputValue);
                    setInputValue('');
                  }
                }}
                disabled={completed || isBuffering || !inputValue.trim()}
                className={`chat-send-btn ${inputValue.trim() && !completed && !isBuffering ? 'chat-send-btn--active' : ''}`}
                title="Send message"
                aria-label="Send message"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Show recommended modules as cards matching business/technical modules, with a 'Recommended' tag and Detailed Report */}
        {recommendedModules.length > 0 && (
          <div className="recommended-modules enhanced">
            <h3 className="recommended-header">
              <span>Recommended AI Assistants</span>
              <button
                className="detailed-report-tag"
                onClick={() => setShowDetailedReport(true)}
              >
                Detailed Report
              </button>
            </h3>
            <CardGrid columns="auto" gap="md" className="modules-container recommended">
              {recommendedModules.map((name, idx) => {
                // Find module details from businessModules or technicalModules
                const module = businessModules.find(m => m.name === name) || technicalModules.find(m => m.name === name);
                if (!module) return null;
                return (
                  <div
                    key={idx}
                    className={`module-card recommended-card ${businessModules.some(b => b.name === name) ? 'business-module' : 'technical-module'}`}
                  >
                    <img src={module.icon} alt={module.name} />
                    <p>{module.name}</p>
                    <span className="recommended-tag">Recommended</span>
                    <div className="card-buttons">
                      <button
                        className="try-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTryModule(module.name);
                        }}
                        title={`Try ${module.name} for free`}
                      >
                        Try
                      </button>
                      <button
                        className="buy-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBuyModule(module);
                        }}
                        title={`Buy ${module.name} - ${module.price}`}
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                );
              })}
            </CardGrid>
            {/* Detailed Report Popup - Visual Tabular Format */}
            {showDetailedReport && detailedReportData && (
              <div className="detailed-report-popup" role="dialog" aria-modal="true" aria-labelledby="detailed-report-title">
                <div className="detailed-report-modal">
                  <button className="detailed-report-close" onClick={() => setShowDetailedReport(false)} aria-label="Close detailed report">Close</button>
                  <h2 id="detailed-report-title" className="detailed-report-title">Detailed Recommendation Report</h2>
                  {/* Recommended Tools Section - Card Style */}
                  <div className="detailed-report-section corporate-section">
                    <div className="corporate-header">
                      <span className="corporate-title">Top Recommended AI Tools</span>
                      <span className="corporate-divider" />
                    </div>
                    <div className="detailed-report-tool-list">
                      {(detailedReportData.recommendations?.recommended_tools || []).length === 0 ? (
                        <div className="detailed-report-empty">No recommended tools found.</div>
                      ) : (
                        detailedReportData.recommendations.recommended_tools.map((tool, idx) => (
                          <div key={idx} className="detailed-report-tool-card corporate-card">
                            <div className="detailed-report-tool-header">
                              <span className="detailed-report-tool-name">{tool.name}</span>
                              {tool.relevance && <span className="detailed-report-badge">{tool.relevance}</span>}
                            </div>
                            {tool.description && <div className="detailed-report-tool-desc">{tool.description}</div>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {/* Potential Integration Section - Card Style */}
                  <div className="detailed-report-section corporate-section">
                    <div className="corporate-header">
                      <span className="corporate-title">Smart Integration Opportunities</span>
                      <span className="corporate-divider" />
                    </div>
                    <div className="detailed-report-integration-list">
                      {(detailedReportData.recommendations?.integration_pairs || []).length === 0 ? (
                        <div className="detailed-report-empty">No integration pairs found.</div>
                      ) : (
                        detailedReportData.recommendations.integration_pairs.map((pairObj, idx) => {
                          let tool1 = '-';
                          let tool2 = '-';
                          let dataShared = '-';
                          let description = '-';
                          if (pairObj.pair && Array.isArray(pairObj.pair)) {
                            tool1 = pairObj.pair[0] || '-';
                            tool2 = pairObj.pair[1] || '-';
                          } else {
                            tool1 = pairObj.tool_1 || '-';
                            tool2 = pairObj.tool_2 || '-';
                          }
                          dataShared = pairObj.data_shared || '-';
                          description = pairObj.integration_description || pairObj.integration_type || '-';
                          return (
                            <div key={idx} className="detailed-report-integration-card corporate-card">
                              <div className="detailed-report-integration-tools">
                                <span className="detailed-report-integration-tool">{tool1}</span>
                                <span className="detailed-report-integration-sep">+</span>
                                <span className="detailed-report-integration-tool">{tool2}</span>
                              </div>
                              <div className="detailed-report-integration-data">
                                <span className="detailed-report-badge">{dataShared}</span>
                              </div>
                              <div className="detailed-report-integration-desc">{description}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  {/* Additional Tools Section - Card Style with Companies */}
                  <div className="detailed-report-section corporate-section">
                    <div className="corporate-header">
                      <span className="corporate-title">Other Useful AI Tools & Providers</span>
                      <span className="corporate-divider" />
                    </div>
                    <div className="detailed-report-tool-list">
                      {(detailedReportData.recommendations?.additional_tools || []).length === 0 ? (
                        <div className="detailed-report-empty">No additional tools found.</div>
                      ) : (
                        detailedReportData.recommendations.additional_tools.map((tool, idx) => {
                          let companies = '-';
                          if (Array.isArray(tool.companies_offering) && tool.companies_offering.length > 0) {
                            companies = tool.companies_offering.join(', ');
                          } else if (tool.company) {
                            companies = tool.company;
                          }
                          return (
                            <div key={idx} className="detailed-report-tool-card corporate-card">
                              <div className="detailed-report-tool-header">
                                <span className="detailed-report-tool-name">{tool.name}</span>
                              </div>
                              {tool.description && <div className="detailed-report-tool-desc">{tool.description}</div>}
                              <div className="detailed-report-tool-companies">
                                {Array.isArray(tool.companies_offering) && tool.companies_offering.length > 0 ? (
                                  <div className="company-pill-list">
                                    {tool.companies_offering.map((company, cidx) => (
                                      <span key={cidx} className="company-pill" title="Third-party tool suggestion">{company}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="company-pill" title="Third-party tool suggestion">{companies}</span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Unified toolbar: Tabs | Search | Filters */}
        <div className="agents-toolbar">
          <div className="module-tabs" role="tablist" aria-label="Module categories">
            <button
              role="tab"
              className={`module-tab module-tab--business ${moduleTab === 'business' ? 'module-tab--active' : ''}`}
              aria-selected={moduleTab === 'business'}
              onClick={() => { setModuleTab('business'); setCarouselIndex(0); }}
            >
              Business ({businessModules.length})
            </button>
            <button
              role="tab"
              className={`module-tab module-tab--technical ${moduleTab === 'technical' ? 'module-tab--active' : ''}`}
              aria-selected={moduleTab === 'technical'}
              onClick={() => { setModuleTab('technical'); setCarouselIndex(0); }}
            >
              Technical ({technicalModules.length})
            </button>
          </div>

          <div className="agent-search-wrapper">
            <input
              type="text"
              className="agent-search-input"
              placeholder="Search agent..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search agent"
            />
            {searchTerm && (
              <button
                className="agent-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="filter-chips" role="group" aria-label="Filter modules">
            <Select
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
              aria-label="Select industry"
            >
              <option value="">All Industries</option>
              <option value="Retail">Retail</option>
              <option value="Food Service">Food Service</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Finance">Finance</option>
              <option value="Technology">Technology</option>
              <option value="Consulting">Consulting</option>
            </Select>
            <Select
              value={selectedProcess}
              onChange={(e) => setSelectedProcess(e.target.value)}
              aria-label="Select process"
            >
              <option value="">All Processes</option>
              <option value="Sales">Sales</option>
              <option value="Procurement">Procurement</option>
              <option value="HR">HR</option>
              <option value="Operations">Operations</option>
              <option value="Finance">Finance</option>
              <option value="Customer Service">Customer Service</option>
            </Select>
            {(selectedIndustry || selectedProcess) && (
              <button
                className="clear-filters-btn"
                onClick={() => {
                  setSelectedIndustry('');
                  setSelectedProcess('');
                }}
                title="Clear filters"
                aria-label="Clear all filters"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Modules Section - Infinite 3D Carousel */}
        {(() => {
          const displayModules = filteredModules
            .filter(module => {
              // Filter by tab (business/technical)
              if (moduleTab === 'business') {
                if (!businessModules.some(b => b.name === module.name)) return false;
              } else {
                if (!technicalModules.some(t => t.name === module.name)) return false;
              }
              // Filter by industry
              if (selectedIndustry && module.industries) {
                const industryMatch = module.industries.some(ind =>
                  ind.toLowerCase().includes(selectedIndustry.toLowerCase()) ||
                  ind.toLowerCase() === 'all industries'
                );
                if (!industryMatch) return false;
              }
              // Filter by process
              if (selectedProcess && module.keywords) {
                const processMatch = module.keywords.some(kw =>
                  kw.toLowerCase().includes(selectedProcess.toLowerCase())
                ) || (module.businessContext && module.businessContext.some(ctx =>
                  ctx.toLowerCase().includes(selectedProcess.toLowerCase())
                ));
                if (!processMatch) return false;
              }
              return true;
            })
            .sort((a, b) => {
              if (a.status === 'ready' && b.status !== 'ready') return -1;
              if (a.status !== 'ready' && b.status === 'ready') return 1;
              return 0;
            });

          const total = displayModules.length;
          if (total === 0) {
            return (
              <div className="no-results">
                <h3>{moduleTab === 'technical' ? 'Technical Tools' : 'No modules found'}</h3>
                <p>
                  {moduleTab === 'technical'
                    ? 'Data Insights is available now. Additional technical tools are currently in beta.'
                    : 'Try adjusting your search or browse all available modules.'}
                </p>
                {moduleTab !== 'technical' && (
                  <button type="button" onClick={() => setSearchTerm('')}>Clear Search</button>
                )}
              </div>
            );
          }

          // Infinite circular navigation
          const scrollCarousel = (direction) => {
            if (direction === 'left') {
              setCarouselIndex(prev => (prev - 1 + total) % total);
            } else {
              setCarouselIndex(prev => (prev + 1) % total);
            }
          };

          // Get circular offset from center (-2, -1, 0, 1, 2)
          const getCircularOffset = (index) => {
            const activeIndex = carouselIndex;
            let offset = index - activeIndex;
            // Wrap around for circular effect
            if (offset > total / 2) offset -= total;
            if (offset < -total / 2) offset += total;
            return offset;
          };

          // Calculate 3D card style based on offset from center
          const getCardStyle = (index) => {
            const offset = getCircularOffset(index);
            const absOffset = Math.abs(offset);

            // Only show 5 cards: -2, -1, 0, 1, 2
            if (absOffset > 2) {
              return { visible: false };
            }

            // Scale: center = 1, ±1 = 0.85, ±2 = 0.7
            const scale = absOffset === 0 ? 1 : absOffset === 1 ? 0.85 : 0.7;

            // Opacity: center = 1, ±1 = 0.6, ±2 = 0.3
            const opacity = absOffset === 0 ? 1 : absOffset === 1 ? 0.6 : 0.3;

            // Z-index: center highest
            const zIndex = 100 - absOffset * 10;

            // X translation: consistent visual gap between scaled cards
            const cardWidth = Math.min(360, window.innerWidth * 0.20);
            const gap = 12; // Visual gap between cards
            // Calculate position accounting for scaled widths
            let translateX = 0;
            if (absOffset === 1) {
              translateX = offset * (cardWidth * 0.925 + gap);
            } else if (absOffset === 2) {
              translateX = offset * (cardWidth * 0.925 + gap) + offset * (cardWidth * 0.775 + gap);
            }

            // Slight Y offset for depth
            const translateY = absOffset * 8;

            return { visible: true, scale, opacity, zIndex, translateX, translateY, offset };
          };

          return (
            <div className="carousel-3d-container">
              <button
                type="button"
                className="carousel-nav carousel-nav--left"
                onClick={() => scrollCarousel('left')}
                aria-label="Previous agent"
              />

              <div className="carousel-3d-viewport">
                <div className="carousel-3d-stage">
                  {displayModules.map((module, index) => {
                    const style = getCardStyle(index);
                    if (!style.visible) return null;

                    const isReady = module.status === 'ready';
                    const isNotReady = !isReady;
                    const isActive = style.offset === 0;

                    return (
                      <div
                        key={module.name}
                        className={`carousel-3d-card ${isActive ? 'carousel-3d-card--active' : ''} ${isNotReady ? 'carousel-3d-card--locked' : ''}`}
                        onClick={() => {
                          if (isActive) {
                            if (isReady) handleCardClick(module.name);
                          } else {
                            setCarouselIndex(index);
                          }
                        }}
                        style={{
                          transform: `translateX(${style.translateX}px) translateY(${style.translateY}px) scale(${style.scale})`,
                          opacity: style.opacity,
                          zIndex: style.zIndex,
                        }}
                      >
                        <div className="card-inner">
                          <div className="card-header">
                            <img src={module.icon} alt={module.name} />
                            <StatusIndicator status={isReady ? 'ready' : 'in-progress'} />
                          </div>
                          <p className="card-title">{module.name}</p>
                          <p className="card-description">
                            {module.description || 'AI-powered agent to help automate and optimize your workflows.'}
                          </p>
                          <div className="card-price">{module.price}</div>
                          <div className="card-buttons">
                            <button
                              type="button"
                              className="try-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isReady && isActive) handleTryModule(module.name);
                              }}
                              disabled={isNotReady || !isActive}
                            >
                              {isNotReady ? 'Not Available' : 'Try Free'}
                            </button>
                            <button
                              type="button"
                              className="buy-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isReady && isActive) handleBuyModule(module);
                              }}
                              disabled={isNotReady || !isActive}
                            >
                              Buy
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                className="carousel-nav carousel-nav--right"
                onClick={() => scrollCarousel('right')}
                aria-label="Next agent"
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default AgentsAssembly;