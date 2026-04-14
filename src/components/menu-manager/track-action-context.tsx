'use client';

import { createContext, useContext } from 'react';

/**
 * Fire-and-forget UI action tracker.
 *
 * The shared menu-manager components call this to emit observability events
 * (button clicks, drag-drops, save/delete). Consumers (owner-webapp,
 * waiter-webapp) bind this to their own metrics pipeline via the
 * {@link TrackActionProvider}.
 *
 * Components call `useTrackAction()` unconditionally. If no provider is
 * mounted the default is a no-op, so the components render correctly in
 * unit tests or when consumed by apps that don't have metrics plumbing.
 */
export type TrackActionOptions = {
  restaurantId?: string;
  metadata?: Record<string, unknown>;
  success?: boolean;
  durationMs?: number;
  errorMessage?: string;
};

export type TrackActionFn = (
  action: string,
  options?: TrackActionOptions,
) => void;

const NOOP: TrackActionFn = () => {};

const TrackActionContext = createContext<TrackActionFn>(NOOP);

export const TrackActionProvider = TrackActionContext.Provider;

/**
 * Returns the active `trackAction` fn, or a no-op if no provider is mounted.
 */
export function useTrackAction(): TrackActionFn {
  return useContext(TrackActionContext);
}
