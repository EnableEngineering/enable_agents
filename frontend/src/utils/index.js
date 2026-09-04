/**
 * Utils Library Index
 *
 * Usage:
 *   import { announce, generateId, getFocusableElements } from '../utils';
 */

export {
  // Per-agent local UI state storage
  getAgentData,
  setAgentData,
  updateAgentData,
  clearAgentData,
  useModeStorage,
  AGENT_KEYS,
} from './modeStorage';

export {
  // ID generation
  generateId,
  resetIdCounter,

  // Screen reader announcements
  announce,
  announceAssertive,

  // Focus management
  getFocusableElements,
  getFirstFocusable,
  getLastFocusable,
  focusFirst,

  // ARIA helpers
  getExpandableButtonProps,
  getExpandableContentProps,
  getTabProps,
  getTabPanelProps,
  getDialogProps,
  getOptionProps,

  // Color contrast
  getContrastRatio,
  meetsContrastAA,
  meetsContrastAAA,

  // Motion preferences
  prefersReducedMotion,
  getAnimationDuration
} from './accessibility';
