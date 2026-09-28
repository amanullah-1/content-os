-- Publish provenance: record the real platform post id and the publish timestamp.
-- Previously a post was only flagged `status = 'published'`, so there was no way
-- to prove a post actually reached the platform after the fact.
-- Run: mysql -u root contented < api/migrations/004_add_publish_provenance.sql

ALTER TABLE `content_items`
  ADD COLUMN `external_id` varchar(255) NULL COMMENT 'Platform post id, e.g. Facebook PAGEID_POSTID',
  ADD COLUMN `published_at` datetime NULL COMMENT 'When the post was successfully published',
  ADD INDEX `idx_content_published_at` (`published_at`);
