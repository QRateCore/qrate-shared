'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Info, KeyRound, RefreshCw, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ExperienceService, KdsConfig, KdsPairingCode } from '../../types/experience';
import { useIsMobile } from '../../hooks/useIsMobile';

// Human-typeable pairing code — no ambiguous 0/O/1/I/L. Two groups of four, e.g. "K7F3-9QX2".
// Used only for the local PREVIEW code before the KDS pairing backend is deployed; the real code
// is minted + rotated server-side (invalidating the previous) via service.rotateKdsPairingCode.
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generatePreviewPairingCode(): string {
  const pick = () => PAIR_ALPHABET[Math.floor(Math.random() * PAIR_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}`;
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
}

/**
 * Kitchen setup — owner-defined KDS stations (STR-876) + device tunables (STR-880).
 * Lives as the 3rd tab in Tables & Staff. Reads/writes via the optional
 * ExperienceService.getKdsConfig/saveKdsConfig; falls back to DEFAULT_KDS_CONFIG
 * so the surface always renders (and stays usable before the backend deploys).
 */
export default function KitchenTab({ restaurantId, service }: KitchenTabProps) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<KdsConfig>(DEFAULT_KDS_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const wired = typeof service.getKdsConfig === 'function';

  // ── device pairing code (rotatable) ───────────────────────────────
  const pairingWired = typeof service.getKdsPairingCode === 'function';
  const [pairing, setPairing] = useState<KdsPairingCode | null>(null);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (restaurantId && service.getKdsPairingCode) {
        try {
          const p = await service.getKdsPairingCode(restaurantId);
          if (alive) setPairing(p);
          return;
        } catch { /* fall through to a local preview code */ }
      }
      if (alive) setPairing({ code: generatePreviewPairingCode(), rotatedAt: new Date().toISOString() });
    })();
    return () => { alive = false; };
  }, [restaurantId, service]);

  const rotate = async () => {
    setCopied(false);
    if (!restaurantId || !service.rotateKdsPairingCode) {
      setPairing({ code: generatePreviewPairingCode(), rotatedAt: new Date().toISOString() });
      toast('New code generated (preview — the KDS pairing backend isn’t deployed yet).');
      return;
    }
    setRotating(true);
    try {
      const p = await service.rotateKdsPairingCode(restaurantId);
      setPairing(p);
      toast('New pairing code generated. The previous code no longer works.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not rotate the code — try again.');
    } finally {
      setRotating(false);
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
          <span>Preview — the KDS backend isn’t wired on this environment yet, so saving settings and rotating the pairing code are local. Stations &amp; device settings render from defaults.</span>
        </div>
      )}

      {/* ── Device pairing (rotatable code) ── */}
      <section data-testid="kds-pairing">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-1">
          <KeyRound className="h-5 w-5 text-orange-500" /> Connect your kitchen display
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          On the kitchen tablet, open the QRate KDS and enter this code to pair it to this restaurant.
          <strong className="text-gray-700"> Rotating</strong> the code disconnects any tablet paired with the old one — use it if a device is lost or an employee leaves.
        </p>

        <div className={`flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 ${isMobile ? 'flex-col items-stretch' : ''}`}>
          <code
            data-testid="kds-pairing-code"
            className="font-mono text-2xl font-bold tracking-[0.25em] text-gray-900 select-all flex-1 text-center sm:text-left"
          >
            {pairing?.code ?? '••••-••••'}
          </code>
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
            onClick={rotate}
            disabled={rotating}
            data-testid="kds-pairing-rotate"
            className={`flex items-center justify-center gap-1.5 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium ${isMobile ? 'h-11' : 'h-9'}`}
          >
            {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {rotating ? 'Rotating…' : 'Rotate code'}
          </button>
        </div>
        {pairing?.rotatedAt && (
          <p className="mt-2 text-xs text-gray-400" data-testid="kds-pairing-rotated-at">
            Last generated {new Date(pairing.rotatedAt).toLocaleString()}
            {pairing.expiresAt ? ` · expires ${new Date(pairing.expiresAt).toLocaleString()}` : ''}
          </p>
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
