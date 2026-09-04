import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './Settings.css';
import { showToast } from '../core/toast';
import { showConfirm } from '../components/ConfirmDialog';
import Header from '../core/Header';
import FormField from '../components/FormField';
import Skeleton from '../components/SkeletonLoader';
import { useMode } from '../contexts';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Frontend-only tab definitions (merged with backend settings)
const FRONTEND_TABS = {
  account: {
    id: 'account',
    label: 'Account',
    icon: 'user',
    description: 'Your profile and authentication settings',
    isFrontend: true,
  },
  preferences: {
    id: 'preferences',
    label: 'Preferences',
    icon: 'sliders',
    description: 'App behavior and display preferences',
    isFrontend: true,
  },
  business: {
    id: 'business',
    label: 'Business Context',
    icon: 'briefcase',
    description: 'Your industry, role, and business information',
    isFrontend: true,
  },
};

// Icons as simple SVG components
const Icons = {
  ArrowLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
      <path d="M19 12H5"/>
      <path d="M12 19l-7-7 7-7"/>
    </svg>
  ),
  brain: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.45 2.1-1.17 2.83L12 12l-2.83-3.17A4 4 0 0 1 12 2z"/>
      <path d="M12 12v10"/>
      <path d="M8 22h8"/>
    </svg>
  ),
  plug: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v6m-4-4v4m8-4v4"/>
      <rect x="6" y="8" width="12" height="8" rx="2"/>
      <path d="M10 16v4m4-4v4"/>
    </svg>
  ),
  globe: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  link: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  x: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Eye: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  EyeOff: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ),
  ExternalLink: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  ),
  user: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  sliders: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="21" x2="4" y2="14"/>
      <line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/>
      <line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  ),
  briefcase: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  ),
  Logout: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Google: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  ),
};

