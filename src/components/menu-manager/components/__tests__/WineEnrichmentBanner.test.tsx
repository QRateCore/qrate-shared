// @vitest-environment jsdom
/**
 * WineEnrichmentBanner — status/retry surface for the post-commit wine
 * short_story/long_story background job. Separate flow, deliberately not
 * folded into the item editor or the wizard's own polling.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WineEnrichmentBanner from '../WineEnrichmentBanner';
import type { WineEnrichmentJob } from '../../../../types/restaurant';

function job(overrides: Partial<WineEnrichmentJob> = {}): WineEnrichmentJob {
  return {
    status: 'running',
    items_total: 188,
    items_enriched: 0,
    items_no_data: 0,
    items_failed: 0,
    last_error: null,
    ...overrides,
  };
}

describe('WineEnrichmentBanner', () => {
  it('renders nothing when there is no job', () => {
    const { container } = render(<WineEnrichmentBanner job={null} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once the job has completed cleanly', () => {
    const { container } = render(
      <WineEnrichmentBanner job={job({ status: 'completed' })} onRetry={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows progress while running', () => {
    render(
      <WineEnrichmentBanner
        job={job({ status: 'running', items_enriched: 40, items_no_data: 10, items_failed: 0 })}
        onRetry={vi.fn()}
      />
    );
    const banner = screen.getByTestId('wine-enrichment-banner-running');
    expect(banner.textContent).toContain('50 of 188 done');
    expect(screen.queryByTestId('wine-enrichment-retry-btn')).toBeNull();
  });

  it('shows a failure count + retry button on partial_failure', () => {
    render(
      <WineEnrichmentBanner
        job={job({ status: 'partial_failure', items_enriched: 150, items_no_data: 30, items_failed: 8 })}
        onRetry={vi.fn()}
      />
    );
    const banner = screen.getByTestId('wine-enrichment-banner-failed');
    expect(banner.textContent).toContain('8 wines');
    expect(screen.getByTestId('wine-enrichment-retry-btn')).toBeInTheDocument();
  });

  it('singularizes the count for exactly one failure', () => {
    render(
      <WineEnrichmentBanner job={job({ status: 'failed', items_failed: 1 })} onRetry={vi.fn()} />
    );
    expect(screen.getByTestId('wine-enrichment-banner-failed').textContent).toContain('1 wine ');
  });

  it('calls onRetry when the button is clicked, disabling it while in flight', async () => {
    let resolveRetry: () => void = () => {};
    const onRetry = vi.fn(
      () => new Promise<void>((resolve) => { resolveRetry = resolve; })
    );
    render(
      <WineEnrichmentBanner job={job({ status: 'failed', items_failed: 3 })} onRetry={onRetry} />
    );
    const btn = screen.getByTestId('wine-enrichment-retry-btn');
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn.textContent).toContain('Retrying');

    resolveRetry();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('re-enables the retry button even if onRetry rejects', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('409'));
    render(
      <WineEnrichmentBanner job={job({ status: 'failed', items_failed: 2 })} onRetry={onRetry} />
    );
    const btn = screen.getByTestId('wine-enrichment-retry-btn');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
