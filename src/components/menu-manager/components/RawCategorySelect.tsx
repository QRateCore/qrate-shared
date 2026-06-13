import React, { useMemo } from 'react';
import Select from '../../common/Select';
import type { MenuItemDisplay } from '../../../types/restaurant';

export interface BuildRawCategoryOptionsArgs {
  /** Every dish item — each contributes its scraped `category` label. */
  items?: MenuItemDisplay[];
  /** Owner-created (possibly item-less) food categories. Threading these in is
   *  what lets a freshly-created category appear BEFORE any dish carries it. */
  ownerFoodCategories?: string[];
  /** The currently-selected value — always kept in the list so the control can
   *  render its own value even if nothing else references it. */
  currentValue?: string | null;
  /** Value used for the leading "Uncategorized" escape-hatch entry. EditModal
   *  uses '' (empty placeholder); the bulk drawer uses a '__uncat__' sentinel
   *  to distinguish "clear to Uncategorized" from "no selection". */
  uncategorizedValue?: string;
  uncategorizedLabel?: string;
}

/**
 * Single source of truth for the Raw Category dropdown options across the owner
 * webapp (food-item EditModal, bulk-actions drawer, …). Unions — case-
 * insensitively de-duped, first-seen casing wins:
 *   • every item's scraped `category`,
 *   • the owner-created food categories (incl. empty ones),
 *   • the current value,
 * so a freshly-created category is selectable even before any dish carries it.
 * The Uncategorized escape-hatch is always the first option, and the literal
 * "Uncategorized" is never duplicated inside the list.
 */
export function buildRawCategoryOptions({
  items,
  ownerFoodCategories,
  currentValue,
  uncategorizedValue = '',
  uncategorizedLabel = 'Uncategorized',
}: BuildRawCategoryOptionsArgs): Array<{ value: string; label: string }> {
  const byLower = new Map<string, string>();
  const add = (raw: string | null | undefined) => {
    const c = (raw ?? '').trim();
    if (!c) return;
    // Never duplicate the dedicated Uncategorized escape-hatch entry.
    if (c.toLowerCase() === uncategorizedLabel.toLowerCase()) return;
    if (!byLower.has(c.toLowerCase())) byLower.set(c.toLowerCase(), c);
  };
  for (const it of items ?? []) add(it.category);
  for (const c of ownerFoodCategories ?? []) add(c);
  add(currentValue);
  return [
    { value: uncategorizedValue, label: uncategorizedLabel },
    ...[...byLower.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ value: c, label: c })),
  ];
}

export interface RawCategorySelectProps extends BuildRawCategoryOptionsArgs {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  'data-testid'?: string;
}

/**
 * Unified Raw Category picker. Wraps the common <Select> with the canonical
 * option set from buildRawCategoryOptions, so every surface that assigns a raw
 * category (EditModal, bulk-actions drawer) renders the SAME, consistently-
 * populated list — including categories that were just created and have no
 * backing item yet.
 */
export default function RawCategorySelect({
  items,
  ownerFoodCategories,
  currentValue,
  uncategorizedValue,
  uncategorizedLabel,
  value,
  onChange,
  id,
  placeholder = '— Select category —',
  disabled,
  fullWidth,
  'data-testid': dataTestid,
}: RawCategorySelectProps) {
  const options = useMemo(
    () =>
      buildRawCategoryOptions({
        items,
        ownerFoodCategories,
        currentValue,
        uncategorizedValue,
        uncategorizedLabel,
      }),
    [items, ownerFoodCategories, currentValue, uncategorizedValue, uncategorizedLabel],
  );
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      fullWidth={fullWidth}
      data-testid={dataTestid}
    />
  );
}
