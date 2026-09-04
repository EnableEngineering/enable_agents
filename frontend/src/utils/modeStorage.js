/**
 * Mode Storage Utility
 *
 * Centralized storage for demo/live mode data segregation.
 * All agent data is stored under single keys to keep it organized:
 * - localStorage 'demoData': All demo mode data for all agents
 * - localStorage 'liveData': All live mode data for all agents
 *
 * Structure:
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

const DEMO_KEY = 'enableAgentsDemoData';
const LIVE_KEY = 'enableAgentsLiveData';

/**
 * Check if currently in demo mode. Default is Live when unset - was
 * `!== 'live'`, the opposite of the locked default. Same fix as
 * contexts/ModeContext.js and utils/demoApi.js, which duplicate this check.
 */
export const isDemoMode = () => {
  return localStorage.getItem('enableAgentsMode') === 'demo';
};

/**
 * Get the storage key based on mode
 */
const getStorageKey = (isDemo = isDemoMode()) => {
  return isDemo ? DEMO_KEY : LIVE_KEY;
};

/**
 * Get all data for current mode
 */
export const getAllModeData = (isDemo = isDemoMode()) => {
  try {
    const key = getStorageKey(isDemo);
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

/**
 * Get agent-specific data for current mode
 * @param {string} agentKey - The agent identifier (e.g., 'marketResearch', 'chatbot')
 * @param {boolean} isDemo - Override demo mode check
 */
export const getAgentData = (agentKey, isDemo = isDemoMode()) => {
  const key = getStorageKey(isDemo);
  const allData = getAllModeData(isDemo);
  const result = allData[agentKey] || null;
  console.log('[STORAGE_DEBUG] getAgentData:', agentKey, 'isDemo:', isDemo, 'storageKey:', key, 'hasData:', !!result);
  return result;
};

/**
 * Set agent-specific data for current mode
 * @param {string} agentKey - The agent identifier
 * @param {object} data - The data to store
 * @param {boolean} isDemo - Override demo mode check
 */
export const setAgentData = (agentKey, data, isDemo = isDemoMode()) => {
  try {
    const key = getStorageKey(isDemo);
    console.log('[STORAGE_DEBUG] setAgentData:', agentKey, 'isDemo:', isDemo, 'storageKey:', key);
    const allData = getAllModeData(isDemo);
    allData[agentKey] = data;
    localStorage.setItem(key, JSON.stringify(allData));
  } catch (e) {
    console.warn('Failed to save agent data:', e);
  }
};

/**
 * Update specific fields within agent data (merge)
 * @param {string} agentKey - The agent identifier
 * @param {object} updates - Fields to update/merge
 * @param {boolean} isDemo - Override demo mode check
 */
export const updateAgentData = (agentKey, updates, isDemo = isDemoMode()) => {
  const current = getAgentData(agentKey, isDemo) || {};
  setAgentData(agentKey, { ...current, ...updates }, isDemo);
};

/**
 * Clear agent data for specific mode
 * @param {string} agentKey - The agent identifier
 * @param {boolean} isDemo - Override demo mode check
 */
export const clearAgentData = (agentKey, isDemo = isDemoMode()) => {
  try {
    const key = getStorageKey(isDemo);
    const allData = getAllModeData(isDemo);
    delete allData[agentKey];
    localStorage.setItem(key, JSON.stringify(allData));
  } catch (e) {
    console.warn('Failed to clear agent data:', e);
  }
};

/**
 * Clear all data for specific mode
 * @param {boolean} isDemo - Override demo mode check
 */
export const clearAllModeData = (isDemo = isDemoMode()) => {
  try {
    const key = getStorageKey(isDemo);
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Failed to clear mode data:', e);
  }
};

/**
 * React hook for mode-aware storage
 * Returns current mode and functions to get/set agent data
 */
export const useModeStorage = (agentKey) => {
  const isDemo = isDemoMode();

  return {
    isDemo,
    getData: () => getAgentData(agentKey, isDemo),
    setData: (data) => setAgentData(agentKey, data, isDemo),
    updateData: (updates) => updateAgentData(agentKey, updates, isDemo),
    clearData: () => clearAgentData(agentKey, isDemo),
  };
};

// Agent key constants for consistency
export const AGENT_KEYS = {
  MARKET_RESEARCH: 'marketResearch',
  CHATBOT: 'chatbot',
  CAMPAIGNS: 'campaigns',
  SALES_HELPER: 'salesHelper',
  EXECUTIVE_ASSISTANT: 'executiveAssistant',
  CONTENT_MARKETING: 'contentMarketing',
  COMMUNITY_NETWORK: 'communityNetwork',
  DATA_INSIGHTS: 'dataInsights',
};
