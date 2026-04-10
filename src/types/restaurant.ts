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
  canonical_categories?: string[];
  /** 'single' = serves one person; 'shared' = serves multiple guests */
  portion_type?: 'single' | 'shared';
  /** Number of guests the item serves (only set when portion_type = 'shared') */
  portion_serves?: number | null;
  menu_id?: string;
  menu_associations?: MenuAssociation[];
  enrichment_status?: string;
  food_tags_source?: string;
  enriched_at?: string | null;
  /** true = visible to diners; false = hidden from diners but visible in owner dashboard */
  active?: boolean;
  /**
   * STR-251: per-item modifiers stored in menu_items.sides / menu_items.addons JSONB.
   * `sides` are free or low-cost included extras; `addons` are paid optional extras.
   * Returned by /owner/restaurants/{id}/all-items so the menu builder can render
   * them inline without an extra fetch per item.
   */
  sides?: Array<{
    menu_item_id: string;
    name: string;
    price_override: number | null;
    thumbnail_url?: string | null;
  }>;
  addons?: Array<{
    menu_item_id: string;
    name: string;
    price_override: number;
    thumbnail_url?: string | null;
  }>;
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
