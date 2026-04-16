export interface MenuPairing {
  id: string;
  item_a_id: string;
  item_b_id: string;
  recommendation_type: 'manual' | 'ai' | 'ai_generated';
  strength: number;
  reason: string;
  ai_confidence?: number;
  item_a_name: string;
  item_a_category: string;
  item_a_price?: number;
  item_a_thumbnail?: string | null;
  item_b_name: string;
  item_b_category: string;
  item_b_price?: number;
  item_b_thumbnail?: string | null;
}

export interface PairingSuggestion {
  item_a_id: string;
  item_b_id: string;
  item_a_name: string;
  item_a_category: string;
  item_b_name: string;
  item_b_category: string;
  strength: number;
  reason: string;
  confidence: number;
}
