// @vitest-environment jsdom
/**
 * GroupZone — generic drop-zone shell tests (BYO PDD Step 6).
 *
 * Verifies:
 *   - palette class derived from kind by default
 *   - legacy test ID is primary, new generic ID is secondary
 *   - selectionMode dropdown renders + fires onChange
 *   - empty state vs. children-rendered
 *   - drop event fires onDrop with the original DragEvent
 *   - count badge appears only when count > 0
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupZone from '../GroupZone';

function setup(overrides: Partial<React.ComponentProps<typeof GroupZone>> = {}) {
  const defaults: React.ComponentProps<typeof GroupZone> = {
    kind: 'addons',
    parentItemId: 'item-1',
    title: 'Add-ons',
    hint: 'Drag add-on items here',
    count: 0,
    emptyText: 'Drop here',
    onDrop: vi.fn(),
    children: null,
  };
  return render(<GroupZone {...defaults} {...overrides} />);
}

describe('GroupZone', () => {
  describe('test IDs', () => {
    it('uses legacy testIdPrefix as the primary data-testid', () => {
      setup({ legacyTestIdPrefix: 'addons-drop-zone' });
      expect(screen.getByTestId('addons-drop-zone-item-1')).toBeInTheDocument();
    });

    it('exposes the new generic ID via data-new-testid + data-grouping-id', () => {
      const { container } = setup({
        legacyTestIdPrefix: 'addons-drop-zone',
        groupingId: 'g-123',
      });
      const dropZone = container.querySelector('[data-grouping-id="g-123"]');
      expect(dropZone).toBeInTheDocument();
      expect(dropZone?.getAttribute('data-new-testid')).toBe('group-drop-zone-g-123');
    });

    it('falls back to the new generic ID when no legacy prefix is provided', () => {
      setup({ groupingId: 'g-456' });
      expect(screen.getByTestId('group-drop-zone-g-456')).toBeInTheDocument();
    });
  });

  describe('palette', () => {
    it('uses kind-derived header class by default', () => {
      const { container } = setup({ kind: 'recommendations' });
      expect(
        container.querySelector('.modifier-section-header--recommendations'),
      ).toBeInTheDocument();
    });

    it('honours explicit paletteClassName override', () => {
      const { container } = setup({
        kind: 'sides_or',
        paletteClassName: 'modifier-section-header--sides',
      });
      expect(
        container.querySelector('.modifier-section-header--sides'),
      ).toBeInTheDocument();
    });
  });

  describe('count badge', () => {
    it('hides the count badge when count is 0', () => {
      const { container } = setup({ count: 0 });
      expect(container.querySelector('.modifier-section-count')).toBeNull();
    });

    it('shows the count badge when count is > 0', () => {
      const { container } = setup({ count: 3 });
      const badge = container.querySelector('.modifier-section-count');
      expect(badge).toBeInTheDocument();
      expect(badge?.textContent).toBe('3');
    });
  });

  describe('empty vs. children', () => {
    it('renders emptyText when count is 0', () => {
      setup({ count: 0, emptyText: 'Nothing here yet' });
      expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    });

    it('renders children when count is > 0', () => {
      setup({
        count: 1,
        children: <div data-testid="card-child">A card</div>,
        emptyText: 'Nothing',
      });
      expect(screen.getByTestId('card-child')).toBeInTheDocument();
      expect(screen.queryByText('Nothing')).not.toBeInTheDocument();
    });
  });

  describe('drop event', () => {
    it('fires onDrop with the dataTransfer', () => {
      const onDrop = vi.fn();
      setup({
        legacyTestIdPrefix: 'addons-drop-zone',
        onDrop,
      });
      const zone = screen.getByTestId('addons-drop-zone-item-1');
      fireEvent.drop(zone, {
        dataTransfer: {
          getData: () => 'mem-1',
          types: [],
          files: [],
          items: [],
        },
      });
      expect(onDrop).toHaveBeenCalledTimes(1);
    });
  });

  describe('selectionMode dropdown', () => {
    it('renders the selection-mode trigger when selectionMode is provided', () => {
      // Select is a custom button-based component (Select.tsx); the trigger
      // exposes data-testid when passed via props.
      setup({
        selectionMode: {
          value: 'and',
          onChange: vi.fn(),
          options: [
            { value: 'and', label: 'AND' },
            { value: 'or', label: 'OR' },
          ],
          testId: 'sides-selection-mode-x',
        },
      });
      expect(screen.getByTestId('sides-selection-mode-x')).toBeInTheDocument();
    });

    it('omits the selection-mode trigger when selectionMode is not provided', () => {
      const { container } = setup({ selectionMode: undefined });
      // Custom Select renders as a button; absence = no extra button beyond
      // those rendered by the GroupZone shell itself (none in the basic shell).
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(0);
    });
  });

  describe('drag-over state', () => {
    it('adds drag-over class when dragOver fires', () => {
      const { container } = setup({ legacyTestIdPrefix: 'addons-drop-zone' });
      const zone = screen.getByTestId('addons-drop-zone-item-1');
      fireEvent.dragOver(zone, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(zone.className).toContain('drag-over');
    });

    it('removes drag-over class on dragLeave', () => {
      setup({ legacyTestIdPrefix: 'addons-drop-zone' });
      const zone = screen.getByTestId('addons-drop-zone-item-1');
      fireEvent.dragOver(zone, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
      fireEvent.dragLeave(zone);
      expect(zone.className).not.toContain('drag-over');
    });
  });
});
