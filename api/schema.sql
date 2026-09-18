-- ContentOS local MySQL schema (Laragon).
-- Run once: mysql -u root < api/schema.sql
-- Or import via HeidiSQL / phpMyAdmin.

CREATE DATABASE IF NOT EXISTS `contentos`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `contentos`;

CREATE TABLE IF NOT EXISTS `kv_store` (
  `key` VARCHAR(255) NOT NULL PRIMARY KEY,
  `value` JSON NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
