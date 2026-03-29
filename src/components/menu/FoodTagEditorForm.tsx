'use client';

import { TAG_CATEGORIES, CALORIE_OPTIONS } from '../../constants/food-tags';
import { TagInput } from './TagInput';
import type { FoodTags } from '../../types';

interface FoodTagEditorFormProps {
  tags: FoodTags;
  onChange: (tags: FoodTags) => void;
}

export function FoodTagEditorForm({ tags, onChange }: FoodTagEditorFormProps) {
  const updateArrayTag = (key: string, values: string[]) => {
    onChange({ ...tags, [key]: values });
  };

  return (
    <div className="space-y-4" data-testid="food-tag-editor">
      {/* Array-based tag categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TAG_CATEGORIES.map(({ key, label, color, icon }) => (
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
