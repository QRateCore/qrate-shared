export interface Restaurant {
  id: string;
  name: string;
  address: string;
  phone: string;
  cuisine_type: string;
}

export interface RestaurantCreate {
  name: string;
  address: string;
  phone: string;
  cuisine_type: string;
}

export interface BeverageTags {
  beverage_type?: string;
  alcoholic?: boolean;
  base_spirit?: string | null;
  wine_variety?: string | null;
  beer_style?: string | null;
  flavor_notes?: string[];
  served?: string | null;
  strength?: string;
  key_ingredients?: string[];
}

export interface FoodTags {
  ingredients?: string[];
  allergens?: string[];
  heat?: number;
  heat_spice?: string[];
  cooking_method?: string[];
  textures?: string[];
  dietary?: string[];
  calorie_count?: string;
  taste_profile?: string[];
  seasons?: string[];
  festivity?: string[];
  beverage?: BeverageTags;
  // Legacy fields — kept for backwards compatibility
  cuisine?: string[];
  proteins?: string[];
  vegetables?: string[];
  portion?: string;
  times?: string[];
  tags?: string[];
}

export interface GuidedSectionItem {
  name: string;
  emoji: string;
  description: string;
  matchingItemIds: string[];
}

export interface GuidedSection {
  type: 'mood' | 'texture' | 'proteins' | 'vegetables';
  label: string;
  emoji: string;
  items: GuidedSectionItem[];
}

export interface MenuAssociation {
  menu_id: string;
  menu_name: string;
  price: number | null;
  category_name?: string;
  canonical_categories?: string[];
  boost_level?: string | null;
  chefs_special?: boolean;
  portion_type?: 'single' | 'shared';
  portion_serves?: number | null;
  /**
   * Per-canonical-category price overrides for this (item, menu) placement.
   * Only categories with an explicit override appear here. Missing keys fall
   * back to the default `price`. When the item is in a single canonical
   * category, owners typically just set `price` and leave this empty.
   *
   * Source: backend `menu_item_menu_categories` table, aggregated into a
   * JSON map server-side. Frontend consumers should treat an empty or
   * absent map as "no overrides — use `price` for every category."
   */
  category_prices?: Record<string, number>;
  /**
   * Per-canonical-category boost level overrides. Keys are canonical category
   * names; values are the boost level string ("1"/"2"/"3"). Missing keys fall
   * back to the shared `boost_level` for this (item, menu) placement.
   */
  category_boost_levels?: Record<string, string | null>;
  /**
   * Per-canonical-category chef's special flag overrides. Missing keys fall
   * back to the shared `chefs_special` for this (item, menu) placement.
   */
  category_chefs_specials?: Record<string, boolean>;
  /**
   * Per-canonical-category portion overrides. Missing keys fall back to the
   * shared `portion_type`/`portion_serves` for this (item, menu) placement.
   */
  category_portions?: Record<string, { portion_type: 'single' | 'shared'; portion_serves: number | null }>;
}

/** Per-menu, per-item settings passed to POST/PATCH junction endpoints */
export interface MenuItemJunctionSettings {
  price?: number | null;
  category_name?: string | null;
  canonical_categories?: string[];
  boost_level?: string | null;
  chefs_special?: boolean;
  portion_type?: 'single' | 'shared';
  portion_serves?: number | null;
  /**
   * Optional per-category price overrides. When provided, the backend
   * replaces any existing overrides for (item, menu) with this set.
   * Keys not present in `canonical_categories` are ignored server-side.
   * Use `{}` or omit to clear all overrides; the base `price` applies.
   */
  category_prices?: Record<string, number>;
  /** Per-category boost level overrides (same replace-semantics as category_prices). */
  category_boost_levels?: Record<string, string | null>;
  /** Per-category chef's special flag overrides (same replace-semantics as category_prices). */
  category_chefs_specials?: Record<string, boolean>;
  /** Per-category portion overrides (same replace-semantics as category_prices). */
  category_portions?: Record<string, { portion_type: 'single' | 'shared'; portion_serves: number | null }>;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  food_tags?: FoodTags;
  thumbnail_url?: string | null;
  gallery_urls?: (string | null)[];
  boost_level?: number;
  chefs_special?: boolean;
  /** 'single' = serves one person; 'shared' = serves multiple guests */
  portion_type?: 'single' | 'shared';
  /** Number of guests the item serves (only set when portion_type = 'shared') */
  portion_serves?: number | null;
  menu_id?: string;
  menu_associations?: MenuAssociation[];
  /**
   * 'dish'     — regular menu item visible to diners.
   * 'addon'    — ingredient-level modifier (e.g. Extra Chicken), hidden from browsing.
   * 'included' — orderable by diners AND eligible to be offered free-with-order by the recommendation engine.
   */
  item_type?: 'dish' | 'addon' | 'included';
}

