'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, Save, Info, KeyRound, RefreshCw, Copy, Check, ExternalLink, QrCode, Monitor, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ExperienceService, KdsConfig, KdsPairingCode, KdsDevice } from '../../types/experience';
import { useIsMobile } from '../../hooks/useIsMobile';

// 8-digit numeric pairing code — matches the server format (STR-890). Used ONLY for the local
// PREVIEW code on an environment where the KDS pairing backend isn't wired; the real code is the
// ONE reusable, persistent code minted server-side via service.createKdsPairingCode.
function generatePreviewPairingCode(): string {
  return String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
}

// "active now / active 5m ago / offline" cue from a device's last poll. The KDS polls the board
// every few seconds, so a lastSeen inside 2 min means the display is live — the owner uses this to
// avoid revoking a board that's actually running service.
function lastActiveLabel(lastSeenAt: string | null): { text: string; live: boolean } {
  if (!lastSeenAt) return { text: 'not seen yet', live: false };
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (ms < 2 * 60_000) return { text: 'active now', live: true };
  const min = Math.round(ms / 60_000);
  if (min < 60) return { text: `active ${min}m ago`, live: min < 10 };
  const hr = Math.round(min / 60);
  if (hr < 24) return { text: `active ${hr}h ago`, live: false };
  return { text: `active ${Math.round(hr / 24)}d ago`, live: false };
}

// Built-in defaults — device tunables MUST mirror qrate-core owner_kds_config.DEFAULT_* and the
// KDS device's DEFAULT_KDS_CONFIG. Used when the restaurant has no saved config (or the backend
// endpoint isn't reachable yet).
//
// NOTE: owner-configurable KITCHEN STATIONS were removed — stations aren't real board data, and the
// KDS now filters by TABLE instead. The default `stations` are still carried in the saved payload so
// the backend contract (which expects a stations list) stays satisfied, but there is no station
// editor: this tab configures device behaviour + the device pairing code only.
const DEFAULT_KDS_CONFIG: KdsConfig = {
  stations: [
    { id: 'grill', label: 'Grill', order: 0, color: '#ef4444' },
    { id: 'fry', label: 'Fry', order: 1, color: '#f97316' },
    { id: 'cold', label: 'Cold', order: 2, color: '#38bdf8' },
    { id: 'pass', label: 'Pass', order: 3, color: '#a3a3a3' },
    { id: 'bar', label: 'Bar', order: 4, color: '#a855f7' },
  ],
  device: { autoCloseMs: 10_000, ageWarnMs: 480_000, ageCritMs: 900_000, readyRetainMs: 360_000 },
};

export interface KitchenTabProps {
  restaurantId?: string;
  service: ExperienceService;
  /**
   * Base URL of the KDS app (owner env `NEXT_PUBLIC_KDS_URL`). When set alongside a real pairing
   * code, the tab shows a QR encoding `${kdsUrl}/#code=<code>` + an "Open kitchen display" link.
   * Undefined (e.g. waiter/admin consumers, or unconfigured env) → QR/link simply don't render.
   * NOTE: the code rides in the URL FRAGMENT (#code=), never a query (?code=), so it never lands
   * in a CloudFront/access log (STR-890).
   */
  kdsUrl?: string;
  /**
   * QR renderer injected by the owner app (keeps the `qrcode.react` dep OUT of the shared package
   * and its other consumers). Given the full deep-link URL, returns the QR node. Undefined → no QR.
   */
  renderPairingQr?: (value: string) => ReactNode;
}

/**
 * Kitchen setup — the reusable KDS pairing code + paired-device list (STR-890) and device tunables
 * (STR-880). Lives as the 3rd tab in Tables & Staff. Reads/writes via the optional
 * ExperienceService.getKdsConfig/saveKdsConfig + getKdsCurrentPairingCode/createKdsPairingCode/
 * getKdsDevices/revokeKdsDevice; falls back to defaults + a local preview code so the surface always
 * renders (and stays usable before the backend deploys).
 */
