/**
 * Menu Builder — sub-category-v2 structure projection (multi-course placement).
 *
 * REGRESSION CONTEXT (Indian Aroma dev, reported 2026-08-10):
 * dragging the "Alcoholic Beverages" raw category onto the Drinks course left
 * the rows rendered under Mains; they only relocated to Drinks after an
 * unrelated later drop forced a structure refetch.
 *
 * Root cause: `structureItemIndex` mapped each item to ONE course by plain
 * overwrite (`perItem[itemId] = {...}`), so an item placed in two courses kept
 * only whichever the structure yielded last, and `effectiveAssignments` then
 * discarded that item's legacy placements in every other course. An item could
 * not render in two courses at all.
 *
 * The schema always allowed it: menu_subcategory_items is
 * UNIQUE (menu_id, course, menu_item_id) — one sub-category PER COURSE.
 *
 * These tests pin the invariant: an item renders in EVERY course it is placed
 * in, immediately, and a refetch changes nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStructureItemIndex,
  projectStructureBuckets,
  CANONICAL_CATEGORIES,
  DRINK_TYPE_SECTION_KEYS,
} from '../menuUtils';
import type { MenuStructure } from '../../../../types/restaurant';

const MENU = 'menu-1';
const ITEM = 'item-alcoholic-1';

function sub(id: string, name: string, itemIds: string[]) {
  return { subcategory_id: id, name, item_ids: itemIds } as never;
}

/** The reported scenario: one raw category filed under BOTH Drinks and Mains. */
function structureWithItemInBothCourses(): Record<string, MenuStructure> {
  return {
    [MENU]: {
      courses: {
        Beverages: [sub('sub-bev', 'Alcoholic Beverages', [ITEM])],
        Entrees: [sub('sub-ent', 'Alcoholic Beverages', [ITEM])],
      },
    } as unknown as MenuStructure,
  };
}

describe('buildStructureItemIndex — one placement per course, never collapsed', () => {
  it('keeps BOTH courses for an item placed in two (the bug)', () => {
    const idx = buildStructureItemIndex(structureWithItemInBothCourses());
    const courses = idx[MENU][ITEM].map((p) => p.course).sort();
    expect(courses).toEqual(['Beverages', 'Entrees']);
  });

  it('carries the sub-category name and id for each course independently', () => {
    const idx = buildStructureItemIndex(structureWithItemInBothCourses());
    const byCourse = Object.fromEntries(idx[MENU][ITEM].map((p) => [p.course, p]));
    expect(byCourse.Beverages.subId).toBe('sub-bev');
    expect(byCourse.Entrees.subId).toBe('sub-ent');
    expect(byCourse.Beverages.subName).toBe('Alcoholic Beverages');
  });

  it('is order-independent — neither course wins by appearing last', () => {
    const forward = buildStructureItemIndex(structureWithItemInBothCourses());
    const reversed = buildStructureItemIndex({
      [MENU]: {
        courses: {
          Entrees: [sub('sub-ent', 'Alcoholic Beverages', [ITEM])],
          Beverages: [sub('sub-bev', 'Alcoholic Beverages', [ITEM])],
        },
      } as unknown as MenuStructure,
    });
    expect(forward[MENU][ITEM].map((p) => p.course).sort())
      .toEqual(reversed[MENU][ITEM].map((p) => p.course).sort());
  });

  it('does not duplicate a row when a course somehow lists the item twice', () => {
    const idx = buildStructureItemIndex({
      [MENU]: {
        courses: {
          Beverages: [
            sub('sub-a', 'Alcoholic Beverages', [ITEM]),
            sub('sub-b', 'Spirits', [ITEM]),
          ],
        },
      } as unknown as MenuStructure,
    });
    expect(idx[MENU][ITEM]).toHaveLength(1);
  });

  it('tolerates empty / missing structure shapes', () => {
    expect(buildStructureItemIndex({})).toEqual({});
    expect(buildStructureItemIndex({ [MENU]: {} as MenuStructure })).toEqual({ [MENU]: {} });
    expect(
      buildStructureItemIndex({ [MENU]: { courses: { Beverages: [] } } as unknown as MenuStructure }),
    ).toEqual({ [MENU]: {} });
  });
});

