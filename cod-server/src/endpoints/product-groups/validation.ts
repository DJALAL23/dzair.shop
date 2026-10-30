import { z } from "zod";
import { SEO_TEXT } from "../../../../cod-shared/lib/seo";
import { MediaKeySchema } from "@/openapi/schemas/media";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createGroupSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(slugRegex, "Slug must be lowercase letters, numbers and hyphens").optional(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  imageKey: MediaKeySchema.optional().nullable(),
  metaTitle: z.string().max(SEO_TEXT.titleMax).optional().nullable(),
  metaDescription: z.string().max(SEO_TEXT.descriptionMax).optional().nullable(),
  metaKeywords: z.string().optional().nullable(),
  position: z.number().int().min(0).default(0),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().regex(slugRegex, "Slug must be lowercase letters, numbers and hyphens").optional(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  imageKey: MediaKeySchema.optional().nullable(),
  metaTitle: z.string().max(SEO_TEXT.titleMax).optional().nullable(),
  metaDescription: z.string().max(SEO_TEXT.descriptionMax).optional().nullable(),
  metaKeywords: z.string().optional().nullable(),
  position: z.number().int().min(0).optional(),
});

export const groupFiltersSchema = z.object({
  search: z.string().optional(),
  parentId: z.string().optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type GroupFiltersInput = z.infer<typeof groupFiltersSchema>;
