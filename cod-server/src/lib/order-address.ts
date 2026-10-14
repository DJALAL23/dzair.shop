import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { communes, wilayas } from "@/db/schema";
import { ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../cod-shared/errors/codes";

/**
 * An order's wilaya and commune, checked against the reference tables before
 * anything is written. A commune that does not exist would otherwise fail the
 * insert as a server error, and one from another wilaya would be saved and
 * handed to a carrier as a contradictory address.
 *
 * A field left out is not checked; a commune is checked against the wilaya
 * when both are given.
 */
export async function assertOrderAddress(
  db: AppDb,
  address: { wilayaId?: number | null; communeId?: string | null },
  context: Record<string, unknown> = {},
): Promise<void> {
  const { wilayaId, communeId } = address;

  if (wilayaId != null) {
    const wilaya = await db.select({ id: wilayas.id }).from(wilayas).where(eq(wilayas.id, wilayaId)).get();
    if (!wilaya) {
      throw new ValidationError("Wilaya not found in reference tables", ERROR_CODES.MISSING_WILAYA_COMMUNE, {
        ...context,
        wilayaId,
      });
    }
  }

  if (communeId != null) {
    const commune = await db
      .select({ id: communes.id, wilayaId: communes.wilayaId })
      .from(communes)
      .where(eq(communes.id, communeId))
      .get();
    if (!commune) {
      throw new ValidationError("Commune not found in reference tables", ERROR_CODES.MISSING_WILAYA_COMMUNE, {
        ...context,
        communeId,
      });
    }
    if (wilayaId != null && commune.wilayaId !== wilayaId) {
      throw new ValidationError("Commune does not belong to the selected wilaya", ERROR_CODES.MISSING_WILAYA_COMMUNE, {
        ...context,
        communeId,
        wilayaId,
      });
    }
  }
}
