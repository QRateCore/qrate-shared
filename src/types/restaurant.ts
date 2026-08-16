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
  /** Wine grape variety (cabernet sauvignon, pinot noir, etc.) */
  wine_variety?: string | null;
  /** Red | white | rose | sparkling | dessert — populated by beverage_enrichment
   *  for wines. ASCII canonical values ('rose', never 'rosé' — PLAN 2026-08-04 M5). */
  wine_color?: string | null;
  /** Light | medium | full — populated by beverage_enrichment for wines. */
  wine_body?: string | null;
  /** Dry | off-dry | medium-sweet | sweet — populated for wines + dessert wines. */
  wine_style?: string | null;
  /** Dry | off-dry | medium-sweet | sweet | dessert — applies to wines and some
   *  cocktails. Used by the wine_mapper rule for wn_sweet archetype. */
  sweetness?: string | null;
  beer_style?: string | null;
  flavor_notes?: string[];
  served?: string | null;
  strength?: string;
  key_ingredients?: string[];
  /** Wine tannin level — ordinal facet (wine_intelligence v2, PLAN 2026-08-04). */
  tannin?: 'low' | 'medium' | 'high';
  /** Wine acidity level — ordinal facet (wine_intelligence v2, PLAN 2026-08-04). */
  acidity?: 'low' | 'medium' | 'high';
  /** Oak influence — ordinal facet (wine_intelligence v2, PLAN 2026-08-04). */
  oak?: 'low' | 'medium' | 'high';
  /** 0-100 taste scalars (WSET-rubric absolute scale) served to The Cellar's
   *  quiz + rendered as sliders in the owner EditModal (PLAN 2026-08-04 M5). */
  taste_scales?: {
    body?: number;
    sweetness?: number;
    tannin?: number;
    acidity?: number;
    alcohol?: number;
  };
  /** Closed vocab ⊆ [red_meat, poultry, seafood, pasta, cheese, dessert,
   *  vegetarian, spiced] — dish-pairing tags for the wine surface. */
  dish_pairings?: string[];
  /** Sommelier tasting note, ≤160 chars (server-enforced). */
  tasting_note?: string;
}

/** Per-item review state for allergens / dietary restrictions.
 *  - 'ai_suggested': enrichment generated tags (or none); owner hasn't reviewed.
 *  - 'manually_accepted': owner has actively reviewed — added/removed/accepted
 *    /rejected a tag, or marked "None apply". Excluded from the
 *    "Allergens & Dietary" filter on the Food Items page. */
export type TagReviewState = 'ai_suggested' | 'manually_accepted';

