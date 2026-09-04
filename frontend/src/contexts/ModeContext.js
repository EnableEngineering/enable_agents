/**
 * Mode Context
 *
 * Provides demo/live mode state to the entire app via React Context.
 * Uses storage event listener instead of polling to detect mode changes.
 *
 * Usage:
 *   import { useMode } from '../contexts/ModeContext';
 *   const { isDemoMode, setMode } = useMode();
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const MODE_KEY = 'enableAgentsMode';

const ModeContext = createContext({
  isDemoMode: false,
  setMode: () => {},
});

export function ModeProvider({ children }) {
  // Default is Live when unset - was `!== 'live'`, which defaults to Demo
  // for any value other than the literal string 'live' (including null,
  // i.e. every first-time visitor), the opposite of the locked product
  // decision ("Live by default, user switches to Demo when exploring
  // samples" - docs/todo/active-priorities.md).
  const [isDemoMode, setIsDemoMode] = useState(() => {
    return localStorage.getItem(MODE_KEY) === 'demo';
  });

  // Listen for storage changes (from other tabs or same-tab updates)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === MODE_KEY || e.key === null) {
        const newMode = localStorage.getItem(MODE_KEY) === 'demo';
        setIsDemoMode(newMode);
      }
    };

    // Listen to storage events from other tabs
    window.addEventListener('storage', handleStorageChange);

    // Custom event for same-tab updates
    const handleModeChange = () => {
      const newMode = localStorage.getItem(MODE_KEY) === 'demo';
      setIsDemoMode(newMode);
    };
    window.addEventListener('modeChange', handleModeChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('modeChange', handleModeChange);
    };
  }, []);

  const setMode = useCallback((isDemo) => {
    const newValue = isDemo ? 'demo' : 'live';
    localStorage.setItem(MODE_KEY, newValue);
    setIsDemoMode(isDemo);
    // Dispatch custom event for same-tab components
    window.dispatchEvent(new CustomEvent('modeChange', { detail: { isDemoMode: isDemo } }));
  }, []);

  return (
    <ModeContext.Provider value={{ isDemoMode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}

export default ModeContext;
