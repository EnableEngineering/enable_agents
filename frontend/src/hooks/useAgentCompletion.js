import { useEffect } from 'react';

const AGENT_COMPLETED_EVENT = 'enableAgents:agentCompleted';

/**
 * Fire-and-forget "callback" for agent pages to call right after a real,
 * user-actionable result lands (leads found, content generated, campaign
 * sent, etc.) - independent of whether the user ever chatted with the AI
 * Assistant. AiAssistantPanel listens globally and turns this into a
 * proactive next-step suggestion, since running an agent from its own page
 * (the normal path) never touches /assistant_chat at all.
 */
export function notifyAgentCompleted(agentKey, summary, contextFields) {
  window.dispatchEvent(new CustomEvent(AGENT_COMPLETED_EVENT, { detail: { agentKey, summary, contextFields } }));
}

export function useAgentCompletionListener(callback) {
  useEffect(() => {
    const handler = (e) => callback(e.detail);
    window.addEventListener(AGENT_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(AGENT_COMPLETED_EVENT, handler);
  }, [callback]);
}