export interface FoodTags {
  ingredients?: string[];
  allergens?: string[];
  allergens_state?: TagReviewState;
  heat?: number;
  heat_spice?: string[];
  /** Review state for the spice level on this item. Flipped to
   *  'manually_accepted' by either the row-level Accept button OR by
   *  the inline-edit canonical /spice endpoint (set or clear) as a
   *  side effect. Gates the Setup Hub "With tags accepted" coverage
   *  bar — items count as covered only when ALL FOUR review states
   *  are 'manually_accepted'. Added 2026-05-07. */
  spice_state?: TagReviewState;
  sweetness_label?: string | null;
  /** Review state for the sweetness level. Same semantics as spice_state. */
  sweetness_state?: TagReviewState;
  cooking_method?: string[];
  textures?: string[];
  dietary?: string[];
  dietary_state?: TagReviewState;
  /** Explicit "no allergens apply" flag — decoupled from allergens_state.
   *  When true, the row's N/A pill renders as selected even if
   *  allergens_state is still 'ai_suggested'. Cleared on any tag mutation
   *  (add/accept/reject) by the backend. Added 2026-05-08. */
  allergens_na?: boolean;
  /** Explicit "no dietary tags apply" flag — same semantics as allergens_na. */
  dietary_na?: boolean;
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
  /**
   * Owner-curated raw sub-category labels (free text) for this (item, menu)
   * placement. Menu-wide labels nested under the canonical buckets on the
   * owner Menu page; an item may carry several. Owner-side only (v1).
   */
  raw_categories?: string[];
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
   * Per-menu WINE serving PRICE override (PDD 2026-06-15). Keyed by serving
   * option id → price in CENTS, overriding the item-level
   * `serving_options[].price_cents` for this (item, menu) placement only.
   * Price-only; the servings themselves stay item-level. Absent ⇒ use the
   * item default.
   */
  serving_price_overrides?: Record<string, number>;
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

/** One distinct raw sub-category label on a menu, with its item count. */
export interface RawCategorySummary {
  label: string;
  item_count: number;
}

// ── First-class menu sub-category structure (PDD 2026-06-19 Phase 3) ──────────
// The new single-source model behind GET /owner/menus/{menuId}/structure. The 4
// fixed courses each hold an ordered list of sub-categories; each sub-category
// holds the ordered item ids assigned to it (single-membership within a course).

/** The 4 fixed top-level courses in the first-class sub-category model. */
export const STRUCTURE_COURSES = ['Beverages', 'Appetizers', 'Entrees', 'Desserts'] as const;
export type StructureCourse = (typeof STRUCTURE_COURSES)[number];

/** One first-class sub-category within a course. */
export interface MenuSubcategory {
  subcategory_id: string;
  name: string;
  sort_order: number;
  item_ids: string[];
  count: number;
}

/**
 * GET /owner/menus/{menuId}/structure response shape.
 *
 * Keys are the 4 `StructureCourse` names for a normal menu. A drinks-mode menu
 * (`menus.drinks_only`) is sectioned by DRINK TYPE instead — keys from the
 * restaurant's own editable `drink_subcategories` tree, which operators add to
 * and rename, so they can't be enumerated in a union.
 *
 * Hence `Partial<Record<string, …>>` rather than a widened `Record`: the four
 * course names stay well-known and `StructureCourse` keeps narrowing the food
 * paths, while an arbitrary drink key is representable and every lookup is
 * correctly typed as possibly-absent.
 */
export interface MenuStructure {
  menu_id: string;
  courses: Partial<Record<string, MenuSubcategory[]>>;
}

/** Per-menu, per-item settings passed to POST/PATCH junction endpoints */
export interface MenuItemJunctionSettings {
  price?: number | null;
  category_name?: string | null;
  canonical_categories?: string[];
  /**
   * Raw sub-category labels — replace-semantics. When provided, the backend
   * sets this (item, menu)'s labels to exactly this validated set. Omit to
   * leave existing labels unchanged.
   */
  raw_categories?: string[];
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
  /**
   * Per-menu WINE serving PRICE override (PDD 2026-06-15). Keyed by serving
   * option id → price in CENTS, overriding the item-level
   * `serving_options[].price_cents` for this (item, menu) placement only.
   * Price-only; the servings themselves stay item-level. Absent ⇒ use the
   * item default.
   */
  serving_price_overrides?: Record<string, number>;
  /** Per-category boost level overrides (same replace-semantics as category_prices). */
  category_boost_levels?: Record<string, string | null>;
  /** Per-category chef's special flag overrides (same replace-semantics as category_prices). */
  category_chefs_specials?: Record<string, boolean>;
  /** Per-category portion overrides (same replace-semantics as category_prices). */
  category_portions?: Record<string, { portion_type: 'single' | 'shared'; portion_serves: number | null }>;
}

/**
 * Wine serving size (PDD 2026-06-15). Owner-configured option so a wine can be
 * sold by the glass AND/OR the bottle, each priced independently. Stored on
 * `menu_items.serving_options` (JSONB). `id` is a slug unique within the array;
 * exactly one option has `is_default` (server-normalized on write).
 */
export interface ServingOption {
  id: string;
  label: string;
  /** Pour size in millilitres (display only; optional). */
  volume_ml?: number;
  /** Price for this serving, in cents. */
  price_cents: number;
  is_default: boolean;
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
  /**
   * Wine serving sizes (PDD 2026-06-15). Owner-configured glass/bottle options.
   * Absent / empty ⇒ single-priced wine (patron skips the serving step).
   */
  serving_options?: ServingOption[] | null;
  /**
   * Wine identity/provenance columns (PLAN 2026-08-04 M2/M5). Top-level
   * menu_items columns (NOT food_tags.beverage facets) — readable on owner
   * GETs and writable via PUT /owner/menu/items/{itemId}. wine_old_world is
   * DERIVED server-side from wine_country via the closed Old/New-World maps;
   * an explicit value is accepted only when the country is absent/unknown
   * (contradicting pairs are rejected with code=inconsistent_pair).
   */
  wine_varietal?: string | null;
  wine_region?: string | null;
  wine_vintage?: number | null;
  wine_producer?: string | null;
  wine_country?: string | null;
  wine_old_world?: boolean | null;
  /**
   * PDD 2026-05-15: owner per-item opt-out for the patron composition page
   * Spice Level slider (VISIBILITY). Defaults to TRUE on the wire.
   */
  spice_modifier_enabled?: boolean;
  /**
   * PDD 2026-07-17 (re-split from STR-680): owner "require a spice selection"
   * flag (REQUIRED). When true — and spice_modifier_enabled is also true —
   * the patron must pick a spice level before adding the item. The backend
   * force-reverts this to FALSE whenever spice_modifier_enabled is false.
   * Defaults to FALSE on the wire.
   */
  spice_selection_required?: boolean;
  /**
   * PDD 2026-05-26: Build-Your-Own classification. When true, the recommender
   * bypasses Stage 0 dietary/allergen filtering on the dish's own tags so the
   * dish surfaces to any diner; the patron flow routes it through the
   * composition page. Defaults to FALSE on the wire.
   */
  is_byo?: boolean;
  /** Pipeline-assigned canonical category (set by the categorize stage) */
  canonical_category?: string | null;
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
  /**
   * PDD 2026-05-25 — owner/staff-only free-text note attached to add-ons
   * (e.g. "comes with bread basket"). NEVER patron-facing. Capped at 500
   * chars server-side. NULL = no note.
   */
  memo?: string | null;
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

/**
 * Owner-set intent label for the patron Now Serving banner.
 * Allowlist enforced by the backend (qrate-core owner_menus.py
 * MENU_INTENT_LABELS). NULL = unspecified (banner suppressed).
 * Phase 1 Analyze-Menu-Configurations (PDD 2026-06-22).
 */
export type MenuIntentLabel =
  | 'breakfast'
  | 'brunch'
  | 'lunch'
  | 'happy_hour'
  | 'dinner'
  | 'late_night'
  | 'all_day'
  | 'drinks';

export const MENU_INTENT_LABELS: readonly MenuIntentLabel[] = [
  'breakfast',
  'brunch',
  'lunch',
  'happy_hour',
  'dinner',
  'late_night',
  'all_day',
  'drinks',
] as const;

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
  /** Crawler-set source URL. NULL for menus the owner created manually. */
  source_url?: string | null;
  /**
   * Owner-set intent (drives patron "Now Serving" banner). NULL = unspecified.
   * Phase 1 Analyze-Menu-Configurations (PDD 2026-06-22).
   */
  intent_label?: MenuIntentLabel | null;
  /**
   * Owner-set integer rank for overlap tiebreaking. Lower = higher priority.
   * NULL = unconfigured (patron evaluator falls back to narrowest then display_order).
   * Phase 1 (Q14).
   */
  display_precedence?: number | null;
  /**
   * Drinks menu mode. TRUE = this menu is built from drink-type sections
   * (Beer / Wine / Cocktails …) instead of the 4 food courses, and is served
   * ONLY to qrate-drinks-webapp — it never appears on the patron menu.
   * At most one ACTIVE drinks menu per restaurant.
   *
   * NOT settable via updateMenu: switching modes wipes the menu's contents
   * (the two structures are not interchangeable), so it goes through
   * setMenuDrinksMode + an owner confirmation.
   */
  drinks_only?: boolean;
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
  /**
   * Owner-set intent (drives patron "Now Serving" banner).
   * Allowlist enforced server-side; null clears the label.
   * Phase 1 (PDD 2026-06-22).
   */
  intent_label?: MenuIntentLabel | null;
  /**
   * Owner-set integer rank for overlap tiebreaking (Q14).
   * Lower int = higher priority. null clears (algorithmic fallback applies).
   * Validated server-side: int >= 0 or null. Bools rejected.
   */
  display_precedence?: number | null;
}

export interface MenuCloneRequest {
  name: string;
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

/**
 * PDD 2026-05-25 overlapping-menu-items — per-menu projection of a
 * food item that appears on 2+ concurrently-active menus with diffs
 * in {price, Includes, Choose-One}. Lives on the patron-facing
 * `MenuItem.variants[]` field; drives the carousel "N VERSIONS"
 * pill, the pre-step variant chooser sheet, and the
 * `VERSION · {menu} · ₹X · change` chip on the composition page.
 *
 * Patron-only — the owner side uses a separate `OverlapPlacement`
 * shape from the openapi-fetch generated types (smaller, no thumbnails).
 */
export interface FoodItemVariant {
  menu_id: string;
  menu_name: string;
  /** Pre-formatted hours string ("12 PM — 4 PM", em-dash with spaces).
   *  Null when the menu is all-day; consumers render "All day" or hide. */
  menu_hours: string | null;
  menu_is_all_day: boolean;
  price: number;
  /** Per-menu Includes sides (menu_item_menu_sides.side_type='and'). */
  includes: SideEntry[];
  /** Per-menu Choose-One sides (menu_item_menu_sides.side_type='or').
   *  Field named `pick_one` (not `choose_one`) to match patron variant
   *  card vocabulary. */
  pick_one: SideEntry[];
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
  /** Wine serving sizes (PDD 2026-06-15) — owner-configured glass/bottle options. */
  serving_options?: ServingOption[] | null;
  /**
   * Wine identity/provenance columns (PLAN 2026-08-04 M2/M5) — see MenuItem
   * for full semantics. Present on Display because the EditModal edits the
   * hydrated GET /owner/menu/items/{itemId} shape (which projects all ten
   * wine columns as of core M2).
   */
  wine_varietal?: string | null;
  wine_region?: string | null;
  wine_vintage?: number | null;
  wine_producer?: string | null;
  wine_country?: string | null;
  wine_old_world?: boolean | null;
  /**
   * PDD 2026-05-15: owner per-item opt-out for the patron composition page
   * Spice Level slider. Defaults to TRUE on the wire (backend column
   * default + COALESCE in the public menu API). Setting FALSE suppresses
   * the slider for non-dessert items only — desserts always hide
   * regardless of this flag.
   */
  spice_modifier_enabled?: boolean;
  /**
   * STR-673 (PDD 2026-06-06): when true (and spice_modifier_enabled is also
   * true), the patron composition-page spice picker is REQUIRED — the diner
   * must actively pick a level before Add-to-order enables. Nested under the
   * Spice Modifier toggle; force-reverted to false server-side whenever the
   * modifier is disabled. Defaults to FALSE (optional picker — prior behaviour).
   */
  spice_selection_required?: boolean;
  /**
   * PDD 2026-05-26: Build-Your-Own classification. When true, the recommender
   * bypasses Stage 0 filtering on the dish's own tags; the patron-side
   * "Add" CTA reads "Customize" and routes to the composition page.
   */
  is_byo?: boolean;
  /**
   * Canonical heat/spice level (1..N indexing into the per-restaurant
   * spice_scale). Source of truth alongside `food_tags.heat_spice` (label).
   * EditModal falls back to this when the JSONB label is missing.
   */
  spice_level?: number | null;
  /**
   * Canonical sweetness level (1..N indexing into the per-restaurant
   * sweetness_scale). Source of truth alongside `food_tags.sweetness_label`.
   */
  sweetness_level?: number | null;
  /** Pipeline-assigned canonical category (set by the categorize stage, independent of menu assignment) */
  canonical_category?: string | null;
  canonical_categories?: string[];
  /**
   * Drink type ('beer' | 'wine' | 'cocktails' | …) from the restaurant's
   * configurable drink-subcategory tree. On a drinks-mode menu this replaces
   * canonical_categories as the builder's top-level section key. NULL/absent
   * groups the item under the reserved 'other' bucket.
   */
  drink_subcategory_key?: string | null;
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
  /**
   * STR-928/929 — which of the owner's modifier types this add-on is filed
   * under ("Sauce", "Portion", ...). `null` = untyped = the Add-ons bucket,
   * where every pre-existing add-on lives.
   *
   * Present on Display as well as Summary because the Food Items table
   * renders MenuItemDisplay — a field on Summary alone would arrive
   * `undefined` on every row (summaryToDisplay must carry it) and silently
   * empty every modifier type's tab.
   *
   * A LABEL over the add-on pool, never a new `item_type` — see ModifierType.
   */
  modifier_type_id?: string | null;
  enrichment_status?: string;
  food_tags_source?: string;
  enriched_at?: string | null;
  /** true = visible to diners; false = hidden from diners but visible in owner dashboard */
  active?: boolean;
  /** Display-time allergen / dietary arrays for the food-items page —
   *  derived server-side from menu_item_dietary_tags (junction is
   *  canonical for owner-curated state) with a fallback to the
   *  food_tags JSONB arrays when an item has no junction rows yet.
   *  Reading from food_tags.{allergens,dietary} on the table/grid
   *  drops owner-added tags that never write back to JSONB. */
  display_allergens?: string[];
  display_dietary?: string[];
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
  /**
   * @deprecated PDD 2026-05-10 collapse-addons-recs Phase G Step 19 —
   * dish-to-dish recommendations live in `groupings` now (the
   * `kind='recommendations'` default grouping; symmetric pair expansion
   * via the food_item_grouping_recommendation_pairs view). The patron
   * payload still includes this key for stale-client compat (Phase F
   * Step 15 set it to []); new code MUST NOT consume it. Hard removal
   * is gated on:
   *   1. Phase F Step 16 prod flag flip (BYO_DUAL_WRITE_ENABLED=false)
   *      + ≥24 h soak.
   *   2. EditModal dead-code cleanup (the addon/rec tab state that
   *      still references this field as a useState initial value).
   *   3. addonHelpers.countApprovedAddons fallback removal.
   * Tracked as Step 19b.
   */
  recommendations?: RecommendationEntry[];
  /**
   * @deprecated PDD 2026-05-10 collapse-addons-recs Phase G Step 19 —
   * add-ons live in `groupings` now (the `kind='addons'` default
   * grouping; flat shape via `g.items[]`). Patron-webapp consumers
   * read via `getAddonsFromGroupings(item)` since Phase C. The patron
   * payload still includes this key with `[]` (Phase F Step 15) for
   * stale-client compat; new code MUST NOT consume it. Hard-removal
   * gated on the same conditions as `recommendations` above.
   */
  addons?: AddonEntry[];
  sides_selection_mode?: 'and' | 'or';
  /**
   * BYO PDD (2026-05-02) — unified groupings model. Additive new field;
   * legacy fields above are kept in sync via the backend compat shim.
   * Owner-webapp BYO authoring (Step 7) consumes this; until then it's
   * informational and used by GroupZone for canonical grouping IDs.
   */
  pricing_mode?: 'base_plus_components' | 'components_only';
  groupings?: Grouping[];
  /**
   * PDD 2026-05-25 — owner/staff-only memo on add-ons. Never patron-facing.
   * Capped at 500 chars server-side. NULL = no note.
   */
  memo?: string | null;
  /**
   * PDD 2026-05-25 overlapping-menu-items — per-menu projections when
   * this dish appears on 2+ concurrently-active menus with differing
   * per-menu attributes (price, Includes, Choose-One). Absent when the
   * item has only one active placement OR all placements are
   * attribute-identical — consumers treat missing as "render normally,
   * no N VERSIONS pill, no chooser". Capped at 4 entries server-side.
   */
  variants?: FoodItemVariant[];
  /**
   * PDD 2026-05-25 overlapping-menu-items — owner-authored internal
   * note explaining why this dish appears on multiple active menus
   * with differences. NEVER surfaced to diners. Capped at 240 chars
   * server-side. NULL when not set. Surfaced on the owner overlap
   * modal's rationale composer.
   */
  overlap_rationale?: string | null;
}

/**
 * Lightweight projection used by the Food Items page table + completeness
 * banner + customization-tab counts. Returned by
 * `GET /owner/restaurants/{id}/menu-items/summary`.
 *
 * Drops the heavy fields the table never renders: full food_tags JSON tail
 * (ingredients, cooking_method, textures, taste_profile, seasons,
 * festivity, calories), addons[], sides[], recommendations[],
 * gallery_urls, menu_associations[] (replaced by menu_count), AI
 * metadata. The full MenuItemDisplay is fetched on demand via
 * `GET /owner/menu/items/{itemId}` when the EditModal opens.
 *
 * The fields kept are the minimum surface needed for the rendered UI:
 * - Identity / display: id, name, description, category, item_type,
 *   thumbnail_url, price, active, pricing_mode
 * - Aggregates: menu_count
 * - Tag-derived: allergens[], dietary[], heat_spice, sweetness_label
 *   (drives Spice / Sweetness / Allergens / Dietary tab grouping + counts)
 * - Review state: allergens_state, dietary_state (drives the
 *   "Allergens & dietary" needs-review banner pill)
 * - Spice/sweetness int fallbacks (paired with the labels above)
 */
/**
 * STR-928 — one of the owner's own modifier kinds ("Sauce", "Portion", ...).
 *
 * A restaurant-scoped LABEL over the owner's add-on pool, surfaced as a row
 * on the Food Items rail beside Add-ons. Selecting a row filters the table
 * to the add-ons whose `modifier_type_id` matches.
 *
 * Deliberately NOT: a new `item_type` (that enum is CHECK-constrained in 4+
 * load-bearing places and owner-invented names can never be a DB enum), a
 * selection rule (min/max/required stay on the dish's grouping, where they
 * already work), or a template.
 */
export interface ModifierType {
  id: string;
  /** Unique per restaurant, case- and whitespace-insensitively. */
  name: string;
  /** Rail order, ascending. Ties broken by name. */
  position: number;
  /**
   * How many add-ons are filed under this type — the rail renders
   * "Sauce (4)". Counts only this restaurant's `item_type: 'addon'` rows.
   * Absent on the create response (a new type always has 0).
   */
  option_count?: number;
}

export interface MenuItemSummary {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  /**
   * Pipeline-assigned canonical category (one of Beverages, Appetizers,
   * Breads, Entrees, Sides, Desserts, Soups, Salads). Drives the
   * canonical-category chip rail on the Food Items page. Null until
   * the categorize stage runs.
   */
  canonical_category?: string | null;
  item_type: 'dish' | 'addon' | 'included';
  /**
   * STR-928 — which of the owner's modifier types this add-on is filed
   * under ("Sauce", "Portion", ...). Restaurant-scoped; see the
   * `modifier_types` table.
   *
   * `null` = untyped = the Add-ons bucket, which is where every
   * pre-existing add-on lives. The Food Items rail filters the table on
   * this field.
   *
   * Always present in the summary payload (never omitted), so the client
   * can tell "untyped" apart from "not loaded". Only add-ons carry a type;
   * a dish is always null.
   *
   * NOT a new `item_type` — a modifier type is a LABEL over the add-on
   * pool. That is deliberate: options stay `item_type: 'addon'`, so the
   * Edit modal's Add-ons picker lists them with no change to that modal.
   */
  modifier_type_id?: string | null;
  thumbnail_url?: string | null;
  price?: number | null;
  active: boolean;
  pricing_mode?: 'base_plus_components' | 'components_only' | null;
  menu_count: number;
  allergens: string[];
  dietary: string[];
  heat_spice?: string | null;
  sweetness_label?: string | null;
  allergens_state?: 'ai_suggested' | 'manually_accepted' | null;
  dietary_state?: 'ai_suggested' | 'manually_accepted' | null;
  spice_level?: number | null;
  sweetness_level?: number | null;
  /**
   * PDD 2026-05-15 — owner per-item opt-out for the patron composition-page
   * spice slider. Defaults to TRUE on the schema (NOT NULL); the backend
   * COALESCEs nulls to TRUE so this field is always a boolean on the wire.
   * Optional in TS because legacy summary payloads (pre-fix) may omit it.
   */
  spice_modifier_enabled?: boolean;
  /**
   * STR-673: per-item mandatory-spice flag in the Food Library summary
   * projection. Defaults to FALSE on the wire. Gated by spice_modifier_enabled.
   */
  spice_selection_required?: boolean;
  /**
   * PDD 2026-05-26: Build-Your-Own classification flag in the Food Library
   * summary projection. Defaults to FALSE on the wire. Drives the BYO chip
   * in the Food Library row.
   */
  is_byo?: boolean;
  /**
   * Lightweight projection of the dish's non-empty groupings, used by
   * the Food Library table's Groupings column to render a count + hover
   * popover listing each group and its members. Empty groupings are
   * filtered server-side; for kind='addons' members with status='suggested'
   * are excluded so the count matches MenuBuilder's in-editor chip.
   * Always [] for addon/included items (they don't own groupings).
   */
  groupings_summary?: GroupingSummary[];
}

/** Lightweight Grouping projection returned by /menu-items/summary.
 *  `kind` mirrors Grouping.kind so the Food Library Add-ons + Active Recs +
 *  Inactive Recs columns can filter the aggregate without re-fetching.
 *
 *  Each member carries the referenced menu_items.id plus the list of menu
 *  UUIDs on which it has an active placement on an active menu
 *  (menu_item_menus.active AND menus.active). The Food Library Active /
 *  Inactive split is: active iff at least one of these menus is ALSO
 *  currently in its schedule window in the owner's browser timezone — the
 *  time-of-day check happens client-side so the owner sees their own local
 *  evaluation, not the server's UTC one. An empty menu_ids list means the
 *  rec target is orphaned and counts as Inactive. */
export interface GroupingSummary {
  kind: 'addons' | 'sides_and' | 'sides_or' | 'recommendations' | 'modifier' | null;
  name: string;
  items: { id: string; name: string; menu_ids: string[] }[];
}

/** BYO PDD selection rule shape (Step 5 OpenAPI). */
export interface SelectionRule {
  min_select: number;
  max_select: number | null;
  default_select: 'all' | 'none' | 'first';
}

/** BYO PDD grouping member shape (Step 5 OpenAPI). */
export interface GroupingItem {
  id: string;
  menu_item_id: string;
  name?: string;
  thumbnail_url?: string | null;
  item_type: 'dish' | 'addon' | 'included';
  position?: number;
  price_override?: number | null;
  status?: 'suggested' | 'approved';
  suggestion_source?: 'manual' | 'ai';
  ai_confidence?: number | null;
  /**
   * PDD 2026-05-25 — owner/staff-only memo, projected from the linked
   * menu_items.memo so the Add member popup picker can render the Memo
   * column without an extra fetch. Add-ons only by convention.
   */
  memo?: string | null;
}

/** BYO PDD grouping shape (Step 5 OpenAPI).
 *
 * `kind='modifier'` was added by the food-item groupings PDD (2026-05-07,
 * step 1) for groupings promoted from a 3rd-party scrape (Zenfoody /
 * UberEats modifier groups). Modifier groupings additionally carry:
 *   - external_source / external_ref : provenance back to the staging
 *     row (so the UI can render "from Zenfoody" / "from UberEats").
 *   - overrides_attribute : when set, the patron app uses this grouping
 *     as the picker for the named attribute (spice / sweetness / portion)
 *     INSTEAD of the dish's item-level spice_level / sweetness_level /
 *     portion_serves UI. The owner can re-classify via PATCH on the
 *     existing single-row grouping endpoint.
 */
export interface Grouping {
  id: string;
  kind: 'addons' | 'sides_and' | 'sides_or' | 'recommendations' | 'modifier' | null;
  name: string;
  position: number;
  is_default: boolean;
  is_deletable: boolean;
  is_symmetric: boolean;
  min_select: number;
  max_select: number | null;
  default_select: 'all' | 'none' | 'first';
  pricing_contribution: 'additive' | 'replace_base' | 'none';
  external_source?: 'zenfoody' | 'ubereats' | null;
  external_ref?: string | null;
  overrides_attribute?: 'spice' | 'sweetness' | 'portion' | null;
  items: GroupingItem[];
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
  /**
   * Clone an existing menu's structure (categories + per-category overrides + items)
   * into a new menu owned by the same restaurant. The new menu starts INACTIVE
   * regardless of the source menu's active state — the owner toggles it live after
   * configuration. Optional in the interface so consumers without the backend
   * route deployed can still type-check.
   */
  cloneMenu?(restaurantId: string, sourceMenuId: string, data: MenuCloneRequest): Promise<MenuSummary>;
  /**
   * Switch a menu between normal (food courses) and drinks mode (drink-type
   * sections). DESTRUCTIVE — clears the menu's item placements and
   * sub-categories in both directions, because the two structures are not
   * interchangeable. Callers MUST confirm with the owner first.
   *
   * Rejects with 409 when another active drinks menu already exists, and with
   * 400 when this is the restaurant's only active menu (a drinks menu is hidden
   * from the patron app, so diners would be left with nothing).
   *
   * Optional so consumers without the backend route deployed still type-check.
   */
  setMenuDrinksMode?(restaurantId: string, menuId: string, enabled: boolean): Promise<MenuSummary>;
  /**
   * Bulk-assign a drink type ('beer' | 'wine' | …) to menu items. This is how a
   * drinks menu files items: its builder zones are drink types, so dropping an
   * item into one writes `menu_items.drink_subcategory_key` rather than the
   * canonical_categories a food menu uses.
   *
   * `null` clears the assignment (the item then falls into the reserved
   * 'other' bucket). Optional so consumers without the route still type-check.
   */
  bulkSetDrinkSubcategory?(restaurantId: string, itemIds: string[], key: string | null): Promise<void>;

