export { default as MenuManagerClient } from './MenuManagerClient';
export type { BulkMode, DragState } from './MenuManagerClient';
export { default as EditModal } from './components/EditModal';
export type { DietaryTagService, DietaryTagRecord } from './components/EditModal';
export { MenuManagerServiceProvider } from './context';
export {
  TrackActionProvider,
  useTrackAction,
} from './track-action-context';
export type {
  TrackActionFn,
  TrackActionOptions,
} from './track-action-context';

// BYO authoring primitives (Step 13 — usable on the Food Items page).
export { default as SelectionRuleEditor } from './components/SelectionRuleEditor';
export type { RulePresetKind } from './components/SelectionRuleEditor';

// Item pool primitive — reused on the Food Items page so it visually matches
// the Menu page's left column. `activateOnRowClick` + `showBulkActions=false`
// adapt it to the Food Items "click row → open editor" interaction.
export { default as ItemPool } from './components/ItemPool';
export { getMenuColor } from './lib/menuUtils';
export type { MenuColor, MenuColorName } from './lib/menuUtils';
