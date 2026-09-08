/**
 * Centralized Agents/Modules Configuration
 *
 * Single source of truth for all agent metadata.
 * Update this file to add/modify agents - no need to change multiple files.
 */

export const AGENT_CATEGORIES = {
  BUSINESS: 'business',
  TECHNICAL: 'technical',
};

export const AGENT_STATUS = {
  READY: 'ready',
  COMING_SOON: 'coming_soon',
  IN_PROGRESS: 'in_progress',
};

/**
 * All agents configuration
 *
 * Each agent has:
 * - id: Unique identifier (used as key)
 * - name: Display name
 * - route: URL path for navigation
 * - icon: Icon filename or emoji
 * - description: Short description (2-3 lines)
 * - category: 'business' or 'technical'
 * - status: 'ready', 'coming_soon', or 'in_progress'
 * - price: Pricing display string
 * - features: Array of key features (optional)
 */
export const AGENTS = {
  marketResearch: {
    id: 'marketResearch',
    name: 'Market Research',
    route: '/market-research',
    icon: 'search-analysis.png',
    description: 'Discover market trends, analyze competitors, and gather customer insights to make data-driven decisions.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$29/month',
    features: ['Lead Generation', 'Competitor Analysis', 'Market Trends'],
    nextStep: { agentKey: 'emailOutreach', reason: 'reach out to the leads you just found' },
  },

  salesHelper: {
    id: 'salesHelper',
    name: 'Sales Helper',
    route: '/sales-helper',
    icon: 'increase.png',
    description: 'Supercharge your sales with CRM integration, and intelligent recommendations.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$45/month',
    features: ['CRM Integration', 'Lead Scoring', 'Sales Analytics'],
    nextStep: { agentKey: 'emailOutreach', reason: 'reach out to your ranked prospects' },
  },

  contentMarketing: {
    id: 'contentMarketing',
    name: 'Content Marketing',
    route: '/content-marketing',
    icon: 'bullhorn.png',
    description: 'Create engaging content, manage campaigns, and analyze performance across channels.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$35/month',
    features: ['Content Generation', 'Campaign Management', 'Analytics'],
    nextStep: { agentKey: 'emailOutreach', reason: 'send what you just generated' },
  },

  communityNetwork: {
    id: 'communityNetwork',
    name: 'Community Network',
    route: '/community-network',
    icon: 'community.png',
    description: 'Build and engage your community with AI-powered networking and relationship management.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$25/month',
    features: ['Community Building', 'Engagement Tools', 'Network Analysis'],
    nextStep: { agentKey: 'eventNetworking', reason: 'turn these connections into an event' },
  },

  eventNetworking: {
    id: 'eventNetworking',
    name: 'Event Networking',
    route: '/event-networking',
    icon: 'networking.png',
    description: 'Maximize event ROI with smart attendee matching and follow-up automation.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$30/month',
    features: ['Attendee Matching', 'Follow-up Automation', 'Event Analytics'],
    nextStep: { agentKey: 'emailOutreach', reason: 'send post-event follow-ups' },
  },

  executiveAssistant: {
    id: 'executiveAssistant',
    name: 'Executive Assistant',
    route: '/executive-assistant',
    icon: 'hr.png',
    description: 'Your AI-powered executive assistant for task management, reminders, and stakeholder coordination via WhatsApp.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: 'Free',
    features: ['Task Management', 'WhatsApp Integration', 'Scheduling'],
    nextStep: null,
  },

  dataInsights: {
    id: 'dataInsights',
    name: 'Data Insights',
    route: '/data-insights',
    icon: 'data-discovery.png',
    description: 'Transform raw data into actionable insights with AI-powered analytics and visualization.',
    category: AGENT_CATEGORIES.TECHNICAL,
    status: AGENT_STATUS.READY,
    price: '$49/month',
    features: ['Data Visualization', 'Predictive Analytics', 'Reports'],
    nextStep: { agentKey: 'contentMarketing', reason: 'act on what the document revealed' },
  },

  emailOutreach: {
    id: 'emailOutreach',
    name: 'Email Outreach',
    route: '/email-outreach',
    icon: 'mail.png',
    description: 'Send personalized bulk emails to suppliers, leads, or contacts with templates and tracking.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$25/month',
    features: ['Email Templates', 'Bulk Sending', 'Response Tracking'],
    nextStep: { agentKey: 'salesHelper', reason: 'track responses and follow up' },
  },

  supplyChainAudit: {
    id: 'supplyChainAudit',
    name: 'Supply Chain Audit',
    route: '/supply-chain-agent',
    icon: 'supply-chain-management.png',
    description: 'Qualify suppliers through capability and compliance audits with weighted scoring.',
    category: AGENT_CATEGORIES.BUSINESS,
    status: AGENT_STATUS.READY,
    price: '$40/month',
    features: ['Supplier Audits', 'Compliance Scoring', 'Qualification Tracking'],
    nextStep: { agentKey: 'executiveAssistant', reason: 'track follow-up tasks from the audit' },
  },

  // Hidden - placeholder only
  investAgent: {
    id: 'investAgent',
    name: 'Investment Agent',
    route: '/invest-agent',
    icon: 'save-money.png',
    description: 'Make smarter investment decisions with AI-powered market analysis and portfolio recommendations.',
    category: AGENT_CATEGORIES.TECHNICAL,
    status: AGENT_STATUS.COMING_SOON,
    hidden: true,
    price: '$65/month',
    features: ['Market Analysis', 'Portfolio Tracking', 'Risk Assessment'],
  },

  // Hidden - placeholder only
  teamPerformance: {
    id: 'teamPerformance',
    name: 'Team Performance',
    route: '/team-performance',
    icon: 'performance.png',
    description: 'Track team productivity, evaluate performance, and identify areas for improvement with analytics.',
    category: AGENT_CATEGORIES.TECHNICAL,
    status: AGENT_STATUS.COMING_SOON,
    hidden: true,
    price: '$39/month',
    features: ['Performance Tracking', 'Team Analytics', 'Goal Management'],
  },

  aiChatbot: {
    id: 'aiChatbot',
    name: 'AI Chatbot',
    // Was '/ai-chatbot' - doesn't exist; the real route (App.js) is
    // '/aichatbot'. Was also marked hidden/coming_soon despite Chatbot.js
    // being a complete, working page - fixed both, since the only current
    // consumer of getAllAgents()/hidden (Dashboard's "available agents"
    // count) was undercounting a real feature, not gating a real link.
    route: '/aichatbot',
    icon: 'ai-chatbots.png',
    description: 'Deploy intelligent chatbots for customer support and lead qualification.',
    category: AGENT_CATEGORIES.TECHNICAL,
    status: AGENT_STATUS.READY,
    price: '$40/month',
    features: ['Customer Support', 'Lead Qualification', 'Multi-channel'],
    nextStep: null,
  },
};

