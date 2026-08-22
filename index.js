/**
 * ======================================================================
 * JamporuDex (ジャンポルデックス) — index.js
 * ----------------------------------------------------------------------
 * Express server responsible for:
 *   1. Serving the EJS front-end
 *   2. Talking to PostgreSQL (via `pg`) for CRUD on `media_entries`
 *   3. Proxying searches to the Jikan API (MyAnimeList v4) via Axios,
 *      with an automatic fallback to the AniList GraphQL API if Jikan
 *      is unreachable, so the client never has to call a third-party
 *      API directly (avoids CORS issues and keeps the client simple).
 * ======================================================================
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// View engine + static assets
// ----------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------
// Body parsing (form posts + JSON from fetch())
// ----------------------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ----------------------------------------------------------------------
// PostgreSQL connection pool
// Uses standard PG* environment variables (PGUSER, PGPASSWORD, PGHOST,
// PGPORT, PGDATABASE) which `pg` picks up automatically, but we pass
// them explicitly here so the intent is clear and .env is respected.
// ----------------------------------------------------------------------
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Ensure the table exists on boot (safe no-op if it already does), and
// patch in any columns added after the table was first created — plain
// `CREATE TABLE IF NOT EXISTS` does NOT add new columns to an existing
// table, so without this, schema changes (like adding `synopsis`) would
// silently fail to apply for anyone who already has the table.
async function ensureSchema() {
  await pool.query(`
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
  `);

  // Backfill columns for tables created before they existed in the schema.
  await pool.query(`ALTER TABLE media_entries ADD COLUMN IF NOT EXISTS synopsis TEXT;`);
}

// ----------------------------------------------------------------------
// Jikan API helper
// ----------------------------------------------------------------------
const JIKAN_BASE_URL = process.env.JIKAN_BASE_URL || 'https://api.jikan.moe/v4';

/**
 * Search Jikan for anime or manga by title.
 * Includes automatic retry with backoff, since Jikan (a free, community-run
 * API) intermittently throws 502/503/504 errors that usually succeed on
 * a quick retry rather than indicating a real outage.
 * @param {string} title
 * @param {'anime'|'manga'} mediaType
 * @param {number} limit
 */
async function searchJikan(title, mediaType, limit = 6) {
  const type = mediaType === 'anime' ? 'anime' : 'manga';
  const url = `${JIKAN_BASE_URL}/${type}?q=${encodeURIComponent(title)}&limit=${limit}`;

  const MAX_ATTEMPTS = 3;
  const RETRYABLE_STATUSES = [502, 503, 504];
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      return (data.data || []).map((item) => ({
        mal_id: item.mal_id,
        title: item.title,
        image_url:
          item.images?.webp?.large_image_url ||
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url ||
          '',
        synopsis: item.synopsis || 'No synopsis available.',
        type,
      }));
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const isRetryable = RETRYABLE_STATUSES.includes(status) || err.code === 'ECONNABORTED';

      if (!isRetryable || attempt === MAX_ATTEMPTS) break;

      console.warn(`Jikan request failed (status ${status || err.code}), retrying attempt ${attempt + 1}/${MAX_ATTEMPTS}...`);
      // Exponential backoff: 400ms, 800ms, ...
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }

  throw lastErr;
}

// ----------------------------------------------------------------------
// AniList API fallback
// AniList's GraphQL API is generally far more stable than Jikan, and
// covers essentially the same anime/manga catalog. We only reach for it
// when Jikan has exhausted its retries — Jikan stays the primary source
// since it maps cleanly onto MyAnimeList IDs, which is what this app's
// schema is built around.
// ----------------------------------------------------------------------
const ANILIST_URL = 'https://graphql.anilist.co';

const ANILIST_SEARCH_QUERY = `
  query ($search: String, $type: MediaType, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(search: $search, type: $type, sort: SEARCH_MATCH) {
        id
        idMal
        title { romaji english }
        description(asHtml: false)
        coverImage { extraLarge large }
      }
    }
  }
`;

function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Search AniList for anime or manga by title. Used as a fallback when
 * Jikan is unreachable.
 * @param {string} title
 * @param {'anime'|'manga'} mediaType
 * @param {number} limit
 */
