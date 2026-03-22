import type { FoodTags } from '../../types';
import { TAG_CATEGORIES, HEAT_LABELS } from '../../constants/food-tags';

export function FoodTagBadges({ tags }: { tags?: FoodTags }) {
  if (!tags) return null;

  const hasArrayTags = TAG_CATEGORIES.some(cat => {
    const val = tags[cat.key as keyof FoodTags];
    return Array.isArray(val) && val.length > 0;
  });
  const hasHeat = typeof tags.heat === 'number' && tags.heat > 0;
  const hasCalorie = !!tags.calorie_count;

  if (!hasArrayTags && !hasHeat && !hasCalorie) return null;

  return (
    <div className="mt-3 space-y-1">
      {TAG_CATEGORIES.map(({ key, label, color }) => {
        const categoryTags = tags[key as keyof FoodTags];
        if (!Array.isArray(categoryTags) || categoryTags.length === 0) return null;

        return (
          <div key={key} className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">{label}:</span>
            {categoryTags.map((tag: string, idx: number) => (
              <span
                key={`${key}-${idx}`}
                className={`inline-block px-2 py-0.5 text-xs rounded-full ${color}`}
              >
                {tag}
              </span>
            ))}
          </div>
        );
      })}
      {hasHeat && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Heat:</span>
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">
            {'🔥'.repeat(tags.heat!)} {HEAT_LABELS[tags.heat!]}
          </span>
        </div>
      )}
      {hasCalorie && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Calories:</span>
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
            {tags.calorie_count}
          </span>
        </div>
      )}
    </div>
  );
}