/**
 * Helper functions
 */

// Get agent by route path
export const getAgentByRoute = (route) => {
  return Object.values(AGENTS).find(agent => agent.route === route);
};

// Get agent by name
export const getAgentByName = (name) => {
  return Object.values(AGENTS).find(
    agent => agent.name.toLowerCase() === name.toLowerCase()
  );
};

// Get agent by ID
export const getAgentById = (id) => {
  return AGENTS[id];
};

// Get all agents as array (excluding hidden)
export const getAllAgents = () => {
  return Object.values(AGENTS).filter(agent => !agent.hidden);
};

// Get agents by category (excluding hidden)
export const getAgentsByCategory = (category) => {
  return Object.values(AGENTS).filter(agent => agent.category === category && !agent.hidden);
};

// Get business modules
export const getBusinessAgents = () => {
  return getAgentsByCategory(AGENT_CATEGORIES.BUSINESS);
};

// Get technical modules
export const getTechnicalAgents = () => {
  return getAgentsByCategory(AGENT_CATEGORIES.TECHNICAL);
};

// Get ready agents only (excluding hidden)
export const getReadyAgents = () => {
  return Object.values(AGENTS).filter(agent => agent.status === AGENT_STATUS.READY && !agent.hidden);
};

// Check if agent is ready
export const isAgentReady = (agentId) => {
  const agent = AGENTS[agentId];
  return agent?.status === AGENT_STATUS.READY;
};

// Route to agent name mapping (for Header breadcrumbs)
export const ROUTE_TO_AGENT_NAME = Object.values(AGENTS).reduce((acc, agent) => {
  acc[agent.route] = agent.name;
  return acc;
}, {});

/**
 * Module display name to route mapping
 * Used for navigation from module cards
 * Maps the exact display names used in the UI to their routes
 */
// Entries removed here (2026-09-04 cleanup) pointed at routes that don't
// exist anywhere in App.js and don't correspond to any AGENTS entry either
// - not "future roadmap" placeholders, just orphaned from an earlier,
// abandoned broader-catalog draft: Travel Agent, the duplicate/wrong
// 'Supply Chain Agent' -> /supply-chain (real route is /supply-chain-agent,
// already correct under 'Supply Chain Audit' below), Hiring & Onboarding,
// Documents, Supplier Tracking, Invoices, Inventory, Orders, Reports,
// Testing AI, LLM Benchmarking. 'Team Performance' -> /team-performance is
// kept despite the route not existing yet, since it mirrors AGENTS.teamPerformance
// (a real, still-pending COMING_SOON feature, not dead weight).
export const MODULE_NAME_TO_ROUTE = {
  // Business modules
  'Market Research': '/market-research',
  'Executive Assistant Agent': '/executive-assistant',
  'Sales Helper Agent': '/sales-helper',
  'Content Marketing Agent': '/content-marketing',
  'Community Network': '/community-network',
  'Event Networking Agent': '/event-networking',
  'Email Outreach': '/email-outreach',
  'Supply Chain Audit': '/supply-chain-agent',
  'Invest Agent': '/invest-agent',
  'Team Performance': '/team-performance',

  // Technical modules
  'Data Discovery': '/data-insights',
  'AI Chatbot': '/aichatbot',
  'Data Insights': '/data-insights',
};

/**
 * Get route for a module by its display name
 * @param {string} moduleName - The display name of the module
 * @returns {string|null} - The route path or null if not found
 */
export const getRouteByModuleName = (moduleName) => {
  return MODULE_NAME_TO_ROUTE[moduleName] || null;
};

/**
 * Navigate to a module by its display name
 * Use with react-router's navigate function:
 *
 * const navigate = useNavigate();
 * const route = getRouteByModuleName(moduleName);
 * if (route) navigate(route);
 */

export default AGENTS;
