/**
 * Agent Data Storage Utility
 *
 * Centralized localStorage persistence for per-agent UI state, keyed under
 * a single 'enableAgentsLiveData' object so it stays organized:
 * {
 *   marketResearch: { results, savedLists, overview, ... },
 *   chatbot: { messages, history },
 *   campaigns: { campaigns, recipients },
 *   salesHelper: { projects, leads, campaigns },
 *   executiveAssistant: { projects, tasks, people },
 *   contentMarketing: { content, messages },
 *   communityNetwork: { messages },
 *   dataInsights: { insights, previousPrompts }
 * }
 */

const STORAGE_KEY = 'enableAgentsLiveData';

/**
 * Get all stored agent data
 */
export const getAllModeData = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

/**
 * Get agent-specific data
 * @param {string} agentKey - The agent identifier (e.g., 'marketResearch', 'chatbot')
 */
export const getAgentData = (agentKey) => {
  const allData = getAllModeData();
  return allData[agentKey] || null;
};

/**
 * Set agent-specific data
 * @param {string} agentKey - The agent identifier
 * @param {object} data - The data to store
 */
export const setAgentData = (agentKey, data) => {
  try {
    const allData = getAllModeData();
    allData[agentKey] = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
  } catch (e) {
    console.warn('Failed to save agent data:', e);
  }
};

/**
 * Update specific fields within agent data (merge)
 * @param {string} agentKey - The agent identifier
 * @param {object} updates - Fields to update/merge
 */
export const updateAgentData = (agentKey, updates) => {
  const current = getAgentData(agentKey) || {};
  setAgentData(agentKey, { ...current, ...updates });
};

/**
 * Clear agent data
 * @param {string} agentKey - The agent identifier
 */
export const clearAgentData = (agentKey) => {
  try {
    const allData = getAllModeData();
    delete allData[agentKey];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
  } catch (e) {
    console.warn('Failed to clear agent data:', e);
  }
};

/**
 * Clear all stored agent data
 */
export const clearAllModeData = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear mode data:', e);
  }
};

/**
 * React hook for agent-scoped storage
 */
export const useModeStorage = (agentKey) => {
  return {
    getData: () => getAgentData(agentKey),
    setData: (data) => setAgentData(agentKey, data),
    updateData: (updates) => updateAgentData(agentKey, updates),
    clearData: () => clearAgentData(agentKey),
  };
};

// Agent key constants for consistency. Values must match the `id`s in
// frontend/src/config/agentsConfig.js's AGENTS registry (that file is the
// canonical source per its own docstring) - CHATBOT was drifted to
// 'chatbot' instead of 'aiChatbot' and several ready agents were missing
// entirely. Neither the drifted value nor the gap had a live consumer
// (nothing currently reads AGENT_KEYS.CHATBOT), so this is a safe,
// no-blast-radius correction, not a behavior change.
export const AGENT_KEYS = {
  MARKET_RESEARCH: 'marketResearch',
  CHATBOT: 'aiChatbot',
  CAMPAIGNS: 'campaigns',
  SALES_HELPER: 'salesHelper',
  EXECUTIVE_ASSISTANT: 'executiveAssistant',
  CONTENT_MARKETING: 'contentMarketing',
  COMMUNITY_NETWORK: 'communityNetwork',
  DATA_INSIGHTS: 'dataInsights',
  EVENT_NETWORKING: 'eventNetworking',
  EMAIL_OUTREACH: 'emailOutreach',
  SUPPLY_CHAIN_AUDIT: 'supplyChainAudit',
};
