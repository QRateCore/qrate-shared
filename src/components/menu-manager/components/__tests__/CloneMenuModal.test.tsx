// @vitest-environment jsdom
/**
 * Unit tests for CloneMenuModal — STR-521.
 *
 * Covers:
 *  - Title + name input + radio source list render
 *  - Submit disabled until BOTH name and source selected
 *  - Submit calls onConfirm(sourceMenuId, name)
 *  - X button calls onClose
 *  - Backdrop click calls onClose
 *  - Escape key calls onClose
 *  - Empty sourceMenus shows "no sources" message
 *  - Rejected onConfirm shows error message + re-enables submit
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CloneMenuModal } from '../CloneMenuModal';
import type { MenuSummary } from '../../../../types/restaurant';

const SOURCE_MENUS: MenuSummary[] = [
  { id: 'menu-a', name: 'Lunch Menu', slug: 'lunch-menu', active: true, is_all_day: true, start_time: null, end_time: null, days_of_week: [], schedule: null, display_order: 0, item_count: 5 },
  { id: 'menu-b', name: 'Dinner Menu', slug: 'dinner-menu', active: false, is_all_day: true, start_time: null, end_time: null, days_of_week: [], schedule: null, display_order: 1, item_count: 8 },
];

describe('CloneMenuModal', () => {
  it('renders title, name input, and source radio list', () => {
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Clone Existing Menu')).toBeInTheDocument();
    expect(screen.getByTestId('clone-menu-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('clone-menu-source-menu-a')).toBeInTheDocument();
    expect(screen.getByTestId('clone-menu-source-menu-b')).toBeInTheDocument();
    expect(screen.getByText('Lunch Menu')).toBeInTheDocument();
    expect(screen.getByText('Dinner Menu')).toBeInTheDocument();
  });

  it('shows (inactive) marker on inactive source menus', () => {
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('(inactive)')).toBeInTheDocument();
  });

  it('disables submit until both name and source selected', async () => {
    const user = userEvent.setup();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={vi.fn()} />);

    const submit = screen.getByTestId('clone-menu-submit-btn');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('clone-menu-name-input'), 'My Clone');
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('clone-menu-source-menu-a'));
    expect(submit).toBeEnabled();
  });

  it('treats whitespace-only name as empty (submit stays disabled)', async () => {
    const user = userEvent.setup();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByTestId('clone-menu-name-input'), '   ');
    await user.click(screen.getByTestId('clone-menu-source-menu-a'));
    expect(screen.getByTestId('clone-menu-submit-btn')).toBeDisabled();
  });

  it('calls onConfirm with (sourceMenuId, trimmed name)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={onConfirm} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('clone-menu-name-input'), '  My Clone  ');
    await user.click(screen.getByTestId('clone-menu-source-menu-b'));
    await user.click(screen.getByTestId('clone-menu-submit-btn'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith('menu-b', 'My Clone');
  });

  it('calls onClose when X close button clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByTestId('clone-menu-modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('clone-menu-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key press', () => {
    const onClose = vi.fn();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "no sources" message when sourceMenus is empty', () => {
    render(<CloneMenuModal sourceMenus={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('clone-menu-no-sources')).toBeInTheDocument();
  });

  it('shows error and re-enables submit when onConfirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Slug already exists'));
    const user = userEvent.setup();
    render(<CloneMenuModal sourceMenus={SOURCE_MENUS} onConfirm={onConfirm} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('clone-menu-name-input'), 'My Clone');
    await user.click(screen.getByTestId('clone-menu-source-menu-a'));
    await user.click(screen.getByTestId('clone-menu-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('clone-menu-error')).toHaveTextContent('Slug already exists');
    });
    expect(screen.getByTestId('clone-menu-submit-btn')).toBeEnabled();
  });
});
