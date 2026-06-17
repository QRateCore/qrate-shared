export { default as MenuManagerClient } from './MenuManagerClient';
export type { BulkMode, DragState } from './MenuManagerClient';
export { default as EditModal } from './components/EditModal';
export type { DietaryTagService } from './components/EditModal';
export { default as BulkActionsPanel } from './components/BulkActionsPanel';
export { default as BulkModifierPanel } from './components/BulkModifierPanel';
// PDD 2026-05-22 — shared picker (extracted from BulkActionsPanel.BulkGroupingForm)
export { BulkMemberPicker, DEFAULT_MAX_PICKER_SELECTIONS } from './components/BulkMemberPicker';
export type { BulkMemberPickerProps } from './components/BulkMemberPicker';
// PDD 2026-05-22 — Menu Builder bulk Includes drawer
export { default as BulkMenuSidesPanel } from './components/BulkMenuSidesPanel';
export type {
  BulkMenuSidesPanelProps,
  BulkMenuSidesParent,
  PerMenuSidesResult,
  SideType,
} from './components/BulkMenuSidesPanel';
export { CloneMenuModal } from './components/CloneMenuModal';
export type { CloneMenuModalProps } from './components/CloneMenuModal';
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
export { getMenuColor, CANONICAL_CATEGORIES, toCanonical, UNGROUPED_KEY, MENU_SECTIONS, sectionForCanonical } from './lib/menuUtils';
export type { MenuColor, MenuColorName, CanonicalCategory, MenuSection } from './lib/menuUtils';

// Unified drag-drop placement modal (replaces SubCategoryPickModal +
// the owner-app CategorySelectionModal).
export { ItemPlacementModal } from './components/ItemPlacementModal';
export type { ItemPlacementModalProps } from './components/ItemPlacementModal';
