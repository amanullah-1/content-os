-- ============================================================================
-- ContentOS relational schema (MySQL 8 / Laragon)
-- ============================================================================
-- Purpose : proper relational model replacing the single-table KV store
--           (kv_store stays untouched — the app still runs on it until the
--           migration + enforcement step, which is deliberately NOT part of
--           this file).
--
-- Access model (STRUCTURE ONLY — not enforced anywhere yet):
--   * roles.sees_all = 1  -> master / super admin, unrestricted:
--                            sees ALL brands and ALL content.
--   * roles.sees_all = 0  -> business / client level users, scoped:
--                            sees ONLY brands listed for them in
--                            brand_members (content follows its brand via
--                            content_items.brand_id).
--   * brand_members.member_role (owner/editor/viewer) is reserved for
--     future fine-grained rights (edit vs read-only). Nothing reads it yet.
--
-- Apply: mysql -u root contentos < api/schema_relational.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `contentos`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `contentos`;

-- ----------------------------------------------------------------------------
-- Roles: global role catalogue. `sees_all` encodes the super-admin rule.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `slug`        VARCHAR(50)  NOT NULL UNIQUE,
  `label`       VARCHAR(100) NOT NULL,
  `sees_all`    TINYINT(1)   NOT NULL DEFAULT 0,
  `description` VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `roles` (`slug`, `label`, `sees_all`, `description`) VALUES
  ('super_admin',     'Super Admin',     1, 'Master admin: unrestricted access to all brands and content'),
  ('admin',           'Admin',           0, 'Staff admin: only assigned brands and their content'),
  ('brand_manager',   'Brand Manager',   0, 'Manages assigned brands'),
  ('content_manager', 'Content Manager', 0, 'Manages content of assigned brands'),
  ('editor',          'Editor',          0, 'Edits content of assigned brands'),
  ('business',        'Business',        0, 'Client level: only own brands and their content'),
  ('client',          'Client',          0, 'Client level: only own brands and their content'),
  ('viewer',          'Viewer',          0, 'Read-only access to assigned brands');

