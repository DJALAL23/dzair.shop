/**
 * The words of a review, once: what states it passes through, who entered
 * it, what can be attached to it, and the choices a merchant has. The schema,
 * the server, the dashboard and the SDK contracts read them from here.
 */

/** `processing`: received, its photos or voice note still being prepared — never shown, never moderated. */
export const REVIEW_STATUSES = ["processing", "pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The statuses a merchant moves a review between; `processing` is the system's. */
export const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const satisfies readonly ReviewStatus[];
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/** Who entered it: a shopper on the storefront, or the store from the dashboard. */
export const REVIEW_SOURCES = ["storefront", "merchant"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_MEDIA_KINDS = ["image", "audio"] as const;
export type ReviewMediaKind = (typeof REVIEW_MEDIA_KINDS)[number];

/**
 * What a review may publish without the merchant checking it: nothing, text
 * reviews only (anything with a photo or a voice note waits), or everything.
 */
export const REVIEW_AUTO_PUBLISH = ["off", "text_only", "all"] as const;
export type ReviewAutoPublish = (typeof REVIEW_AUTO_PUBLISH)[number];

/** The voice-note lengths a merchant can allow, in seconds. */
export const REVIEW_VOICE_LENGTHS = [30, 60, 90, 120] as const;
export type ReviewVoiceLength = (typeof REVIEW_VOICE_LENGTHS)[number];

/** At most this many photos on one review, whatever the merchant chooses. */
export const REVIEW_MAX_PHOTOS = 6;
