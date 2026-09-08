import axios from 'axios';
import { showToast } from './toast';

// The backend's @require_auth rejects a missing/invalid Bearer token with a
// 401, and that's the *only* thing a 401 means in this API (see
// backend/core/auth.py). Nearly every request goes through fetch() with
// authJsonHeaders()/authOptionalHeaders() (a handful through axios in
// AiAssistantPanel.js), and none of them currently distinguish "logged out"
// from "an API returned zero rows" - so an expired/invalidated session token
// just quietly renders every page as empty instead of prompting sign-in
// again. Patching fetch/axios once here, app-wide, is far less risky than
// touching every call site individually.
//
// A genuine network failure (offline, DNS, connection reset - anything that
// never gets an HTTP response at all) hits the exact same silent-empty-state
// problem for a different reason, and most call sites' own try/catch just
// swallows it the same way. This module handles both: it never blocks or
// replaces a page's own error handling (the original error/rejection is
// always re-thrown/re-rejected), it only adds a visible signal on top.
let expiryHandled = false;
let lastNetworkErrorToastAt = 0;
const NETWORK_ERROR_TOAST_COOLDOWN_MS = 8000; // several requests failing together (e.g. a dashboard's parallel fetches) should surface as one toast, not a stack of identical ones

function isAuthEndpoint(url) {
  return /\/(login|register)(\?|$)/.test(url || '');
}

function notifyNetworkError() {
  const now = Date.now();
  if (now - lastNetworkErrorToastAt < NETWORK_ERROR_TOAST_COOLDOWN_MS) return;
  lastNetworkErrorToastAt = now;
  showToast('Network error. Some data may not have loaded. Check your connection and try again.', 'error');
}

function handleExpiredSession() {
  if (expiryHandled) return;
  if (!localStorage.getItem('sessionToken')) return; // never had a session to expire
  expiryHandled = true;

  localStorage.removeItem('sessionToken');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('firstName');
  localStorage.removeItem('lastName');
  sessionStorage.clear();

  showToast('Your session has expired. Please sign in again.', 'warning');
  // Full reload rather than client-side navigate: this runs outside React,
  // and a fresh load guarantees every component starts from a clean,
  // logged-out state instead of stale in-memory data from the old session.
  window.location.href = '/login';
}

export function installSessionExpiryHandler() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    let response;
    try {
      response = await originalFetch(...args);
    } catch (err) {
      // Connection-level failure - no HTTP response was ever received.
      notifyNetworkError();
      throw err;
    }
    if (response.status === 401) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!isAuthEndpoint(url)) handleExpiredSession();
    }
    return response;
  };

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401 && !isAuthEndpoint(error.config?.url)) {
        handleExpiredSession();
      } else if (!error?.response) {
        // Axios has no `response` at all for a network-level failure
        // (as opposed to a real HTTP error status).
        notifyNetworkError();
      }
      return Promise.reject(error);
    }
  );
}
