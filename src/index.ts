// Types
export * from './types';

// Hooks
export { useRangeSelection } from './hooks/useRangeSelection';

// Components — Pairings
export {
  EntreeCard,
  SpokeCard,
  HubCard,
  EntreeGrid,
  EntreeDetail,
  PairableSidebar,
  getCategoryColor,
  isEntreeCategory,
  setCanonicalCategoryMap,
  CATEGORY_COLORS,
} from './components/pairings';

// Components — Menu
export { FoodTagBadges, FoodTagEditorForm, TagInput, MenuScheduleEditor, MenuTabs } from './components/menu';
export type { MenuEditState, MenuTabsProps, MenuScheduleEditorProps } from './components/menu';

// Components — Experience
export { ExperienceManagement, TableCard, TableDetailSheet } from './components/experience';
export type { TableCardProps, TableDetailSheetProps } from './components/experience';

// Components — Staff
export { StaffManagement, SwipeSlider } from './components/staff';
export type { SwipeSliderProps } from './components/staff';

// Components — Menu Items
export { MenuItemsManagement } from './components/menu-items';

// Restored 2026-05-18 — admin-webapp consumes this factory. The earlier
// "unused" deletion (df73858) missed qrate-admin-webapp as a consumer.
// See services/createMenuManagerService.ts header for the history.
export { createMenuManagerService } from './services/createMenuManagerService';

// Components — Menu Manager (full two-pane menu management UI)
export { MenuManagerClient } from './components/menu-manager';
export type { BulkMode, DragState } from './components/menu-manager';
export { EditModal, MenuManagerServiceProvider, BulkActionsPanel, BulkModifierPanel, CloneMenuModal } from './components/menu-manager';
export type { CloneMenuModalProps } from './components/menu-manager';
export type { DietaryTagService } from './components/menu-manager';
export { TrackActionProvider, useTrackAction } from './components/menu-manager';
export type { TrackActionFn, TrackActionOptions } from './components/menu-manager';
export { SelectionRuleEditor } from './components/menu-manager';
export type { RulePresetKind } from './components/menu-manager';
export { ItemPool, getMenuColor, CANONICAL_CATEGORIES, toCanonical, UNGROUPED_KEY, ItemPlacementModal, MENU_SECTIONS, sectionForCanonical } from './components/menu-manager';
export type { MenuColor, MenuColorName, CanonicalCategory, ItemPlacementModalProps, MenuSection } from './components/menu-manager';

// Components — Common
export { QRateLogo, Button, Card, Select } from './components/common';

// Lib — Groupings (PDD 2026-05-10 collapse-addons-recs Phase D Step 11)
// Helper for reading add-on entries from item.groupings instead of the
// legacy item.addons field. Kept structurally compatible with patron-
// webapp's standalone copy at src/lib/groupings/useGroupingAddons.ts.
export {
  getAddonsFromGroupings,
  useGroupingAddons,
  type AddonView,
  type ItemWithGroupingsAndItems,
} from './lib/groupings/useGroupingAddons';

// Components — Preview (owner-side patron view mockups)
export { PhoneFrame, WelcomeScreenPreview, GoodbyeScreenPreview, CarouselPreviewPhone, CompositionPreviewPhone, FoodItemPreviewModal } from './components/preview';
export type { PhoneFrameProps, WelcomeScreenPreviewProps, GoodbyeScreenPreviewProps, CarouselPreviewPhoneProps, CompositionPreviewPhoneProps, FoodItemPreviewModalProps } from './components/preview';
export type { QRateLogoProps, SelectProps, SelectOption, SelectSize } from './components/common';

// Services
export { createMenuItemsService, fetchCanonicalCategoryMap } from './services/createMenuItemsService';
export type { CreateMenuItemsServiceOptions } from './services/createMenuItemsService';

// Utils — Order Status Display
export { STATUS_DISPLAY, getNextStatus, getNextStatusLabel, ACTIVE_STATUSES, isActiveStatus } from './utils/order-status-display';

// Constants
export {
  TAG_CATEGORIES,
  COMPACT_TAG_CATEGORIES,
  HEAT_LABELS,
  CALORIE_OPTIONS,
  DEFAULT_HEAT_LABELS,
  DEFAULT_HEAT_ICONS,
  DEFAULT_HEAT_BG,
  DEFAULT_HEAT_BORDER,
  DEFAULT_HEAT_COLOR,
  MIN_SPICE_SCALE_LEVELS,
  MAX_SPICE_SCALE_LEVELS,
  SPICE_LABEL_MIN,
  SPICE_LABEL_MAX,
  DEFAULT_SWEETNESS_LABELS,
  DEFAULT_SWEETNESS_ICONS,
  DEFAULT_SWEETNESS_BG,
  DEFAULT_SWEETNESS_BORDER,
  DEFAULT_SWEETNESS_COLOR,
  MIN_SWEETNESS_SCALE_LEVELS,
  MAX_SWEETNESS_SCALE_LEVELS,
  SWEETNESS_LABEL_MIN,
  SWEETNESS_LABEL_MAX,
} from './constants';

// Feature flags
export { SWEETNESS_VISIBLE, isSubcategoryV2Enabled } from './constants/feature-flags';

// Utils — Recommendation Broadcast (cross-tab reactivity)
export { broadcastRecommendationChange, onRecommendationChange } from './utils/recommendation-broadcast';
export type { RecommendationChangeMessage } from './utils/recommendation-broadcast';

// Utils — Addon Broadcast (cross-tab reactivity)
export { broadcastAddonChange, onAddonChange } from './utils/addon-broadcast';
export type { AddonChangeMessage } from './utils/addon-broadcast';

// Utils — Food Tags Review (single source of truth for the
// "Allergens & Dietary" filter + the EditModal yellow-tint nudge)
export {
  isAllergensReviewed,
  isDietaryReviewed,
  needsAllergenOrDietaryReview,
} from './utils/foodTagsReview';
export type { ItemWithReviewState } from './utils/foodTagsReview';

// Utils — Spice Derivation (client-side port of qrate-core HEAT_FROM_SPICE_LEVEL;
// powers EditModal "Patron sees" preview + Spice tab per-row 0..4 hint — STR-478)
export {
  deriveHeat,
  deriveHeatFromLabel,
  HEAT_FROM_SPICE_LEVEL,
} from './utils/spice-derivation';

// Utils — Menu schedule evaluation. Drives the Active vs Inactive Recs
// split on MenuBuilder rows + the Food Library Active/Inactive chips.
// Runs in the owner's browser tz on purpose — `restaurants.timezone`
// doesn't exist as a column, so a server-side UTC eval would be wrong
// for non-UTC restaurants.
export { isMenuLiveNow, classifyRecMember } from './utils/menuSchedule';

// Utils — Currency (canonical 16-currency preset + formatMoney helper).
// Mirrored to qrate-patron-webapp/src/lib/utils/currency.ts via a CI sync
// guard. PDD: .agents/planning/2026-05-19-currency-configuration/
export {
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  DEFAULT_CURRENCY_LOCALE,
  getCurrencyConfig,
  formatMoney,
} from './utils/currency';
export type { CurrencyCode, CurrencyConfig, FormatMoneyOptions } from './utils/currency';
