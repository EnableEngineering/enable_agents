import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from './authHeaders';
import '../styles/Header.css';
import './Sidebar.css';

const NAV_ITEMS = [
  {
    id: 'home',
    label: 'Home',
    to: '/home',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>
    ),
  },
  {
    id: 'agents',
    label: 'Agents',
    to: '/agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
    ),
  },
  {
    id: 'workflows',
    label: 'Workflows',
    to: '/workflows',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7 6h6a4 4 0 0 1 4 4M7 18h6a4 4 0 0 0 4-4" /></svg>
    ),
  },
  {
    id: 'projects',
    label: 'Projects',
    to: '/projects',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
    ),
  },
];

// Routes that belong under a given nav item even though the URL doesn't
// match its `to` exactly (e.g. individual agent pages under "Agents").
const ACTIVE_PREFIXES = {
  home: ['/home'],
  agents: [
    '/agents', '/market-research', '/sales-helper', '/content-marketing',
    '/community-network', '/event-networking', '/data-insights', '/aichatbot',
    '/supply-chain-agent', '/email-outreach', '/invest-agent',
  ],
  workflows: ['/workflows'],
  projects: ['/projects'],
};

function getActiveNavId(pathname) {
  for (const [id, prefixes] of Object.entries(ACTIVE_PREFIXES)) {
    if (prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))) return id;
  }
  return null;
}

function Sidebar({ collapsed = false, onCollapseToggle }) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeNavId = getActiveNavId(location.pathname);
  const firstName = localStorage.getItem('firstName') || '';
  const userEmail = localStorage.getItem('userEmail') || '';
  const initials = (firstName ? firstName[0] : (userEmail[0] || '?')).toUpperCase();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const handleSignOut = () => {
    localStorage.removeItem('firstName');
    localStorage.removeItem('lastName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('username');
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('enableAgentsBusinessContext');
    sessionStorage.clear();
    window.dispatchEvent(new Event('authChange'));
    navigate('/login');
  };

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const notifDropdownRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target)) {
        setShowNotifDropdown(false);
      }
    };
    if (showNotifDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifDropdown]);

  const handleMarkNotifRead = async (notifId) => {
    try {
      await fetch(`${API_CONFIG.BASE_URL}/api/notifications/${notifId}/read`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      setNotifications(notifications.map((n) => (n.id === notifId ? { ...n, is_read: true } : n)));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch(`${API_CONFIG.BASE_URL}/api/notifications/read-all`, {
        method: 'POST',
        headers: authJsonHeaders(),
      });
      setNotifications(notifications.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Error marking all notifications read:', err);
    }
  };

  return (
    <>
      <nav className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`} aria-label="Primary">
        <Link to="/home" className="sidebar-logo" aria-label="Enable home">
          <img src={`${process.env.PUBLIC_URL}/logo192.svg`} alt="Enable" />
        </Link>

        <div className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              className={`sidebar-nav-item ${activeNavId === item.id ? 'sidebar-nav-item--active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <div className="sidebar-utilities">
          <div className="sidebar-utility-wrapper" ref={notifDropdownRef}>
            <button
              className="sidebar-utility-button"
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              aria-label="Notifications"
              title={`${unreadCount} unread notifications`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
              <span>Notifications</span>
              {unreadCount > 0 && <span className="sidebar-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            {showNotifDropdown && (
              <div className="sidebar-notif-dropdown" role="menu">
                <div className="sidebar-notif-dropdown-header">
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <button className="sidebar-notif-mark-all" onClick={handleMarkAllRead}>Mark all read</button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="sidebar-notif-empty">No notifications</div>
                ) : (
                  <div className="sidebar-notif-list">
                    {notifications.slice(0, 5).map((notif) => (
                      <div
                        key={notif.id}
                        className={`sidebar-notif-item ${notif.is_read ? '' : 'unread'}`}
                        onClick={() => {
                          if (!notif.is_read) handleMarkNotifRead(notif.id);
                          if (notif.link) navigate(notif.link);
                          setShowNotifDropdown(false);
                        }}
                      >
                        <div className="sidebar-notif-item-title">{notif.title}</div>
                        <div className="sidebar-notif-item-message">{notif.message}</div>
                        <div className="sidebar-notif-item-time">
                          {new Date(notif.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="sidebar-notif-dropdown-footer">
                  <button onClick={() => { setShowNotifDropdown(false); navigate('/settings?tab=notifications'); }}>
                    View all notifications
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {onCollapseToggle && (
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={onCollapseToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        <div className="sidebar-user-wrapper" ref={userMenuRef}>
          <button
            className="sidebar-user"
            onClick={() => setShowUserMenu((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showUserMenu}
            title={collapsed ? (firstName || userEmail || 'Account') : undefined}
          >
            <span className="sidebar-user-avatar">{initials}</span>
            <span className="sidebar-user-name">{firstName || userEmail || 'Account'}</span>
          </button>
          {showUserMenu && (
            <div className="sidebar-user-menu" role="menu">
              <button className="sidebar-user-menu-item" role="menuitem" onClick={() => { setShowUserMenu(false); navigate('/dashboard'); }}>Dashboard</button>
              <button className="sidebar-user-menu-item" role="menuitem" onClick={() => { setShowUserMenu(false); navigate('/team'); }}>Team</button>
              <button className="sidebar-user-menu-item" role="menuitem" onClick={() => { setShowUserMenu(false); navigate('/usage'); }}>Usage</button>
              <button className="sidebar-user-menu-item" role="menuitem" onClick={() => { setShowUserMenu(false); navigate('/settings'); }}>Settings</button>
              <div className="sidebar-user-menu-divider" />
              <button className="sidebar-user-menu-item sidebar-user-menu-item--danger" role="menuitem" onClick={handleSignOut}>Sign Out</button>
            </div>
          )}
        </div>
      </nav>

    </>
  );
}

export default Sidebar;
