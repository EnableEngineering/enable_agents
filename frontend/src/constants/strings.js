/**
 * Centralized Strings for Localization
 *
 * All user-facing strings should be defined here for easy i18n support.
 * Group strings by module/feature for organization.
 *
 * Usage:
 *   import { STRINGS } from '../constants/strings';
 *   showToast(STRINGS.COMMON.SAVE_SUCCESS, 'success');
 *   showConfirm({ title: STRINGS.DIALOGS.DELETE_TITLE, message: STRINGS.DIALOGS.DELETE_CONFIRM });
 *
 * Future i18n:
 *   Replace this file with a function that returns strings based on locale:
 *   export const STRINGS = getStrings(currentLocale);
 */

export const STRINGS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMON — Used across multiple modules
  // ═══════════════════════════════════════════════════════════════════════════
  COMMON: {
    SAVE_SUCCESS: 'Saved successfully',
    SAVE_ERROR: 'Failed to save. Please try again.',
    DELETE_SUCCESS: 'Deleted successfully',
    DELETE_ERROR: 'Failed to delete. Please try again.',
    LOAD_ERROR: 'Failed to load data. Please try again.',
    COPY_SUCCESS: 'Copied to clipboard',
    COPY_ERROR: 'Failed to copy to clipboard',
    REQUIRED_FIELDS: 'Please fill in all required fields',
    NETWORK_ERROR: 'Network error. Please check your connection.',
    TIMEOUT_ERROR: 'Request timed out. Please try again.',
    TRY_AGAIN: 'Try Again',
    CANCEL: 'Cancel',
    SAVE: 'Save',
    DELETE: 'Delete',
    EDIT: 'Edit',
    CLOSE: 'Close',
    CONFIRM: 'Confirm',
    LOADING: 'Loading...',
    SAVING: 'Saving...',
    PROCESSING: 'Processing...',
    ANALYZING: 'Analyzing...',
    GENERATING: 'Generating...',
    THINKING: 'Working on it...',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING STATES — Specific loading messages
  // ═══════════════════════════════════════════════════════════════════════════
  LOADING: {
    WORKFLOWS: 'Loading workflows...',
    DOCUMENTS: 'Loading documents...',
    AGENTS: 'Loading assistants...',
    PROJECTS: 'Loading projects...',
    TEAM: 'Loading team members...',
    SETTINGS: 'Loading settings...',
    CHAT_HISTORY: 'Loading conversation...',
    RECOMMENDATIONS: 'Analyzing your needs...',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIALOGS — Confirmation dialogs
  // ═══════════════════════════════════════════════════════════════════════════
  DIALOGS: {
    DELETE_TITLE: 'Delete Item',
    DELETE_CONFIRM: 'Are you sure you want to delete this item? This action cannot be undone.',
    DELETE_LIST_TITLE: 'Delete Saved List',
    DELETE_LIST_CONFIRM: 'Delete this saved list permanently?',
    UNSAVED_CHANGES_TITLE: 'Unsaved Changes',
    UNSAVED_CHANGES_CONFIRM: 'You have unsaved changes. Are you sure you want to leave?',
    LOGOUT_TITLE: 'Sign Out',
    LOGOUT_CONFIRM: 'Are you sure you want to sign out?',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEMO MODE — Demo/Live mode messages
  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET RESEARCH — RequirementsGathering module
  // ═══════════════════════════════════════════════════════════════════════════
  MARKET_RESEARCH: {
    FILL_REQUIRED: 'Please fill in Overview, Industries, and Region/Countries for research',
    NO_DATA_COPY: 'No data to copy.',
    NO_DATA_EXPORT: 'No data available to export.',
    NO_LEADS_TO_SAVE: 'No leads available to save.',
    NO_VENDORS_TO_SAVE: 'No vendors available to save.',
    NO_LEADS_TO_SCORE: 'No leads available to score.',
    NO_VENDORS_TO_SCORE: 'No vendors available to score.',
    NO_LEADS_TO_ENRICH: 'No leads to enrich with emails',
    NO_VENDORS_TO_ENRICH: 'No vendors to enrich with emails',
    PROVIDE_LIST_NAME: 'Please provide a name for the list.',
    SELECT_LIST_TO_APPEND: 'Please select a list to append to.',
    PROVIDE_SCORING_CRITERIA: 'Please provide a short description of what you want to match for.',
    WEBSITE_NOT_AVAILABLE: 'Website not available for this business.',
    EMAIL_EXTRACTION_TIMEOUT: 'Email extraction timed out. Please try again.',
    LINKEDIN_EXTRACTION_TIMEOUT: 'LinkedIn extraction timed out. Please try again.',
    EXTRACTION_ERROR: 'Error extracting data. Please try again.',
    LEADS_SAVED_SUCCESS: 'Leads list saved successfully!',
    VENDORS_SAVED_SUCCESS: 'Vendors list saved successfully!',
    LEADS_APPENDED_SUCCESS: 'Leads appended successfully!',
    SCORING_COMPLETE: 'Scoring complete',
    SCORING_FAILED: 'Scoring failed',
    ENRICHMENT_SUCCESS: 'Successfully enriched businesses with email data!',
    ENRICHMENT_FAILED: 'Failed to enrich businesses with emails',
    GOOGLE_SHEETS_COPIED: 'Google Sheets opened. Data is copied to clipboard, paste with Ctrl+V.',
    EXPORT_FAILED: 'Export failed. Please try again.',
    GOOGLE_CREDENTIALS_MISSING: 'Google credentials not configured. Contact administrator.',
    GOOGLE_AUTH_FAILED: 'Failed to generate authorization URL',
    GOOGLE_CONNECT_ERROR: 'Error connecting to Google Business',
    GOOGLE_CONNECTED: 'Google Business Account connected successfully!',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL — Email sending
  // ═══════════════════════════════════════════════════════════════════════════
  EMAIL: {
    SUBJECT_BODY_REQUIRED: 'Subject and Body required unless using AI Personalization',
    NO_REGISTERED_EMAIL: 'Registered email not found. Please log in again so the campaign can be sent from your account.',
    NO_VALID_EMAILS: 'No valid emails found to send to',
    SEND_SUCCESS: 'Successfully sent emails!',
    SEND_ERROR: 'Error sending emails',
    GENERATE_FAILED: 'Failed to generate personalized email.',
    GENERATE_ERROR: 'Error generating email.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECTS — Project management
  // ═══════════════════════════════════════════════════════════════════════════
  PROJECTS: {
    CREATE_SUCCESS: 'Project created successfully',
    CREATE_ERROR: 'Failed to create project',
    DELETE_SUCCESS: 'Project deleted successfully',
    DELETE_ERROR: 'Failed to delete project',
    NAME_REQUIRED: 'Project name is required',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM — Team management
  // ═══════════════════════════════════════════════════════════════════════════
  TEAM: {
    INVITE_SUCCESS: 'Team member invited successfully',
    INVITE_ERROR: 'Failed to invite team member',
    REMOVE_SUCCESS: 'Team member removed',
    REMOVE_ERROR: 'Failed to remove team member',
    ROLE_UPDATE_SUCCESS: 'Role updated successfully',
    ROLE_UPDATE_ERROR: 'Failed to update role',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS — Settings page
  // ═══════════════════════════════════════════════════════════════════════════
  SETTINGS: {
    PROFILE_UPDATED: 'Profile updated successfully',
    PASSWORD_CHANGED: 'Password changed successfully',
    API_KEY_SAVED: 'API key saved successfully',
    API_KEY_REMOVED: 'API key removed',
    PREFERENCES_SAVED: 'Preferences saved',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH — Authentication
  // ═══════════════════════════════════════════════════════════════════════════
  AUTH: {
    LOGIN_SUCCESS: 'Welcome back!',
    LOGIN_FAILED: 'Invalid email or password',
    REGISTER_SUCCESS: 'Account created successfully',
    REGISTER_FAILED: 'Failed to create account',
    LOGOUT_SUCCESS: 'Signed out successfully',
    SESSION_EXPIRED: 'Your session has expired. Please log in again.',
    EMAIL_REQUIRED: 'Email is required',
    PASSWORD_REQUIRED: 'Password is required',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR BOUNDARY — Error fallback UI
  // ═══════════════════════════════════════════════════════════════════════════
  ERRORS: {
    SOMETHING_WRONG: 'Something went wrong',
    TRY_AGAIN_MESSAGE: 'We encountered an unexpected error. Please try again or return to the home page.',
    GO_HOME: 'Go to Home',
  },
};

export default STRINGS;