export interface MenuItemCreate {
  name: string;
  description?: string;
  price: number;
  category: string;
}

export interface MenuItem_MenuRef {
  id: string;
  name: string;
  slug: string;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number[];
  is_all_day: boolean;
}

export interface Menu {
  id: string;
  restaurant_id: string;
  name: string;
  items: MenuItem[];
  menus?: MenuItem_MenuRef[];
  guidedCategories?: GuidedSection[];
}

// Per-day schedule entry: start and end time for a specific day
export interface DaySchedule {
  start: string;  // "HH:MM"
  end: string;    // "HH:MM"
}

// Keys are day numbers as strings: "0"=Sun, "1"=Mon, ... "6"=Sat
export type MenuSchedule = Record<string, DaySchedule>;

export interface MenuSummary {
  id: string;
  name: string;
  slug: string;
  display_order: number;
  active: boolean;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number[];
  is_all_day: boolean;
  schedule: MenuSchedule | null;
  item_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface MenuCreate {
  name: string;
  is_all_day?: boolean;
  start_time?: string;
  end_time?: string;
  days_of_week?: number[];
  schedule?: MenuSchedule | null;
}

export interface MenuUpdate {
  name?: string;
  is_all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: number[];
  active?: boolean;
  display_order?: number;
  schedule?: MenuSchedule | null;
}

// ─── HTTP Adapter (auth-agnostic interface for service factories) ────────────

/**
 * Minimal HTTP adapter that each app implements with its own auth mechanism.
 * The shared factory uses this to make authenticated requests.
 */
export interface HttpAdapter {
  /** Make an authenticated JSON request. Returns parsed JSON response body. */
  fetchJson<T>(url: string, opts?: { method?: string; body?: unknown }): Promise<T>;
  /** Make a raw fetch (e.g. for S3 presigned-URL uploads that don't need auth headers). */
  fetchRaw(url: string, opts?: RequestInit): Promise<Response>;
}

// ─── Menu Items Management Service ──────────────────────────────────────────

export interface SideEntry {
  menu_item_id: string;
  name: string;
  price_override: number | null;
  thumbnail_url?: string | null;
}

export interface RecommendationEntry {
  menu_item_id: string;
  name: string;
  price_override: number | null;
  thumbnail_url?: string | null;
  /** Defaults to 'manual' for newly drag-dropped items; set by backend on save. */
  recommendation_type?: 'manual' | 'ai' | 'ai_generated';
}

export interface AddonEntry {
  /** Row ID in menu_item_addons — present when returned by the API, absent for local-optimistic entries */
  id?: string;
  menu_item_id: string;
  name: string;
  price_override: number;
  thumbnail_url?: string | null;
  status: 'suggested' | 'approved';
  suggestion_source: 'ai' | 'manual';
}

export interface MenuItemDisplay {
  id: string;
  name: string;
  description?: string | null;
  price: number | null;
  price_raw?: string | null;
  category: string;
  food_tags?: FoodTags;
  thumbnail_url?: string | null;
  gallery_urls?: (string | null)[];
  boost_level?: number;
  chefs_special?: boolean;
  /** Pipeline-assigned canonical category (set by the categorize stage, independent of menu assignment) */
  canonical_category?: string | null;
  canonical_categories?: string[];
  /** 'single' = serves one person; 'shared' = serves multiple guests */
  portion_type?: 'single' | 'shared';
  /** Number of guests the item serves (only set when portion_type = 'shared') */
  portion_serves?: number | null;
  menu_id?: string;
  menu_associations?: MenuAssociation[];
  /**
   * 'dish'     — regular menu item visible to diners.
   * 'addon'    — ingredient-level modifier, hidden from browsing.
   * 'included' — orderable by diners AND eligible to be offered free-with-order by the recommendation engine.
   */
  item_type?: 'dish' | 'addon' | 'included';
  enrichment_status?: string;
  food_tags_source?: string;
  enriched_at?: string | null;
  /** true = visible to diners; false = hidden from diners but visible in owner dashboard */
  active?: boolean;
  /**
   * Per-item modifiers stored in dedicated join tables.
   * `sides` — legacy combined list (menu_item_sides table, unfiltered).
   * `sides_and` — Included sides (side_type='and'), always free-with-order.
   * `sides_or` — Choice sides (side_type='or'), one-of selection.
   * `recommendations` — paired dish items (menu_item_recommendations table).
   * `addons` — ingredient-level extras, e.g. "Extra Chicken" (menu_item_addons table).
   *
   * When the `sides_and_or_split` feature flag is ENABLED, consumers should
   * read/write `sides_and` + `sides_or` and treat `sides` as read-only legacy.
   * When DISABLED, consumers should continue to read/write `sides` +
   * `sides_selection_mode` only. Mixing the two write paths in a single
   * PATCH request is a 400 at the backend (STR-342).
   */
  sides?: SideEntry[];
  sides_and?: SideEntry[];
  sides_or?: SideEntry[];
  recommendations?: RecommendationEntry[];
  addons?: AddonEntry[];
  sides_selection_mode?: 'and' | 'or';
}

export interface MenuItemsService {
  /** Required: fetch all menu items as a flat list */
  getItems(restaurantId: string): Promise<MenuItemDisplay[]>;

