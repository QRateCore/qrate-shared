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
 * `text` with every case-insensitive occurrence of `query` wrapped in <mark>.
 * Returns the plain string when there is nothing to mark.
 */
export function markMatches(text: string, query: string | null | undefined): ReactNode {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q);
  if (at < 0) return text;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-[2px] bg-surface2 px-px text-accent" data-testid="builder-search-mark">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
