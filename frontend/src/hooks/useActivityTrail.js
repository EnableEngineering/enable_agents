import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AGENTS } from '../config/agentsConfig';

const STORAGE_KEY = 'enableAgentsActivityTrail';
const MAX_ENTRIES = 5;

// Routes AGENTS doesn't cover - kept small and manual since these rarely
// change, unlike the agent list which already has its own name/route pairs.
const CORE_PAGE_LABELS = {
  '/home': 'Home',
  '/dashboard': 'Dashboard',
  '/agents': 'Agents catalog',
  '/workflows': 'Workflows',
  '/projects': 'Projects',
  '/settings': 'Settings',
  '/team': 'Team',
  '/usage': 'Usage & billing',
};

let routeLabelMap = null;
function getRouteLabelMap() {
  if (routeLabelMap) return routeLabelMap;
  routeLabelMap = { ...CORE_PAGE_LABELS };
  Object.values(AGENTS).forEach((agent) => {
    if (agent.route && agent.name) routeLabelMap[agent.route] = agent.name;
  });
  return routeLabelMap;
}

function labelForPath(pathname) {
  const map = getRouteLabelMap();
  if (map[pathname]) return map[pathname];
  // Agent sub-routes (e.g. /workflows/:id) - fall back to the closest known prefix.
  const prefixMatch = Object.keys(map)
    .filter((route) => route !== '/' && pathname.startsWith(route + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return prefixMatch ? map[prefixMatch] : null;
}

function readTrail() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTrail(trail) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail));
  } catch {
    // sessionStorage unavailable - trail just won't persist, not fatal.
  }
}

/**
 * useActivityTrail
 *
 * Records a lightweight breadcrumb of which pages the user has visited
 * this session (page-level, not click-level - individual field edits or
 * button presses aren't tracked, only navigation) so the AI Assistant can
 * be told roughly where the user has been and what they were just looking
 * at, without instrumenting every interaction in the app.
 *
 * Call once near the app root (mounted alongside the always-present
 * AiAssistantPanel) to keep the trail updated; call getActivityTrail() from
 * anywhere to read the current list of human-readable labels, oldest first.
 */
export function useActivityTrail() {
  const location = useLocation();
  const lastPathRef = useRef(null);

  useEffect(() => {
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;

    const label = labelForPath(location.pathname);
    if (!label) return; // unrecognized route (e.g. /login) - not useful context

    const trail = readTrail();
    if (trail[trail.length - 1] === label) return; // no repeat of the immediately-previous entry
    trail.push(label);
    if (trail.length > MAX_ENTRIES) trail.shift();
    writeTrail(trail);
  }, [location.pathname]);
}

export function getActivityTrail() {
  return readTrail();
}
