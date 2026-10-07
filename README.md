# Survey Rewards Site

A RewardXP-style **survey rewards (GPT) web app**: users sign up, complete surveys
from an offerwall, earn points, and redeem them. Built with **Node.js + Express +
SQLite (better-sqlite3) + EJS** — server-rendered, no frontend build step.

## Quick start (local)

```bash
npm install
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET (any long random string for dev)
npm start
```

Open http://localhost:3000. The SQLite database (`./data/app.db`) and all tables
are created automatically on first boot.

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `PORT` | No | `3000` | Port the app listens on (hosts set this for you). |
| `BASE_URL` | No | `http://localhost:PORT` | Public URL of the site, no trailing slash. Used for OAuth callback + absolute links. |
| `SESSION_SECRET` | **Yes in production** | (insecure dev fallback) | Signs session cookies. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The app refuses to boot in production without it. |
| `DB_PATH` | No | `./data/app.db` | SQLite file location. |
| `GOOGLE_CLIENT_ID` | For Google login | _(empty)_ | From Google Cloud Console (below). Empty = Google button shows a setup notice. |
| `GOOGLE_CLIENT_SECRET` | For Google login | _(empty)_ | From Google Cloud Console. **Never commit or share.** |
| `GOOGLE_CALLBACK_URL` | No | `BASE_URL + /auth/google/callback` | Must exactly match the redirect URI registered in Google Cloud Console. |
| `CPX_APP_ID` | For live offerwall | _(empty)_ | Your CPX Research publisher App ID. Empty = Earn page shows the setup guide. |
| `CPX_OFFERWALL_URL` | No | `https://offerwall.cpx-research.com` | Base offerwall URL from your CPX publisher dashboard. |
| `CPX_SECURE_KEY` | For postbacks | _(empty)_ | Shared secret used to verify CPX postback signatures. **Never commit or log.** |
| `POINTS_PER_USD` | No | `100` | Points per 1 USD — used for display (estimated USD value on Redeem page). |
| `SITE_NAME` | No | `SurveyRewards` | Brand name shown in the UI. |
| `NODE_ENV` | No | `development` | Set to `production` on your host. |

## Google Cloud Console — OAuth client (step by step)

"Sign in with Google" needs an OAuth 2.0 client tied to **your** Google account.
Takes ~10 minutes; you only do it once.

1. Go to https://console.cloud.google.com/ and sign in.
2. **Create a project**: top bar → project picker → *New Project* → name it (e.g. `survey-rewards`) → Create.
3. **OAuth consent screen**: left menu → *APIs & Services → OAuth consent screen*.
   - User type: **External** → Create.
   - Fill in: App name (your site name), User support email (yours), Developer contact email (yours).
   - **Authorized domains**: add your production domain (e.g. `example.com`). Skip for local testing.
   - Add scopes: `email`, `profile`, `openid` → Save. Add yourself as a test user while in testing mode.
   - **Important for approval**: add links to your live `/privacy` and `/terms` pages on the consent screen — Google requires them.
4. **Credentials**: left menu → *Credentials → Create Credentials → OAuth client ID*.
   - Application type: **Web application**. Name it (e.g. `survey-rewards-web`).
   - **Authorized redirect URIs** → *Add URI*: `https://YOUR-DOMAIN/auth/google/callback`
     (local testing: `http://localhost:3000/auth/google/callback`).
   - Create → copy the **Client ID** and **Client secret**.
5. Put them in `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   GOOGLE_CALLBACK_URL=https://YOUR-DOMAIN/auth/google/callback
   ```
6. Restart the app (`npm start`). The Google buttons on the signup/login pages
   now work. If the Google email matches an existing account, the accounts are
   **linked** automatically instead of creating a duplicate.

## CPX Research publisher setup (offerwall)

You don't build the survey inventory yourself — you embed CPX's offerwall as a
publisher and earn a revenue share.

1. **Sign up** at https://cpx-research.com as a **publisher** and get approved
   (they review your site; having Privacy/Terms pages helps).
