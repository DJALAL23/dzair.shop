/** `GET /api/collections` — one row of the list. */
export interface CollectionSummary {
  id: string;
  handle: string;
  title: string;
  productCount: number;
  updatedAt: string;
}

export interface CollectionProduct {
  id: string;
  name: string;
  handle: string;
  imageUrl: string | null;
  /** Whether shoppers see it now; a hidden product is left out of the storefront list. */
  visible: boolean;
}

/** `GET /api/collections/{id}`. */
export interface CollectionDetail {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  updatedAt: string;
  products: CollectionProduct[];
}
