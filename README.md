# Manual Health Logger

A manual workout logger that runs entirely on Vercel and syncs entries to your
Google account via the **Google Health API**.

---

## 1. Why the Google Health API, not Google Fit or Health Connect

**Google Fit APIs are being shut down.** Sign-ups closed May 1, 2024; the
legacy Fitbit Web API (which Fit depended on) loses support September 30,
2026 and is fully turned off October 30, 2026. Building on it today would
mean shipping something dead in weeks.

**Health Connect cannot be used here.** Health Connect is an **on-device**
Android data store (a local, encrypted SQLite-backed repository with an
Android SDK). It has no cloud/REST endpoint. A serverless web app on Vercel
has no way to reach it directly — only a native Android app on the phone can
read or write Health Connect. Any claim that a pure web backend can "write to
Health Connect" is incorrect; that's the limitation your brief anticipated,
and it's real.

**The Google Health API is the correct, currently-supported choice.** Google
launched it in March 2026 as the official next generation of the Fitbit Web
API, explicitly positioned as the cloud/account-level counterpart to
Health Connect (which stays mobile-only). It is:
- A plain **cloud REST API** (`https://health.googleapis.com/v4/...`) —
  reachable from any server, including a Vercel API route.
- Authenticated with standard **OAuth 2.0** (authorization code + refresh
  tokens), the same pattern as every other Google API.
- Able to **write workout/exercise data** via the `exercise` data type:
  `POST /v4/users/me/dataTypes/exercise/dataPoints`.

So the architecture is exactly the simple one, no Android bridge needed:

```
Vercel Web App (Next.js)
        ↓
Server-side API route (/api/workouts)
        ↓
Google Health API (health.googleapis.com)
```

One caveat worth knowing: supporting more than 100 users with sensitive
Google Health scopes requires a third-party security review from Google.
This app is built for **your own single Google account** — one user — so
that review does not apply to you. If you ever wanted to offer this to
other people, you'd need to go through Google's verification process first.

---

## 2. What gets created in Google Health

Each saved workout is written as one **Exercise session data point**
containing: activity type, start/end time, distance (meters), calories, and
a short note. Once synced, it shows up in the Google Health ecosystem
wherever exercise-session data from any source (Fitbit, Health Connect,
other synced apps) is surfaced for that account — i.e. alongside your other
logged or synced workouts, not in a separate "manual logger" silo. Exactly
which first-party Google surface renders it depends on Google's own app
rollout (the Google Health app is replacing the old Fit app through 2026);
the data itself lands correctly as soon as the API call succeeds, which you
can verify immediately via the API (see Test Procedure below) even before
checking any Google-owned app's UI.

---

## 3. Stack

- Next.js 14 (App Router) + TypeScript + React
- Tailwind CSS
- Postgres (Vercel Postgres, Neon, or Supabase — any standard Postgres works)
- Server-side API routes for OAuth + Google Health API calls
- `pg` for direct SQL (no ORM, to keep the schema and queries fully visible)

---

