/**
 * The words of the Media glossary (CONTEXT.md) that the schema and every
 * module share. A Media Host is added here, then given its adapter in
 * `hosts/`.
 */

export const MEDIA_HOSTS = ["imagekit", "r2"] as const;
export type MediaHostKind = (typeof MEDIA_HOSTS)[number];

export const MEDIA_KINDS = ["image", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ["pending", "ready"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