2. In your CPX publisher dashboard, find your **App ID** and the **offerwall URL**.
   Set in `.env`:
   ```
   CPX_APP_ID=your-app-id
   CPX_OFFERWALL_URL=https://offerwall.cpx-research.com   # use exactly what CPX gives you
   ```
   Restart — the **Earn** page now renders the live iframe, passing each logged-in
   user's id as `user_id` so completions credit the right person.
3. **Postback URL** (this is how users get paid): in the CPX dashboard, set your
   postback/callback URL to:
   ```
   https://YOUR-DOMAIN/api/postback/cpx
   ```
   When a user finishes a survey, CPX calls this URL server-to-server with
   `user_id`, `amount_local` (points), `amount_usd`, `type` (Complete/Out/Bonus),
   `offer_id`, `subid`, `subid_2`, `ip_click`, and `secure_hash`.
4. **Signature verification**: copy the secure key into `.env` as `CPX_SECURE_KEY`.
   This app verifies every postback as:
   ```
   secure_hash == md5("user_id|amount_local|amount_usd|type|offer_id|subid|subid_2|ip_click|" + CPX_SECURE_KEY)
   ```
   using the raw query-string values and a timing-safe comparison. **The exact
   field order must match what CPX signs** — configure the same template in your
   CPX dashboard, or adjust the `payload` construction in `routes/postback.js`.
5. **How crediting works**: `type=Complete` (or `Bonus`) credits `amount_local`
   points to the user's ledger (`reason: cpx_postback`). `type=Out`
   (screened out) earns nothing. Each credit carries a unique `ref_key`
   (`cpx:user_id:offer_id:type:amount`), so if CPX retries a postback, the
   duplicate is acknowledged but **not double-credited**.
6. Use CPX's **design settings** to match the wall's colors to your brand, and run
   a test completion before going live.

Alternatives with the same pattern: **BitLabs**, **TheoremReach**.

## Deploy notes

**Render / Railway (easiest):**
- Push this folder to a Git repo, create a Web Service, build command `npm install`,
  start command `npm start`, set `NODE_ENV=production` and all env vars in the
  dashboard (never commit `.env`).
- **SQLite persistence:** the default `./data/app.db` lives on the container's
  ephemeral disk and **will be wiped on redeploys**. Attach a persistent disk and
  set `DB_PATH` to a path on it (e.g. `/data/app.db` on Render).
- **Follow-up:** for a serious production site, migrate to Postgres — set a
  `DATABASE_URL` and swap the `better-sqlite3` calls for `pg`. The schema and
  queries are deliberately simple to port.

**VPS (e.g. Ubuntu):**
- Install Node 18+, clone, `npm install --omit=dev`, create `.env`, run behind
  nginx/Caddy with HTTPS (required: session cookies are `secure` in production),
  and keep it alive with `pm2` or systemd. SQLite file persists on the VPS disk.

## Go-live checklist

- [ ] `SESSION_SECRET` set to a long random value; `NODE_ENV=production`
- [ ] `BASE_URL` set to your real `https://` domain
- [ ] Google OAuth client created; redirect URI matches `GOOGLE_CALLBACK_URL`; consent screen has Privacy/Terms links
- [ ] `[BRACKETS]` in `/privacy` and `/terms` replaced (site name, URL, contact email, date)
- [ ] CPX publisher approved; `CPX_APP_ID`, `CPX_OFFERWALL_URL`, `CPX_SECURE_KEY` set
- [ ] Postback URL registered in CPX dashboard; test completion credits points once (and a replay is ignored)
- [ ] Persistent disk attached for SQLite (or Postgres migration done)
- [ ] HTTPS enabled; test signup → earn → redeem flow end-to-end

## Project layout

```
server.js              Express boot (helmet, sessions, passport, routes)
config.js              Env loading + validation (all secrets from env)
db.js                  SQLite schema + prepared statements + atomic creditPoints()
lib/passport.js        Session serialization + Google OAuth strategy (optional)
middleware/requireLogin.js
routes/auth.js         Signup/login/logout + Google OAuth (rate-limited)
routes/pages.js        Landing, dashboard, earn, redeem, privacy, terms
routes/postback.js     GET /api/postback/cpx — verified, idempotent crediting
views/                 EJS templates (partials/header.ejs holds all CSS)
public/                Static assets (empty — add logos here)
```
