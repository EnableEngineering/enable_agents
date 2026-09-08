import axios from 'axios';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { AGENTS } from '../config/agentsConfig';
import { STRINGS } from '../constants/strings';
import { getActivityTrail, useAgentCompletionListener } from '../hooks';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import TypingIndicator from './TypingIndicator';
import ExpandableText from './ExpandableText';
import './AiAssistantPanel.css';

const MESSAGES_STORAGE_KEY_PREFIX = 'aiAssistantMessages';
// 'general' is the localStorage-key suffix for project-less pages (Dashboard,
// Team, Settings, ...) - kept distinct from the server's NULL project_id,
// which is what actually represents that bucket there.
function storageKeyFor(projectId) {
  return `${MESSAGES_STORAGE_KEY_PREFIX}:${projectId || 'general'}`;
}

// Module-level (not a ref) on purpose: survives regardless of which
// component instance/mount pass a given completion event is handled by.
let lastCompletionSignature = null;
let lastCompletionTime = 0;

// Human-readable labels for the field_key strings the assistant's open_agent
// tool call can return, so the action card shows "Project context: ..."
// rather than raw camelCase keys. Keep in sync with the field catalog in
// backend/app.py's ASSISTANT_AGENT_FIELD_CATALOG.
const FIELD_LABELS = {
  overview: 'Project context', industries: 'Industry', countries: 'Region',
  inputMessage: 'Message', userContext: 'Context', selectedChannel: 'Channel', contentType: 'Content type',
  title: 'Task', name: 'Name', description: 'Description', location: 'Location', date: 'Date',
  interests: 'Interests', goals: 'Goals', subject: 'Subject', body: 'Body', capacity: 'Capacity',
  certifications: 'Certifications', capabilities: 'Capabilities', prompt: 'Question', input: 'Question',
};

function labelFor(fieldKey) {
  return FIELD_LABELS[fieldKey] || fieldKey;
}


