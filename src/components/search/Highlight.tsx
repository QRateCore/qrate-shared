/**
 * Search highlighting (owner Menu workspace v5.2.1 §4): every search box marks
 * the matching text in its own results. ONE implementation for every surface —
 * the Menus tab rows, the Item library, the item picker, the add-on / Swap
 * lookup, "Copy from another dish", Recipes.
 *
 * Case-insensitive, EVERY occurrence, wrapped in <mark> with the design's
 * highlight (background #F5D3CD, colour #7A2219), no padding, inheriting the
 * surrounding font. Inline style rather than a class so it looks the same in
 * every app that consumes the shared package. Use it on display text only —
 * never inside an input, select, option or an action button's label.
 */

import type { CSSProperties, ReactNode } from 'react';

/** The design's search-hit look (prototype `::highlight(qr-hit)`). */
export const SEARCH_HIGHLIGHT_STYLE: CSSProperties = {
  backgroundColor: '#F5D3CD',
  color: '#7A2219',
  padding: 0,
  margin: 0,
  borderRadius: 0,
  font: 'inherit',
};

/**
 * `text` with every case-insensitive occurrence of `query` (trimmed) wrapped
 * in a <mark>. Returns the plain string when there is nothing to mark.
 */
export function markMatches(text: string, query: string | null | undefined, testId = 'search-highlight-mark'): ReactNode {
  const q = (query ?? '').trim().toLowerCase();
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  let at = lower.indexOf(q);
  if (at < 0) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} style={SEARCH_HIGHLIGHT_STYLE} data-testid={testId}>
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

export interface HighlightProps {
  /** The display text. */
  text: string;
  /** The search box's value; empty / blank = no marks. */
  query?: string | null;
  /** data-testid on each <mark> (default `search-highlight-mark`). */
  testId?: string;
}

/** `<Highlight text query />` — the component form of {@link markMatches}. */
export function Highlight({ text, query, testId }: HighlightProps) {
  return <>{markMatches(text, query, testId)}</>;
}
