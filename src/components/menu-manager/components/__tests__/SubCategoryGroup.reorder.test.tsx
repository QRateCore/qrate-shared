// @vitest-environment jsdom
/**
 * STR-775 (refined in the STR-775 rework) — SubCategoryGroup reorder controls.
 * The WHOLE header row is the drag source (the grip is the visual cue) and the
 * drop target; an insertion line shows above/below the hovered row. The ▲▼
 * buttons are the keyboard/switch-accessible path (WCAG 2.1.1). Reorder-drag vs
 * item-refile-drag are disambiguated by `isReorderActive`. Controls render only
 * when reorderEnabled.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubCategoryGroup } from '../SubCategoryGroup';
import { COLOR_MAP } from '../../lib/menuUtils';

const color = COLOR_MAP.blue;
const ROW = 'subcategory-drop-Beverages-Beer (Bottle)';

function renderGroup(props: Partial<React.ComponentProps<typeof SubCategoryGroup>> = {}) {
  return render(
    <SubCategoryGroup
      label="Beer (Bottle)"
      category="Beverages"
      menuId="menu-1"
      itemCount={2}
      color={color}
      reorderEnabled
      canMoveUp
      canMoveDown
      {...props}
    >
      <div>child row</div>
    </SubCategoryGroup>,
  );
}

describe('SubCategoryGroup reorder controls', () => {
  it('renders grip cue + up/down when reorderEnabled', () => {
    renderGroup();
    expect(screen.getByTestId('subcategory-reorder-grip-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.getByTestId('subcategory-move-up-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.getByTestId('subcategory-move-down-Beverages-Beer (Bottle)')).toBeTruthy();
  });

  it('makes the whole header row draggable when reorderEnabled', () => {
    renderGroup();
    expect((screen.getByTestId(ROW) as HTMLElement).getAttribute('draggable')).toBe('true');
  });

  it('is NOT draggable while renaming (so the input stays usable)', () => {
    // Open rename via the pencil, then the row must not be draggable.
    renderGroup({ onRename: vi.fn() });
    fireEvent.click(screen.getByTestId('subcategory-rename-Beverages-Beer (Bottle)'));
    expect((screen.getByTestId(ROW) as HTMLElement).getAttribute('draggable')).toBe('false');
  });

  it('hides reorder controls when reorderEnabled is false', () => {
    renderGroup({ reorderEnabled: false });
    expect(screen.queryByTestId('subcategory-reorder-grip-Beverages-Beer (Bottle)')).toBeNull();
    expect(screen.queryByTestId('subcategory-move-up-Beverages-Beer (Bottle)')).toBeNull();
    expect((screen.getByTestId(ROW) as HTMLElement).getAttribute('draggable')).toBe('false');
  });

  it('fires onMoveUp / onMoveDown on the ▲▼ buttons', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    renderGroup({ onMoveUp, onMoveDown });
    fireEvent.click(screen.getByTestId('subcategory-move-up-Beverages-Beer (Bottle)'));
    fireEvent.click(screen.getByTestId('subcategory-move-down-Beverages-Beer (Bottle)'));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('disables ▲ at the top and ▼ at the bottom', () => {
    renderGroup({ canMoveUp: false, canMoveDown: true });
    expect((screen.getByTestId('subcategory-move-up-Beverages-Beer (Bottle)') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('subcategory-move-down-Beverages-Beer (Bottle)') as HTMLButtonElement).disabled).toBe(false);
  });

  it('row drag fires onReorderDragStart; drop while reordering fires onReorderDrop, NOT item-refile', () => {
    const onReorderDragStart = vi.fn();
    const onReorderDrop = vi.fn();
    const onDrop = vi.fn(); // item-refile — must NOT fire during a reorder drop
    renderGroup({ onReorderDragStart, onReorderDrop, onDrop, isReorderActive: true });
    const row = screen.getByTestId(ROW);
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(row, { dataTransfer: { setData: vi.fn() } });
    expect(onReorderDragStart).toHaveBeenCalledTimes(1);
    expect(onReorderDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled(); // isReorderActive routes the drop to reorder
  });

  it('drop when NOT reordering routes to item-refile onDrop, NOT reorder', () => {
    const onReorderDrop = vi.fn();
    const onDrop = vi.fn();
    renderGroup({ onReorderDrop, onDrop, isReorderActive: false });
    fireEvent.drop(screen.getByTestId(ROW), { dataTransfer: { setData: vi.fn() } });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onReorderDrop).not.toHaveBeenCalled();
  });

  it('shows the insertion line above/below per the insertionLine prop', () => {
    const { rerender } = renderGroup({ insertionLine: 'before' });
    expect(screen.getByTestId('subcategory-insertion-before-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.queryByTestId('subcategory-insertion-after-Beverages-Beer (Bottle)')).toBeNull();
    rerender(
      <SubCategoryGroup label="Beer (Bottle)" category="Beverages" menuId="menu-1" itemCount={2} color={color} reorderEnabled insertionLine="after">
        <div>child row</div>
      </SubCategoryGroup>,
    );
    expect(screen.getByTestId('subcategory-insertion-after-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.queryByTestId('subcategory-insertion-before-Beverages-Beer (Bottle)')).toBeNull();
  });

  it('never shows reorder controls for the Ungrouped sentinel via reorderEnabled gate', () => {
    renderGroup({ label: '__ungrouped__', reorderEnabled: false });
    expect(screen.queryByTestId('subcategory-reorder-grip-Beverages-__ungrouped__')).toBeNull();
  });
});

// ── Row-level click-to-toggle (2026-07-02) ────────────────────────────────
//
// User request: clicking anywhere on the subcategory row should
// expand/collapse the item list — historically only the chevron button
// (subcategory-toggle-*) did. Interactive children (buttons, inputs) must
// still fire their own handlers without a double-toggle.

describe('SubCategoryGroup row-level click-to-toggle', () => {
  function getChild() {
    return screen.queryByText('child row');
  }

  it('starts collapsed (child rows hidden)', () => {
    renderGroup();
    expect(getChild()).toBeNull();
  });

  it('clicking the row toggles expanded state', () => {
    renderGroup();
    fireEvent.click(screen.getByTestId(ROW));
    expect(getChild()).toBeTruthy();
    fireEvent.click(screen.getByTestId(ROW));
    expect(getChild()).toBeNull();
  });

  it('exposes role=button + aria-expanded that reflects state', () => {
    renderGroup();
    const row = screen.getByTestId(ROW);
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter key on the row toggles expanded', () => {
    renderGroup();
    fireEvent.keyDown(screen.getByTestId(ROW), { key: 'Enter' });
    expect(getChild()).toBeTruthy();
  });

  it('Space key on the row toggles expanded', () => {
    renderGroup();
    fireEvent.keyDown(screen.getByTestId(ROW), { key: ' ' });
    expect(getChild()).toBeTruthy();
  });

  it('clicking the chevron button toggles only once (no double-toggle from row bubble)', () => {
    renderGroup();
    // Chevron click expands; the row's onClick also fires via bubble, but
    // the closest('button') guard short-circuits it — should end EXPANDED.
    fireEvent.click(screen.getByTestId('subcategory-toggle-Beverages-Beer (Bottle)'));
    expect(getChild()).toBeTruthy();
  });

  it('clicking a nested action button (move up) does NOT toggle the row', () => {
    const onMoveUp = vi.fn();
    renderGroup({ onMoveUp });
    fireEvent.click(screen.getByTestId('subcategory-move-up-Beverages-Beer (Bottle)'));
    // Row stays collapsed
    expect(getChild()).toBeNull();
    expect(onMoveUp).toHaveBeenCalledTimes(1);
  });

  it('clicking the rename input does NOT toggle the row', () => {
    renderGroup({ onRename: vi.fn() });
    fireEvent.click(screen.getByTestId('subcategory-rename-Beverages-Beer (Bottle)'));
    const input = screen.getByTestId('subcategory-rename-input-Beverages-Beer (Bottle)');
    fireEvent.click(input);
    // Row stays collapsed (renaming mode also disables toggle entirely)
    expect(getChild()).toBeNull();
  });

  it('row is not toggled while in rename mode (tabIndex=-1, no keyboard trap)', () => {
    renderGroup({ onRename: vi.fn() });
    fireEvent.click(screen.getByTestId('subcategory-rename-Beverages-Beer (Bottle)'));
    const row = screen.getByTestId(ROW);
    expect(row.getAttribute('tabindex')).toBe('-1');
    // Even if the row is somehow clicked directly, no toggle
    fireEvent.click(row);
    expect(getChild()).toBeNull();
  });
});