  /** If present, basic info fields become editable and a Save button appears */
  updateItem?(itemId: string, updates: Partial<MenuItemDisplay>): Promise<MenuItemDisplay>;
  /** If present, an "Add Item" button appears */
  addItem?(restaurantId: string, data: { name: string; price: number; category: string }): Promise<MenuItemDisplay>;
  /** If present, a "Delete" button (with permanent-delete confirmation) appears */
  deleteItem?(itemId: string): Promise<void>;
  /** If present, an Active/Inactive toggle appears next to Delete */
  toggleActive?(itemId: string, active: boolean): Promise<void>;

  /** If present, food tags can be saved */
  saveTags?(itemId: string, tags: FoodTags): Promise<void>;
  /** If present, a "Generate All Tags" button appears */
  generateAllTags?(restaurantId: string): Promise<void>;

  /** If present, image upload/generate/enhance/remove controls appear */
  uploadImage?(itemId: string, blob: Blob): Promise<string>;
  generateImage?(itemId: string): Promise<string>;
  enhanceImage?(itemId: string): Promise<string>;
  removeImage?(itemId: string): Promise<void>;

  /** If present, boost level controls appear */
  updateBoost?(restaurantId: string, itemId: string, level: number): Promise<void>;

  /** If present, "Add to Menu" / per-menu pricing controls appear */
  addItemToMenu?(itemId: string, menuId: string, price: number, categoryName?: string, options?: { canonical_categories?: string[] }): Promise<MenuAssociation[]>;
  removeItemFromMenu?(itemId: string, menuId: string): Promise<MenuAssociation[]>;
  updateItemInMenu?(itemId: string, menuId: string, settings: MenuItemJunctionSettings): Promise<MenuAssociation[]>;

