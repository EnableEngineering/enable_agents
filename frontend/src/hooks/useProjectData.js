/**
 * useProjectData Hook
 *
 * Manages project-scoped data persistence for agents.
 * - Loads data when project is selected
 * - Saves data to project context (localStorage in demo, API in live)
 * - Provides shared data from other agents in the same project
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDemoProjectsWithData } from '../data/demo';
import { showToast } from '../core/toast';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const PROJECTS_STORAGE_KEY = 'enableAgentsProjects';

/**
 * Get projects from localStorage (demo mode)
 */
const getStoredProjects = () => {
  try {
    const data = localStorage.getItem(PROJECTS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

/**
 * Save projects to localStorage (demo mode)
 */
const saveStoredProjects = (projects) => {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.warn('Failed to save projects:', e);
  }
};

/**
 * Hook for managing project-scoped data
 *
 * @param {string} agentKey - The agent identifier (e.g., 'executiveAssistant')
 * @param {object} options - Configuration options
 * @param {object} options.defaultData - Default data structure for this agent
 * @param {function} options.onProjectLoad - Callback when project data is loaded
 */
export function useProjectData(agentKey, options = {}) {
  const { defaultData = {}, onProjectLoad } = options;

  // Use refs for callback and defaultData to avoid re-creating loadProject on every render
  const onProjectLoadRef = useRef(onProjectLoad);
  onProjectLoadRef.current = onProjectLoad;

  const defaultDataRef = useRef(defaultData);

  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');

  const [isDemoMode] = useState(() => {
    return localStorage.getItem('enableAgentsMode') === 'demo';
  });

  const [project, setProject] = useState(null);
  const [agentData, setAgentData] = useState(() => defaultDataRef.current);
  const [sharedData, setSharedData] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const userEmail = localStorage.getItem('userEmail') || '';

  /**
   * Load project and its data
   */
  const loadProject = useCallback(async (id) => {
    if (!id) {
      setProject(null);
      setAgentData(defaultDataRef.current);
      setSharedData({});
      return;
    }

    setLoading(true);

    if (isDemoMode) {
      // Load from localStorage
      const projects = getStoredProjects();
      const proj = projects.find(p => p.id === id);

      if (proj) {
        setProject(proj);
        // Load agent-specific data
        const myData = proj.data?.[agentKey] || defaultDataRef.current;
        setAgentData(myData);

        // Load shared data from other agents
        const shared = {};
        Object.entries(proj.data || {}).forEach(([key, value]) => {
          if (key !== agentKey) {
            shared[key] = value;
          }
        });
        setSharedData(shared);

        onProjectLoadRef.current?.(proj, myData, shared);
      }

      setLoading(false);
      return;
    }

    // Live mode - fetch from API
    try {
      const res = await fetch(`${API_URL}/api/projects/${id}`, {
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        const proj = data.project;

        setProject(proj);
        const myData = proj.data?.[agentKey] || defaultDataRef.current;
        setAgentData(myData);

        // Shared data
        const shared = {};
        Object.entries(proj.data || {}).forEach(([key, value]) => {
          if (key !== agentKey) {
            shared[key] = value;
          }
        });
        setSharedData(shared);

        onProjectLoadRef.current?.(proj, myData, shared);
      }
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setLoading(false);
    }
  }, [agentKey, isDemoMode, userEmail]);

  /**
   * Save agent data to project
   */
  const saveData = useCallback(async (newData) => {
    if (!project) {
      // No project selected - just update local state
      setAgentData(newData);
      return;
    }

    setAgentData(newData);

    if (isDemoMode) {
      // Save to localStorage
      const projects = getStoredProjects();
      const idx = projects.findIndex(p => p.id === project.id);

      if (idx >= 0) {
        if (!projects[idx].data) {
          projects[idx].data = {};
        }
        projects[idx].data[agentKey] = newData;
        projects[idx].updatedAt = new Date().toISOString();
        saveStoredProjects(projects);
        setLastSaved(new Date());
      }
      return;
    }

    // Live mode - save to API
    try {
      const res = await fetch(`${API_URL}/api/projects/${project.id}/data`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          agent: agentKey,
          data: newData,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || 'Failed to save - your changes were not stored', 'error');
        return false;
      }
      setLastSaved(new Date());
      return true;
    } catch (err) {
      console.error('Failed to save project data:', err);
      showToast('Failed to save - your changes were not stored', 'error');
      return false;
    }
  }, [project, agentKey, isDemoMode, userEmail]);

  /**
   * Update specific fields in agent data
   */
  const updateData = useCallback((updates) => {
    const newData = { ...agentData, ...updates };
    saveData(newData);
  }, [agentData, saveData]);

  /**
   * Get data from another agent in the same project
   */
  const getSharedAgentData = useCallback((otherAgentKey) => {
    return sharedData[otherAgentKey] || null;
  }, [sharedData]);

  /**
   * Check if we have access to another agent's data
   */
  const hasSharedData = useCallback((otherAgentKey) => {
    return !!sharedData[otherAgentKey];
  }, [sharedData]);

  // Load project on mount or when projectId changes
  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  return {
    // Project info
    project,
    projectId,
    hasProject: !!project,

    // Agent's own data
    data: agentData,
    saveData,
    updateData,

    // Shared data from other agents
    sharedData,
    getSharedAgentData,
    hasSharedData,

    // Loading state
    loading,
    lastSaved,

    // Refresh
    refresh: () => loadProject(projectId),
  };
}

/**
 * Initialize demo projects in localStorage if not present
 * Uses demo data from JSON files in src/data/demo/
 */
export function initializeDemoProjects() {
  const existing = getStoredProjects();
  if (existing.length > 0) return;

  // Load demo projects with full agent data from JSON files
  const demoProjects = getDemoProjectsWithData();
  saveStoredProjects(demoProjects);
}

/**
 * Reset demo data to defaults from JSON files
 * Useful for "Reset Demo Data" button
 */
export function resetDemoProjects() {
  const demoProjects = getDemoProjectsWithData();
  saveStoredProjects(demoProjects);
  return demoProjects;
}

export default useProjectData;
