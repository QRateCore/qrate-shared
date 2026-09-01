import { useState } from 'react';
import type { WineEnrichmentJob } from '../../../types/restaurant';

interface WineEnrichmentBannerProps {
  job: WineEnrichmentJob | null;
  onRetry: () => Promise<void> | void;
}

/**
 * Status/retry surface for the post-commit wine short_story/long_story
 * enrichment job — a SEPARATE flow from the Add Menu wizard and the item
 * editor (EditModal). Renders nothing when there's no job (menu isn't wine
 * type, or nothing was ever pending) or the job completed cleanly.
 */
export default function WineEnrichmentBanner({ job, onRetry }: WineEnrichmentBannerProps) {
  const [retrying, setRetrying] = useState(false);

  if (!job || job.status === 'completed') return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // Transient failure (e.g. 409 — a job is already running from a
      // second click, or a network blip). No toast: the next poll tick
      // (~7s, wired in MenuManagerClient) reflects the real server state
      // regardless, matching the wizard's own polling posture.
    } finally {
      setRetrying(false);
    }
  };

  if (job.status === 'running') {
    const done = job.items_enriched + job.items_no_data + job.items_failed;
    return (
      <div
        data-testid="wine-enrichment-banner-running"
        className="px-3.5 py-2 text-xs text-[var(--text2)] bg-[var(--bg)] border-b border-[var(--border)] flex items-center gap-2"
      >
        <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--border)] border-t-[var(--blue)] animate-spin" />
        Analyzing wine details&hellip; {done} of {job.items_total} done.
      </div>
    );
  }

  // partial_failure | failed
  const count = job.items_failed;
  return (
    <div
      data-testid="wine-enrichment-banner-failed"
      className="px-3.5 py-2 text-xs text-[var(--red)] bg-[var(--red-bg)] border-b border-[var(--border)] flex items-center gap-2"
    >
      <span>
        {count} wine{count === 1 ? '' : 's'} couldn&apos;t be enriched.
      </span>
      <button
        type="button"
        data-testid="wine-enrichment-retry-btn"
        onClick={handleRetry}
        disabled={retrying}
        className="text-xs font-bold underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
