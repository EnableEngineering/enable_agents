import { API_CONFIG } from '../config/apiConfig';

/** Merge JSON headers with optional Bearer session token from login/register/OAuth */

export function authJsonHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };

  if (typeof localStorage !== 'undefined') {
    // Add session token for auth
    const token = localStorage.getItem('sessionToken');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Add X-User-Id for routes that use it directly
    const userEmail = localStorage.getItem('userEmail');
    if (userEmail) {
      headers['X-User-Id'] = userEmail;
    }
  }

  return headers;
}

/**
 * Post-login/register routing: returning users (already have a project) go
 * straight to the Dashboard; first-time users land on the agent catalog.
 * Fails open to /agents if the check itself fails, rather than blocking on
 * a broken state.
 */
export async function navigateAfterLogin(navigate) {
  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/api/projects`, {
      headers: authJsonHeaders(),
    });
    const data = await res.json();
    if (Array.isArray(data.projects) && data.projects.length > 0) {
      navigate('/dashboard');
      return;
    }
  } catch {
    // fall through to /agents
  }
  navigate('/agents');
}

/** For GET requests: only add Authorization when logged in. */
export function authOptionalHeaders(extra = {}) {
  const headers = { ...extra };

  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const userEmail = localStorage.getItem('userEmail');
    if (userEmail) {
      headers['X-User-Id'] = userEmail;
    }
  }

  return headers;
}
