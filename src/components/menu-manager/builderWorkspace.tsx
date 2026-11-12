'use client';

/**
 * Owner Menu workspace mode for the builder (handoff v3, Menus tab).
 *
 * Set by MenuBuilder when `workspaceMode` is on and read down the tree
 * (CategoryBucket → SubCategoryGroup), so the many-prop components stay as
 * they are for admin / waiter. In this mode:
 *  - the card header keeps only the item count and Expand all / Collapse all
 *    (no Manage sections, no Select toggle);
 *  - Expand all / Collapse all also opens / closes every sub-category
 *    (`subcatSignal` — `n` bumps on each press, `open` is the target state);
 *  - an expanded course and an expanded sub-category carry a tri-state
 *    select-all; sub-categories reorder by drag only (no ▲▼).
 */

import { createContext, useContext } from 'react';

export interface BuilderWorkspaceMode {
  subcatSignal: { open: boolean; n: number };
}

export const BuilderWorkspaceContext = createContext<BuilderWorkspaceMode | null>(null);

export function useBuilderWorkspace(): BuilderWorkspaceMode | null {
  return useContext(BuilderWorkspaceContext);
}

/** Tri-state checkbox state for a set of item ids against a selection. */
export function selectionState(ids: readonly string[], selected: ReadonlySet<string> | undefined): 'none' | 'some' | 'all' {
  if (!selected || ids.length === 0) return 'none';
  let n = 0;
  for (const id of ids) if (selected.has(id)) n++;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}