## 4. Google Cloud Console setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create (or select) a project.
2. **APIs & Services → Library** → search **"Google Health API"** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have a Workspace org to use Internal).
   - Add yourself as a **Test user** (while the app is unverified, only test
     users can complete the consent flow — that's fine for a personal tool).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI:
     - Local dev: `http://localhost:3000/api/auth/google/callback`
     - Production: `https://your-app-name.vercel.app/api/auth/google/callback`
   - Save the **Client ID** and **Client Secret**.
5. Back on the OAuth consent screen, **Add or remove scopes** → search
   "Google Health API" → select the **activity_and_fitness (write-only)**
   scope. (The app requests this scope itself at login time; adding it here
   just lets Google show it on the consent screen.)

---

## 5. Environment variables

Copy `.env.example` to `.env.local` (for local dev) and fill in:

| Variable | How to get it |
|---|---|
| `POSTGRES_URL` | From your Postgres provider (e.g. Vercel Postgres → `.env.local` tab) |
| `APP_BASE_URL` | `http://localhost:3000` locally, your Vercel URL in production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 4 above |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (must decode to 32 bytes — this command does that) |

**Never commit `.env.local`.** Client secrets and refresh tokens are only
ever used/stored server-side (encrypted in Postgres); the browser never sees
them.

---

## 6. Database setup

Run the schema once against your Postgres database:

```bash
psql "$POSTGRES_URL" -f schema.sql
```

(If your provider doesn't auto-enable `pgcrypto`/`gen_random_uuid()`, uncomment
the `CREATE EXTENSION` line at the bottom of `schema.sql` and run it first —
Vercel Postgres and Neon have it available already.)

---

## 7. Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, click **Connect**, complete Google sign-in,
then **+ Add Workout**.

---

## 8. Deploying to Vercel

1. Push this project to a GitHub repo.
2. In Vercel: **New Project** → import the repo.
3. Add all the environment variables from step 5 in **Project Settings →
   Environment Variables** (use your production `APP_BASE_URL` and a
   production Postgres URL).
4. Deploy.
5. Go back to Google Cloud Console → your OAuth client → add the production
   redirect URI (`https://<your-vercel-domain>/api/auth/google/callback`) if
   you haven't already.
6. Visit your deployed URL and connect your Google account.

---

## 9. Test procedure: log a 10 km run

1. Open the app, confirm the banner reads **"Google Account: connected ✓ ·
   Health API: connected ✓"** (connect first if not).
2. Click **+ Add Workout**.
3. Fill in:
   - Activity: **Running**
   - Distance: **10** km
   - Duration: **60** minutes
   - Date: today
   - Start time: e.g. **8:30 PM**
4. Click **Save**.
5. The new entry appears under **Recent Activity** with status **✓ Synced**
   and a Google record ID stored against it (visible in the `workouts` table
   `google_record_id` column, and surfaced in the UI as the synced badge).
6. If it instead shows **✕ Failed**, click **Retry sync** — the error message
   underneath tells you why (expired token → reconnect; permission error →
   re-check the consent scope in step 4 above).
7. Submit the exact same workout a second time: the idempotency key matches,
   so the API returns the existing record instead of creating a duplicate
   (`duplicate: true` in the response, no new row, no second Google write).

---

## 10. Project structure

```
app/
  page.tsx                          Home page (client component)
  layout.tsx, globals.css
  components/WorkoutForm.tsx        Add Workout form
  components/WorkoutRow.tsx         History row with status badge + retry
  api/auth/google/route.ts          Starts Google OAuth
  api/auth/google/callback/route.ts Handles OAuth callback, stores tokens
  api/auth/status/route.ts          Reports connection status to the UI
  api/workouts/route.ts             List + create workouts, triggers sync
  api/workouts/[id]/sync/route.ts   Manual retry-sync endpoint
lib/
  db.ts            Postgres connection pool
  crypto.ts         AES-256-GCM encryption for tokens at rest
  session.ts        Signed session cookie (no secrets inside it)
  googleHealth.ts    OAuth + Google Health API client (the core integration)
  workouts.ts        Shared types, idempotency key, activity type list
schema.sql           Database schema
```

## 11. Adding more metric types later

The `workouts` table and `writeExerciseSession` function are intentionally
narrow (exercise sessions only) but structured so you can add a new table +
a new `lib/googleHealth.ts` write function per Google Health data type (e.g.
`sleep`, `heart-rate`, `hydration-log`) without touching existing code —
each data type has its own endpoint under
`/v4/users/me/dataTypes/<type>/dataPoints`.

## 12. Receiving data from HC Webhook (mcnaveen/health-connect-webhook)

The [HC Webhook](https://github.com/mcnaveen/health-connect-webhook) Android app
reads Health Connect and POSTs JSON to a URL you choose. This app exposes
`POST /api/webhook/health` for it:

1. Set `WEBHOOK_SECRET` (`openssl rand -hex 32`) in your env / Vercel settings
   and re-run `npm run db:init` (adds `health_samples` + `workouts.source`).
2. In HC Webhook add webhook URL `https://<your-app>/api/webhook/health` and a
   custom header `Authorization: Bearer <WEBHOOK_SECRET>`.
3. `exercise` records become workouts (deduplicated, then synced to Google
   Health). Other types (steps, heart rate, sleep, ...) are stored in
   `health_samples`.

Test:
```bash
curl -X POST "$APP_BASE_URL/api/webhook/health" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"timestamp":"2026-10-05T15:00:00Z","exercise":[{"type":"RUNNING","start_time":"2026-10-05T14:30:00Z","end_time":"2026-10-05T15:30:00Z","duration_seconds":3600,"distance_meters":10000}]}'
```