function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState({});
  const [showPasswords, setShowPasswords] = useState({});
  const [editValues, setEditValues] = useState({});
  const [testResults, setTestResults] = useState({});

  // Support ?tab=account URL param (for Header dropdown link)
  const initialTab = searchParams.get('tab') || 'account';
  const [activeCategory, setActiveCategory] = useState(initialTab);

  // Account state
  const userEmail = localStorage.getItem('userEmail') || '';
  const firstName = localStorage.getItem('firstName') || '';
  const lastName = localStorage.getItem('lastName') || '';
  const [accountForm, setAccountForm] = useState({
    firstName: firstName,
    lastName: lastName,
    email: userEmail,
  });

  // Preferences state - using shared context
  const { isDemoMode, setMode } = useMode();
  const isLiveMode = !isDemoMode;

  // Business context state (persisted to localStorage for now, can move to API later)
  const [businessContext, setBusinessContext] = useState(() => {
    const stored = localStorage.getItem('enableAgentsBusinessContext');
    return stored ? JSON.parse(stored) : {
      industry: '',
      role: '',
      companySize: '',
      productService: '',
    };
  });

  // Get user ID from localStorage (set during login)
  const getUserId = () => {
    return localStorage.getItem('userEmail') || localStorage.getItem('userId') || 'anonymous';
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/settings?include_values=true`, {
        headers: authOptionalHeaders(),
      });
      const data = await response.json();
      setSettings(data.settings);
      setError(null);
    } catch (err) {
      setError('Failed to load settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveSetting = async (category, key, value) => {
    const settingKey = `${category}/${key}`;
    setSaving(prev => ({ ...prev, [settingKey]: true }));

    try {
      const response = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ category, key, value }),
      });

      if (response.ok) {
        // Refresh settings
        await fetchSettings();
        // Clear edit value
        setEditValues(prev => {
          const newValues = { ...prev };
          delete newValues[settingKey];
          return newValues;
        });
      } else {
        const data = await response.json();
        showToast(`Failed to save: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Failed to save setting', 'error');
      console.error(err);
    } finally {
      setSaving(prev => ({ ...prev, [settingKey]: false }));
    }
  };

  const deleteSetting = async (category, key) => {
    const confirmed = await showConfirm({
      title: `Delete ${key}?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_URL}/api/settings/${category}/${key}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });

      if (response.ok) {
        await fetchSettings();
      }
    } catch (err) {
      showToast('Failed to delete setting', 'error');
      console.error(err);
    }
  };

  const testConnection = async (category, key) => {
    const settingKey = `${category}/${key}`;
    setTestResults(prev => ({ ...prev, [settingKey]: { testing: true } }));

    try {
      const response = await fetch(`${API_URL}/api/settings/test-connection`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ category, key }),
      });

      const data = await response.json();
      setTestResults(prev => ({
        ...prev,
        [settingKey]: { success: data.success, message: data.message },
      }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [settingKey]: { success: false, message: 'Connection test failed' },
      }));
    }
  };

  const toggleShowPassword = (key) => {
    setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleInputChange = (category, key, value) => {
    const settingKey = `${category}/${key}`;
    setEditValues(prev => ({ ...prev, [settingKey]: value }));
  };

  // Account handlers
  const handleAccountChange = (field, value) => {
    setAccountForm(prev => ({ ...prev, [field]: value }));
  };

  const [accountSubmitted, setAccountSubmitted] = useState(false);

  const saveAccountInfo = () => {
    setAccountSubmitted(true);
    if (!accountForm.firstName.trim()) {
      return;
    }
    localStorage.setItem('firstName', accountForm.firstName);
    localStorage.setItem('lastName', accountForm.lastName);
    showToast('Account info saved', 'success');
  };

  const handleSignOut = () => {
    localStorage.removeItem('firstName');
    localStorage.removeItem('lastName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('enableAgentsMode');
    localStorage.removeItem('enableAgentsBusinessContext');
    sessionStorage.clear();
    navigate('/login');
  };

  // Preferences handlers
  const handleModeToggle = () => {
    const newIsLive = !isLiveMode;
    setMode(!newIsLive); // setMode takes isDemoMode (opposite of isLiveMode)
    showToast(newIsLive ? 'Switched to Live mode' : 'Switched to Demo mode', 'info');
  };

  // Business context handlers
  const handleBusinessContextChange = (field, value) => {
    setBusinessContext(prev => {
      const updated = { ...prev, [field]: value };
      localStorage.setItem('enableAgentsBusinessContext', JSON.stringify(updated));
      return updated;
    });
  };

  const saveBusinessContext = async () => {
    // Save to localStorage (already done in handleBusinessContextChange)
    // Optionally save to backend ContextStore
    try {
      await fetch(`${API_URL}/api/context`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          agent_id: 'user_profile',
          data_type: 'business_context',
          content: businessContext,
        }),
      });
      showToast('Business context saved', 'success');
    } catch (err) {
      // Still saved to localStorage
      showToast('Saved locally (server unavailable)', 'warning');
    }
  };

  const getIcon = (iconName) => {
    const IconComponent = Icons[iconName] || Icons.plug;
    return <IconComponent />;
  };

  const renderSettingInput = (category, key, setting) => {
    const settingKey = `${category}/${key}`;
    const isEditing = settingKey in editValues;
    const currentValue = isEditing ? editValues[settingKey] : (setting.value || setting.default || '');
    const isSaving = saving[settingKey];
    const testResult = testResults[settingKey];

    if (setting.type === 'oauth') {
      return (
        <div className="oauth-setting">
          {setting.configured ? (
            <div className="oauth-connected">
              <span className="status-badge success">
                <Icons.Check /> Connected
              </span>
              <button
                className="btn-secondary btn-small"
                onClick={() => deleteSetting(category, key)}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              className="btn-primary"
              onClick={() => window.location.href = `${API_URL}/api/connectors/${setting.provider}/auth-url?redirect_uri=${window.location.origin}/settings`}
            >
              Connect {setting.label}
            </button>
          )}
        </div>
      );
    }

    if (setting.type === 'select') {
      return (
        <div className="setting-input-group">
          <select
            value={currentValue}
            onChange={(e) => handleInputChange(category, key, e.target.value)}
            className="setting-select"
          >
            {setting.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {isEditing && (
            <button
              className="btn-primary btn-small"
              onClick={() => saveSetting(category, key, editValues[settingKey])}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="setting-input-group">
        <div className="input-wrapper">
          <input
            type={setting.type === 'password' && !showPasswords[settingKey] ? 'password' : 'text'}
            value={currentValue}
            onChange={(e) => handleInputChange(category, key, e.target.value)}
            placeholder={setting.placeholder}
            className="setting-input"
            min={setting.min}
            max={setting.max}
          />
          {setting.type === 'password' && (
            <button
              className="toggle-visibility"
              onClick={() => toggleShowPassword(settingKey)}
              type="button"
            >
              {showPasswords[settingKey] ? <Icons.EyeOff /> : <Icons.Eye />}
            </button>
          )}
        </div>

        <div className="setting-actions">
          {isEditing && (
            <button
              className="btn-primary btn-small"
              onClick={() => saveSetting(category, key, editValues[settingKey])}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          )}

          {setting.configured && setting.type === 'password' && (
            <button
              className="btn-secondary btn-small"
              onClick={() => testConnection(category, key)}
              disabled={testResult?.testing}
            >
              {testResult?.testing ? 'Testing...' : 'Test'}
            </button>
          )}

          {setting.configured && (
            <button
              className="btn-danger btn-small"
              onClick={() => deleteSetting(category, key)}
            >
              Delete
            </button>
          )}
        </div>

        {testResult && !testResult.testing && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            {testResult.success ? <Icons.Check /> : <Icons.x />}
            {testResult.message}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="settings-page">
        <Header />
        <div className="settings-page-header">
          <Skeleton.Button width="40px" />
          <div className="header-text">
            <Skeleton.Text width="120px" height="1.5rem" />
            <Skeleton.Text width="280px" height="0.875rem" />
          </div>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ padding: '12px 16px' }}>
                <Skeleton.Text width="100%" />
              </div>
            ))}
          </nav>
          <main className="settings-content">
            <div style={{ padding: '24px' }}>
              <Skeleton.Paragraph lines={4} />
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-page">
        <div className="settings-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <Header />

      <div className="settings-page-header">
        <button className="back-button" onClick={() => navigate(-1)} title="Go back">
          <Icons.ArrowLeft />
        </button>
        <div className="header-text">
          <h1>Settings</h1>
          <p>Configure your AI providers, data connectors, and preferences</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {/* Frontend tabs first */}
          {Object.entries(FRONTEND_TABS).map(([tabId, tab]) => (
            <button
              key={tabId}
              className={`nav-item ${activeCategory === tabId ? 'active' : ''}`}
              onClick={() => setActiveCategory(tabId)}
            >
              <span className="nav-icon">{getIcon(tab.icon)}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}

          {/* Divider */}
          <div className="nav-divider" />

          {/* Backend settings tabs */}
          {Object.entries(settings || {}).map(([catId, category]) => (
            <button
              key={catId}
              className={`nav-item ${activeCategory === catId ? 'active' : ''}`}
              onClick={() => setActiveCategory(catId)}
            >
              <span className="nav-icon">{getIcon(category.icon)}</span>
              <span className="nav-label">{category.label}</span>
              {Object.values(category.settings).some(s => s.configured) && (
                <span className="nav-badge">
                  {Object.values(category.settings).filter(s => s.configured).length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main className="settings-content">
          {/* Account Tab */}
          {activeCategory === 'account' && (
            <section className="settings-section">
              <div className="section-header">
                <div className="section-icon">{getIcon('user')}</div>
                <div>
                  <h2>Account</h2>
                  <p>Your profile and authentication settings</p>
                </div>
              </div>

              <div className="settings-list">
                {/* Email */}
                <div className="setting-item">
                  <div className="setting-info">
                    <div className="setting-label">Email</div>
                    <div className="setting-description">Your login email address</div>
                  </div>
                  <div className="setting-control">
                    <input
                      type="email"
                      value={accountForm.email}
                      className="setting-input"
                      disabled
                    />
                  </div>
                </div>

                {/* Name row - side by side */}
                <div className="name-row">
                  <div className="setting-item">
                    <div className="setting-info">
                      <div className="setting-label">First Name</div>
                    </div>
                    <div className="setting-control">
                      <FormField
                        htmlFor="firstName"
                        error={accountSubmitted && !accountForm.firstName.trim() ? 'First name is required' : null}
                      >
                        <input
                          id="firstName"
                          type="text"
                          value={accountForm.firstName}
                          onChange={(e) => {
                            handleAccountChange('firstName', e.target.value);
                            if (accountSubmitted) setAccountSubmitted(false);
                          }}
                          className="setting-input"
                          placeholder="First name"
                        />
                      </FormField>
                    </div>
                  </div>

                  <div className="setting-item">
                    <div className="setting-info">
                      <div className="setting-label">Last Name</div>
                    </div>
                    <div className="setting-control">
                      <input
                        type="text"
                        value={accountForm.lastName}
                        onChange={(e) => handleAccountChange('lastName', e.target.value)}
                        className="setting-input"
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                </div>

                {/* Google Account - inline row */}
                <div className="setting-item inline-row">
                  <div className="setting-info">
                    <div className="setting-label">Google Account</div>
                    <div className="setting-description">
                      {localStorage.getItem('googleConnected') || localStorage.getItem('authProvider') === 'google'
                        ? 'Connected for single sign-on'
                        : 'Connect for single sign-on'}
                    </div>
                  </div>
                  <div className="setting-control">
                    {localStorage.getItem('googleConnected') || localStorage.getItem('authProvider') === 'google' ? (
                      <div className="google-connected">
                        <span className="google-connected-badge">
                          <Icons.Check /> Connected
                        </span>
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => {
                            localStorage.removeItem('googleConnected');
                            localStorage.removeItem('authProvider');
                            window.location.reload();
                          }}
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-secondary google-connect-btn"
                        onClick={() => window.location.href = `${API_URL}/auth/google/start`}
                      >
                        <Icons.Google />
                        Connect Google
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="section-actions">
                <button className="btn-primary" onClick={saveAccountInfo}>
                  Save Changes
                </button>
                <button className="btn-danger" onClick={handleSignOut}>
                  <Icons.Logout />
                  Sign Out
                </button>
              </div>
            </section>
          )}

          {/* Preferences Tab */}
          {activeCategory === 'preferences' && (
            <section className="settings-section">
              <div className="section-header">
                <div className="section-icon">{getIcon('sliders')}</div>
                <div>
                  <h2>Preferences</h2>
                  <p>App behavior and display preferences</p>
                </div>
              </div>

              <div className="settings-list">
                <div className="setting-item preference-toggle-row">
                  <div className="preference-toggle-header">
                    <div className="setting-label">Data Mode</div>
                    <button
                      className={`mode-toggle-large ${isLiveMode ? 'mode-toggle-large--live' : 'mode-toggle-large--demo'}`}
                      onClick={handleModeToggle}
                      aria-pressed={isLiveMode}
                    >
                      <span className="mode-toggle-large-track">
                        <span className="mode-toggle-large-thumb" />
                      </span>
                      <span className="mode-toggle-large-label">{isLiveMode ? 'Live' : 'Demo'}</span>
                    </button>
                  </div>
                  <div className="setting-description preference-description">
                    <strong>Live:</strong> Real data and AI interactions.<br/>
                    <strong>Demo:</strong> Sample data only, safe for exploration.
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Business Context Tab */}
          {activeCategory === 'business' && (
            <section className="settings-section">
              <div className="section-header">
                <div className="section-icon">{getIcon('briefcase')}</div>
                <div>
                  <h2>Business Context</h2>
                  <p>Help our AI agents understand your business better</p>
                </div>
              </div>

              <div className="settings-list compact-grid">
                <div className="setting-item">
                  <div className="setting-info">
                    <div className="setting-label">Industry</div>
                  </div>
                  <div className="setting-control">
                    <select
                      value={businessContext.industry}
                      onChange={(e) => handleBusinessContextChange('industry', e.target.value)}
                      className="setting-select"
                    >
                      <option value="">Select industry...</option>
                      <option value="finance">Finance</option>
                      <option value="healthcare">Healthcare</option>
                      <option value="technology">Technology</option>
                      <option value="retail">Retail</option>
                      <option value="manufacturing">Manufacturing</option>
                      <option value="education">Education</option>
                      <option value="consulting">Consulting</option>
                      <option value="real_estate">Real Estate</option>
                      <option value="hospitality">Hospitality</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <div className="setting-label">Your Role</div>
                  </div>
                  <div className="setting-control">
                    <select
                      value={businessContext.role}
                      onChange={(e) => handleBusinessContextChange('role', e.target.value)}
                      className="setting-select"
                    >
                      <option value="">Select role...</option>
                      <option value="executive">Executive / C-Suite</option>
                      <option value="manager">Manager</option>
                      <option value="analyst">Analyst</option>
                      <option value="developer">Developer / Engineer</option>
                      <option value="sales">Sales</option>
                      <option value="marketing">Marketing</option>
                      <option value="operations">Operations</option>
                      <option value="hr">Human Resources</option>
                      <option value="finance">Finance / Accounting</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <div className="setting-label">Company Size</div>
                  </div>
                  <div className="setting-control">
                    <select
                      value={businessContext.companySize}
                      onChange={(e) => handleBusinessContextChange('companySize', e.target.value)}
                      className="setting-select"
                    >
                      <option value="">Select size...</option>
                      <option value="1-10">1-10 employees</option>
                      <option value="11-50">11-50 employees</option>
                      <option value="51-200">51-200 employees</option>
                      <option value="201-500">201-500 employees</option>
                      <option value="501-1000">501-1000 employees</option>
                      <option value="1000+">1000+ employees</option>
                    </select>
                  </div>
                </div>

                <div className="setting-item full-width">
                  <div className="setting-info">
                    <div className="setting-label">Product / Service</div>
                    <div className="setting-description">Briefly describe what your company does</div>
                  </div>
                  <div className="setting-control">
                    <textarea
                      value={businessContext.productService}
                      onChange={(e) => handleBusinessContextChange('productService', e.target.value)}
                      className="setting-input setting-textarea"
                      placeholder="e.g., We provide cloud-based inventory management software for small retail businesses..."
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              <div className="section-actions">
                <button className="btn-primary" onClick={saveBusinessContext}>
                  Save Business Context
                </button>
              </div>
            </section>
          )}

          {/* Backend settings tabs - no duplicate header since tab already shows title */}
          {settings && settings[activeCategory] && (
            <section className="settings-section no-header">
              {/* Render as cards for connectors/oauth, list for others */}
              {(activeCategory === 'connectors' || activeCategory === 'oauth') ? (
                <div className="connector-cards">
                  {Object.entries(settings[activeCategory].settings).map(([key, setting]) => (
                    <div key={key} className={`connector-card ${setting.configured ? 'connected' : ''}`}>
                      <div className="connector-card-icon">
                        {getIcon(setting.icon || 'plug')}
                      </div>
                      <div className="connector-card-content">
                        <h3 className="connector-card-name">{setting.label}</h3>
                        <p className="connector-card-description">{setting.description}</p>
                        {setting.configured && (
                          <span className="connector-card-status">
                            <Icons.Check /> Connected
                          </span>
                        )}
                      </div>
                      <div className="connector-card-action">
                        {setting.type === 'oauth' ? (
                          setting.configured ? (
                            <button
                              className="btn-secondary"
                              onClick={() => deleteSetting(activeCategory, key)}
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              className="btn-primary"
                              onClick={() => window.location.href = `${API_URL}/api/connectors/${setting.provider}/auth-url?redirect_uri=${window.location.origin}/settings`}
                            >
                              Connect
                            </button>
                          )
                        ) : (
                          setting.configured ? (
                            <button
                              className="btn-secondary"
                              onClick={() => deleteSetting(activeCategory, key)}
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              className="btn-primary"
                              onClick={() => {/* TODO: show input modal */}}
                            >
                              Configure
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-list">
                  {Object.entries(settings[activeCategory].settings).map(([key, setting]) => (
                    <div key={key} className={`setting-item ${setting.configured ? 'configured' : ''}`}>
                      <div className="setting-info">
                        <div className="setting-label">
                          {setting.label}
                          {setting.configured && (
                            <span className="configured-badge">
                              <Icons.Check /> Configured
                            </span>
                          )}
                        </div>
                        <div className="setting-description">
                          {setting.description}
                          {setting.help_url && (
                            <a
                              href={setting.help_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="help-link"
                            >
                              Get connection key <Icons.ExternalLink />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="setting-control">
                        {renderSettingInput(activeCategory, key, setting)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default Settings;
