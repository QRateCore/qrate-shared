'use client';
/**
 * GroupActionsMenu — `[⋮]` dropdown on each grouping header.
 *
 * Actions:
 *   • Rename       — inline text edit (always enabled, including for default groupings)
 *   • Change rule  — opens the SelectionRuleEditor popover (handled by parent)
 *   • Delete       — only enabled when grouping is custom (is_deletable=TRUE).
 *                    Default groupings show the option disabled with an
 *                    explanatory tooltip per Q13 silent-migration UX.
 *
 * The trigger button is the ⋮ vertical-dots icon. The menu is a small popover
 * anchored below; clicking outside dismisses it.
 */
import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';

interface Props {
  /** Whether the grouping can be deleted. Defaults to false. */
  isDeletable: boolean;
  /** Tooltip shown on the (disabled) Delete option for default groupings. */
  deleteDisabledTooltip?: string;
  /** Trigger rename. Caller switches the header into edit mode. */
  onRenameClick: () => void;
  /** Trigger the rule editor. Caller opens the SelectionRuleEditor popover. */
  onChangeRuleClick: () => void;
  /** Delete the grouping. Confirmation should be handled by the caller. */
  onDeleteClick: () => void;
  /** Test ID prefix for the trigger + menu items. */
  testIdPrefix?: string;
}

export default function GroupActionsMenu({
  isDeletable,
  deleteDisabledTooltip = "Default sections can't be deleted, but they can be renamed and emptied",
  onRenameClick,
  onChangeRuleClick,
  onDeleteClick,
  testIdPrefix = 'group-actions',
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function fire(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testIdPrefix}-trigger`}
        title="More actions"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          color: '#64748b',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MoreVertical size={14} />
      </button>

      {open && (
        <div
          data-testid={`${testIdPrefix}-menu`}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 100,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            minWidth: 160,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => fire(onRenameClick)}
            data-testid={`${testIdPrefix}-rename`}
            style={menuItemStyle}
          >
            <Pencil size={12} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            onClick={() => fire(onChangeRuleClick)}
            data-testid={`${testIdPrefix}-change-rule`}
            style={menuItemStyle}
          >
            <span style={{ width: 12, fontSize: 12, color: '#64748b' }}>↺</span>
            <span>Change rule</span>
          </button>
          <button
            type="button"
            disabled={!isDeletable}
            onClick={() => isDeletable && fire(onDeleteClick)}
            data-testid={`${testIdPrefix}-delete`}
            title={!isDeletable ? deleteDisabledTooltip : 'Delete grouping'}
            style={{
              ...menuItemStyle,
              color: isDeletable ? '#b91c1c' : '#cbd5e1',
              cursor: isDeletable ? 'pointer' : 'not-allowed',
            }}
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  color: '#1e293b',
};