export default function KitchenTab({ restaurantId, service, kdsUrl, renderPairingQr }: KitchenTabProps) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<KdsConfig>(DEFAULT_KDS_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const wired = typeof service.getKdsConfig === 'function';

  // ── device pairing (STR-890 reusable, persistent code) ─────────────
  // The restaurant has ONE reusable code. It's fetched on load (getKdsCurrentPairingCode) and shown
  // persistently — it stays put until the owner clicks "Generate new code", so a mid-shift device can
  // pair without disrupting the ones already connected. `pairingWired` reflects the real capability
  // (createKdsPairingCode); without it we fall back to a local PREVIEW code so the surface still
  // demonstrates the flow on an unwired environment.
  const pairingWired = typeof service.createKdsPairingCode === 'function';
  const devicesWired = typeof service.getKdsDevices === 'function';
  const [pairing, setPairing] = useState<KdsPairingCode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<KdsDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (!restaurantId || !service.getKdsDevices) return;
    setDevicesLoading(true);
    try {
      const { devices: d } = await service.getKdsDevices(restaurantId);
      setDevices(Array.isArray(d) ? d : []);
    } catch {
      // non-fatal — the device list is a convenience; the pairing surface still works.
    } finally {
      setDevicesLoading(false);
    }
  }, [restaurantId, service]);

  const loadPairing = useCallback(async () => {
    if (!restaurantId || !service.getKdsCurrentPairingCode) return;
    try {
      const current = await service.getKdsCurrentPairingCode(restaurantId);
      setPairing(current); // null → generate-first empty state (never a dead code)
    } catch {
      // non-fatal — owner can still generate a fresh code.
    }
  }, [restaurantId, service]);

  const generateNew = async () => {
    setCopied(false);
    if (!restaurantId || !service.createKdsPairingCode) {
      setPairing({ code: generatePreviewPairingCode(), generatedAt: new Date().toISOString() });
      toast('New code generated (preview — the KDS pairing backend isn’t deployed yet).');
      return;
    }
    setGenerating(true);
    try {
      const p = await service.createKdsPairingCode(restaurantId);
      setPairing(p);
      toast('New pairing code generated. Devices already connected stay connected.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate the code — try again.');
    } finally {
      setGenerating(false);
    }
  };

  const revokeDevice = async (deviceId: string, name: string) => {
    if (!restaurantId || !service.revokeKdsDevice) return;
    setRevokingId(deviceId);
    try {
      await service.revokeKdsDevice(restaurantId, deviceId);
      setDevices((ds) => ds.filter((d) => d.deviceId !== deviceId));
      toast(`Disconnected “${name}”. It can re-pair with the current code.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not disconnect the device — try again.');
    } finally {
      setRevokingId(null);
    }
  };

  const copyCode = async () => {
    if (!pairing?.code) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed — type the code manually.');
    }
  };

  const load = useCallback(async () => {
    if (!restaurantId || !service.getKdsConfig) {
      setConfig(DEFAULT_KDS_CONFIG);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const c = await service.getKdsConfig(restaurantId);
      setConfig(c && c.stations?.length ? c : DEFAULT_KDS_CONFIG);
    } catch {
      setConfig(DEFAULT_KDS_CONFIG); // graceful — surface still renders on backend miss
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPairing(); }, [loadPairing]);
  useEffect(() => { loadDevices(); }, [loadDevices]);

  const setDevice = (key: keyof KdsConfig['device'], ms: number) =>
    setConfig((c) => ({ ...c, device: { ...c.device, [key]: ms } }));

  // ── save ──────────────────────────────────────────────────────────
  const save = async () => {
    // client-side guard (backend enforces the same, fail-closed). Stations are no longer editable —
    // the default list rides along in the payload only to satisfy the backend contract.
    if ((config.device.ageWarnMs ?? 0) >= (config.device.ageCritMs ?? 0))
      return toast('“Warn after” must be less than “Critical after”.');

    if (!restaurantId || !service.saveKdsConfig) {
      toast('Saved locally (preview — the KDS backend endpoint isn’t deployed yet).');
      return;
    }
    setSaving(true);
    try {
      const saved = await service.saveKdsConfig(restaurantId, config);
      setConfig(saved || config);
      toast('Kitchen settings saved.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400" data-testid="kitchen-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const dev = config.device;

  return (
    <div className="space-y-8" data-testid="kitchen-tab">
      {(!wired || !pairingWired) && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm" data-testid="kitchen-preview-note">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Preview — the KDS backend isn’t wired on this environment yet, so saving settings and generating the pairing code are local. Device settings render from defaults.</span>
        </div>
      )}

      {/* ── Device pairing (reusable code + QR) ── */}
      <section data-testid="kds-pairing">
        <div className={`flex gap-3 mb-1 ${isMobile ? 'flex-col items-start' : 'items-center justify-between'}`}>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <KeyRound className="h-5 w-5 text-orange-500" /> Connect your kitchen display
          </h2>
          {/* Always-visible launcher — the KDS URL is long + unmemorable, so the owner opens it
              from here (new tab). Only renders when the environment has a KDS URL configured. */}
          {kdsUrl && (
            <a
              href={kdsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="kds-open-link"
              className={`flex items-center justify-center gap-1.5 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium ${isMobile ? 'h-11 w-full' : 'h-9'}`}
            >
              <ExternalLink className="h-4 w-4" /> Open kitchen display
            </a>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          On each kitchen tablet, <strong className="text-gray-700">scan this QR with the camera</strong> — the
          QRate KDS opens already paired to this restaurant (no sign-in on the tablet). Off-site? Share the
          code so a team member can enter it by hand. This is your restaurant’s <strong className="text-gray-700">reusable
          code</strong> — the same code connects every kitchen display and <strong className="text-gray-700">stays the
          same</strong>, so you can add a device mid-shift without touching the ones already running. Generating a
          new code doesn’t disconnect anything — to remove a lost or retired device, use <strong className="text-gray-700">Disconnect</strong> in
          the list below.
        </p>

        {!pairing?.code ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center" data-testid="kds-pairing-empty">
            <QrCode className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-4">Generate your restaurant’s pairing code to connect kitchen tablets. One code connects them all and stays valid until you generate a new one.</p>
            <button
              type="button"
              onClick={generateNew}
              disabled={generating}
              data-testid="kds-pairing-generate"
              className={`inline-flex items-center justify-center gap-1.5 px-5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium ${isMobile ? 'h-11 w-full' : 'h-10'}`}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              {generating ? 'Generating…' : 'Generate pairing code'}
            </button>
          </div>
        ) : (
          <div className={`flex gap-5 rounded-lg border border-gray-200 bg-gray-50 p-4 ${isMobile ? 'flex-col' : 'items-stretch'}`}>
            {kdsUrl && renderPairingQr && (
              <div className="shrink-0 bg-white rounded-lg p-3 border border-gray-200 mx-auto" data-testid="kds-pairing-qr">
                {renderPairingQr(`${kdsUrl.replace(/\/$/, '')}/#code=${encodeURIComponent(pairing.code)}`)}
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Or enter this code on the tablet</p>
                <code
                  data-testid="kds-pairing-code"
                  className="font-mono text-2xl font-bold tracking-[0.25em] text-gray-900 select-all block"
                >
                  {pairing.code}
                </code>
              </div>
              <div className={`flex gap-2 ${isMobile ? 'flex-col' : 'flex-wrap'}`}>
                <button
                  type="button"
                  onClick={copyCode}
                  data-testid="kds-pairing-copy"
                  className={`flex items-center justify-center gap-1.5 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium ${isMobile ? 'h-11' : 'h-9'}`}
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={generateNew}
                  disabled={generating}
                  data-testid="kds-pairing-generate-new"
                  className={`flex items-center justify-center gap-1.5 px-4 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium ${isMobile ? 'h-11' : 'h-9'}`}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {generating ? 'Generating…' : 'Generate new code'}
                </button>
              </div>
              <p className="text-xs text-gray-400" data-testid="kds-pairing-generated-at">
                {pairing.generatedAt ? `Generated ${new Date(pairing.generatedAt).toLocaleString()}` : 'Reusable code — connects every kitchen display'}
                {pairing.expiresAt ? ` · auto-expires ${new Date(pairing.expiresAt).toLocaleString()} if unused` : ''}
              </p>
            </div>
          </div>
        )}

        {/* ── Paired displays (identify + disconnect) ── */}
        {devicesWired && (
          <div className="mt-5" data-testid="kds-device-list">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Monitor className="h-4 w-4 text-gray-400" /> Paired displays{devices.length ? ` (${devices.length})` : ''}
              </h3>
              <button
                type="button"
                onClick={loadDevices}
                disabled={devicesLoading}
                data-testid="kds-device-refresh"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${devicesLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            {devices.length === 0 ? (
              <p className="text-sm text-gray-400 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3" data-testid="kds-device-empty">
                No displays paired yet. Scan the code on a kitchen tablet to connect one.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {devices.map((d) => {
                  const active = lastActiveLabel(d.lastSeenAt);
                  return (
                    <li key={d.deviceId} data-testid="kds-device-row" className={`flex items-center justify-between gap-3 px-4 py-3 ${isMobile ? 'flex-col items-start' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{d.name || 'Kitchen display'}</p>
                        <p className="flex items-center gap-1.5 text-xs text-gray-400">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${active.live ? 'bg-green-500' : 'bg-gray-300'}`} />
                          {active.text}
                          {d.pairedAt ? ` · paired ${new Date(d.pairedAt).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeDevice(d.deviceId, d.name || 'Kitchen display')}
                        disabled={revokingId === d.deviceId}
                        data-testid="kds-device-revoke"
                        className={`flex items-center justify-center gap-1.5 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 text-sm font-medium disabled:opacity-60 ${isMobile ? 'h-10 w-full' : 'h-9'}`}
                      >
                        {revokingId === d.deviceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Disconnect
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── Device settings ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Display behaviour</h2>
        <p className="text-sm text-gray-500 mb-4">Tune how the kitchen tablet behaves. Sensible defaults apply until you change them.</p>

        <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <NumberField
            label="Call-out auto-close" unit="seconds" min={3} max={60}
            value={Math.round((dev.autoCloseMs ?? 10_000) / 1000)}
            onChange={(v) => setDevice('autoCloseMs', v * 1000)}
            help="How long the full-screen call-out stays up before closing itself."
            testid="kds-device-autoCloseMs" mobile={isMobile}
          />
          <NumberField
            label="Ready holds on the pass" unit="minutes" min={1} max={60}
            value={Math.round((dev.readyRetainMs ?? 360_000) / 60_000)}
            onChange={(v) => setDevice('readyRetainMs', v * 60_000)}
            help="How long a bumped-Ready ticket stays before clearing to recall."
            testid="kds-device-readyRetainMs" mobile={isMobile}
          />
          <NumberField
            label="Warn after (amber)" unit="minutes" min={1} max={60}
            value={Math.round((dev.ageWarnMs ?? 480_000) / 60_000)}
            onChange={(v) => setDevice('ageWarnMs', v * 60_000)}
            help="A ticket turns amber once it has waited this long."
            testid="kds-device-ageWarnMs" mobile={isMobile}
          />
          <NumberField
            label="Critical after (red)" unit="minutes" min={1} max={60}
            value={Math.round((dev.ageCritMs ?? 900_000) / 60_000)}
            onChange={(v) => setDevice('ageCritMs', v * 60_000)}
            help="A ticket turns red + counts as late. Must be more than the amber threshold."
            testid="kds-device-ageCritMs" mobile={isMobile}
          />
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="kds-config-save"
          className={`flex items-center gap-2 px-5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium ${isMobile ? 'h-11 w-full justify-center' : 'h-10'}`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save kitchen settings'}
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label, unit, value, min, max, onChange, help, testid, mobile,
}: {
  label: string; unit: string; value: number; min: number; max: number;
  onChange: (v: number) => void; help: string; testid: string; mobile: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          data-testid={testid}
          className={`w-24 rounded-md border border-gray-200 px-3 text-sm focus:border-orange-400 focus:outline-none ${mobile ? 'h-11' : 'h-9'}`}
        />
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      <span className="mt-1 block text-xs text-gray-400">{help}</span>
    </label>
  );
}
