import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'pendingAgentPrefill';
const MAX_AGE_MS = 5 * 60 * 1000;
const READY_EVENT = 'enableAgents:pendingAgentPrefillReady';

/**
 * Reads and consumes a pending prefill payload left by AiAssistantPanel, IF
 * it matches this page's own agentKey. Mirrors the sessionStorage handoff
 * pattern already used by pendingTaskRoute (Home.js -> ChatRoutingPage.js).
 *
 * Runs on mount (the normal case: clicking "Open & Prefill" navigates here
 * from elsewhere) AND on a same-tab custom event (the case where the user
 * was already on this page when they clicked an older action card in the
 * panel - react-router doesn't remount/re-run effects for a navigate() to
 * the route you're already on, so without this a re-click on an old card
 * silently did nothing until the user left and came back).
 *
 * `onApply` is a caller-supplied callback (not a generic field->setter map)
 * because every agent's fields need a different state shape - flat
 * useState, nested object spreads, or a companion setShowXModal(true) call.
 *
 * Returns { prefill, dismiss } where prefill is
 * { fields, missingFields } | null, for rendering an AgentPrefillBanner.
 */
export function usePendingAgentPrefill(agentKey, onApply) {
  const [prefill, setPrefill] = useState(null);

  const tryApply = useCallback(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload.agentKey !== agentKey) return; // not for this page - leave it, some other page may still consume it
      if (Date.now() - (payload.createdAt || 0) > MAX_AGE_MS) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      onApply(payload.fields || []);
      setPrefill({ fields: payload.fields || [], missingFields: payload.missingFields || [] });
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  useEffect(() => {
    tryApply();
    window.addEventListener(READY_EVENT, tryApply);
    return () => window.removeEventListener(READY_EVENT, tryApply);
  }, [tryApply]);

  return { prefill, dismiss: () => setPrefill(null) };
}