  /** If present, provides the list of available menus for the restaurant */
  getMenus?(restaurantId: string): Promise<{ id: string; name: string }[]>;
}

// ── MenuItemPerformance types (used by MenuManagerService.getMenuItemPerformance) ──
export type MenuItemPerformancePeriod =
  | 'last_hour'
  | 'last_day'
  | 'last_3_days'
  | 'last_7_days'
  | 'last_month';

export interface MenuItemPerformanceResponse {
  item_id: string;
  restaurant_id: string;
  period: MenuItemPerformancePeriod;
  carousel_views: number;
  conversions: number;
  card_flips: number;
  conversion_rate: number;
}

// ── MenuManagerService — full service interface for the menu manager UI ───────
export interface MenuManagerService {
  // Items
  getAllMenuItems(restaurantId: string): Promise<MenuItemDisplay[]>;
  getMenus(restaurantId: string): Promise<MenuSummary[]>;
  addMenuItem(restaurantId: string, data: Partial<MenuItemCreate> & { name: string }): Promise<MenuItemDisplay>;
  updateMenuItem(itemId: string, updates: Partial<MenuItemDisplay>): Promise<MenuItemDisplay>;
  deleteMenuItem(itemId: string): Promise<void>;
  toggleMenuItemActive(itemId: string, active: boolean): Promise<void>;

  // Menu CRUD
  createMenu(restaurantId: string, data: MenuCreate): Promise<MenuSummary>;
  updateMenu(restaurantId: string, menuId: string, data: MenuUpdate): Promise<MenuSummary>;
  deleteMenu(restaurantId: string, menuId: string): Promise<void>;

  // Menu item associations
  addItemToMenu(itemId: string, menuId: string, price: number | null | undefined, category?: string, settings?: { canonical_categories?: string[] }): Promise<MenuAssociation[]>;
  removeItemFromMenu(itemId: string, menuId: string): Promise<MenuAssociation[]>;
  updateMenuItemInMenu(itemId: string, menuId: string, patch: Partial<MenuItemJunctionSettings>): Promise<MenuAssociation[]>;

  // Modifiers & addons
  getItemModifiers?(restaurantId: string, itemId: string): Promise<{
    sides: SideEntry[];
    sides_and?: SideEntry[];
    sides_or?: SideEntry[];
    recommendations: RecommendationEntry[];
    addons: AddonEntry[];
    sides_selection_mode: 'and' | 'or';
  }>;
  /**
   * Update item modifiers. Two mutually exclusive write shapes:
   *   Legacy (flag OFF): `sides` + `sides_selection_mode`
   *   Split  (flag ON):  `sides_and` + `sides_or`
   * Sending both shapes in the same call → 400 at the backend (STR-342).
   * Cross-group duplicates between sides_and and sides_or → 409.
   */
  updateItemModifiers(itemId: string, data: {
    sides?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_and?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_or?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    recommendations?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_selection_mode?: 'and' | 'or';
    addons?: AddonEntry[];
  }): Promise<void>;
  approveAddonSuggestion(itemId: string, assocId: string): Promise<void>;
  getAddonItems(restaurantId: string): Promise<MenuItemDisplay[]>;
  bulkAssignModifiers(restaurantId: string, payload: { modifier_type: 'addon' | 'side'; modifier_item_ids: string[]; dish_ids: string[] }): Promise<{ created: number; skipped: number; total: number }>;

  // Images
  getMenuItemImageUploadUrl(itemId: string): Promise<{ upload_url: string; s3_key?: string }>;
  confirmMenuItemImageUpload(itemId: string): Promise<{ thumbnail_url: string }>;
  enhanceMenuItemImage(itemId: string): Promise<{ thumbnail_url: string }>;
  generateMenuItemImage(itemId: string): Promise<{ thumbnail_url: string }>;
  removeMenuItemImage(itemId: string): Promise<void>;

  // Performance analytics (optional — not available in all consumers)
  getMenuItemPerformance?(restaurantId: string, itemId: string, period: MenuItemPerformancePeriod): Promise<MenuItemPerformanceResponse>;
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  table_number: number;
  table_label?: string;
  qr_code_url?: string;
  capacity?: number;
  assigned_server_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTablesRequest {
  table_count: number;
  start_number?: number;
}

export interface UpdateTableRequest {
  table_label?: string;
  is_active?: boolean;
  capacity?: number;
  assigned_server_id?: string | null;
}
