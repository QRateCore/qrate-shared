// @vitest-environment jsdom
/**
 * NEXT_PUBLIC_SUBCATEGORY_V2 pill DISPLAY — the builder's sub-category pill name
 * is single-source on the first-class D tables when the flag is ON.
 *
 * This is the test coverage for the owner Menu Builder cutover (PDD 2026-06-19
 * Phase 3 / STR-775 / STR-779): with the flag ON, the grouped view reads from
 * GET /owner/menus/{menuId}/structure (the D tables `menu_subcategories` /
 * `menu_subcategory_items`) — NOT from the item's legacy
 * `menu_associations[].raw_categories` (the A source).
 *
 * MECHANISM under test (verified in source):
 *   - Flag OFF: MenuBuilder derives the pill from
 *     `getSettings(menuId, itemId).raw_categories`, which flag-OFF resolves to
 *     the item's `raw_categories` (A) — MenuManagerClient.tsx `getSettings` base.
 *   - Flag ON: MenuManagerClient overrides that field in `effectiveGetSettings`
 *     (MenuManagerClient.tsx:850) to the D `sub.name`:
 *       `raw_categories: info && info.subName ? [info.subName] : []`
 *     projected from the loaded structure (`structureItemIndex`, :750).
 *   MenuBuilder then collapses that single label into the displayed pill via
 *   normalizeSubcatKey + preferScrapedLabel (MenuBuilder.tsx:2143-2166).
 *
 * COLLISION CASE (the divergence this bundle documents): the D structure sub is
 * named "Bread (Kulcha)" while the item's legacy raw_categories is the bare
 * "Bread Kulcha". Both normalize to the SAME key ("bread kulcha") — so they are
 * the same pill bucket — but the DISPLAYED label differs:
 *   - flag OFF → "Bread Kulcha"    (the raw A label)
 *   - flag ON  → "Bread (Kulcha)"  (the D name from /structure)
 *
 * We capture the `getSettings` prop MenuBuilder receives (MenuManagerClient
 * passes `effectiveGetSettings` as `getSettings`, :2912) and reproduce the exact
 * MenuBuilder pill-collapse to prove the DISPLAYED pill label, not merely the
 * raw prop value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import MenuManagerClient from '../MenuManagerClient';
import { normalizeSubcatKey, preferScrapedLabel, UNGROUPED_KEY } from '../lib/menuUtils';
import type {
  MenuItemDisplay,
  MenuSummary,
  MenuAssociation,
  MenuManagerService,
  MenuStructure,
} from '../../../types/restaurant';

const MENU_ID = 'menu-1';
const ITEM_ID = 'A';
const COURSE = 'Entrees';
// The two colliding names — same normalizeSubcatKey, different display.
const D_NAME = 'Bread (Kulcha)';   // first-class structure sub.name (D)
const RAW_NAME = 'Bread Kulcha';   // legacy raw_categories on the association (A)

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAssoc(): MenuAssociation {
  return {
    menu_id: MENU_ID,
    menu_name: `Menu ${MENU_ID}`,
    price: 10,
    category_name: COURSE,
    canonical_categories: [COURSE],
    // The legacy A grouping label — deliberately the bare variant so it diverges
    // from the D structure name below.
    raw_categories: [RAW_NAME],
    boost_level: null,
    chefs_special: false,
    portion_type: 'single',
    portion_serves: null,
  } as MenuAssociation;
}

function makeItem(): MenuItemDisplay {
  return {
    id: ITEM_ID,
    name: `Item ${ITEM_ID}`,
    description: null,
    category: COURSE,
    canonical_category: COURSE,
    price: 10,
    active: true,
    item_type: 'dish',
    thumbnail_url: null,
    associations: [],
    food_tags: {},
    addons: [],
    sides: [],
    recommendations: [],
    boost_level: null,
    chefs_special: false,
    menu_associations: [makeAssoc()],
  } as unknown as MenuItemDisplay;
}

function makeMenu(): MenuSummary {
  return {
    id: MENU_ID,
    name: `Menu ${MENU_ID}`,
    active: true,
    schedule: null,
    items: [],
  } as unknown as MenuSummary;
}

// The D structure: item A sits under a sub whose name is the PARENTHESISED
// variant "Bread (Kulcha)" in the Entrees course.
function makeStructure(): MenuStructure {
  return {
    menu_id: MENU_ID,
    courses: {
      Beverages: [],
      Appetizers: [],
      Entrees: [
        { subcategory_id: 'kulcha', name: D_NAME, sort_order: 0, item_ids: [ITEM_ID], count: 1 },
      ],
      Desserts: [],
    },
  } as unknown as MenuStructure;
}

// ── Capture MenuBuilder's getSettings prop ──────────────────────────────────
type BuilderMockProps = {
  getSettings: (menuId: string, itemId: string) => { raw_categories?: string[]; canonical_categories?: string[] };
};
let lastBuilderProps: BuilderMockProps | null = null;

vi.mock('../components/MenuBuilder', () => ({
  default: (props: BuilderMockProps) => {
    lastBuilderProps = props;
    return <div data-testid="menu-builder-mock" />;
  },
  itemHasAttention: () => false,
}));
vi.mock('../components/ItemPool', () => ({ default: () => <div /> }));
vi.mock('../components/MobileMenuManagerLayout', () => ({ default: () => <div /> }));
vi.mock('../components/BulkActionsPanel', () => ({ default: () => null }));
vi.mock('../components/BulkModifierPanel', () => ({ default: () => null }));
vi.mock('../components/MenuEditPanel', () => ({ default: () => null }));
vi.mock('../components/EditModal', () => ({ default: () => <div data-testid="edit-modal-mock" /> }));
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../track-action-context', () => ({
  useTrackAction: () => () => {},
  TrackActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeService(): MenuManagerService {
  return {
    getAllMenuItems: vi.fn(),
    getMenus: vi.fn(),
    addMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    toggleMenuItemActive: vi.fn(),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
    deleteMenu: vi.fn(),
    addItemToMenu: vi.fn(),
    removeItemFromMenu: vi.fn(),
    updateMenuItemInMenu: vi.fn(),
    updateItemModifiers: vi.fn(),
    getMenuStructure: vi.fn().mockResolvedValue(makeStructure()),
    // Required for subcatV2 to evaluate true (MenuManagerClient.tsx:481-483).
    assignItemToSubcategory: vi.fn().mockResolvedValue(undefined),
  } as unknown as MenuManagerService;
}

/**
 * Reproduce the exact MenuBuilder pill collapse (MenuBuilder.tsx:2143-2166) for a
 * SINGLE item's labels, returning the DISPLAYED pill label. Proves the rendered
 * pill, not just the underlying prop.
 */