async function searchAniList(title, mediaType, limit = 6) {
  const type = mediaType === 'anime' ? 'ANIME' : 'MANGA';

  const { data } = await axios.post(
    ANILIST_URL,
    {
      query: ANILIST_SEARCH_QUERY,
      variables: { search: title, type, perPage: limit },
    },
    { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
  );

  const mediaList = data?.data?.Page?.media || [];

  return mediaList.map((item) => ({
    // Prefer the MyAnimeList-equivalent ID (idMal) so entries stay
    // consistent with Jikan-sourced ones; fall back to AniList's own
    // id for the rare title that has no MAL counterpart.
    mal_id: item.idMal || item.id,
    title: item.title?.english || item.title?.romaji || 'Untitled',
    image_url: item.coverImage?.extraLarge || item.coverImage?.large || '',
    synopsis: stripHtml(item.description) || 'No synopsis available.',
    type: mediaType === 'anime' ? 'anime' : 'manga',
  }));
}

/**
 * Search across providers: Jikan first (with its own retries), then
 * AniList as a fallback if Jikan is still down after retrying.
 * @param {string} title
 * @param {'anime'|'manga'} mediaType
 */
async function searchMedia(title, mediaType) {
  try {
    const results = await searchJikan(title, mediaType);
    return { results, source: 'jikan' };
  } catch (jikanErr) {
    console.warn('Jikan exhausted retries, falling back to AniList:', jikanErr.message);
    try {
      const results = await searchAniList(title, mediaType);
      return { results, source: 'anilist' };
    } catch (aniListErr) {
      console.error('AniList fallback also failed:', aniListErr.message);
      // Surface the original Jikan error, since it's the primary source
      // and usually has the more specific status code / message.
      throw jikanErr;
    }
  }
}

// ----------------------------------------------------------------------
// Sorting whitelist — never interpolate raw query params into SQL.
// ----------------------------------------------------------------------
const SORT_COLUMNS = {
  rating: 'rating DESC NULLS LAST',
  title: 'title ASC',
  recency: 'date_added DESC',
};

// ======================================================================
// ROUTES
// ======================================================================

/**
 * [R] READ — main page.
 * Supports ?sort=rating|title|recency and ?filter=<status> query params.
 */
app.get('/', async (req, res) => {
  try {
    const sortKey = SORT_COLUMNS[req.query.sort] ? req.query.sort : 'recency';
    const orderBy = SORT_COLUMNS[sortKey];
    const statusFilter = req.query.filter;

    let query = 'SELECT * FROM media_entries';
    const params = [];

    if (statusFilter && statusFilter !== 'All') {
      params.push(statusFilter);
      query += ` WHERE status = $${params.length}`;
    }

    query += ` ORDER BY ${orderBy}`;

    const { rows } = await pool.query(query, params);

    res.render('index', {
      entries: rows,
      currentSort: sortKey,
      currentFilter: statusFilter || 'All',
    });
  } catch (err) {
    console.error('Error loading entries:', err);
    res.status(500).send('Something went wrong loading your index. Check server logs.');
  }
});

/**
 * Jikan search proxy — used by the "Add Entry" modal to let the user
 * pick the correct title/cover before saving it to the database.
 * GET /api/jikan-search?title=...&type=anime|manga
 */
app.get('/api/jikan-search', async (req, res) => {
  const { title, type } = req.query;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'A title query is required.' });
  }
  try {
    const { results, source } = await searchMedia(title.trim(), type);
    res.json({ results, source });
  } catch (err) {
    // Log the full detail server-side so the real cause (rate limit,
    // DNS/network failure, Jikan downtime, etc.) is easy to diagnose —
    // the client only ever sees a friendly message.
    const status = err.response?.status;
    const jikanMessage = err.response?.data?.message;
    console.error('Search failed on all providers:', {
      status,
      jikanMessage,
      message: err.message,
    });

    if (status === 429) {
      return res.status(429).json({
        error: 'Jikan API rate limit hit — wait a few seconds and search again.',
      });
    }

    if (status === 504 || status === 502 || status === 503) {
      return res.status(502).json({
        error: 'Both Jikan and the AniList fallback are unreachable right now. Wait a moment and try again.',
      });
    }

    res.status(502).json({ error: 'Could not reach any anime/manga database right now. Try again shortly.' });
  }
});

/**
 * [C] CREATE — add a new entry.
 * Expects mal_id, title, media_type, cover_url, synopsis (from the
 * selected Jikan search result) plus user-entered status/progress/
 * rating/review.
 */
app.post('/entries', async (req, res) => {
  const {
    mal_id,
    title,
    media_type,
    cover_url,
    synopsis,
    status,
    progress,
    rating,
    review,
  } = req.body;

  if (!mal_id || !title || !cover_url) {
    return res.status(400).send('Missing required fields (mal_id, title, cover_url).');
  }

  try {
    await pool.query(
      `INSERT INTO media_entries
        (mal_id, title, media_type, cover_url, rating, progress, status, review, synopsis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        mal_id,
        title,
        media_type || 'manga',
        cover_url,
        rating ? parseInt(rating, 10) : null,
        progress || '',
        status || 'Reading',
        review || '',
        synopsis || '',
      ]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Error inserting entry:', err);
    res.status(500).send('Could not save this entry.');
  }
});

/**
 * [U] UPDATE — edit progress, status, rating, and review.
 * (Cover art / title / mal_id are left untouched on edit — re-adding
 * is how you'd correct a mis-matched Jikan result.)
 */
app.post('/entries/:id/update', async (req, res) => {
  const { id } = req.params;
  const { status, progress, rating, review } = req.body;

  try {
    await pool.query(
      `UPDATE media_entries
       SET status = $1, progress = $2, rating = $3, review = $4
       WHERE id = $5`,
      [
        status || 'Reading',
        progress || '',
        rating ? parseInt(rating, 10) : null,
        review || '',
        id,
      ]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Error updating entry:', err);
    res.status(500).send('Could not update this entry.');
  }
});

/**
 * [D] DELETE — remove an entry.
 */
app.post('/entries/:id/delete', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM media_entries WHERE id = $1', [id]);
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting entry:', err);
    res.status(500).send('Could not delete this entry.');
  }
});

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✨ JamporuDex running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });