/**
 * Reference Data Schemas
 *
 * Algerian administrative divisions used throughout the platform.
 */

import { z } from "@hono/zod-openapi";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";

export const WilayaSchema = z
  .object({
    id: z
      .number()
      .int()
      .min(1)
      .max(LAST_WILAYA_ID)
      .openapi({ example: 16, description: `Official wilaya number (1–${LAST_WILAYA_ID})` }),
    name: z.string().openapi({ example: "Alger" }),
    nameAr: z.string().openapi({ example: "الجزائر" }),
  })
  .openapi("Wilaya");

export const CommuneSchema = z
  .object({
    id: z.string().openapi({ example: "c-16-001" }),
    wilayaId: z.number().int().openapi({ example: 16 }),
    name: z.string().openapi({ example: "Bir Mourad Raïs" }),
    nameAr: z.string().openapi({ example: "بئر مراد رايس" }),
  })
  .openapi("Commune");