function derivePillLabel(rawCategories: string[] | undefined): string {
  const labels = rawCategories && rawCategories.length ? rawCategories : [UNGROUPED_KEY];
  const variants = new Map<string, number>();
  let sawKeyed = false;
  for (const raw of labels) {
    if (raw === UNGROUPED_KEY) continue;
    const key = normalizeSubcatKey(raw) || UNGROUPED_KEY;
    if (key === UNGROUPED_KEY) continue;
    sawKeyed = true;
    variants.set(raw, (variants.get(raw) ?? 0) + 1);
  }
  if (!sawKeyed) return UNGROUPED_KEY;
  return preferScrapedLabel([...variants].map(([label, count]) => ({ label, count })));
}

async function renderAndSettle() {
  lastBuilderProps = null;
  const service = makeService();
  render(
    <MenuManagerClient
      service={service}
      restaurantId="r1"
      initialItems={[makeItem()]}
      initialMenus={[makeMenu()]}
      refreshing={false}
      onRefresh={vi.fn()}
    />,
  );
  // Flush the structure fetch promise + the setState it triggers so
  // structureByMenu[MENU_ID] is populated before we read effectiveGetSettings.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(lastBuilderProps).not.toBeNull();
  return { service };
}

const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2;
  else process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = ORIGINAL_FLAG;
  vi.clearAllMocks();
});
beforeEach(() => {
  lastBuilderProps = null;
});

