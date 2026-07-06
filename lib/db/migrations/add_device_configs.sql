-- Migration: device configuration backup storage
-- Run: psql $DATABASE_URL -f add_device_configs.sql

CREATE TABLE IF NOT EXISTS device_configs (
  id            SERIAL PRIMARY KEY,
  switch_id     INTEGER REFERENCES network_switches(id) ON DELETE SET NULL,
  device_name   VARCHAR(200) NOT NULL,
  device_type   VARCHAR(50)  NOT NULL DEFAULT 'other',
  filename      VARCHAR(300) NOT NULL,
  content       TEXT         NOT NULL,
  notes         TEXT,
  size_bytes    INTEGER,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_configs_switch_id   ON device_configs(switch_id);
CREATE INDEX IF NOT EXISTS idx_device_configs_device_name ON device_configs(device_name);
CREATE INDEX IF NOT EXISTS idx_device_configs_device_type ON device_configs(device_type);
-- Full-text search index for config content
CREATE INDEX IF NOT EXISTS idx_device_configs_content_fts
  ON device_configs USING gin(to_tsvector('english', content));
