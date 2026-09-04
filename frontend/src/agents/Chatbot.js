import { API_CONFIG } from '../config/apiConfig';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import Header from '../core/Header';
import { BackButton, LiveModeHint, AgentOutcomesStrip, ProjectSelector, ProjectGate } from '../components';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { authJsonHeaders } from '../core/authHeaders';
import '../styles/agent-shell.css';
import '../styles/Chatbot.css';

// Storage key for state persistence
const STATE_KEY = 'chatbotState';

function Chatbot() {
  const selectedProjectId = useSelectedProjectId();

  // Load persisted state
  const loadPersistedState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  // Load messages from sessionStorage or default
  const [messages, setMessages] = useState(() => {
    const saved = loadPersistedState();
    return saved.messages || [{ sender: 'ai', text: 'Hi! Ask me anything about your documents.' }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState(() => {
    const saved = loadPersistedState();
    return saved.chatHistory || [{ subject: 'Welcome', summary: 'Introduction to the chatbot.' }];
  });
  const chatEndRef = useRef(null);

  // Persist state to sessionStorage
  useEffect(() => {
    const state = { messages, chatHistory };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [messages, chatHistory]);

  // Clear state when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setMessages([{ sender: 'ai', text: 'Hi! Ask me anything about your documents.' }]);
      setChatHistory([{ subject: 'Welcome', summary: 'Introduction to the chatbot.' }]);
    }
  }, [selectedProjectId]);

  const botProps = {
    description: "This AI chatbot helps you query and analyze your uploaded documents.",
    expertise: "Document Q&A, Data Extraction, Summarization",
    dataSources: "Uploaded PDFs, Internal Knowledge Base",
    responseFormat: "Concise, Contextual, Human-readable"
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage = { sender: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/document-intelligence/chat`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          query: input,
          project_id: selectedProjectId,
        }),
      });
      const data = await response.json();
      const answer = data.answer || data.error || 'No answer found.';
      const sources = data.sources || [];

      let responseText = answer;
      if (sources.length > 0) {
        responseText += `\n\n*Sources: ${sources.map(s => `Page ${s.page_number || s.chunk_index || '?'}`).join(', ')}*`;
      }

      setMessages(prev => [...prev, { sender: 'ai', text: responseText }]);
      setChatHistory(prev => [
        { subject: input.slice(0, 30) + (input.length > 30 ? '...' : ''), summary: answer.slice(0, 50) + '...' },
        ...prev.slice(0, 9)
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [
        ...prev,
        { sender: 'ai', text: 'Error contacting server. Please try again.' }
      ]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) sendMessage();
  };

  return (
    <div className="chatbot-agent-page">
      <Header />
      <div className="agent-page-header">
        <div className="agent-header-left">
          <BackButton />
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>AI Chatbot</h1>
            </div>
            <p className="text-muted">Query and analyze uploaded documents with conversational AI.</p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector agentKey="chatbot" />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/chat.png', title: 'Document Q&A', description: 'Ask questions about uploaded files.' },
          { iconSrc: '/assets/icons/retrieval.png', title: 'Data extraction', description: 'Pull facts and summaries from docs.' },
          { iconSrc: '/assets/icons/document.png', title: 'Chat history', description: 'Review past queries and answers.' },
        ]}
      />

      <LiveModeHint message="Upload documents in Live mode, or switch to Demo for sample responses." requireProject={true} />

      <ProjectGate agentLabel="AI Chatbot">
        <div className="chatbot-page">
          <div className="chatbot-layout">
            <div className="chatbot-properties">
              <h3>Chatbot Properties</h3>
              <div><strong>Description:</strong> <span>{botProps.description}</span></div>
              <div><strong>Expertise:</strong> <span>{botProps.expertise}</span></div>
              <div><strong>Data Sources:</strong> <span>{botProps.dataSources}</span></div>
              <div><strong>Response Format:</strong> <span>{botProps.responseFormat}</span></div>
            </div>
            <div className="chatbot-card">
              <h2 className="chatbot-title">AI Chatbot</h2>
              <div className="chatbot-window">
                <div className="chatbot-messages">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`chatbot-message ${msg.sender === 'user' ? 'user' : 'ai'}`}
                    >
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="chatbot-input-row">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your question..."
                    disabled={loading}
                  />
                  <button type="button" onClick={sendMessage} disabled={loading || !input.trim()}>
                    {loading ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
            <div className="chatbot-history">
              <h3>Chat History</h3>
              <ul>
                {chatHistory.map((item, idx) => (
                  <li key={idx}>
                    <strong>{item.subject}</strong>
                    <div className="chatbot-history-summary">{item.summary}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </ProjectGate>
    </div>
  );
}

export default Chatbot;
