-- No Staging: a review's photos and voice note are prepared when they arrive
-- and kept by the Media Library on the store's own host, so a review lands as
-- soon as it is sent. Nothing waits in a bucket, and no job prepares files
-- after the answer.
--
-- A voice note's length is measured when it arrives (or taken from the
-- recorder, never above the store's limit) and kept with its file until the
-- review that names it is written.
ALTER TABLE media ADD COLUMN duration_ms INTEGER;

-- data-safety: reviews.status — a review still `processing` waited for a media job this release no longer runs; it goes to the merchant's queue as pending
-- data-safety: reviews.media_dropped — its files are counted as dropped, at least one
-- data-safety: reviews.updated_at — it changed now
UPDATE reviews SET status = 'pending', media_dropped = max(media_dropped, 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'processing';
