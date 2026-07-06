-- Migration: add scope + owner_id to ai_knowledge
-- Run once: psql $DATABASE_URL -f this_file.sql

ALTER TABLE ai_knowledge
  ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);

-- Existing rows are team-scoped (shared) — no data change needed
