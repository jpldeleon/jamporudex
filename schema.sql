-- ======================================================
-- JamporuDex — PostgreSQL Schema
-- Run with: psql -U postgres -d jamporudex -f schema.sql
-- ======================================================

CREATE TABLE IF NOT EXISTS media_entries (
    id           SERIAL PRIMARY KEY,
    mal_id       INT NOT NULL,
    title        VARCHAR(255) NOT NULL,
    media_type   VARCHAR(20) DEFAULT 'manga',
    cover_url    TEXT NOT NULL,
    rating       INT CHECK (rating >= 1 AND rating <= 10),
    progress     VARCHAR(100),
    status       VARCHAR(50) DEFAULT 'Reading',
    review       TEXT,
    synopsis     TEXT,
    date_added   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Helpful index for the default "recency" sort
CREATE INDEX IF NOT EXISTS idx_media_entries_date_added ON media_entries (date_added DESC);

-- Safe to re-run: adds the synopsis column for tables created before it
-- was part of the schema.
ALTER TABLE media_entries ADD COLUMN IF NOT EXISTS synopsis TEXT;