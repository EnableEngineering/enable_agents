import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import '../styles/Header.css';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from './authHeaders';
import { showToast } from './toast';
import { Modal, ModalTabs } from '../components/Modal';
import { useMode } from '../contexts';


function Header({ onProcessClick, onModeChange }) {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dataSource, setDataSource] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [bulkFiles, setBulkFiles] = useState([]);
  const firstName = localStorage.getItem('firstName');
  const [showModal, setShowModal] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedSystemTab, setSelectedSystemTab] = useState('tools');

  // Mode from context - toggle moved to Settings, but still needed for demo data logic
  const { isDemoMode } = useMode();
  const userDropdownRef = useRef(null);

  const handleUserIconClick = () => {
    setShowUserDropdown((prev) => !prev);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false);
      }
    };

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserDropdown]);

  const handleSignOutClick = () => {
    localStorage.removeItem('firstName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('username');
    localStorage.removeItem('sessionToken');
    sessionStorage.clear();
    setShowUserDropdown(false);
    navigate('/login');
  };
  const [testResult, setTestResult] = useState('');
  const [dbRows, setDbRows] = useState([]);
  const [selectedSource, setSelectedSource] = useState('Database');
  const [isLoading, setIsLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [connectionDetails, setConnectionDetails] = useState({
    host: '',
    user: '',
    password: '',
    database: ''
  });

  const handleOpenModal = () => setShowModal(true);
  const handleCloseModal = () => setShowModal(false);

  const handleBulkFileChange = (e) => {
    setBulkFiles(Array.from(e.target.files));
  };

  // Handle input changes (including folderName)
  const handleInputChange = (e) => {
    setConnectionDetails({ ...connectionDetails, [e.target.name]: e.target.value });
  };

  // Update your handleLandscapeClick function in Header.js
  const handleLandscapeClick = async () => {
    setIsLoadingHistory(true);
    
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/chrome_history?user_id=${firstName}`);
      const result = await response.json();
      
      if (result.success) {
        // Use your existing modal instead of console.table and alert
        setHistoryData(result.data);
        showHistoryModal(result.data);
      } else {
        showToast(`Error: ${result.error}`, 'error');
      }
      
    } catch (error) {
      console.error('Error:', error);
      showToast('Please close Chrome completely and try again.', 'warning');
    } finally {
      setIsLoadingHistory(false);
    }
  };


  const displayHistoryData = (data) => {
    showHistoryModal(data);
  };

  const showHistoryModal = (data) => {
  // Separate web tools from regular URLs (using new field name)
  const webTools = data.filter(item => item.is_tool === true);
  const regularUrls = data.filter(item => item.is_tool !== true);
  
  // Group tools by type and category
  const toolsByType = {};
  const toolsByCategory = {};
  
  webTools.forEach(tool => {
    const type = tool.tool_type || 'Unknown';
    const category = tool.category || 'Other';
    
    if (!toolsByType[type]) toolsByType[type] = [];
    if (!toolsByCategory[category]) toolsByCategory[category] = [];
    
    toolsByType[type].push(tool);
    toolsByCategory[category].push(tool);
  });
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'history-modal';
  modal.innerHTML = `
    <div class="history-modal-content">
      <div class="history-modal-header">
        <h2> Application Landscape </h2>
        <button class="close-modal">&times;</button>
      </div>
      <div class="history-modal-body">
        <div class="history-summary">
          ${Object.keys(toolsByType).length > 0 ? `
          <div class="tools-breakdown">
            <strong>Tool Types:</strong> 
            ${Object.entries(toolsByType).map(([type, tools]) => 
              `<span class="type-badge type-${type.toLowerCase().replace(/\s+/g, '-')}">${type}: ${tools.length}</span>`
            ).join(' ')}
          </div>
          ` : ''}
        </div>
        
        ${webTools.length > 0 ? `
        <div class="tools-section">
          <h3>Web Tools & Applications Found (${webTools.length})</h3>
          
          ${Object.keys(toolsByCategory).length > 1 ? `
          <div class="category-tabs">
            ${Object.keys(toolsByCategory).map((category, index) => `
              <button class="category-tab ${index === 0 ? 'active' : ''}" data-category="${category}">
                ${category} (${toolsByCategory[category].length})
              </button>
            `).join('')}
          </div>
          ` : ''}
          
          ${Object.entries(toolsByCategory).map(([category, tools], index) => `
            <div class="category-content ${index === 0 ? 'active' : ''}" data-category="${category}">
              <div class="tools-grid">
                ${tools.map((item, toolIndex) => `
                  <div class="tool-card">
                    <div class="tool-header">
                      <h4>${item.tool_name || item.title}</h4>
                      <div class="tool-badges">
                        <span class="tool-type-badge">${item.tool_type || 'Tool'}</span>
                        <span class="tool-category-badge">${item.category || 'Other'}</span>
                      </div>
                    </div>
                    <p class="tool-description">${item.description || 'No description available'}</p>
                    <div class="tool-url">
                      🔗 <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a>
                    </div>
                    <div class="tool-meta">
                      📅 ${item.visit_date} | 👀 ${item.visit_count} visits
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        ` : ''}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add category tab functionality
  modal.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const category = e.target.dataset.category;
      
      // Update active tab
      modal.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      
      // Update active content
      modal.querySelectorAll('.category-content').forEach(content => {
        content.classList.toggle('active', content.dataset.category === category);
      });
    });
  });
  
  // Close modal functionality
  modal.querySelector('.close-modal').onclick = () => {
    document.body.removeChild(modal);
  };
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
};

  // Bulk upload handler
  const handleBulkUpload = async () => {
    if (bulkFiles.length === 0) {
      showToast('Please select files to upload.', 'warning');
      return;
    }

    const pdfFiles = bulkFiles.filter(file => file.type === 'application/pdf');
    if (pdfFiles.length === 0) {
      showToast('No PDF files found in your selection.', 'warning');
      return;
    }

    // Create a new PDFDocument
    const mergedPdf = await PDFDocument.create();

    // For each PDF, fetch its ArrayBuffer and copy its pages into the merged PDF
    for (const file of pdfFiles) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(arrayBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    // Serialize the merged PDF to bytes (Uint8Array)
    const mergedPdfBytes = await mergedPdf.save();

    // Create a Blob and File from the merged PDF
    const mergedPdfBlob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    const mergedPdfFile = new File([mergedPdfBlob], 'merged.pdf');

    const formData = new FormData();
    formData.append('file', mergedPdfFile);
    if (connectionDetails.folderName) {
      formData.append('folder_name', connectionDetails.folderName);
    }
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (response.ok) {
        showToast('Files uploaded successfully!', 'success');
      } else {
        showToast(data.error || 'Upload failed.', 'error');
      }
    } catch (error) {
      showToast('Upload failed.', 'error');
    }
  };

  const handleTestConnection = async () => {
    // Example API call to test connection
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionDetails),
      });
      const data = await response.json();
      setTestResult(data.message || 'Test completed');
      setDbRows(data.rows || []);
    } catch (error) {
      setTestResult('Connection failed');
      setDbRows([]);
    }
  };

  const handleCreateConnection = () => {
    // Implement your create connection logic here
    showToast('Connection setup coming soon.', 'info');
  };

  const [showSystemModal, setShowSystemModal] = useState(false);
  const [systemTools, setSystemTools] = useState([]);
  const [toolsSortAsc, setToolsSortAsc] = useState(true);
  const [recommendedAgents, setRecommendedAgents] = useState('');

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const notifDropdownRef = useRef(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (isDemoMode) {
      // Demo notifications
      setNotifications([
        { id: 'n1', type: 'task_assigned', title: 'New task assigned', message: 'Verify component dimensions', link: '/workflows/demo-instance-1', is_read: false, created_at: new Date().toISOString() },
        { id: 'n2', type: 'task_completed', title: 'Task completed', message: 'Confirm client specifications', link: '/workflows/demo-instance-1', is_read: true, created_at: new Date(Date.now() - 3600000).toISOString() },
      ]);
      setUnreadCount(1);
      return;
    }
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/notifications?unread_only=false`, {
        headers: authJsonHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unread_count || 0);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  }, [isDemoMode]);

  useEffect(() => {
    fetchNotifications();
    // Refresh every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close notification dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target)) {
        setShowNotifDropdown(false);
      }
    };
    if (showNotifDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifDropdown]);

  const handleMarkNotifRead = async (notifId) => {
    if (isDemoMode) {
      setNotifications(notifications.map(n => n.id === notifId ? { ...n, is_read: true } : n));
      setUnreadCount(Math.max(0, unreadCount - 1));
      return;
    }
    try {
      await fetch(`${API_CONFIG.BASE_URL}/api/notifications/${notifId}/read`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      setNotifications(notifications.map(n => n.id === notifId ? { ...n, is_read: true } : n));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    if (isDemoMode) {
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      return;
    }
    try {
      await fetch(`${API_CONFIG.BASE_URL}/api/notifications/read-all`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Error marking all notifications read:', err);
    }
  };

  const handleSystemClick = async () => {
    setShowSystemModal(true);
    try {
      // Both endpoints require @require_auth - this was previously
      // sending no Authorization header at all, so every call silently
      // 401'd (still resolves to valid JSON via the error body, so it
      // never threw - just looked like "no tools"/"no recommendations"
      // instead of surfacing the real auth failure).
      const toolsRes = await fetch(`${API_CONFIG.API_URL}/get_tools_landscape`, {
        headers: authJsonHeaders(),
      });
      const toolsResult = await toolsRes.json();
      let tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
      setSystemTools(tools);

      // Business context lives in localStorage under
      // 'enableAgentsBusinessContext' (same key the Business Context tab
      // below and Settings' business tab read/write).
      const storedContext = localStorage.getItem('enableAgentsBusinessContext');
      const context = storedContext ? JSON.parse(storedContext) : {};

      // Field names must match /recommend_agents' actual payload shape
      // (backend/app.py:recommend_agents) - this previously sent
      // tools_landscape/business_description, which that endpoint doesn't
      // read at all (it reads tools/product_service), so every call
      // silently produced recommendations based on empty input.
      const payload = {
        tools: tools,
        industry: context.industry || '',
        product_service: context.productService || '',
        role: context.role || '',
      };
      const agentsRes = await fetch(`${API_CONFIG.API_URL}/recommend_agents`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
      const agentsResult = await agentsRes.json();
      const recs = agentsResult.recommendations;
      if (recs && typeof recs === 'object') {
        setRecommendedAgents(JSON.stringify(recs, null, 2));
      } else {
        setRecommendedAgents(recs || 'No recommendations found.');
      }
    } catch (error) {
      setSystemTools([]);
      setRecommendedAgents('Error fetching recommendations.');
    }
  };
  const handleCloseSystemModal = () => {
    setShowSystemModal(false);
  };

  return (
    <>
      <header className="header">
        <div className="header-left">
          <Link to="/dashboard" aria-label="Go to home">
            <img
              src={`${process.env.PUBLIC_URL}/logo192.svg`}
              alt="Enable Logo"
              className="logo"
              style={{ height: '48px' }}
            />
          </Link>
        </div>

        <div className="header-icons">
          {/* HIDDEN: Landscape feature requires Chrome history API - not functional
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img
              src="/assets/icons/layout-grid.png"
              onClick={handleLandscapeClick}
              alt="Landscape"
              className="icon"
              style={{ cursor: 'pointer' }}
            />
            <span className="icon-label" style={{ fontSize: '0.95em', marginTop: '2px' }}>landscape</span>
          </div>
          */}
          {/* HIDDEN: Process feature incomplete
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img
              src="/assets/icons/process.png"
              alt="Process"
              className="icon"
              style={{ cursor: 'pointer' }}
              onClick={onProcessClick}
            />
            <span className="icon-label" style={{ fontSize: '0.95em', marginTop: '2px' }}>process</span>
          </div>
          */}
          {/* System Overview: tools landscape + AI-recommended agents.
              Button was removed in 9a3209b4 (no stated reason, bundled
              into an unrelated demo-mode change) while the modal/handler
              stayed behind, unreachable. Restored, now that the
              /recommend_agents payload bug above is fixed. */}
          <button
            className="header-icon-button"
            onClick={handleSystemClick}
            aria-label="System overview"
            title="System overview: tools & recommended agents"
          >
            <img src="/assets/icons/puzzle.png" alt="" className="icon" />
          </button>
          {/* Notifications */}
          <div className="notif-icon-wrapper" ref={notifDropdownRef}>
            <button
              className="header-icon-button"
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              aria-label="Notifications"
              title={`${unreadCount} unread notifications`}
            >
              <img src="/assets/icons/notifications.png" alt="" className="icon" />
              {unreadCount > 0 && (
                <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
            {showNotifDropdown && (
              <div className="notif-dropdown" role="menu">
                <div className="notif-dropdown-header">
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <button className="notif-mark-all" onClick={handleMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="notif-empty">No notifications</div>
                ) : (
                  <div className="notif-list">
                    {notifications.slice(0, 5).map(notif => (
                      <div
                        key={notif.id}
                        className={`notif-item ${notif.is_read ? '' : 'unread'}`}
                        onClick={() => {
                          if (!notif.is_read) handleMarkNotifRead(notif.id);
                          if (notif.link) navigate(notif.link);
                          setShowNotifDropdown(false);
                        }}
                      >
                        <div className="notif-item-title">{notif.title}</div>
                        <div className="notif-item-message">{notif.message}</div>
                        <div className="notif-item-time">
                          {new Date(notif.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="notif-dropdown-footer">
                  <button onClick={() => { setShowNotifDropdown(false); navigate('/settings?tab=notifications'); }}>
                    View all notifications
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="user-icon-wrapper" ref={userDropdownRef}>
            <button
              className="header-icon-button"
              onClick={handleUserIconClick}
              aria-label="User menu"
              aria-expanded={showUserDropdown}
              aria-haspopup="true"
              title={firstName ? `Signed in as ${firstName}` : 'User menu'}
            >
              <img src="/assets/icons/user.png" alt="" className="icon" />
              {firstName && (
                <span className="user-first-name">{firstName}</span>
              )}
            </button>
            {showUserDropdown && (
              <div className="user-dropdown-menu" role="menu">
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/dashboard'); }}>Dashboard</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/agents'); }}>Agents</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/workflows'); }}>Workflows</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/projects'); }}>Projects</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/team'); }}>Team</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/usage'); }}>Usage</button>
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setShowUserDropdown(false); navigate('/settings'); }}>Settings</button>
                <div className="user-dropdown-divider"></div>
                <button className="user-dropdown-item user-dropdown-item--danger" role="menuitem" onClick={handleSignOutClick}>Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* System Overview Modal - using shared Modal component */}
      <Modal
        open={showSystemModal}
        onClose={handleCloseSystemModal}
        title="System Overview"
        size="lg"
      >
        <ModalTabs
          tabs={[
            {
              id: 'tools',
              label: 'Software Tools',
              content: (
                <div className="system-tools-content">
                  {systemTools.length === 0 ? (
                    <div className="system-empty-state">
                      <p>No tools detected yet.</p>
                      <p className="system-empty-hint">Tools will appear here after browser scan or manual import.</p>
                    </div>
                  ) : (
                    <>
                      <div className="tools-analytics-summary">
                        <div className="tools-analytics-item">
                          <span className="tools-analytics-value">{systemTools.length}</span>
                          <span className="tools-analytics-label">Total Tools</span>
                        </div>
                        <div className="tools-analytics-item">
                          <span className="tools-analytics-value">{Array.from(new Set(systemTools.map(t => t.category))).length}</span>
                          <span className="tools-analytics-label">Categories</span>
                        </div>
                      </div>
                      <div className="tools-list">
                        <div className="tools-list-header">
                          <span className="tools-col-name">Tool</span>
                          <span className="tools-col-category" onClick={() => setToolsSortAsc(asc => !asc)}>
                            Category {toolsSortAsc ? '▲' : '▼'}
                          </span>
                          <span className="tools-col-desc">Description</span>
                        </div>
                        <div className="tools-list-body">
                          {[...systemTools]
                            .sort((a, b) => {
                              if (!a.category) return 1;
                              if (!b.category) return -1;
                              const cmp = a.category.toLowerCase().localeCompare(b.category.toLowerCase());
                              return toolsSortAsc ? cmp : -cmp;
                            })
                            .map((tool, idx) => (
                              <div key={idx} className="tools-list-row">
                                <span className="tools-col-name">{tool.tool_name}</span>
                                <span className="tools-col-category">
                                  <span className="category-badge">{tool.category}</span>
                                </span>
                                <span className="tools-col-desc">{tool.description}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            },
            {
              id: 'context',
              label: 'Business Context',
              content: (
                <div className="system-context-content">
                  {(() => {
                    // Read from localStorage (same as Settings)
                    const stored = localStorage.getItem('enableAgentsBusinessContext');
                    const ctx = stored ? JSON.parse(stored) : null;
                    const hasContext = ctx && (ctx.industry || ctx.role || ctx.productService);

                    if (!hasContext) {
                      return (
                        <div className="system-empty-state">
                          <p>No business context configured yet.</p>
                          <button
                            className="btn btn-primary"
                            onClick={() => {
                              handleCloseSystemModal();
                              navigate('/settings?tab=business');
                            }}
                          >
                            Set Up Business Context
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="context-display">
                        <div className="context-display-row">
                          <span className="context-display-label">Industry</span>
                          <span className="context-display-value">{ctx.industry || '—'}</span>
                        </div>
                        <div className="context-display-row">
                          <span className="context-display-label">Role</span>
                          <span className="context-display-value">{ctx.role || '—'}</span>
                        </div>
                        <div className="context-display-row">
                          <span className="context-display-label">Company Size</span>
                          <span className="context-display-value">{ctx.companySize || '—'}</span>
                        </div>
                        <div className="context-display-row">
                          <span className="context-display-label">Product/Service</span>
                          <span className="context-display-value">{ctx.productService || '—'}</span>
                        </div>
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            handleCloseSystemModal();
                            navigate('/settings?tab=business');
                          }}
                        >
                          Edit in Settings
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )
            },
            {
              id: 'agents',
              label: 'Recommended Agents',
              content: (
                <div className="system-agents-content">
                  {recommendedAgents ? (
                    <div className="recommendations-display">
                      <pre className="recommendations-json">{recommendedAgents}</pre>
                    </div>
                  ) : (
                    <div className="system-empty-state">
                      <p>Loading recommendations...</p>
                      <p className="system-empty-hint">Set up your business context to get personalized agent recommendations.</p>
                    </div>
                  )}
                </div>
              )
            }
          ]}
          activeTab={selectedSystemTab}
          onTabChange={setSelectedSystemTab}
        />
      </Modal>

      {/* HIDDEN: Connection modal moved to Settings > Connectors
      {showModal && (
        <div className="modal-overlay">
          ...connection modal content...
        </div>
      )}
      */}
    </>
  );
}

export default Header;