  // Menu item associations
  addItemToMenu(itemId: string, menuId: string, price: number | null | undefined, category?: string, settings?: { canonical_categories?: string[]; raw_categories?: string[] }): Promise<MenuAssociation[]>;
  removeItemFromMenu(itemId: string, menuId: string): Promise<MenuAssociation[]>;
  updateMenuItemInMenu(itemId: string, menuId: string, patch: Partial<MenuItemJunctionSettings>): Promise<MenuAssociation[]>;

  // Raw sub-categories (menu raw sub-categories feature, 2026-06-09). Optional so
  // consumers (admin/waiter) without the backend route deployed still type-check.
  listMenuRawCategories?(menuId: string): Promise<RawCategorySummary[]>;
  renameMenuRawCategory?(menuId: string, from: string, to: string): Promise<{ updated_count: number }>;
  deleteMenuRawCategory?(menuId: string, label: string): Promise<{ updated_count: number }>;
  /** Replace-set the per-(item, menu, canonical) sub-category labels (PDD
   *  2026-06-11). Paired source of truth; the builder dual-writes this beside
   *  the legacy raw_categories write during the migration window. Optional so
   *  consumers that haven't wired it (admin/waiter) simply skip the dual-write. */
  setItemSubcategories?(menuId: string, itemId: string, canonical: string, labels: string[], mode?: 'add' | 'replace' | 'remove'): Promise<void>;

