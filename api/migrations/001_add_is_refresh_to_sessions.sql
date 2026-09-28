-- Migration: Add is_refresh column to sessions for token rotation support
-- Run: mysql -u root contentos < api/migrations/001_add_is_refresh_to_sessions.sql

ALTER TABLE `sessions` 
  ADD COLUMN `is_refresh` TINYINT(1) NOT NULL DEFAULT 0 AFTER `expires_at`,
  ADD INDEX `idx_sessions_is_refresh` (`is_refresh`, `expires_at`);