'use client';

import {
  TAG_CATEGORIES,
  CALORIE_OPTIONS,
  DEFAULT_HEAT_LABELS,
  DEFAULT_HEAT_ICONS,
  DEFAULT_SWEETNESS_LABELS,
  DEFAULT_SWEETNESS_ICONS,
} from '../../constants/food-tags';
import { TagInput } from './TagInput';
import type { FoodTags } from '../../types';

const SPICE_EXCLUDED_CATEGORIES = new Set(['Beverages', 'Desserts']);

interface FoodTagEditorFormProps {
  tags: FoodTags;
  onChange: (tags: FoodTags) => void;
  canonicalCategory?: string | null;
  /** Per-restaurant spice scale labels. Falls back to the default 5-level scale. */
  heatLabels?: string[];
  /** Per-restaurant sweetness scale labels. Falls back to the default 4-level scale. */
  sweetnessLabels?: string[];
}

export function FoodTagEditorForm({ tags, onChange, canonicalCategory, heatLabels, sweetnessLabels }: FoodTagEditorFormProps) {
  const activeHeatLabels: string[] = (heatLabels && heatLabels.length > 0)
    ? heatLabels
    : [...DEFAULT_HEAT_LABELS];
  const activeSweetnessLabels: string[] = (sweetnessLabels && sweetnessLabels.length > 0)
    ? sweetnessLabels
    : [...DEFAULT_SWEETNESS_LABELS];
  const updateArrayTag = (key: string, values: string[]) => {
    onChange({ ...tags, [key]: values });
  };

  // heat_spice is stored as string[] — read first element as current selection
  const currentHeat = (() => {
    const hs = tags.heat_spice;
    if (Array.isArray(hs) && hs.length > 0) return hs[0];
    if (typeof hs === 'string' && hs) return hs;
    return null;
  })();

  const handleHeatSelect = (label: string) => {
    const next = currentHeat === label ? undefined : ([label] as string[]);
    onChange({ ...tags, heat_spice: next });
  };

  // sweetness_label is stored as a string (single selection)
  const currentSweetness = tags.sweetness_label ?? null;

  const handleSweetnessSelect = (label: string) => {
    const next = currentSweetness === label ? null : label;
    onChange({ ...tags, sweetness_label: next });
  };

  return (
    <div className="space-y-4" data-testid="food-tag-editor">
      {/* Sweetness — single-select pill group (shown only for Desserts) */}
      {canonicalCategory === 'Desserts' && <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">✦ Sweetness Level</label>
        <div className="flex flex-wrap gap-2" data-testid="sweetness-selector">
          {activeSweetnessLabels.map((label, i) => {
            const selected = currentSweetness === label;
            const icon = DEFAULT_SWEETNESS_ICONS[Math.min(i, DEFAULT_SWEETNESS_ICONS.length - 1)];
            return (
              <button
                key={label}
                type="button"
                data-testid={`sweetness-pill-${label.toLowerCase().replace(/\s+/g, '-')}`}
                aria-pressed={selected}
                onClick={() => handleSweetnessSelect(label)}
                className={
                  'text-xs px-3 py-1.5 rounded-full border-2 transition font-medium ' +
                  (selected
                    ? 'bg-pink-50 border-pink-400 text-pink-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-pink-300 hover:text-pink-500')
                }
              >
                {icon} {label}
              </button>
            );
          })}
        </div>
      </div>}

      {/* Heat / Spice — single-select pill group (hidden for Beverages & Desserts) */}
      {!SPICE_EXCLUDED_CATEGORIES.has(canonicalCategory ?? '') && <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">🌶️ Heat / Spice Level</label>
        <div className="flex flex-wrap gap-2" data-testid="heat-spice-selector">
          {activeHeatLabels.map((label, i) => {
            const selected = currentHeat === label;
            const icon = DEFAULT_HEAT_ICONS[Math.min(i, DEFAULT_HEAT_ICONS.length - 1)];
            return (
              <button
                key={label}
                type="button"
                data-testid={`heat-pill-${label.toLowerCase()}`}
                aria-pressed={selected}
                onClick={() => handleHeatSelect(label)}
                className={
                  'text-xs px-3 py-1.5 rounded-full border-2 transition font-medium ' +
                  (selected
                    ? 'bg-orange-50 border-orange-400 text-orange-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300 hover:text-orange-500')
                }
              >
                {icon} {label}
              </button>
            );
          })}
        </div>
      </div>}

      {/* Array-based tag categories (heat_spice excluded — handled above) */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TAG_CATEGORIES.filter(({ key }) => key !== 'heat_spice').map(({ key, label, color, icon }) => (
          <TagInput
            key={key}
            label={`${icon} ${label}`}
            tags={(tags[key as keyof FoodTags] as string[]) || []}
            onChange={(t) => updateArrayTag(key, t)}
            color={color}
            testId={key}
          />
        ))}
      </div>

      {/* Calorie Count */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">🔢 Calorie Count</label>
        <div className="flex flex-wrap gap-1.5" data-testid="calorie-selector">
          {CALORIE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ ...tags, calorie_count: tags.calorie_count === option ? undefined : option })}
              data-testid={`calorie-btn-${option}`}
              className={'text-xs px-3 py-1.5 rounded-lg border-2 transition font-medium ' +
                (tags.calorie_count === option
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300 hover:text-orange-500')}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
