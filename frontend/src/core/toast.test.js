import { sanitizeToastMessage } from './toast';

describe('sanitizeToastMessage', () => {
  it('translates JSON parsing errors to user-friendly copy', () => {
    const raw = 'SyntaxError: Unexpected token < in JSON at position 0';
    expect(sanitizeToastMessage(raw, 'error')).toBe(
      'The server returned an unexpected response. Please try again in a moment.'
    );
    expect(sanitizeToastMessage('Invalid JSON in request payload', 'error')).toBe(
      'The server returned an unexpected response. Please try again in a moment.'
    );
  });

  it('translates network fetch errors', () => {
    expect(sanitizeToastMessage('TypeError: Failed to fetch', 'error')).toBe(
      'Unable to reach the server. Please check your internet connection.'
    );
    expect(sanitizeToastMessage('NetworkError when attempting to fetch resource', 'error')).toBe(
      'Unable to reach the server. Please check your internet connection.'
    );
  });

  it('translates 500 internal server errors and tracebacks', () => {
    const raw = '500 Internal Server Error: Traceback (most recent call last)...';
    expect(sanitizeToastMessage(raw, 'error')).toBe(
      'Something went wrong on the server. Please try again later.'
    );
  });

  it('translates timeouts and gateway errors using word boundaries', () => {
    expect(sanitizeToastMessage('504 Gateway Time-out', 'error')).toBe(
      'The request took longer than expected and timed out. Please try again.'
    );
    expect(sanitizeToastMessage('HTTP 502 Bad Gateway', 'error')).toBe(
      'The service is temporarily unavailable. Please try again in a moment.'
    );
  });

  it('does not misfire on numbers appearing inside IDs or text', () => {
    expect(sanitizeToastMessage('Lead 5021 failed validation', 'error')).toBe(
      'Lead 5021 failed validation'
    );
    expect(sanitizeToastMessage('Batch 5040 pending review', 'error')).toBe(
      'Batch 5040 pending review'
    );
    expect(sanitizeToastMessage('Item 4290 exceeds count', 'error')).toBe(
      'Item 4290 exceeds count'
    );
  });

  it('translates quota and rate limit errors', () => {
    expect(sanitizeToastMessage('Rate limit exceeded: 429 Too Many Requests', 'error')).toBe(
      'Request limit reached. Please wait a moment before trying again.'
    );
    expect(sanitizeToastMessage('Monthly quota exceeded', 'error')).toBe(
      'Request limit reached. Please wait a moment before trying again.'
    );
  });

  it('translates auth / session expired errors', () => {
    expect(sanitizeToastMessage('Token expired: 401 Unauthorized', 'error')).toBe(
      'Your session has expired. Please refresh the page or sign in again.'
    );
    expect(sanitizeToastMessage('Missing or invalid session token', 'error')).toBe(
      'Your session has expired. Please refresh the page or sign in again.'
    );
  });

  it('strips Error: prefix without replacing valid business copy containing "at "', () => {
    expect(sanitizeToastMessage('Error: Could not save at this time', 'error')).toBe(
      'Could not save at this time'
    );
  });

  it('replaces Error: prefix with generic message when followed by stack frames or object artifacts', () => {
    expect(sanitizeToastMessage('Error: [object Object]', 'error')).toBe(
      'An unexpected error occurred. Please try again.'
    );
    expect(sanitizeToastMessage('Error: Failed\n    at Object.test (app.js:10:5)', 'error')).toBe(
      'An unexpected error occurred. Please try again.'
    );
  });

  it('preserves clean non-error messages', () => {
    const msg = 'Project created successfully';
    expect(sanitizeToastMessage(msg, 'success')).toBe(msg);
    expect(sanitizeToastMessage('Settings updated', 'info')).toBe('Settings updated');
  });

  it('handles empty or null error messages gracefully', () => {
    expect(sanitizeToastMessage('', 'error')).toBe(
      'An unexpected error occurred. Please try again.'
    );
    expect(sanitizeToastMessage(null, 'error')).toBe(
      'An unexpected error occurred. Please try again.'
    );
  });
});