// ── Deliverable #1 — flag ON reads the D name ───────────────────────────────
describe('MenuBuilder pill display — flag ON reads the first-class D sub.name', () => {
  it('overrides the pill label to the D structure sub.name (not the item raw_categories)', async () => {
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'true';
    const { service } = await renderAndSettle();

    // The structure loader fired for the active menu (proves the D read path).
    expect((service.getMenuStructure as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(MENU_ID);

    const settings = lastBuilderProps!.getSettings(MENU_ID, ITEM_ID);
    // raw_categories is projected from the D structure, NOT the A raw label.
    expect(settings.raw_categories).toEqual([D_NAME]);
    expect(settings.raw_categories).not.toContain(RAW_NAME);
    // Course membership is also projected from the structure.
    expect(settings.canonical_categories).toEqual([COURSE]);

    // The DISPLAYED pill (post-collapse) is the D name.
    expect(derivePillLabel(settings.raw_categories)).toBe(D_NAME);
  });

  it('an item absent from the loaded structure projects to NO label (Ungrouped), never the stale raw label', async () => {
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'true';
    lastBuilderProps = null;
    const service = makeService();
    // Structure with an EMPTY Entrees course → item A is not in any D sub.
    (service.getMenuStructure as ReturnType<typeof vi.fn>).mockResolvedValue({
      menu_id: MENU_ID,
      courses: { Beverages: [], Appetizers: [], Entrees: [], Desserts: [] },
    } as unknown as MenuStructure);
    render(
      <MenuManagerClient
        service={service}
        restaurantId="r1"
        initialItems={[makeItem()]}
        initialMenus={[makeMenu()]}
        refreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const settings = lastBuilderProps!.getSettings(MENU_ID, ITEM_ID);
    // D single-source: no membership → empty labels → Ungrouped pill. The legacy
    // raw label must NOT leak through under the flag.
    expect(settings.raw_categories).toEqual([]);
    expect(derivePillLabel(settings.raw_categories)).toBe(UNGROUPED_KEY);
  });
});

// ── Deliverable #2 — the D name is PERMANENT (subcatV2 is no longer a flag) ───
// subcatV2 was made permanent 2026-07-11: `isSubcategoryV2Enabled()` is hardcoded
// true and cannot be turned off by any env value. These assert the D structure
// name ALWAYS wins for display, even when the legacy env var is explicitly unset
// or "false" — the old flag-OFF raw_categories display path is dead.
describe('MenuBuilder pill display — D name is permanent (cannot be turned off)', () => {
  it('reads the D name even with NEXT_PUBLIC_SUBCATEGORY_V2 explicitly unset', async () => {
    delete process.env.NEXT_PUBLIC_SUBCATEGORY_V2; // legacy "off" — now ignored
    const { service } = await renderAndSettle();

    // The structure IS loaded regardless of the env var (feature is permanent).
    expect((service.getMenuStructure as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(MENU_ID);

    const settings = lastBuilderProps!.getSettings(MENU_ID, ITEM_ID);
    expect(settings.raw_categories).toEqual([D_NAME]);          // D name, not the raw A label
    expect(derivePillLabel(settings.raw_categories)).toBe(D_NAME);
  });

  it('the two labels COLLIDE on normalizeSubcatKey but the DISPLAY is always the curated D name', async () => {
    // Same bucket key — grouping is unaffected; only the shown text matters.
    expect(normalizeSubcatKey(D_NAME)).toBe(normalizeSubcatKey(RAW_NAME));

    // Even with the legacy env var forced to "false", the D name wins — proving
    // the feature can no longer be accidentally turned off.
    process.env.NEXT_PUBLIC_SUBCATEGORY_V2 = 'false';
    await renderAndSettle();
    const label = derivePillLabel(lastBuilderProps!.getSettings(MENU_ID, ITEM_ID).raw_categories);

    expect(label).toBe(D_NAME);        // "Bread (Kulcha)" — curated D name
    expect(label).not.toBe(RAW_NAME);  // never the bare raw "Bread Kulcha"
  });
});
