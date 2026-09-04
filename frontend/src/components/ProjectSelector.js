/**
 * ProjectSelector Component
 *
 * Dropdown to select/switch projects within an agent.
 * Shows only projects that have this agent enabled.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './ProjectSelector.css';
import { authOptionalHeaders } from '../core/authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
// Remembers the last project picked in ANY agent, so navigating to a
// different agent (or leaving and coming back) restores it instead of
// requiring the user to pick a project again every time - the `?project=`
// URL param alone doesn't survive a plain nav-link click to another agent.
const LAST_PROJECT_STORAGE_KEY = 'enableAgentsLastProjectId';

function ProjectSelector({ agentKey, onProjectChange }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userEmail = localStorage.getItem('userEmail') || '';

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef(null);
  // Tracks which project id we've already notified onProjectChange about,
  // so effect re-runs (StrictMode double-invoke, unrelated re-renders) don't
  // re-fire the callback - and any toast it shows - more than once per selection.
  const notifiedProjectIdRef = useRef(null);

  // Get project ID from URL
  const projectIdFromUrl = searchParams.get('project');

  // Fetch projects for this agent
  useEffect(() => {
    fetchProjects();
  }, [agentKey]);

  // Set selected project from URL, or restore the last one used
  useEffect(() => {
    if (projectIdFromUrl && projects.length > 0) {
      const project = projects.find(p => p.id === projectIdFromUrl);
      if (project) {
        setSelectedProject(project);
        if (notifiedProjectIdRef.current !== project.id) {
          notifiedProjectIdRef.current = project.id;
          onProjectChange?.(project);
        }
        // Remember it even when it arrived via a deep link (e.g. opened from
        // the Projects page) rather than a manual dropdown pick, so the next
        // agent visited without its own `?project=` can still restore it.
        localStorage.setItem(LAST_PROJECT_STORAGE_KEY, project.id);
      }
      return;
    }

    if (!projectIdFromUrl && projects.length > 0 && !loading) {
      // Preserve existing params (e.g. workflow/stage/view when opened from a
      // workflow) - only add `project`, don't clobber the whole query string.
      const currentPath = window.location.pathname;
      const newParams = new URLSearchParams(window.location.search);

      // Restore the last project selected in any agent, if it's still one
      // this agent has access to, instead of making the user pick a
      // project again every time they open a different agent.
      const rememberedId = localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
      const remembered = rememberedId && projects.find(p => p.id === rememberedId);
      if (remembered) {
        newParams.set('project', remembered.id);
        navigate(`${currentPath}?${newParams.toString()}`, { replace: true });
      }
    }
  }, [projectIdFromUrl, projects, loading, navigate]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchProjects = async () => {
    try {
      // Fetch all user projects (not filtered by agent)
      const res = await fetch(`${API_URL}/api/projects`, {
        headers: authOptionalHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (project) => {
    setSelectedProject(project);
    setIsOpen(false);

    // Update URL with project param, preserving any other existing params
    // (workflow/stage/view context etc.)
    const currentPath = window.location.pathname;
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('project', project.id);
    navigate(`${currentPath}?${newParams.toString()}`, { replace: true });
    localStorage.setItem(LAST_PROJECT_STORAGE_KEY, project.id);

    notifiedProjectIdRef.current = project.id;
    onProjectChange?.(project);
  };

  const handleClearProject = () => {
    setSelectedProject(null);
    setIsOpen(false);

    // Remove only the project param from the URL, keep everything else
    const currentPath = window.location.pathname;
    const newParams = new URLSearchParams(window.location.search);
    newParams.delete('project');
    const qs = newParams.toString();
    navigate(qs ? `${currentPath}?${qs}` : currentPath, { replace: true });
    localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);

    notifiedProjectIdRef.current = null;
    onProjectChange?.(null);
  };

  if (loading) {
    return null;
  }

  // Don't show if no projects available
  if (projects.length === 0) {
    return (
      <div className="project-selector project-selector--empty">
        <button
          className="project-selector-btn project-selector-btn--create"
          onClick={() => navigate('/projects')}
        >
          + New Project
        </button>
      </div>
    );
  }

  return (
    <div className="project-selector" ref={dropdownRef}>
      <button
        className={`project-selector-btn ${selectedProject ? 'has-project' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="project-name">
          {selectedProject ? selectedProject.name : 'Select project...'}
        </span>
        <span className="dropdown-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="project-dropdown" role="listbox">
          {selectedProject && (
            <button
              className="project-option project-option--clear"
              onClick={handleClearProject}
            >
              <span className="clear-icon">×</span>
              Clear selection
            </button>
          )}

          {projects.map(project => (
            <button
              key={project.id}
              className={`project-option ${selectedProject?.id === project.id ? 'selected' : ''}`}
              onClick={() => handleSelect(project)}
              role="option"
              aria-selected={selectedProject?.id === project.id}
            >
              <span className="project-option-name">{project.name}</span>
              {selectedProject?.id === project.id && (
                <span className="check-icon">✓</span>
              )}
            </button>
          ))}

          <div className="project-dropdown-divider" />

          <button
            className="project-option project-option--create"
            onClick={() => navigate('/projects')}
          >
            <span className="plus-icon">+</span>
            Manage Projects
          </button>
        </div>
      )}
    </div>
  );
}

export default ProjectSelector;
