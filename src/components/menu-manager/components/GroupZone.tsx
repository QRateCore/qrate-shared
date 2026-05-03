'use client';
/**
 * GroupZone — generic drop-zone shell for any modifier grouping (BYO PDD Step 6).
 *
 * Replaces 5 hardcoded drop-zone blocks in ItemModifierZones with a single
 * iterable component. Visible behaviour is unchanged: same chrome, same
 * empty-state copy, same drag-over highlight, same testIDs.
 *
 * Step 6 keeps the per-zone special behaviours (recommendations inactive
 * state, addon price label, async drop gate, sides selection-mode dropdown)
 * via slot/children — the consumer renders the inner cards. Step 7 will
 * collapse those down to a single generic card renderer for custom groupings.
 *
 * Test IDs (DUAL during transition — legacy + new):
 *   - Legacy: `${legacyTestIdPrefix}-${itemId}` — e.g. "sides-drop-zone-abc"
 *     (preserves existing E2E selectors and unit tests).
 *   - New:    `group-drop-zone-${groupingId}` — used by custom groupings in
 *     Step 7 where there is no legacy "kind."
 */
import { type CSSProperties, type ReactNode, useState } from 'react';
import Select from '../../common/Select';

export type GroupZoneKind =
  | 'sides'
  | 'sides_and'
  | 'sides_or'
  | 'addons'
  | 'recommendations'
  | 'custom';

interface SelectionModeOption {
  value: 'and' | 'or';
  label: string;
}

interface Props {
  /** Logical kind — drives the default palette class. */
  kind: GroupZoneKind;
  /** Optional grouping ID — emitted as `group-drop-zone-${groupingId}` test ID. */
  groupingId?: string;
  /** Parent food item ID (for legacy test ID compatibility). */
  parentItemId: string;
  /** Display label in the header. */
  title: string;
  /** Hint copy under the header. */
  hint: ReactNode;
  /** Number of members; rendered as a count badge when > 0. */
  count: number;
  /** Empty-state copy when count === 0. */
  emptyText: string;
  /** Drop handler — fired with the raw text/plain payload of the dataTransfer. */
  onDrop: (e: React.DragEvent) => void;
  /**
   * Cards (or whatever else) to render when count > 0. Consumer-controlled so
   * each group keeps its specific card variations: addons show price, recs
   * show inactive border, etc.
   */
  children: ReactNode;
  /**
   * Legacy test-ID prefix for backward-compat. Examples:
   *   'sides-drop-zone' → "sides-drop-zone-${parentItemId}"
   *   'sides-and-drop-zone'
   *   'sides-or-drop-zone'
   *   'addons-drop-zone'
   *   'recommendations-drop-zone'
   * If omitted, only the new generic test ID is emitted.
   */
  legacyTestIdPrefix?: string;
  /** Optional palette override. Defaults to `modifier-section-header--${kind}`. */
  paletteClassName?: string;
  /** Optional inline style override on the header (e.g., sides_or amber tint). */
  headerStyle?: CSSProperties;
  /** Optional inline style override on the drop zone when dragOver. */
  dragOverStyle?: CSSProperties;
  /** Optional embedded select (legacy sides AND/OR dropdown). */
  selectionMode?: {
    value: 'and' | 'or';
    onChange: (next: 'and' | 'or') => void;
    options: SelectionModeOption[];
    /** Test ID for the select element. */
    testId?: string;
  };
  /**
   * Optional rendered after the count badge in the header — used by Step 7
   * to attach the SelectionRuleEditor pill + GroupActionsMenu (`[⋮]`) for
   * BYO authoring affordances.
   */
  headerExtras?: ReactNode;
  /**
   * Optional rendered in place of the title — used by inline rename mode
   * where the title becomes a text input. Falls back to the title prop.
   */
  titleOverride?: ReactNode;
}

export default function GroupZone({
  kind,
  groupingId,
  parentItemId,
  title,
  hint,
  count,
  emptyText,
  onDrop,
  children,
  legacyTestIdPrefix,
  paletteClassName,
  headerStyle,
  dragOverStyle,
  selectionMode,
  headerExtras,
  titleOverride,
}: Props) {
  const [dragOver, setDragOver] = useState(false);

  const headerClass = paletteClassName ?? `modifier-section-header--${kind}`;
  const legacyId = legacyTestIdPrefix
    ? `${legacyTestIdPrefix}-${parentItemId}`
    : undefined;
  const newId = groupingId
    ? `group-drop-zone-${groupingId}`
    : undefined;
  // Legacy ID is the PRIMARY data-testid (preserves existing E2E + unit tests).
  // The new generic ID is exposed as data-grouping-id + a sibling attribute
  // for Step 7 (custom groupings, where there is no legacy kind).
  const dropZoneTestId = legacyId ?? newId;

  return (
    <div className="modifier-section" style={{ flex: 1, minWidth: 0 }}>
      <div
        className={`modifier-section-header ${headerClass}`}
        style={headerStyle}
      >
        <span className="modifier-section-title">{titleOverride ?? title}</span>
        {selectionMode ? (
          <Select
            size="sm"
            value={selectionMode.value}
            onChange={(e) => selectionMode.onChange(e.target.value as 'and' | 'or')}
            data-testid={selectionMode.testId}
            options={selectionMode.options}
            style={{ marginLeft: 8 }}
          />
        ) : null}
        {count > 0 && <span className="modifier-section-count">{count}</span>}
        {headerExtras ? (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {headerExtras}
          </span>
        ) : null}
      </div>
      <p className="modifier-section-hint">{hint}</p>
      <div
        // data-testid: legacy prefix takes precedence so existing E2E +
        // unit tests still find the zone. data-grouping-id + data-new-testid
        // expose the new generic identity for Step 7 (custom groupings).
        data-testid={dropZoneTestId}
        data-new-testid={newId}
        data-grouping-id={groupingId}
        className={`modifier-drop-zone${dragOver ? ' drag-over' : ''}`}
        style={dragOver ? dragOverStyle : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          onDrop(e);
        }}
      >
        {count === 0 ? (
          <div className="modifier-drop-zone-empty">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
