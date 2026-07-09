'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, Save, Info, KeyRound, RefreshCw, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ExperienceService, KdsConfig, KdsStationConfig, KdsPairingCode } from '../../types/experience';
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

// Built-in defaults — MUST mirror qrate-core owner_kds_config.DEFAULT_* and the
// KDS device's DEFAULT_KDS_CONFIG. Used when the restaurant has no saved config
// (or the backend endpoint isn't reachable yet).
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

const STATION_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#38bdf8', '#a855f7', '#ec4899', '#a3a3a3'];

function newStationId(existing: KdsStationConfig[]): string {
  let n = existing.length + 1;
  let id = `station-${n}`;
  const ids = new Set(existing.map((s) => s.id));
  while (ids.has(id)) id = `station-${++n}`;
  return id;
}

function reindex(stations: KdsStationConfig[]): KdsStationConfig[] {
  return stations.map((s, i) => ({ ...s, order: i }));
}

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

  // ── station mutators ──────────────────────────────────────────────
  const setStations = (stations: KdsStationConfig[]) => setConfig((c) => ({ ...c, stations }));

  const addStation = () => {
    const id = newStationId(config.stations);
    setStations(reindex([...config.stations, {
      id, label: 'New Station', order: config.stations.length,
      color: STATION_PALETTE[config.stations.length % STATION_PALETTE.length],
    }]));
  };
  const removeStation = (id: string) =>
    setStations(reindex(config.stations.filter((s) => s.id !== id)));
  const renameStation = (id: string, label: string) =>
    setStations(config.stations.map((s) => (s.id === id ? { ...s, label } : s)));
  const recolorStation = (id: string, color: string) =>
    setStations(config.stations.map((s) => (s.id === id ? { ...s, color } : s)));
  const moveStation = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= config.stations.length) return;
    const next = [...config.stations];
    [next[index], next[j]] = [next[j], next[index]];
    setStations(reindex(next));
  };

  const setDevice = (key: keyof KdsConfig['device'], ms: number) =>
    setConfig((c) => ({ ...c, device: { ...c.device, [key]: ms } }));

  // ── save ──────────────────────────────────────────────────────────
  const save = async () => {
    // client-side guard (backend enforces the same, fail-closed)
    if (config.stations.length < 1) return toast('Add at least one station.');
    if ((config.device.ageWarnMs ?? 0) >= (config.device.ageCritMs ?? 0))
      return toast('“Warn after” must be less than “Critical after”.');
    if (config.stations.some((s) => !s.label.trim()))
      return toast('Every station needs a name.');

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

  const touch = isMobile ? 'min-h-[44px]' : '';
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

      {/* ── Stations ── */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Kitchen stations</h2>
          <button
            type="button"
            onClick={addStation}
            data-testid="kitchen-add-station"
            className={`flex items-center gap-1.5 px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium ${touch || 'h-9'}`}
          >
            <Plus className="h-4 w-4" /> Add station
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Define how your kitchen is segmented on the display — e.g. a <em>Tandoor</em>, a wood-fired <em>Oven</em>, a sushi <em>Pass</em>. Each dish is routed to a station.
        </p>

        <ul className="space-y-2">
          {config.stations.map((s, i) => (
            <li
              key={s.id}
              data-testid={`kds-station-${s.id}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2"
            >
              <span
                className="h-6 w-6 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: s.color || '#a3a3a3' }}
                aria-hidden
              />
              <input
                value={s.label}
                onChange={(e) => renameStation(s.id, e.target.value)}
                data-testid={`kds-station-label-${s.id}`}
                aria-label={`Station ${i + 1} name`}
                className={`flex-1 min-w-0 rounded-md border border-gray-200 px-3 text-sm focus:border-orange-400 focus:outline-none ${isMobile ? 'h-11' : 'h-9'}`}
              />
              <input
                type="color"
                value={s.color || '#a3a3a3'}
                onChange={(e) => recolorStation(s.id, e.target.value)}
                aria-label={`Station ${i + 1} colour`}
                className={`shrink-0 rounded-md border border-gray-200 bg-white p-0.5 cursor-pointer ${isMobile ? 'h-11 w-11' : 'h-9 w-9'}`}
              />
              <div className="flex flex-col shrink-0">
                <button type="button" onClick={() => moveStation(i, -1)} disabled={i === 0}
                  aria-label="Move up" className="grid place-items-center h-5 w-8 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => moveStation(i, 1)} disabled={i === config.stations.length - 1}
                  aria-label="Move down" className="grid place-items-center h-5 w-8 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeStation(s.id)}
                aria-label={`Delete ${s.label}`}
                data-testid={`kds-station-delete-${s.id}`}
                className={`grid place-items-center shrink-0 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 ${isMobile ? 'h-11 w-11' : 'h-9 w-9'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
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
