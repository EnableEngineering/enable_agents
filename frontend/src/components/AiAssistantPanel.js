import axios from 'axios';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { getRouteByModuleName } from '../config/agentsConfig';
import { findModuleByName, DEPARTMENT_COLORS } from '../data/agentCatalog';
import { CardGrid, ModuleCard } from './Card';
import { STRINGS } from '../constants/strings';
import './AiAssistantPanel.css';

const DEPARTMENT_OPTIONS = [
  'Sales', 'Marketing', 'Finance', 'Operations', 'HR', 'Customer Service', 'Product', 'IT', 'Legal', 'Procurement', 'R&D', 'Strategy', 'Supply Chain', 'Admin', 'Executive'
];

/**
 * Global AI Assistant panel - a persistent, docked right-side panel
 * (Copilot-style) present on every logged-in page, not scoped to one route.
 * Holds the conversational agent-recommendation flow (POST /enterprise_chat
 * -> POST /recommend_agents) that used to live inside AgentsAssembly.js's
 * floating chat widget.
 */
function AiAssistantPanel({ open, onToggle }) {
  const navigate = useNavigate();
  const chatHistoryRef = useRef(null);

  const [departmentPrompted, setDepartmentPrompted] = useState(() => {
    return localStorage.getItem('aiAssistantDeptPrompted') === 'true';
  });
  const [inputValue, setInputValue] = useState('');
  const [inputHighlighted, setInputHighlighted] = useState(false);
  const [chatState, setChatState] = useState(() => {
    const saved = localStorage.getItem('aiAssistantChatState');
    return saved ? JSON.parse(saved) : {};
  });
  const [chatHistory, setChatHistory] = useState(() => {
    const saved = localStorage.getItem('aiAssistantChatHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [nextQuestion, setNextQuestion] = useState(() => {
    const saved = localStorage.getItem('aiAssistantNextQuestion');
    return saved || 'Tell us more about your business to get agent recommendations';
  });
  const [nextQuestionKey, setNextQuestionKey] = useState(() => {
    return localStorage.getItem('aiAssistantNextQuestionKey') || '';
  });
  const [completed, setCompleted] = useState(() => {
    return localStorage.getItem('aiAssistantCompleted') === 'true';
  });
  const [isBuffering, setIsBuffering] = useState(false);
  const [recommendedModules, setRecommendedModules] = useState([]);
  const [detailedReportData, setDetailedReportData] = useState(null);
  const [showDetailedReport, setShowDetailedReport] = useState(false);

  useEffect(() => {
    localStorage.setItem('aiAssistantChatHistory', JSON.stringify(chatHistory));
  }, [chatHistory]);

  useEffect(() => {
    localStorage.setItem('aiAssistantChatState', JSON.stringify(chatState));
  }, [chatState]);

  useEffect(() => {
    localStorage.setItem('aiAssistantNextQuestion', nextQuestion);
  }, [nextQuestion]);

  useEffect(() => {
    localStorage.setItem('aiAssistantNextQuestionKey', nextQuestionKey);
  }, [nextQuestionKey]);

  useEffect(() => {
    localStorage.setItem('aiAssistantCompleted', completed.toString());
  }, [completed]);

  useEffect(() => {
    localStorage.setItem('aiAssistantDeptPrompted', departmentPrompted.toString());
  }, [departmentPrompted]);

  // Auto-scroll chat history to bottom when new messages arrive
  useEffect(() => {
    if (chatHistoryRef.current) {
      setTimeout(() => {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }, 0);
    }
  }, [chatHistory, isBuffering]);

  const clearChatSession = () => {
    setChatHistory([]);
    setChatState({});
    setNextQuestion('Tell us more about your business to get agent recommendations');
    setNextQuestionKey('');
    setCompleted(false);
    setDepartmentPrompted(false);
    setRecommendedModules([]);
    setDetailedReportData(null);
    localStorage.removeItem('aiAssistantChatHistory');
    localStorage.removeItem('aiAssistantChatState');
    localStorage.removeItem('aiAssistantNextQuestion');
    localStorage.removeItem('aiAssistantNextQuestionKey');
    localStorage.removeItem('aiAssistantCompleted');
    localStorage.removeItem('aiAssistantDeptPrompted');
  };

  const handleOpenModule = (moduleName) => {
    const route = getRouteByModuleName(moduleName);
    if (route) navigate(route);
  };

  const handleEnterpriseChat = async (userInput) => {
    let localChatState = { ...chatState };
    let lastAnswer = userInput;
    let lastQuestionKey = nextQuestionKey;
    let updatedChatHistory = [...chatHistory];

    setIsBuffering(true);
    while (!completed) {
      try {
        setChatHistory(prev => [...prev, { type: 'buffer', text: STRINGS.COMMON.THINKING }]);

        const res = await axios.post(`${API_CONFIG.API_URL}/enterprise_chat`, {
          chat_state: localChatState,
          last_answer: lastAnswer,
          last_question_key: lastQuestionKey,
        }, { headers: authJsonHeaders() });

        const data = res.data;
        setChatState(data.chat_state || {});
        setCompleted(data.completed);
        setChatHistory(prev => prev.filter(msg => msg.type !== 'buffer'));

        const now = new Date().toISOString();

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

        if (data.next_question && !data.completed) {
          updatedChatHistory.push({ type: 'system', text: data.next_question, timestamp: now });
          if (
            (data.next_question.toLowerCase().includes('role') || data.next_question.toLowerCase().includes('department')) &&
            !updatedChatHistory.some(msg => msg.text === '__DEPARTMENT_OPTIONS__')
          ) {
            updatedChatHistory.push({ type: 'system', text: '__DEPARTMENT_OPTIONS__' });
          }
        }

        if (data.completed && data.search_summary) {
          updatedChatHistory.push({ type: 'system', text: data.search_summary, timestamp: now });
        }

        setChatHistory(updatedChatHistory);

        if (data.completed) {
          setNextQuestion('Thank you! Here is the summary of your business context.');
          setChatHistory(prev => [...prev, { type: 'buffer', text: 'Finding recommendations...' }]);

          try {
            const recRes = await axios.post(`${API_CONFIG.API_URL}/recommend_agents`, data.chat_state, { headers: authJsonHeaders() });
            const recData = recRes.data;
            setChatHistory(prev => prev.filter(msg => msg.type !== 'buffer'));

            let toolNames = [];
            if (recData?.recommendations?.recommended_tools && Array.isArray(recData.recommendations.recommended_tools)) {
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
          lastAnswer = '';
          setIsBuffering(false);
          break;
        }
      } catch (err) {
        setChatHistory(prev => [...prev.filter(msg => msg.type !== 'buffer'), { type: 'system', text: 'Error contacting chat API.', timestamp: new Date().toISOString() }]);
        setIsBuffering(false);
        break;
      }
    }
  };

  if (!open) {
    return (
      <button
        className="ai-panel-collapsed-trigger"
        onClick={() => onToggle(true)}
        title="Open AI Assistant"
        aria-label="Open AI Assistant"
      >
        <img src="/assets/icons/chat.png" alt="" className="ai-panel-collapsed-icon" />
      </button>
    );
  }

  return (
    <div className="ai-assistant-panel">
      <div className="ai-panel-header">
        <span className="ai-panel-title">AI Assistant</span>
        <div className="ai-panel-actions">
          <button
            className="ai-panel-clear"
            onClick={clearChatSession}
            title="Clear chat"
            aria-label="Clear chat"
          >
            ↻
          </button>
          <button
            className="ai-panel-collapse"
            onClick={() => onToggle(false)}
            aria-label="Collapse AI Assistant panel"
            title="Collapse"
          >
            ×
          </button>
        </div>
      </div>

      <div ref={chatHistoryRef} className="ai-panel-history" role="log" aria-live="polite" aria-label="Chat messages">
        {chatHistory.length === 0 && (
          <div className="ai-panel-row system">
            <span className="ai-panel-sender">AI Assistant</span>
            <div className="ai-panel-message system">
              <span>{nextQuestion}</span>
            </div>
          </div>
        )}
        {chatHistory.map((msg, idx) => {
          if (msg.text === '__DEPARTMENT_OPTIONS__') {
            if (departmentPrompted) return null;
            return (
              <div key={idx} className="ai-panel-row system">
                <span className="ai-panel-sender">AI Assistant</span>
                <div className="ai-panel-message system">
                  <span>Select your department:</span>
                  <div className="ai-panel-options-list">
                    {DEPARTMENT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        className="ai-panel-option-btn"
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
          }
          if (msg.text === '' && msg.type === 'system') return null;

          const senderLabel = msg.type === 'user' ? 'You' : 'AI Assistant';
          const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          return (
            <div key={idx} className={`ai-panel-row ${msg.type}`}>
              <span className="ai-panel-sender">{senderLabel}</span>
              <div className={`ai-panel-message ${msg.type}`}>
                {msg.type === 'buffer' ? (
                  <span className="ai-panel-buffering">
                    <span className="ai-panel-loading-dots"><span>.</span><span>.</span><span>.</span></span> {msg.text}
                  </span>
                ) : (
                  <span>{msg.text}</span>
                )}
              </div>
              {timeStr && <span className="ai-panel-timestamp">{timeStr}</span>}
            </div>
          );
        })}
        {isBuffering && (
          <div className="ai-panel-row buffer-row">
            <span className="ai-panel-sender">AI Assistant</span>
            <div className="ai-panel-message system">
              <span className="ai-panel-buffering">
                <span className="ai-panel-loading-dots"><span>.</span><span>.</span><span>.</span></span> Thinking ...
              </span>
            </div>
          </div>
        )}
      </div>

      {recommendedModules.length > 0 && (
        <div className="ai-panel-recommended">
          <div className="ai-panel-recommended-header">
            <span>Recommended AI Assistants</span>
            <button className="ai-panel-detailed-report-tag" onClick={() => setShowDetailedReport(true)}>
              Detailed Report
            </button>
          </div>
          <CardGrid columns="1" gap="sm">
            {recommendedModules.map((name) => {
              const module = findModuleByName(name);
              if (!module) return null;
              const isReady = module.status === 'ready';
              return (
                <ModuleCard
                  key={name}
                  icon={module.icon}
                  title={module.name}
                  description={module.description}
                  price={module.price}
                  status={isReady ? 'ready' : 'in-progress'}
                  locked={!isReady}
                  department={module.department}
                  departmentColor={DEPARTMENT_COLORS[module.department]}
                  badge="Recommended"
                  onOpen={() => handleOpenModule(module.name)}
                />
              );
            })}
          </CardGrid>

          {showDetailedReport && detailedReportData && (
            <div className="ai-panel-report-popup" role="dialog" aria-modal="true" aria-labelledby="ai-panel-report-title">
              <div className="ai-panel-report-modal">
                <button className="ai-panel-report-close" onClick={() => setShowDetailedReport(false)} aria-label="Close detailed report">Close</button>
                <h2 id="ai-panel-report-title" className="ai-panel-report-title">Detailed Recommendation Report</h2>

                <div className="ai-panel-report-section">
                  <h3>Top Recommended AI Tools</h3>
                  {(detailedReportData.recommendations?.recommended_tools || []).length === 0 ? (
                    <div className="ai-panel-report-empty">No recommended tools found.</div>
                  ) : (
                    detailedReportData.recommendations.recommended_tools.map((tool, idx) => (
                      <div key={idx} className="ai-panel-report-card">
                        <div className="ai-panel-report-card-header">
                          <span>{tool.name}</span>
                          {tool.relevance && <span className="ai-panel-report-badge">{tool.relevance}</span>}
                        </div>
                        {tool.description && <div className="ai-panel-report-desc">{tool.description}</div>}
                      </div>
                    ))
                  )}
                </div>

                <div className="ai-panel-report-section">
                  <h3>Smart Integration Opportunities</h3>
                  {(detailedReportData.recommendations?.integration_pairs || []).length === 0 ? (
                    <div className="ai-panel-report-empty">No integration pairs found.</div>
                  ) : (
                    detailedReportData.recommendations.integration_pairs.map((pairObj, idx) => {
                      let tool1 = '-', tool2 = '-';
                      if (pairObj.pair && Array.isArray(pairObj.pair)) {
                        tool1 = pairObj.pair[0] || '-';
                        tool2 = pairObj.pair[1] || '-';
                      } else {
                        tool1 = pairObj.tool_1 || '-';
                        tool2 = pairObj.tool_2 || '-';
                      }
                      const dataShared = pairObj.data_shared || '-';
                      const description = pairObj.integration_description || pairObj.integration_type || '-';
                      return (
                        <div key={idx} className="ai-panel-report-card">
                          <div className="ai-panel-report-card-header">
                            <span>{tool1} + {tool2}</span>
                            <span className="ai-panel-report-badge">{dataShared}</span>
                          </div>
                          <div className="ai-panel-report-desc">{description}</div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="ai-panel-report-section">
                  <h3>Other Useful AI Tools & Providers</h3>
                  {(detailedReportData.recommendations?.additional_tools || []).length === 0 ? (
                    <div className="ai-panel-report-empty">No additional tools found.</div>
                  ) : (
                    detailedReportData.recommendations.additional_tools.map((tool, idx) => {
                      let companies = '-';
                      if (Array.isArray(tool.companies_offering) && tool.companies_offering.length > 0) {
                        companies = tool.companies_offering.join(', ');
                      } else if (tool.company) {
                        companies = tool.company;
                      }
                      return (
                        <div key={idx} className="ai-panel-report-card">
                          <div className="ai-panel-report-card-header"><span>{tool.name}</span></div>
                          {tool.description && <div className="ai-panel-report-desc">{tool.description}</div>}
                          <div className="ai-panel-report-companies">{companies}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ai-panel-input">
        <input
          type="text"
          className={`ai-panel-input-field${inputHighlighted ? ' highlighted' : ''}`}
          placeholder={completed ? 'Conversation complete' : isBuffering ? STRINGS.COMMON.THINKING : 'Message AI Assistant...'}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (inputHighlighted) setInputHighlighted(false);
          }}
          onKeyDown={(e) => {
            if (inputHighlighted) setInputHighlighted(false);
            if (e.key === 'Enter' && !completed && !isBuffering && inputValue.trim()) {
              e.preventDefault();
              handleEnterpriseChat(inputValue);
              setInputValue('');
            }
          }}
          disabled={completed || isBuffering}
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
          className={`ai-panel-send-btn ${inputValue.trim() && !completed && !isBuffering ? 'ai-panel-send-btn--active' : ''}`}
          title="Send message"
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default AiAssistantPanel;