function AssistantAgentActionCard({ toolResult, onOpen, onReject }) {
  const fields = toolResult.fields || [];
  const missing = toolResult.missing_fields || [];
  // Locks once acted on (opened or dismissed) - an old card can't be
  // re-clicked later to silently re-run a prefill with stale data (e.g. lead
  // counts from a research run that's since been superseded). One action per
  // card, permanently. The full card content stays visible either way - only
  // the buttons are replaced with a status line - so you can still see what
  // the recommendation actually was, not just that something happened to it.
  const resolved = toolResult.dismissed ? 'dismissed' : toolResult.opened ? 'opened' : null;

  return (
    <div className={`ai-panel-action-card${resolved ? ' ai-panel-action-card--resolved' : ''}`}>
      <div className="ai-panel-action-card-title">{toolResult.agent_display_name || 'Agent'}</div>
      {toolResult.reason && (
        <div className="ai-panel-action-card-reason">Why: {toolResult.reason}</div>
      )}
      {fields.length > 0 && (
        <ul className="ai-panel-action-card-fields">
          {fields.map((f) => (
            <li key={f.field_key}>
              <span className="ai-panel-action-card-field-label">{labelFor(f.field_key)}:</span>{' '}
              <ExpandableText text={f.field_value} />
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <div className="ai-panel-action-card-missing">Still needs from you: {missing.join(', ')}</div>
      )}
      {resolved ? (
        <div className="ai-panel-action-card-status">
          {resolved === 'dismissed'
            ? `Dismissed - won't suggest ${toolResult.agent_display_name} after this again for now.`
            : `Opened ${toolResult.agent_display_name} - already actioned.`}
        </div>
      ) : (
        <div className="ai-panel-action-card-actions">
          <button type="button" className="ai-panel-action-card-btn" onClick={() => onOpen(toolResult)}>
            {fields.length > 0 ? 'Open & Prefill' : `Open ${toolResult.agent_display_name || 'agent'}`}
          </button>
          {toolResult.suggested && (
            <button type="button" className="ai-panel-action-card-btn-secondary" onClick={() => onReject(toolResult)}>
              Not now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Global AI Assistant panel - a persistent, docked right-side panel
 * (Copilot-style) present on every logged-in page, not scoped to one route.
 * A real conversational chat backed by POST /assistant_chat (OpenAI
 * tool-calling): the model either replies in plain text, or calls
 * open_agent when it has identified a specific agent + concrete field(s) to
 * prefill. The tool-call result is carried on the message that produced it
 * (msg.toolResult), not a separate side-array - so a recommendation card
 * from 20 messages ago is exactly as clickable as the newest one.
 */
function AiAssistantPanel({ open, onToggle }) {
  const navigate = useNavigate();
  const projectId = useSelectedProjectId();
  const chatHistoryRef = useRef(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // One conversation per project (plus a project-less "general" bucket for
  // Dashboard/Team/Settings/...) - switching projects shows that project's
  // own history, not one account-wide log mixing everything together.
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem(storageKeyFor(projectId));
    return saved ? JSON.parse(saved) : [];
  });
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const suppressedPairsRef = useRef(new Set());

  useEffect(() => {
    localStorage.setItem(storageKeyFor(projectId), JSON.stringify(messages));
  }, [messages, projectId]);

  // Server is the source of truth (survives clearing site data, works across
  // browsers/devices) - localStorage above is now just an instant-paint cache
  // for repeat visits in the same browser while this fetch is in flight. Runs
  // again whenever the selected project changes (not just on mount), so
  // switching projects swaps in that project's own conversation.
  //
  // react-router's useSearchParams can report a transient projectId of null
  // for one render in the middle of a navigate() call (observed when
  // accepting a suggestion navigates to the destination agent's route),
  // firing this effect an extra time for the wrong (general) bucket. Guard
  // against whichever of the two requests happens to resolve last "winning"
  // with stale/wrong-bucket data by dropping any response that isn't for the
  // project still selected by the time it arrives.
  useEffect(() => {
    const requestedProjectId = projectId;
    setMessages(() => {
      const saved = localStorage.getItem(storageKeyFor(requestedProjectId));
      return saved ? JSON.parse(saved) : [];
    }); // instant paint from this project's cache while the fetch below is in flight
    axios.get(`${API_CONFIG.API_URL}/api/ai_assistant_messages`, {
      headers: authJsonHeaders(),
      params: { project_id: requestedProjectId || undefined },
    })
      .then((res) => {
        if (res.data.messages && projectIdRef.current === requestedProjectId) {
          setMessages(res.data.messages);
        }
      })
      .catch(() => {}); // best-effort - keep whatever localStorage had on failure
  }, [projectId]);

  useEffect(() => {
    if (open) setHasUnread(false);
  }, [open]);

  // Lets non-React CSS (Toast.css) know the panel's open/collapsed state, so
  // toasts - which dock at the same top-right corner - can offset around it
  // instead of rendering underneath its header.
  useEffect(() => {
    document.body.classList.toggle('ai-panel-open', open);
    return () => document.body.classList.remove('ai-panel-open');
  }, [open]);

  // Pairs the user has already dismissed ("Not now") - fetched once so
  // handleAgentCompleted can skip suggesting them again this session without
  // a round trip per completion event.
  useEffect(() => {
    axios.get(`${API_CONFIG.API_URL}/api/agent_suggestion_feedback/dismissed_pairs`, { headers: authJsonHeaders() })
      .then((res) => {
        (res.data.dismissed_pairs || []).forEach((p) => {
          suppressedPairsRef.current.add(`${p.from_agent}>${p.to_agent}`);
        });
      })
      .catch(() => {}); // best-effort - a failed fetch just means no suppression this session
  }, []);

  const postSuggestionFeedback = (fromAgent, toAgent, action) => {
    axios.post(`${API_CONFIG.API_URL}/api/agent_suggestion_feedback`, {
      from_agent: fromAgent, to_agent: toAgent, action,
    }, { headers: authJsonHeaders() }).catch(() => {}); // fire-and-forget
  };

  // Upserts one message server-side - called after every add or in-place
  // edit (dismissed/opened flags) instead of diffing the whole array.
  const syncMessageToServer = (message) => {
    axios.post(`${API_CONFIG.API_URL}/api/ai_assistant_messages`, {
      id: message.id, role: message.role, text: message.text, toolResult: message.toolResult || null,
      project_id: projectId || null,
    }, { headers: authJsonHeaders() }).catch(() => {}); // fire-and-forget
  };

  // Proactive next-step suggestion: fires whenever an agent page finishes a
  // real, actionable task (see notifyAgentCompleted callers), independent of
  // whether the user ever chatted with the assistant - running an agent from
  // its own page never touches /assistant_chat, so that path alone could
  // never surface a suggestion.
  const handleAgentCompleted = useCallback(({ agentKey, summary, contextFields }) => {
    const agent = AGENTS[agentKey];
    const nextStep = agent && agent.nextStep;
    if (!nextStep) return; // no obvious next step for this agent (e.g. Executive Assistant, Chatbot)

    const nextAgent = AGENTS[nextStep.agentKey];
    if (!nextAgent) return;

    if (suppressedPairsRef.current.has(`${agentKey}>${nextStep.agentKey}`)) return; // user already said "not now" to this pairing

    // Cheap defensive backstop against the same completion firing twice in
    // near-simultaneous succession, from any cause - the prev-message dedup
    // check below only catches an *existing* card, not two brand-new ones
    // both being added inside the same tick.
    const signature = `${agentKey}|${summary || ''}`;
    if (lastCompletionSignature === signature && Date.now() - lastCompletionTime < 1000) {
      return;
    }
    lastCompletionSignature = signature;
    lastCompletionTime = Date.now();

    // newMessage is built inside the updater (it needs `prev` to decide
    // whether to skip) but synced to the server outside it - React 18
    // StrictMode deliberately invokes updater functions twice in dev to
    // verify they're pure, and a network call inside one previously fired
    // twice for real, silently creating a duplicate row server-side even
    // though only one of the two ever became the committed React state.
    let messageToSync = null;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.toolResult?.suggested && last.toolResult.agent_key === nextStep.agentKey
          && !last.toolResult.dismissed && !last.toolResult.opened) {
        return prev; // same suggestion already sitting at the bottom, still unresolved - don't repeat it
      }
      const fields = contextFields || [];
      const text = `${summary ? summary + '. ' : ''}Since you just finished with ${agent.name}, want to ${nextStep.reason}? ${nextAgent.name} can help.`;
      const newMessage = {
        id: `${Date.now()}-suggest`, role: 'assistant', text, timestamp: new Date().toISOString(),
        toolResult: {
          agent_key: nextStep.agentKey, agent_display_name: nextAgent.name, from_agent_key: agentKey,
          reason: nextStep.reason, fields,
          missing_fields: nextStep.agentKey === 'emailOutreach' ? ['Recipients'] : [],
          suggested: true,
        },
      };
      messageToSync = newMessage;
      return [...prev, newMessage];
    });
    if (messageToSync) syncMessageToServer(messageToSync);
    if (!open) setHasUnread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  useAgentCompletionListener(handleAgentCompleted);

  const handleRejectSuggestion = (messageId, toolResult) => {
    suppressedPairsRef.current.add(`${toolResult.from_agent_key}>${toolResult.agent_key}`);
    postSuggestionFeedback(toolResult.from_agent_key, toolResult.agent_key, 'dismissed');
    let messageToSync = null;
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const updated = { ...m, toolResult: { ...m.toolResult, dismissed: true } };
      messageToSync = updated;
      return updated;
    }));
    if (messageToSync) syncMessageToServer(messageToSync);
  };

  // Auto-scroll chat history to bottom when new messages arrive. The ref is
  // re-checked inside the timeout (not just before scheduling it) because
  // the panel can collapse - unmounting the scrolling element - in the gap
  // between scheduling and firing.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [messages, isSending]);

  const clearChatSession = () => {
    setMessages([]);
    localStorage.removeItem(storageKeyFor(projectId));
    sessionStorage.removeItem('pendingAgentPrefill');
    axios.delete(`${API_CONFIG.API_URL}/api/ai_assistant_messages`, {
      headers: authJsonHeaders(),
      params: { project_id: projectId || undefined },
    }).catch(() => {});
  };

  const handleOpenAndPrefill = (messageId, toolResult) => {
    const agent = AGENTS[toolResult.agent_key];
    if (!agent) return;
    if (toolResult.suggested && toolResult.from_agent_key) {
      suppressedPairsRef.current.delete(`${toolResult.from_agent_key}>${toolResult.agent_key}`);
      postSuggestionFeedback(toolResult.from_agent_key, toolResult.agent_key, 'accepted');
    }
    // Every action card - not just proactive suggestions - locks once acted
    // on, so an old card can't be used to silently re-run a stale prefill
    // (e.g. re-opening a research suggestion from last week with numbers
    // that no longer reflect anything current).
    let messageToSync = null;
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const updated = { ...m, toolResult: { ...m.toolResult, opened: true } };
      messageToSync = updated;
      return updated;
    }));
    if (messageToSync) syncMessageToServer(messageToSync);
    sessionStorage.setItem('pendingAgentPrefill', JSON.stringify({
      agentKey: toolResult.agent_key,
      fields: toolResult.fields || [],
      missingFields: toolResult.missing_fields || [],
      createdAt: Date.now(),
    }));
    // Below the panel's own 1024px breakpoint it's a 100vw overlay (see
    // AiAssistantPanel.css) - staying open after navigating would bury the
    // destination page, including the AgentPrefillBanner this whole flow
    // exists to show. Desktop keeps it open (Copilot-style dock, never
    // covers the content there).
    if (window.innerWidth <= 1024) onToggle(false);
    if (window.location.pathname === agent.route) {
      // Already on the target page (e.g. re-clicking an older card in this
      // same conversation) - navigate() to the route you're already on is a
      // no-op in react-router, so the destination's usePendingAgentPrefill
      // effect would never re-run. Tell it directly instead.
      window.dispatchEvent(new Event('enableAgents:pendingAgentPrefillReady'));
    } else {
      navigate(agent.route);
    }
  };

  const sendAssistantMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const userMsg = { id: `${Date.now()}-u`, role: 'user', text: trimmed, timestamp: new Date().toISOString() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    syncMessageToServer(userMsg);
    setInputValue('');
    setIsSending(true);

    try {
      const res = await axios.post(`${API_CONFIG.API_URL}/assistant_chat`, {
        messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
        recent_activity: getActivityTrail(),
      }, { headers: authJsonHeaders() });

      const { reply, tool_result: toolResult } = res.data;
      const assistantMsg = {
        id: `${Date.now()}-a`, role: 'assistant',
        text: reply || '', timestamp: new Date().toISOString(),
        toolResult: toolResult || null,
      };
      syncMessageToServer(assistantMsg);
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-err`, role: 'assistant',
        text: 'Sorry, something went wrong reaching the assistant. Please try again.',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsSending(false);
    }
  };

  if (!open) {
    return (
      <button
        className="ai-panel-collapsed-trigger"
        onClick={() => onToggle(true)}
        title={hasUnread ? 'AI Assistant has a new suggestion' : 'Open AI Assistant'}
        aria-label={hasUnread ? 'Open AI Assistant, new suggestion available' : 'Open AI Assistant'}
      >
        <img src="/assets/icons/message.png" alt="" className="ai-panel-collapsed-icon" />
        {hasUnread && <span className="ai-panel-unread-dot" aria-hidden="true" />}
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
        {messages.length === 0 && (
          <div className="ai-panel-row system">
            <span className="ai-panel-sender">AI Assistant</span>
            <div className="ai-panel-message system">
              <span>Tell me what you're trying to do. I'll find the right agent and fill in what I can. Try: "run market research for a SaaS product in fintech."</span>
            </div>
          </div>
        )}
        {messages.map((msg) => {
          const senderLabel = msg.role === 'user' ? 'You' : 'AI Assistant';
          const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          return (
            <div key={msg.id} className={`ai-panel-row ${msg.role}`}>
              <span className="ai-panel-sender">{senderLabel}</span>
              <div className={`ai-panel-message ${msg.role}`}>
                <span>{msg.text}</span>
              </div>
              {timeStr && <span className="ai-panel-timestamp">{timeStr}</span>}
              {msg.toolResult && (
                <AssistantAgentActionCard
                  toolResult={msg.toolResult}
                  onOpen={(toolResult) => handleOpenAndPrefill(msg.id, toolResult)}
                  onReject={(toolResult) => handleRejectSuggestion(msg.id, toolResult)}
                />
              )}
            </div>
          );
        })}
        {isSending && (
          <div className="ai-panel-row buffer-row">
            <span className="ai-panel-sender">AI Assistant</span>
            <TypingIndicator />
          </div>
        )}
      </div>

      <div className="ai-panel-input">
        <input
          type="text"
          className="ai-panel-input-field"
          placeholder={isSending ? STRINGS.COMMON.THINKING : 'Message AI Assistant...'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isSending && inputValue.trim()) {
              e.preventDefault();
              sendAssistantMessage(inputValue);
            }
          }}
          disabled={isSending}
          aria-label="Type your message"
        />
        <button
          onClick={() => sendAssistantMessage(inputValue)}
          disabled={isSending || !inputValue.trim()}
          className={`ai-panel-send-btn ${inputValue.trim() && !isSending ? 'ai-panel-send-btn--active' : ''}`}
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
