# JamporuDex   git

A retro-modern personal anime & manga tracking index — Node.js + Express + PostgreSQL + EJS, with covers/synopses pulled live from the [Jikan API](https://jikan.moe/) (MyAnimeList v4), with [AniList API](https://anilist.co/api/v2) as a fallback.

## Features

- **Dual themes** — Rosé Pine (dark default) and Rosé Pine Moon, toggled from the floating dock and persisted via `LocalStorage`.
- **Centered, retro-anime card grid** with status badges, 1–10 star ratings, progress, and review excerpts.
- **Floating glass dock** (bottom-center, blurred/glowing) with Add Entry, Theme Toggle, and Scroll-to-Top.
- **Custom Lightbox** — click any cover to see the full synopsis, your review, progress, and Edit/Delete actions.
- **Full CRUD** against PostgreSQL, with cover art + metadata auto-fetched from Jikan when you add an entry.
- **Sorting & filtering** — by rating, title, or recency, and by status.

## Project structure

```
jamporudex/
├── index.js              # Express server, PG pool, Jikan integration, CRUD routes
├── schema.sql             # Database schema
├── package.json
├── .env.example
├── views/
│   └── index.ejs          # Main layout: grid, modals, lightbox, dock
└── public/
    ├── css/styles.css     # Rosé Pine / Rosé Pine Moon theme + all UI styling
    └── js/main.js          # Theme toggle, modal/lightbox logic, Jikan search
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create the database**
   ```bash
   createdb jamporudex
   psql -d jamporudex -f schema.sql
   ```
   (The server also runs a `CREATE TABLE IF NOT EXISTS` on boot, so this step is a convenience, not a hard requirement.)

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # then edit .env with your PostgreSQL credentials
   ```

4. **Run it**
   ```bash
   npm start        # or: npm run dev (with nodemon)
   ```
   Visit `http://localhost:3000`.

## How adding an entry works

1. Click **+ Add Entry** in the dock.
2. Pick Manga or Anime and search a title — this calls `GET /api/jikan-search`, which proxies to Jikan API server-side, falling back to AniList API if needed (avoids CORS, keeps your API usage centralized).
3. Click the correct result to auto-fill its ID, title, cover, and synopsis.
4. Fill in your status, progress, rating, and review, then save — this posts to `POST /entries`, which inserts the row into `media_entries`.

## API routes

| Method | Route                     | Purpose                                   |
|--------|----------------------------|--------------------------------------------|
| GET    | `/`                        | Render the index (supports `?sort=` & `?filter=`) |
| GET    | `/api/jikan-search`         | Proxy search to Jikan (`?title=&type=`)    |
| POST   | `/entries`                  | Create a new entry                         |
| POST   | `/entries/:id/update`       | Update status/progress/rating/review       |
| POST   | `/entries/:id/delete`       | Delete an entry                            |

## Notes

- **API fallback strategy**: The app defaults to Jikan API for searches. If Jikan is unavailable or rate-limited, it falls back to AniList API automatically.
  - **Jikan**: Free, unauthenticated, ~3 req/sec rate limit. Used as the primary source.
  - **AniList**: Free, unauthenticated GraphQL API. Used as fallback if Jikan fails.
- The `synopsis` column is stored per-entry at add-time (in addition to the columns from the original spec) so the Lightbox can show it without re-hitting the API on every page load.