'use client';

import { TAG_CATEGORIES, CALORIE_OPTIONS } from '../../constants/food-tags';
import { TagInput } from './TagInput';
import type { FoodTags } from '../../types';

const HEAT_LABELS = ['Mild', 'Warm', 'Medium', 'Hot', 'Fiery'] as const;
const HEAT_ICONS: Record<string, string> = {
  Mild: '❄️', Warm: '🌶️', Medium: '🌶️🌶️', Hot: '🔥', Fiery: '🔥🔥',
};

const SPICE_EXCLUDED_CATEGORIES = new Set(['Beverages', 'Desserts']);

interface FoodTagEditorFormProps {
  tags: FoodTags;
  onChange: (tags: FoodTags) => void;
  canonicalCategory?: string | null;
}

export function FoodTagEditorForm({ tags, onChange, canonicalCategory }: FoodTagEditorFormProps) {
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

  return (
    <div className="space-y-4" data-testid="food-tag-editor">
      {/* Heat / Spice — single-select pill group (hidden for Beverages & Desserts) */}
      {!SPICE_EXCLUDED_CATEGORIES.has(canonicalCategory ?? '') && <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">🌶️ Heat / Spice Level</label>
        <div className="flex flex-wrap gap-2" data-testid="heat-spice-selector">
          {HEAT_LABELS.map((label) => {
            const selected = currentHeat === label;
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
                {HEAT_ICONS[label]} {label}
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
