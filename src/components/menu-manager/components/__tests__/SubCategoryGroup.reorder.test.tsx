// @vitest-environment jsdom
/**
 * STR-775 — SubCategoryGroup reorder controls (drag-grip + keyboard ▲▼).
 * The grip is a DISTINCT draggable handle/drop target (not the item-refile
 * drop on the header body); the ▲▼ buttons are the keyboard/switch-accessible
 * path (WCAG 2.1.1). Controls render only when reorderEnabled.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubCategoryGroup } from '../SubCategoryGroup';
import { COLOR_MAP } from '../../lib/menuUtils';

const color = COLOR_MAP.blue;

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
  it('renders grip + up/down when reorderEnabled', () => {
    renderGroup();
    expect(screen.getByTestId('subcategory-reorder-grip-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.getByTestId('subcategory-move-up-Beverages-Beer (Bottle)')).toBeTruthy();
    expect(screen.getByTestId('subcategory-move-down-Beverages-Beer (Bottle)')).toBeTruthy();
  });

  it('hides reorder controls when reorderEnabled is false', () => {
    renderGroup({ reorderEnabled: false });
    expect(screen.queryByTestId('subcategory-reorder-grip-Beverages-Beer (Bottle)')).toBeNull();
    expect(screen.queryByTestId('subcategory-move-up-Beverages-Beer (Bottle)')).toBeNull();
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

  it('grip drag fires onReorderDragStart and onReorderDrop (distinct from item-refile)', () => {
    const onReorderDragStart = vi.fn();
    const onReorderDrop = vi.fn();
    const onDrop = vi.fn(); // item-refile on the header body — must NOT fire from a grip drop
    renderGroup({ onReorderDragStart, onReorderDrop, onDrop });
    const grip = screen.getByTestId('subcategory-reorder-grip-Beverages-Beer (Bottle)');
    fireEvent.dragStart(grip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(grip, { dataTransfer: { setData: vi.fn() } });
    expect(onReorderDragStart).toHaveBeenCalledTimes(1);
    expect(onReorderDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled(); // stopPropagation isolates the grip drop
  });

  it('never shows reorder controls for the Ungrouped sentinel via reorderEnabled gate', () => {
    // The parent passes reorderEnabled={... && label !== UNGROUPED_KEY}; simulate that.
    renderGroup({ label: '__ungrouped__', reorderEnabled: false });
    expect(screen.queryByTestId('subcategory-reorder-grip-Beverages-__ungrouped__')).toBeNull();
  });
});
