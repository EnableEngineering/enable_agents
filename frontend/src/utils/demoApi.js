/**
 * Demo API Helper
 *
 * Intercepts API calls when in demo mode and returns demo data instead.
 * This prevents real AI calls, database writes, and external API requests.
 *
 * Usage:
 *   import { demoFetch, isDemoMode } from '../utils/demoApi';
 *
 *   // Instead of fetch(), use demoFetch()
 *   const response = await demoFetch('/api/generate', { method: 'POST', body: ... });
 *
 *   // Or check mode manually
 *   if (isDemoMode()) {
 *     // Return demo data
 *   } else {
 *     // Make real API call
 *   }
 */

import { getDemoData } from '../data/demo';

/**
 * Check if demo mode is enabled. Default is Live when unset - was
 * `!== 'live'` (defaults to Demo for anything else, including every
 * first-time visitor), the opposite of the locked default. Same fix as
 * contexts/ModeContext.js, which duplicates this same check.
 */
export function isDemoMode() {
  return localStorage.getItem('enableAgentsMode') === 'demo';
}

/**
 * Demo responses for common API endpoints
 * Returns null if no demo response is configured (will fall through to real API)
 */
const DEMO_RESPONSES = {
  // AI Generation endpoints - return canned responses
  '/api/generate': {
    success: true,
    content: 'This is a demo-generated response. Switch to Live mode to use real AI.',
    model: 'demo',
  },
  '/api/chat': {
    success: true,
    message: 'This is a demo chat response. Switch to Live mode for real AI conversations.',
    model: 'demo',
  },
  '/api/analyze': {
    success: true,
    analysis: 'Demo analysis result. Switch to Live mode for real AI analysis.',
    insights: ['Demo insight 1', 'Demo insight 2'],
  },

  // Email generation
  '/api/generate-email': {
    success: true,
    subject: '[DEMO] Sample Email Subject',
    body: 'This is a demo-generated email body.\n\nIn Live mode, this would be personalized AI-generated content based on your inputs.\n\nBest regards,\nYour AI Assistant',
  },
  '/api/send-email': {
    success: true,
    message: 'Demo mode: Email not actually sent. Switch to Live mode to send real emails.',
    messageId: 'demo-msg-' + Date.now(),
  },

  // Lead/Contact extraction
  '/api/extract-leads': {
    success: true,
    message: 'Demo mode: Using sample lead data.',
    leads: getDemoData('marketResearch').leads?.slice(0, 3) || [],
  },
  '/api/extract-emails': {
    success: true,
    message: 'Demo mode: Email extraction simulated.',
    emails: ['demo1@example.com', 'demo2@example.com'],
  },

  // Campaign operations
  '/api/campaigns': {
    success: true,
    campaigns: getDemoData('marketResearch').campaigns || [],
  },
  '/api/create-campaign': {
    success: true,
    message: 'Demo mode: Campaign created locally.',
    campaign: { id: 'demo-campaign-' + Date.now(), name: 'Demo Campaign', status: 'draft' },
  },

  // Content generation
  '/api/generate-content': {
    success: true,
    content: 'This is demo-generated content.\n\nIn Live mode, the AI would generate personalized content based on your requirements, brand voice, and target audience.\n\nKey points:\n- Point 1\n- Point 2\n- Point 3',
    wordCount: 50,
  },

  // Data insights
  '/api/analyze-data': {
    success: true,
    message: 'Demo mode: Using sample insights.',
    insights: getDemoData('dataInsights').insights || [],
  },

  // Task operations (Executive Assistant)
  '/api/tasks': {
    success: true,
    tasks: getDemoData('executiveAssistant').tasks || [],
  },
  '/api/send-reminder': {
    success: true,
    message: 'Demo mode: Reminder not actually sent. Switch to Live mode for real notifications.',
  },

  // Recommendations
  '/recommend_agents': {
    success: true,
    recommendations: {
      message: 'Demo mode: Sample recommendations',
      agents: ['Market Research', 'Sales Helper', 'Content Marketing'],
    },
  },
  '/get_tools_landscape': {
    success: true,
    tools: [],
  },

  // Health check (always allow)
  '/health': null,
};

/**
 * Get demo response for an endpoint
 * @param {string} url - API endpoint URL
 * @returns {object|null} Demo response or null if not configured
 */
function getDemoResponse(url) {
  // Extract path from full URL
  const path = url.includes('://') ? new URL(url).pathname : url;

  // Check exact match first
  if (DEMO_RESPONSES[path] !== undefined) {
    return DEMO_RESPONSES[path];
  }

  // Check partial matches (for endpoints with IDs)
  for (const [pattern, response] of Object.entries(DEMO_RESPONSES)) {
    if (path.startsWith(pattern) || path.includes(pattern)) {
      return response;
    }
  }

  // Check for common AI/generation patterns
  if (path.includes('generate') || path.includes('ai') || path.includes('gpt') || path.includes('llm')) {
    return {
      success: true,
      content: 'Demo mode: AI generation disabled. Switch to Live mode for real AI responses.',
      model: 'demo',
    };
  }

  // Check for send/notify patterns
  if (path.includes('send') || path.includes('notify') || path.includes('email') || path.includes('sms') || path.includes('whatsapp')) {
    return {
      success: true,
      message: 'Demo mode: Message not sent. Switch to Live mode to send real messages.',
    };
  }

  return null;
}

/**
 * Demo-aware fetch wrapper
 * In demo mode, returns demo data instead of making real API calls
 *
 * @param {string} url - API URL
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} Response object (real or mocked)
 */
export async function demoFetch(url, options = {}) {
  // Always allow in live mode
  if (!isDemoMode()) {
    return fetch(url, options);
  }

  // Check if we have a demo response for this endpoint
  const demoResponse = getDemoResponse(url);

  // If no demo response configured, allow the real call (for read operations)
  if (demoResponse === null) {
    return fetch(url, options);
  }

  // For write operations in demo mode, return demo response
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET' && demoResponse === null) {
    return fetch(url, options);
  }

  // Log demo interception (helpful for debugging)
  console.log(`[Demo Mode] Intercepted ${method} ${url}`);

  // Return mocked response
  return new Response(JSON.stringify(demoResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Show demo mode warning toast
 * Call this when user tries to perform an action that's disabled in demo mode
 */
export function showDemoWarning(action = 'This action') {
  const { showToast } = require('../core/toast');
  showToast(`${action} is disabled in Demo mode. Switch to Live mode to continue.`, 'warning');
}

/**
 * Wrapper for AI-specific calls
 * Always returns demo response in demo mode
 */
export async function demoAiFetch(url, options = {}) {
  if (isDemoMode()) {
    console.log(`[Demo Mode] AI call blocked: ${url}`);
    return new Response(JSON.stringify({
      success: true,
      content: 'Demo mode: AI features disabled. Switch to Live mode for real AI responses.',
      model: 'demo',
      demo: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return fetch(url, options);
}

export default {
  isDemoMode,
  demoFetch,
  demoAiFetch,
  showDemoWarning,
  getDemoResponse,
};
