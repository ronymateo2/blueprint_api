# blueprint_api — Claude Instructions

Cloudflare Worker REST API for the Blueprint habit tracker. Uses Hono + D1 (SQLite at edge). Deployed independently from the frontend.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Cloudflare Worker |
| Framework | Hono v4 |
| Database | Cloudflare D1 (SQLite) |
| Auth | Google OAuth 2.0 → native Web Crypto JWT |
| Language | TypeScript (ESM) |

## Dev Commands

```bash
npm run dev              # wrangler dev → http://localhost:8787
npm run deploy           # wrangler deploy → production

npm run db:migrate:local # apply migrations to local D1
npm run db:migrate:remote # apply migrations to remote D1
npm run cf-typegen       # regenerate worker-configuration.d.ts from wrangler.json
```

## Environment Variables

**Never commit secrets.** Local dev secrets live in `.dev.vars` (gitignored). Production secrets use `wrangler secret put`.

| Var | Where | Description |
|-----|-------|-------------|
| `GOOGLE_CLIENT_ID` | `.dev.vars` / secret | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `.dev.vars` / secret | Google OAuth client secret |
| `JWT_SECRET` | `.dev.vars` / secret | HMAC-SHA256 signing key |
| `ALLOWED_ORIGIN` | `wrangler.json` vars | Frontend URL for CORS |
| `APP_URL` | `wrangler.json` vars | Frontend base URL (redirect after OAuth) |

## File Structure

```
src/
  index.ts              # Hono app, CORS, route registration
  lib/
    id.ts               # newId() → UUID, nowIso() → ISO string
    jwt.ts              # signJwt / verifyJwt using native Web Crypto (no npm JWT lib)
  middleware/
    auth.ts             # authMiddleware: reads Bearer token, sets userId/userEmail in context
  routes/
    auth.ts             # GET /api/auth/google, /google/callback, GET/PATCH /api/auth/me
    habits.ts           # Full CRUD + archive/unarchive + nested reminders
    entries.ts          # GET/POST /api/entries, DELETE /api/entries/:id
    reminders.ts        # PUT/DELETE /api/reminders/:id
    stats.ts            # GET /api/stats (aggregated, timezone-aware)
migrations/
  0001_init.sql         # Full schema — users, oauth_accounts, habits, entries, reminders
```

## Auth Flow

```
Frontend → GET /api/auth/google
  → 302 to Google consent screen

Google → GET /api/auth/google/callback?code=...
  → exchange code → get user info from Google
  → upsert users + oauth_accounts in D1
  → signJwt({ sub: userId, email }) → 30-day JWT
  → 302 to APP_URL/auth/callback?token=<jwt>

Frontend → saves token to localStorage["habit_token"]
All API calls → Authorization: Bearer <token>
```

JWT is signed/verified with native `crypto.subtle` (HMAC-SHA256). No npm JWT lib — Workers runtime doesn't support Node crypto libraries.

## Database Schema (summary)

```
users           id, email, display_name, avatar_url, timezone, created_at, updated_at
oauth_accounts  id, user_id, provider, provider_id, email, created_at   ← UNIQUE(provider, provider_id)
habits          id, user_id, name, icon, type, goal, unit, points, sort_order, archived_at, ...
entries         id, user_id, habit_id, value, points, logged_at, note, created_at
reminders       id, habit_id, time (HH:MM), days (LMXJVSD), enabled
```

- `habits.type`: `count | time | yn | qty | at`
- `habits.archived_at`: NULL = active; set = archived (soft delete)
- `entries.value`: actual amount logged — can differ from `habit.goal`
- Multiple entries per day per habit allowed; sum = daily total
- `entries.logged_at`: always UTC ISO8601; "day" boundaries computed via `user.timezone`

## API Endpoints

```
GET    /api/auth/google
GET    /api/auth/google/callback
GET    /api/auth/me
PATCH  /api/auth/me                      { timezone?, display_name? }

GET    /api/habits                       ?archived=1 for archived
POST   /api/habits
GET    /api/habits/:id
PUT    /api/habits/:id
PATCH  /api/habits/:id/archive
PATCH  /api/habits/:id/unarchive
DELETE /api/habits/:id
GET    /api/habits/:id/reminders
POST   /api/habits/:id/reminders

GET    /api/entries                      ?from=&to=&habit_id=
POST   /api/entries                      { habit_id, value?, note?, logged_at? }
DELETE /api/entries/:id

PUT    /api/reminders/:id
DELETE /api/reminders/:id

GET    /api/stats                        totalPoints, todayPoints, streak, level, weeklyChart[7], heatmap[98]

GET    /api/health                       { ok, ts }
```

All routes except `/api/auth/*` and `/api/health` require `Authorization: Bearer <token>`.

## Patterns to Follow

- All routes use `authMiddleware` via `.use('*', authMiddleware)` at the top of each router
- User scoping: every query includes `WHERE user_id = ?` — never trust client-provided user IDs
- IDs: always use `newId()` (UUID v4); never auto-increment integers
- Timestamps: always use `nowIso()` → UTC ISO8601; timezone math done in stats via `Intl.DateTimeFormat`
- D1 queries: use `.bind()` — never interpolate user input into SQL strings
- Errors: return `c.json({ error: 'message' }, statusCode)` consistently

## Adding a New Route

1. Create `src/routes/myroute.ts` following existing pattern (Hono sub-app + authMiddleware)
2. Import and register in `src/index.ts`: `app.route('/api/myroute', myroute)`
3. Add types to `src/react-app/api/client.ts` in the frontend

## Adding a New Migration

```bash
# Create file: migrations/0002_description.sql
# Then apply:
npm run db:migrate:local   # local dev
npm run db:migrate:remote  # production (after deploy)
```

## CORS

Configured in `src/index.ts`. In dev, any `http://localhost:*` origin is allowed. In prod, only `ALLOWED_ORIGIN` is allowed. All requests require `Content-Type: application/json` and `Authorization` headers — these are declared in `allowHeaders`.
