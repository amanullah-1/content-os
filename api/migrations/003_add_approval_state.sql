-- Multi-stage approval workflow: per-item stage index + approval log (history + comments).
ALTER TABLE `content_items`
  ADD COLUMN `approval_state` JSON NULL COMMENT 'Multi-stage approval state: {"stage":int,"log":[...]}'
  AFTER `status`;