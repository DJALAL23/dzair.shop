import type { MediaImage } from "../../../../cod-shared/media/model";

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  parentId?: string | null;
  image?: MediaImage | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  position: number;
  productsCount?: number;
  children?: ProductCategory[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategoryFormValues {
  name: string;
  slug: string;
  description: string;
  parentId: string;
  image: MediaImage | null;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
}

/** What a create or a PATCH sends: the image by its Media Key; null removes it. */
export type ProductGroupInput = Partial<Pick<ProductCategory, "name" | "slug" | "description" | "parentId" | "metaTitle" | "metaDescription" | "metaKeywords">> & {
  imageKey?: string | null;
};
