import { describe, expect, it } from 'vitest';
import { BASE_SPIRITS, BEER_STYLES, BEVERAGE_TYPES, DRINK_STRENGTHS, SERVING_STYLES } from '../../../constants/food-tags';
import { DRINK_TYPES, applyAlcoholic, applyDrinkType, drinkTypeConfig, drinkTypesFor } from '../drinkConfig';

describe('drinkConfig (v3 DRINK_CFG mapped onto stored values)', () => {
  it('writes only values the diner app already reads', () => {
    for (const t of DRINK_TYPES) {
      expect(BEVERAGE_TYPES as readonly string[]).toContain(t.value);
      for (const s of t.served) expect(SERVING_STYLES as readonly string[]).toContain(s);
      for (const s of t.strength) expect(DRINK_STRENGTHS as readonly string[]).toContain(s);
    }
    expect(BASE_SPIRITS.length).toBeGreaterThan(0);
    expect(BEER_STYLES.length).toBeGreaterThan(0);
  });

  it('Alcoholic offers Cocktail / Spirit / Beer / Wine; Non-alcoholic offers mocktail, soft drinks… and Other', () => {
    expect(drinkTypesFor(true).map((t) => t.value)).toEqual(['cocktail', 'spirit', 'beer', 'wine']);
    const non = drinkTypesFor(false).map((t) => t.value);
    expect(non).toContain('mocktail');
    expect(non).toContain('soda');
    expect(non).not.toContain('cocktail');
    expect(drinkTypesFor(undefined)).toHaveLength(DRINK_TYPES.length);
  });

  it('going non-alcoholic clears an alcoholic type and the base spirit, and sets strength "none"', () => {
    const out = applyAlcoholic({ beverage_type: 'cocktail', alcoholic: true, base_spirit: 'gin', strength: 'strong', served: 'on-the-rocks' }, false);
    expect(out).toMatchObject({ alcoholic: false, beverage_type: undefined, base_spirit: null, strength: 'none' });
  });

  it('changing type clears Served / Strength / third-field values the new type does not offer', () => {
    const out = applyDrinkType({ beverage_type: 'cocktail', alcoholic: true, base_spirit: 'gin', served: 'frozen', strength: 'medium' }, 'beer');
    expect(out).toMatchObject({ beverage_type: 'beer', alcoholic: true, base_spirit: null, served: null, strength: 'medium' });
    const tea = applyDrinkType({ beverage_type: 'beer', alcoholic: true, beer_style: 'IPA', served: 'draft' }, 'tea');
    expect(tea).toMatchObject({ alcoholic: false, beer_style: null, served: null });
    const water = applyDrinkType({ strength: 'strong' }, 'water');
    expect(water.strength).toBe('none');
  });

  it('kept values survive a compatible change', () => {
    const out = applyDrinkType({ beverage_type: 'cocktail', alcoholic: true, served: 'on-the-rocks', base_spirit: 'rum' }, 'spirit');
    expect(out).toMatchObject({ served: 'on-the-rocks', base_spirit: 'rum' });
    expect(drinkTypeConfig('nope')).toBeNull();
  });
});