-- ----------------------------------------------------------------------------
-- Users. `id` stays VARCHAR so existing string ids (uuid, master_admin_001,
-- google_<sub>) migrate without remapping.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`           VARCHAR(64)  NOT NULL PRIMARY KEY,
  `email`        VARCHAR(255) NOT NULL UNIQUE,
  `name`         VARCHAR(150) NOT NULL,
  `avatar_color` VARCHAR(20)  NOT NULL DEFAULT '#6366f1',
  `role_id`      TINYINT UNSIGNED NOT NULL,
  `pw_hash`      VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX `idx_users_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Brands (one row per brand; counters can later be computed from content).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `brands` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(150) NOT NULL,
  `industry`    VARCHAR(100) NOT NULL DEFAULT '',
  `color`       VARCHAR(20)  NOT NULL DEFAULT '#0ea5e9',
  `tagline`     VARCHAR(255) NOT NULL DEFAULT '',
  `audience`    VARCHAR(255) NOT NULL DEFAULT '',
  `ideas`       INT NOT NULL DEFAULT 0,
  `drafts`      INT NOT NULL DEFAULT 0,
  `review`      INT NOT NULL DEFAULT 0,
  `scheduled`   INT NOT NULL DEFAULT 0,
  `posts_month` INT NOT NULL DEFAULT 0,
  `created_by`  VARCHAR(64) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_brands_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX `idx_brands_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Brand access map — THE core of the role-based structure.
-- A (user, brand) row grants that user access to the brand (and, through it,
-- to the brand's content). Users whose role has sees_all = 1 bypass this
-- table entirely. No application code reads this table yet.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `brand_members` (
  `brand_id`    INT UNSIGNED NOT NULL,
  `user_id`     VARCHAR(64)  NOT NULL,
  `member_role` ENUM('owner','editor','viewer') NOT NULL DEFAULT 'owner',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`brand_id`, `user_id`),
  CONSTRAINT `fk_members_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX `idx_members_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Brand satellites (previously nested arrays inside the brand JSON blob).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `brand_tones` (
  `brand_id` INT UNSIGNED NOT NULL,
  `tone`     VARCHAR(100) NOT NULL,
  PRIMARY KEY (`brand_id`, `tone`),
  CONSTRAINT `fk_tones_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `brand_pillars` (
  `id`       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `brand_id` INT UNSIGNED NOT NULL,
  `name`     VARCHAR(150) NOT NULL,
  `weight`   DECIMAL(5,2) NOT NULL DEFAULT 0,
  CONSTRAINT `fk_pillars_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX `idx_pillars_brand` (`brand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `brand_platforms` (
  `brand_id` INT UNSIGNED NOT NULL,
  `platform` VARCHAR(50)  NOT NULL,
  PRIMARY KEY (`brand_id`, `platform`),
  CONSTRAINT `fk_platforms_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `brand_channels` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `brand_id`    INT UNSIGNED NOT NULL,
  `platform_id` VARCHAR(50)  NOT NULL,
  `connected`   TINYINT(1)   NOT NULL DEFAULT 0,
  `config`      JSON         NOT NULL,
  CONSTRAINT `fk_channels_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY `uq_channels_brand_platform` (`brand_id`, `platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Content items. Access is inherited from the brand:
--   super admin            -> WHERE brand_id IN (SELECT id FROM brands)
--   business/client user   -> WHERE brand_id IN
--                             (SELECT brand_id FROM brand_members WHERE user_id = ?)
-- (Queries for later — not enforced yet.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_items` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `brand_id`        INT UNSIGNED NOT NULL,
  `campaign`        VARCHAR(200) NOT NULL DEFAULT '',
  `pillar`          VARCHAR(150) NOT NULL DEFAULT '',
  `platform`        VARCHAR(50)  NOT NULL DEFAULT '',
  `status`          ENUM('ai_generated','draft','review','approved','scheduled','published')
                    NOT NULL DEFAULT 'draft',
  `caption`         TEXT NULL,
  `hashtags`        VARCHAR(500) NOT NULL DEFAULT '',
  `scheduled_label` VARCHAR(100) NOT NULL DEFAULT '',
  `scheduled_at`    DATETIME NULL,
  `format`          VARCHAR(50)  NOT NULL DEFAULT '',
  `score`           TINYINT UNSIGNED NULL,
  `image_prompt`    TEXT NULL,
  `video_script`    TEXT NULL,
  `image_url`       VARCHAR(500) NULL,
  `video_url`       VARCHAR(500) NULL,
  `created_by`      VARCHAR(64) NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_content_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_content_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX `idx_content_brand` (`brand_id`),
  INDEX `idx_content_brand_status` (`brand_id`, `status`),
  INDEX `idx_content_platform` (`platform`),
  INDEX `idx_content_scheduled` (`scheduled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Global (non-brand) data: AI/image integrations, approval policy, app settings.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `integrations` (
  `provider`   VARCHAR(50) NOT NULL PRIMARY KEY,
  `connected`  TINYINT(1)  NOT NULL DEFAULT 0,
  `config`     JSON        NOT NULL,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_policy` (
  `content_type` VARCHAR(150) NOT NULL PRIMARY KEY,
  `level`        ENUM('auto','review','human') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `approval_policy` (`content_type`, `level`) VALUES
  ('General tips', 'auto'),
  ('Inspirational posts', 'auto'),
  ('Evergreen blogs', 'auto'),
  ('Product information', 'review'),
  ('Promotions', 'review'),
  ('Pricing', 'human'),
  ('Legal claims', 'human'),
  ('Sensitive topics', 'human');

CREATE TABLE IF NOT EXISTS `settings` (
  `scope_key`  VARCHAR(100) NOT NULL PRIMARY KEY,
  `value`      JSON         NOT NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Sessions: opaque bearer tokens for API auth (see api/auth.php).
-- Only the SHA-256 hash of the token is stored; the raw token is shown
-- to the client once at login/signup.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `token_hash` VARCHAR(64) NOT NULL PRIMARY KEY,
  `user_id`    VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX `idx_sessions_user` (`user_id`),
  INDEX `idx_sessions_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
