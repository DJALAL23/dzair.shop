import { z } from "zod";

/**
 * A record's id as a tool receives it. Ids are opaque strings: most are
 * UUIDs, but seeded and imported rows carry other shapes
 * (`<store>:starter:product:handbag`), so a tool never demands a UUID.
 */
export const toolId = () => z.string().trim().min(1).max(256);