  // ── First-class sub-category structure (PDD 2026-06-19 Phase 3) ────────────
  // The single-source replacement for the raw_categories grouping + junction
  // dual-write. Gated behind isSubcategoryV2Enabled() in MenuManagerClient.
  // Optional so consumers (admin/waiter) that haven't wired them still
  // type-check; when absent and the flag is ON, the client falls back to the
  // legacy read/write path.
  /** Read the menu's grouped view: course → sub-categories → item ids. */
  getMenuStructure?(menuId: string): Promise<MenuStructure>;
  /** Create a sub-category under a course. */
  createMenuSubcategory?(menuId: string, body: { course: string; name: string; sort_order?: number }): Promise<MenuSubcategory>;
  /** Rename / reorder a single sub-category. */
  updateMenuSubcategory?(menuId: string, subId: string, body: { name?: string; sort_order?: number }): Promise<MenuSubcategory>;
  /** Reorder ALL sub-categories within one course of a menu (STR-775). `ordered_ids`
   *  is the complete set of sub-category ids for (menuId, course) in display order;
   *  backend assigns sort_order = position. `course` is a canonical course value. */
  reorderMenuSubcategories?(menuId: string, body: { course: string; ordered_ids: string[] }): Promise<{ menu_id: string; course: string; reordered: boolean; count: number }>;
  /** Delete a sub-category (its items become unassigned within the course). */
  deleteMenuSubcategory?(menuId: string, subId: string): Promise<void>;
  /** Assign an item to a sub-category (REPLACES within that course). */
  assignItemToSubcategory?(menuId: string, itemId: string, subId: string): Promise<void>;
  /** Unassign an item from its sub-category within a course (keeps it on the menu). */
  unassignItemFromSubcategory?(menuId: string, itemId: string, course: string): Promise<void>;

