-- Migration: Add content_templates table for reusable content skeletons
-- Run: mysql -u root contentos < api/migrations/002_add_content_templates.sql

CREATE TABLE IF NOT EXISTS `content_templates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(150) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `brand_id` int unsigned NULL COMMENT 'NULL = global template (usable across brands)',
  `category` varchar(50) NOT NULL DEFAULT 'General',
  `campaign` varchar(200) NOT NULL DEFAULT '',
  `pillar` varchar(150) NOT NULL DEFAULT '',
  `platform` varchar(50) NOT NULL DEFAULT '',
  `format` varchar(50) NOT NULL DEFAULT '',
  `caption` text NULL,
  `hashtags` varchar(500) NOT NULL DEFAULT '',
  `image_prompt` text NULL,
  `video_script` text NULL,
  `created_by` varchar(64) NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_templates_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_templates_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_templates_brand` (`brand_id`),
  INDEX `idx_templates_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;