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

// Components — Menu Manager (full two-pane menu management UI)
export { MenuManagerClient } from './components/menu-manager';
export type { BulkMode, DragState } from './components/menu-manager';
export { EditModal, MenuManagerServiceProvider } from './components/menu-manager';
export type { DietaryTagService, DietaryTagRecord } from './components/menu-manager';
export { TrackActionProvider, useTrackAction } from './components/menu-manager';
export type { TrackActionFn, TrackActionOptions } from './components/menu-manager';

// Components — Common
export { QRateLogo, Button, Card, Select } from './components/common';

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

// Utils — Recommendation Broadcast (cross-tab reactivity)
export { broadcastRecommendationChange, onRecommendationChange } from './utils/recommendation-broadcast';
export type { RecommendationChangeMessage } from './utils/recommendation-broadcast';

// Utils — Addon Broadcast (cross-tab reactivity)
export { broadcastAddonChange, onAddonChange } from './utils/addon-broadcast';
export type { AddonChangeMessage } from './utils/addon-broadcast';
