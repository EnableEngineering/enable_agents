/** Merge JSON headers with optional Bearer session token from login/register/OAuth */

/**
 * The project the user is working in (?project= in the URL), sent on every API
 * call so the backend can attribute AI spend to it - most agent code logs its
 * calls without a project, and per-project cost/budgets would otherwise miss
 * them. The server only honors it if the user can access that project.
 */
function projectHeader() {
  if (typeof window === 'undefined') return {};
  const project = new URLSearchParams(window.location.search).get('project');
  return project ? { 'X-Project-Id': project } : {};
}

export function authJsonHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...projectHeader(),
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
 * Post-login/register routing: everyone lands on the chat-first Home screen.
 */
export function navigateAfterLogin(navigate) {
  // Chat-first Home is the universal post-login landing screen now, for
  // both new and returning users - it replaces the old branch-by-project-
  // history logic (dashboard for returning users, catalog for new ones).
  navigate('/home');
}

/** For GET requests: only add Authorization when logged in. */
export function authOptionalHeaders(extra = {}) {
  const headers = { ...projectHeader(), ...extra };

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