describe('projectStructureBuckets — renders in every placed course', () => {
  const idx = () => buildStructureItemIndex(structureWithItemInBothCourses())[MENU];

  it('files the item under Drinks AND Mains', () => {
    const buckets = projectStructureBuckets({}, idx(), CANONICAL_CATEGORIES);
    expect(buckets.Beverages).toEqual([ITEM]);
    expect(buckets.Entrees).toEqual([ITEM]);
  });

  it('THE BUG: dropping onto Drinks must not leave the row only under Mains', () => {
    // Pre-fix, the index collapsed to a single course and this bucket was empty
    // while Entrees held the row — precisely what was seen on Indian Aroma.
    const buckets = projectStructureBuckets({}, idx(), CANONICAL_CATEGORIES);
    expect(buckets.Beverages).toContain(ITEM);
  });

  it('is stable across a refetch — nothing "jumps" courses later', () => {
    // Same structure projected twice must be identical; the reported symptom was
    // the render changing on a later, unrelated refresh.
    const first = projectStructureBuckets({}, idx(), CANONICAL_CATEGORIES);
    const second = projectStructureBuckets({}, idx(), CANONICAL_CATEGORIES);
    expect(second).toEqual(first);
  });

  it('seeds every canonical bucket, empty where unused', () => {
    const buckets = projectStructureBuckets({}, idx(), CANONICAL_CATEGORIES);
    for (const cat of CANONICAL_CATEGORIES) expect(buckets[cat]).toBeDefined();
    expect(buckets.Desserts).toEqual([]);
  });

  it('never lists the same item twice within one course', () => {
    const buckets = projectStructureBuckets(
      { Beverages: [ITEM] }, // legacy also claims it here
      idx(),
      CANONICAL_CATEGORIES,
    );
    expect(buckets.Beverages).toEqual([ITEM]);
  });

  // ── Legacy merge is PER COURSE ────────────────────────────────────────────
  it('keeps a legacy Mains placement for an item grouped only under Drinks', () => {
    // The old blanket "item exists anywhere in the structure?" guard deleted
    // this row from Mains — the second half of the disappearing-course bug.
    const drinksOnly = buildStructureItemIndex({
      [MENU]: {
        courses: { Beverages: [sub('sub-bev', 'Alcoholic Beverages', [ITEM])] },
      } as unknown as MenuStructure,
    })[MENU];
    const buckets = projectStructureBuckets({ Entrees: [ITEM] }, drinksOnly, CANONICAL_CATEGORIES);
    expect(buckets.Beverages).toEqual([ITEM]);
    expect(buckets.Entrees).toEqual([ITEM]);
  });

  it('still surfaces an ungrouped item that exists only in legacy assignments', () => {
    const buckets = projectStructureBuckets({ Entrees: ['other-item'] }, {}, CANONICAL_CATEGORIES);
    expect(buckets.Entrees).toEqual(['other-item']);
  });

  it('passes through legacy buckets whose key is not in seedKeys', () => {
    const buckets = projectStructureBuckets({ Mystery: ['x'] }, {}, CANONICAL_CATEGORIES);
    expect(buckets.Mystery).toEqual(['x']);
  });

  // ── Drinks menus bucket by drink type, not canonical ──────────────────────
  it('projects a drinks menu using its own drink-type keys', () => {
    const drinkIdx = buildStructureItemIndex({
      [MENU]: {
        courses: { wine: [sub('sub-wine', 'Reds', ['d1'])] },
      } as unknown as MenuStructure,
    })[MENU];
    const buckets = projectStructureBuckets({}, drinkIdx, DRINK_TYPE_SECTION_KEYS);
    expect(buckets.wine).toEqual(['d1']);
    expect(buckets.beer).toEqual([]);
  });

  it('drops a structure placement whose course is not a seeded key', () => {
    // Guards the food/drinks seeding split: a drink-type course must not leak
    // into a food menu's canonical buckets.
    const drinkIdx = buildStructureItemIndex({
      [MENU]: { courses: { wine: [sub('s', 'Reds', ['d1'])] } } as unknown as MenuStructure,
    })[MENU];
    const buckets = projectStructureBuckets({}, drinkIdx, CANONICAL_CATEGORIES);
    expect(Object.values(buckets).flat()).not.toContain('d1');
  });
});
