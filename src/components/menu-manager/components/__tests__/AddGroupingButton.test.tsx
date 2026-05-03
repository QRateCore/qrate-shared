// @vitest-environment jsdom
/**
 * AddGroupingButton — collapsed/expanded form + intro popover tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import AddGroupingButton from '../AddGroupingButton';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('AddGroupingButton', () => {
  it('starts collapsed', () => {
    render(<AddGroupingButton onCreate={vi.fn()} />);
    expect(screen.getByTestId('add-grouping-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('add-grouping-form')).toBeNull();
  });

  it('expands the form on trigger click', () => {
    render(<AddGroupingButton onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    expect(screen.getByTestId('add-grouping-form')).toBeInTheDocument();
  });

  it('shows the intro popover on first click; dismisses + persists', () => {
    render(<AddGroupingButton onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    expect(screen.getByTestId('add-grouping-intro-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-grouping-intro-dismiss'));
    expect(screen.queryByTestId('add-grouping-intro-popover')).toBeNull();
    expect(localStorage.getItem('qrate.byo_intro_popover_dismissed')).toBe('true');
  });

  it('does not show the intro popover when localStorage is already set', () => {
    localStorage.setItem('qrate.byo_intro_popover_dismissed', 'true');
    render(<AddGroupingButton onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    expect(screen.queryByTestId('add-grouping-intro-popover')).toBeNull();
  });

  it('disables Save when name is empty', () => {
    render(<AddGroupingButton onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    expect(screen.getByTestId('add-grouping-save')).toHaveProperty('disabled', true);
  });

  it('calls onCreate with name + rule on submit', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AddGroupingButton onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    fireEvent.change(screen.getByTestId('add-grouping-name-input'), {
      target: { value: 'Toppings' },
    });
    // Default preset is 'optional'
    await act(async () => {
      fireEvent.submit(screen.getByTestId('add-grouping-form'));
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Toppings',
      rule: { min_select: 0, max_select: null, default_select: 'none' },
    });
  });

  it('switches to "Exactly N" preset and submits with min=max=N', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<AddGroupingButton onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    fireEvent.change(screen.getByTestId('add-grouping-name-input'), {
      target: { value: 'Patty' },
    });
    fireEvent.change(screen.getByTestId('add-grouping-preset-select'), {
      target: { value: 'exactly' },
    });
    fireEvent.change(screen.getByTestId('add-grouping-n-input'), {
      target: { value: '1' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('add-grouping-form'));
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Patty',
      rule: { min_select: 1, max_select: 1, default_select: 'none' },
    });
  });

  it('cancels and clears the input', () => {
    render(<AddGroupingButton onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    fireEvent.change(screen.getByTestId('add-grouping-name-input'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('add-grouping-cancel'));
    expect(screen.queryByTestId('add-grouping-form')).toBeNull();
    expect(screen.getByTestId('add-grouping-trigger')).toBeInTheDocument();
  });

  it('keeps the form open if onCreate rejects', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));
    render(<AddGroupingButton onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('add-grouping-trigger'));
    fireEvent.change(screen.getByTestId('add-grouping-name-input'), {
      target: { value: 'X' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('add-grouping-form'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('add-grouping-form')).toBeInTheDocument();
  });
});
