// @vitest-environment jsdom
/**
 * KitchenTab — reusable multi-device KDS pairing (STR-890).
 *
 * Covers the reversal from the old one-time/rotate model to the persistent reusable code:
 *  - Persistent code + QR render on load (getKdsCurrentPairingCode), no generate-first state
 *  - QR encodes the code in the URL FRAGMENT (#code=), never a query (?code=) — log-safety
 *  - Empty state → "Generate pairing code" mints via createKdsPairingCode
 *  - THE INVARIANT: "Generate new code" NEVER disconnects paired devices (no revoke call, rows stay)
 *  - Paired-displays list renders rows with last-active cue; Disconnect revokes + removes optimistically
 *  - createKdsPairingCode error leaves the shown code unchanged
 *  - Unwired (preview) env still renders + generates a local 8-digit code, no device list
 *
 * Desktop viewport (matchMedia matches:false → useIsMobile() === false).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import KitchenTab from '../KitchenTab';
import type { ExperienceService, KdsConfig, KdsDevice } from '../../../types/experience';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

const CONFIG: KdsConfig = {
  stations: [{ id: 'grill', label: 'Grill', order: 0 }],
  device: { autoCloseMs: 10_000, ageWarnMs: 480_000, ageCritMs: 900_000, readyRetainMs: 360_000 },
};

function makeService(over: Partial<ExperienceService> = {}): ExperienceService {
  return {
    getKdsConfig: vi.fn().mockResolvedValue(CONFIG),
    saveKdsConfig: vi.fn().mockResolvedValue(CONFIG),
    getKdsCurrentPairingCode: vi.fn().mockResolvedValue(null),
    createKdsPairingCode: vi.fn().mockResolvedValue({ code: '12345678', generatedAt: '2026-07-10T00:00:00Z', expiresAt: null }),
    getKdsDevices: vi.fn().mockResolvedValue({ devices: [] }),
    revokeKdsDevice: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ExperienceService;
}

function device(over: Partial<KdsDevice> = {}): KdsDevice {
  return { deviceId: 'd1', name: 'Kitchen display', pairedAt: '2026-07-01T00:00:00Z', lastSeenAt: new Date().toISOString(), ...over };
}

const KDS_URL = 'https://kds.example.com';
const qr = () => vi.fn((v: string) => <span data-testid="qr-marker">{v}</span>);

beforeEach(() => vi.clearAllMocks());

describe('KitchenTab — reusable pairing (STR-890)', () => {
  it('renders the persistent code + QR on load, with the code in a # fragment (not ?query)', async () => {
    const renderQr = qr();
    const svc = makeService({ getKdsCurrentPairingCode: vi.fn().mockResolvedValue({ code: '87654321', expiresAt: null }) });
    render(<KitchenTab restaurantId="r1" service={svc} kdsUrl={KDS_URL} renderPairingQr={renderQr} />);

    await waitFor(() => expect(screen.getByTestId('kds-pairing-code')).toHaveTextContent('87654321'));
    expect(screen.queryByTestId('kds-pairing-empty')).toBeNull();
    // Log-safety: the deep link uses the URL fragment, never a query string.
    expect(renderQr).toHaveBeenCalledWith('https://kds.example.com/#code=87654321');
    expect(renderQr).not.toHaveBeenCalledWith(expect.stringContaining('?code='));
  });

  it('shows the generate-first empty state when no code exists, then mints one', async () => {
    const svc = makeService(); // getKdsCurrentPairingCode → null
    render(<KitchenTab restaurantId="r1" service={svc} kdsUrl={KDS_URL} renderPairingQr={qr()} />);

    await waitFor(() => expect(screen.getByTestId('kds-pairing-empty')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('kds-pairing-generate'));

    await waitFor(() => expect(screen.getByTestId('kds-pairing-code')).toHaveTextContent('12345678'));
    expect(svc.createKdsPairingCode).toHaveBeenCalledWith('r1');
  });

  it('INVARIANT: "Generate new code" never disconnects paired devices', async () => {
    const svc = makeService({
      getKdsCurrentPairingCode: vi.fn().mockResolvedValue({ code: '11112222', expiresAt: null }),
      getKdsDevices: vi.fn().mockResolvedValue({ devices: [device({ deviceId: 'd1', name: 'Line iPad' })] }),
      createKdsPairingCode: vi.fn().mockResolvedValue({ code: '33334444', generatedAt: '2026-07-10T01:00:00Z', expiresAt: null }),
    });
    render(<KitchenTab restaurantId="r1" service={svc} kdsUrl={KDS_URL} renderPairingQr={qr()} />);

    await waitFor(() => expect(screen.getByTestId('kds-device-row')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('kds-pairing-generate-new'));

    await waitFor(() => expect(screen.getByTestId('kds-pairing-code')).toHaveTextContent('33334444'));
    // The load-bearing fact: generate touches only the code — the paired device survives.
    expect(svc.revokeKdsDevice).not.toHaveBeenCalled();
    expect(screen.getByTestId('kds-device-row')).toBeInTheDocument();
  });

  it('lists paired displays and revokes ONE optimistically on Disconnect', async () => {
    const svc = makeService({
      getKdsCurrentPairingCode: vi.fn().mockResolvedValue({ code: '55556666', expiresAt: null }),
      getKdsDevices: vi.fn().mockResolvedValue({
        devices: [
          device({ deviceId: 'd1', name: 'Line iPad', lastSeenAt: new Date().toISOString() }),
          device({ deviceId: 'd2', name: 'Expo', lastSeenAt: null }),
        ],
      }),
    });
    render(<KitchenTab restaurantId="r1" service={svc} kdsUrl={KDS_URL} renderPairingQr={qr()} />);

    await waitFor(() => expect(screen.getAllByTestId('kds-device-row')).toHaveLength(2));
    expect(screen.getByText('Line iPad')).toBeInTheDocument();
    expect(screen.getByText(/active now/)).toBeInTheDocument();     // recent lastSeen → live cue
    expect(screen.getByText(/not seen yet/)).toBeInTheDocument();   // null lastSeen → offline cue

    await userEvent.click(screen.getAllByTestId('kds-device-revoke')[0]);
    await waitFor(() => expect(svc.revokeKdsDevice).toHaveBeenCalledWith('r1', 'd1'));
    await waitFor(() => expect(screen.getAllByTestId('kds-device-row')).toHaveLength(1)); // row removed after the revoke resolves
  });

  it('leaves the shown code unchanged when createKdsPairingCode fails', async () => {
    const svc = makeService({
      getKdsCurrentPairingCode: vi.fn().mockResolvedValue({ code: '99998888', expiresAt: null }),
      createKdsPairingCode: vi.fn().mockRejectedValue(new Error('temporary error')),
    });
    render(<KitchenTab restaurantId="r1" service={svc} kdsUrl={KDS_URL} renderPairingQr={qr()} />);

    await waitFor(() => expect(screen.getByTestId('kds-pairing-code')).toHaveTextContent('99998888'));
    await userEvent.click(screen.getByTestId('kds-pairing-generate-new'));
    await waitFor(() => expect(svc.createKdsPairingCode).toHaveBeenCalled());
    expect(screen.getByTestId('kds-pairing-code')).toHaveTextContent('99998888'); // unchanged
  });

  it('unwired (preview) env renders + generates a local 8-digit code, no device list', async () => {
    const svc = makeService({
      getKdsConfig: undefined,
      saveKdsConfig: undefined,
      getKdsCurrentPairingCode: undefined,
      createKdsPairingCode: undefined,
      getKdsDevices: undefined,
      revokeKdsDevice: undefined,
    });
    render(<KitchenTab restaurantId="r1" service={svc} />);

    await waitFor(() => expect(screen.getByTestId('kitchen-preview-note')).toBeInTheDocument());
    expect(screen.queryByTestId('kds-device-list')).toBeNull(); // devicesWired === false
    await userEvent.click(screen.getByTestId('kds-pairing-generate'));
    await waitFor(() => expect(screen.getByTestId('kds-pairing-code').textContent || '').toMatch(/^\d{8}$/));
  });
});
