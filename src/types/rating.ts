export interface Rating {
  id: string;
  menu_item_id: string;
  order_id: string;
  rating: number; // 1-5
  review_text?: string;
  item_name: string;
  diner_name: string;
  created_at: string; // ISO datetime string
}

export interface RatingCreate {
  menu_item_id: string;
  order_id: string;
  rating: number; // 1-5
  review_text?: string;
}

export interface RestaurantRatingSummary {
  restaurant_id: string;
  average_rating: number;
  count: number;
}
