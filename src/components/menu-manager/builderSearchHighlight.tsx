'use client';

/**
 * The Item library's search on the Menus tab (owner Menu workspace). Since
 * v5.2.1 it FILTERS the menu: only matching rows show (tinted, the matched
 * text in a <mark>); sections and sub-categories without a match are hidden
 * and those with one open (without touching the owner's own open/closed
 * state, so clearing the search restores it). A row outside the matches is
 * still "dim" here for any consumer that renders it.
 *
 * A context rather than props: the flag is read three components down
 * (MenuBuilder → CategoryBucket → SubCategoryGroup / MenuItemRow).
 */

import { createContext, useContext, type ReactNode } from 'react';
import { markMatches as markSearchMatches } from '../search/Highlight';

export interface BuilderSearchHighlight {
  /** Trimmed, non-empty query. */
  query: string;
  /** Ids of the active menu's rows whose name/description match. */
  matchIds: ReadonlySet<string>;
}

export const BuilderSearchHighlightContext = createContext<BuilderSearchHighlight | null>(null);

export function useBuilderSearchHighlight(): BuilderSearchHighlight | null {
  return useContext(BuilderSearchHighlightContext);
}

/**
 * `text` with every case-insensitive occurrence of `query` marked — the shared
 * search highlight (components/search/Highlight), keeping the menu rows'
 * `builder-search-mark` testid.
 */
export function markMatches(text: string, query: string | null | undefined): ReactNode {
  return markSearchMatches(text, query, 'builder-search-mark');
}
