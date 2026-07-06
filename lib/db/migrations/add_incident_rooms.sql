-- Incident rooms: real-time group chat for outage response
-- Safe to re-run (IF NOT EXISTS throughout)

CREATE TABLE IF NOT EXISTS incident_rooms (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  severity     VARCHAR(20)  NOT NULL DEFAULT 'medium',
  status       VARCHAR(20)  NOT NULL DEFAULT 'open',
  created_by   INTEGER REFERENCES users(id),
  resolved_by  INTEGER REFERENCES users(id),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incident_messages (
  id           SERIAL PRIMARY KEY,
  room_id      INTEGER NOT NULL REFERENCES incident_rooms(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id),
  author_name  VARCHAR(255) NOT NULL,
  is_fred      BOOLEAN NOT NULL DEFAULT FALSE,
  content      TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_messages_room ON incident_messages(room_id, created_at);

CREATE TABLE IF NOT EXISTS incident_members (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES incident_rooms(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  joined_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);