  // Modifiers & addons
  getItemModifiers?(restaurantId: string, itemId: string): Promise<{
    sides: SideEntry[];
    sides_and?: SideEntry[];
    sides_or?: SideEntry[];
    recommendations: RecommendationEntry[];
    addons: AddonEntry[];
    sides_selection_mode: 'and' | 'or';
  }>;
  /** Fetch restaurant-level menu intelligence (pairing_graph, etc.) — optional, not available in all consumers */
  getMenuIntelligence?(restaurantId: string): Promise<{
    menu_intelligence?: {
      pairing_graph?: Array<{
        entree_item_id: string;
        paired_items: Array<{ item_id: string; strength: number }>;
      }>;
    };
  }>;
  /**
   * Update item modifiers. Two mutually exclusive write shapes:
   *   Legacy (flag OFF): `sides` + `sides_selection_mode`
   *   Split  (flag ON):  `sides_and` + `sides_or`
   * Sending both shapes in the same call → 400 at the backend (STR-342).
   * Cross-group duplicates between sides_and and sides_or → 409.
   */
  /**
   * @deprecated PDD 2026-05-10 collapse-addons-recs Phase E Step 14 —
   * Add-ons + Recommendations writes have moved to the groupings API
   * (POST /owner/menu-items/{id}/groupings:bulk and the per-grouping
   * endpoints). The `addons` and `recommendations` fields on this
   * payload should not be sent by new code. Sides + sides_and +
   * sides_or remain valid until the menu-manager-view (InlineItemEditor)
   * is migrated to groupings — tracked as Step 14b.
   */
  updateItemModifiers(itemId: string, data: {
    sides?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_and?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_or?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    recommendations?: Array<{ menu_item_id: string; name: string; price_override: number | null; thumbnail_url?: string | null }>;
    sides_selection_mode?: 'and' | 'or';
    addons?: AddonEntry[];
  }): Promise<void>;
  /**
   * @deprecated PDD 2026-05-10 collapse-addons-recs Phase E Step 14 —
   * AI suggestion approval now lives on per-member grouping items via
   * PATCH /owner/grouping-items/{groupingItemId}/approve, called by
   * GroupingsSection's Approve button (Step 12). The legacy endpoint
   * this method called is gone after Step 17 (route returns 410).
   * Implementors may omit this method; callers must not invoke it.
   */
  approveAddonSuggestion?(itemId: string, assocId: string, priceOverride?: number): Promise<void>;
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
  drinks_qr_code_url?: string;
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
