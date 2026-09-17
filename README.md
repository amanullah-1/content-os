# ContentOS

ContentOS is a multi-brand content operations app (brands, content pipeline, calendar, publishing integrations, analytics, team access control) built with **React 19 + Vite 8 + Tailwind CSS v4 + TypeScript** and a **PHP 8 + MySQL 8** backend.

This guide takes you from `git clone` to running the app in your browser and developing further.

**Local stack at a glance**

| Layer | What | Default address |
|-------|------|-----------------|
| Frontend | Vite dev server | `http://localhost:8443` |
| Backend API | PHP under Laragon Apache | `http://localhost/ContentOS/api/*.php` |
| Database | MySQL 8 (`contentos`) | `localhost:3306` via named pipe (`localhost`, not `127.0.0.1` — see §4) |

The frontend talks to the PHP API for auth, brands, content, and team management (`VITE_KV_BASE_URL`), and to the PHP publish proxy for social posting (`VITE_PUBLISH_PROXY_URL`). Supabase remains only as an offline fallback default — no Supabase account is needed for local work.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Git | any recent | to clone the repo |
| Node.js | **22** (see `.mise.toml`) | check with `node --version` |
| Package manager | **pnpm 10.34.3** (preferred, see `.mise.toml`) or npm (comes with Node) | check with `pnpm --version` / `npm --version` |
| Laragon (Windows) | full edition | provides Apache + MySQL 8 + PHP 8.3 (PHP needs the `curl` extension — enabled by default) |
| MySQL + PHP | 8.x | only if not using Laragon — any Apache/Nginx + PHP 8 + MySQL 8 host works |

If you use [mise](https://mise.jdx.dev/), the correct toolchain installs automatically:

```bash
mise install
```

Otherwise just make sure Node 22 is active (via nvm/fnm/nvs or the nodejs.org installer).

---

## 2. Clone and install

```bash
git clone https://github.com/amanullah-1/content-os.git
cd content-os
```

Using pnpm (recommended — a `pnpm-lock.yaml` is committed):

```bash
pnpm install
```

Or with npm (a `package-lock.json` is also committed):

```bash
npm install
```

---

## 3. Configure environment

Copy the example env file:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Then edit `.env`:

| Variable | Required? | What it does |
|----------|-----------|--------------|
| `VITE_KV_BASE_URL` | **Yes (local)** | Base URL of the PHP API, e.g. `http://localhost/ContentOS/api`. Takes precedence over the Supabase fallback. |
| `VITE_PUBLISH_PROXY_URL` | **Yes (local)** | Publish proxy, e.g. `http://localhost/ContentOS/api/publish.php`. Takes precedence over the Supabase fallback. |
| `VITE_SUPABASE_BASE_URL` | No | Fallback KV-sync URL, used only when `VITE_KV_BASE_URL` is empty. |
| `VITE_SUPABASE_PROXY_URL` | No | Fallback publish-proxy URL, used only when `VITE_PUBLISH_PROXY_URL` is empty. |
| `VITE_MASTER_EMAIL` | No | Seed admin email for fresh installs. Defaults to `admin@contentos.app` if empty. |
| `VITE_MASTER_PASSWORD` | No | Seed admin password. If empty, a random password is generated on first run (you'll be locked out — set an explicit one for local dev). |
| `VITE_GOOGLE_CLIENT_ID` | No | Enables Google Sign-In. Leave empty to disable it. |

> `.env*` files are git-ignored — never commit secrets. Vite only reads `.env` at startup, so restart `pnpm dev` after changing it (`VITE_*` vars are also baked in at `pnpm build` time).

---

## 4. Set up the database

1. Start Laragon (**Start All**) so Apache + MySQL are running.
2. Create the schema (run from the repo root — uses Laragon defaults `root` / empty password):

```powershell
& "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe" -u root -e "SOURCE api/schema.sql; SOURCE api/schema_relational.sql;"
```

This creates the `contentos` database with:

* `kv_store` — legacy key-value sync (integrations + settings still live here).
* Relational tables — `roles`, `users`, `sessions`, `brands`, `brand_members`, `brand_tones`, `brand_pillars`, `brand_platforms`, `brand_channels`, `content_items`, `integrations`, `approval_policy`, `settings`, plus reference seeds (8 roles, 8 approval-policy rules).

If PHP can't reach MySQL with different credentials, edit `api/config.php` (defaults: host `localhost`, db `contentos`, user `root`, empty password) or set the `CONTENTOS_DB_HOST/PORT/NAME/USER/PASS` environment variables.

> **Use `localhost`, not `127.0.0.1`, as the DB host on this machine.** Port `127.0.0.1:3306` is intercepted by WSL port-forwarding (a MariaDB inside WSL rejects the login); `localhost` reaches Laragon's MySQL 8.4 through the Windows named pipe. `api/config.php` already defaults to `localhost`.

3. **Migrating existing KV data?** If `kv_store` already holds `contentOS:*` blobs (from the old Supabase-synced app), shred them into the relational tables:

```powershell
php api/migrate_kv.php
# re-run from scratch (wipes relational data, never touches kv_store):
php api/migrate_kv.php --force
```

The migration is one transaction (all-or-nothing): users keep their ids and password hashes, brands keep their numeric ids, every non-super user is granted owner access to every brand (so nobody loses visibility they had), and content is matched to brands by name (unknown names abort the run with a list).

4. **First login:** `admin@contentos.app` / the password in `VITE_MASTER_PASSWORD` (`ChangeMe123!` in the example). Change it afterwards via Profile → Password. On a truly fresh database the master account is auto-seeded from `CONTENTOS_MASTER_EMAIL` / `CONTENTOS_MASTER_PASSWORD` (same defaults).

---

## 5. Run the dev server

```bash
pnpm dev
# or
npm run dev
```

This runs `vite --host 0.0.0.0`. Open the app at:

- **http://localhost:8443** (default port)

The port comes from the `PORT` environment variable (see `vite.config.ts`):

```bash
# Run on a different port
PORT=3000 pnpm dev
```

```powershell
# Windows PowerShell, different port
$env:PORT=3000; pnpm dev
```

Before logging in, sanity-check the API (Apache must be running):

- `http://localhost/ContentOS/api/kv.php?key=contentOS:ping` → `{"value":null}` (KV store reachable)
- `http://localhost/ContentOS/api/publish.php` → `{"ok":true,"platforms":[...]}` (publish proxy reachable)

Features of dev mode:

- Hot reload — edits to `src/**` refresh instantly.
- Changes under `**/.figma/**` are ignored by the file watcher.
- The `@` alias maps to `src/` (e.g. `import x from "@/db"`).

First-run behaviour: log in (server auth issues a 30-day token stored in `localStorage`). If the database has no brands yet, your local seeds are pushed into the API automatically and you become their owner. If Apache/MySQL is down, the app falls back to the legacy local + KV behaviour.

---

## 6. Available scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` / `npm run dev` | Start the Vite dev server (port `8443` by default) |
| `pnpm build` / `npm run build` | Production build into `dist/` |
| `pnpm preview` / `npm run preview` | Serve the production `dist/` build locally (same port logic) |
| `pnpm test` / `npm test` | Run tests once with Vitest (`src/**/*.test.{ts,tsx}`, jsdom) |
| `pnpm test:watch` / `npm run test:watch` | Run Vitest in watch mode |
| `pnpm format` / `npm run format` | Format code with `oxfmt` |
| `php api/migrate_kv.php [--force]` | Migrate KV blobs to relational tables (see §4) |

Typical production check:

```bash
pnpm build
pnpm preview
# then open http://localhost:8443
```

---

## 7. Project structure

```
index.html            # Vite HTML shell (mounts #root, loads src/main.tsx)
vite.config.ts        # Vite + React + Tailwind plugins, @ alias, PORT handling
vitest.config.ts      # Vitest config (jsdom, @ alias, src/**/*.test.*)
tsconfig.json         # TypeScript (bundler resolution, @/* paths, react-jsx)
.mise.toml            # Pinned toolchain: Node 22, pnpm 10.34.3
.env.example          # Template for local env vars

api/                  # Local PHP backend (served by Laragon Apache)
  config.php          # DB credentials (Laragon defaults; CONTENTOS_DB_* overrides)
  bootstrap.php       # Shared PDO, CORS, token auth, brand-access scoping
  auth.php            # Login/signup/Google/logout/me/password/profile (token = 30 days)
  brands.php          # Brand CRUD, scoped by membership (creator becomes owner)
  content.php         # Content CRUD + ?brand_id&status&platform filters, scoped
  members.php         # Super-admin-only team management (grant/revoke/set-role)
  kv.php              # Legacy KV store (GET/POST/DELETE /kv/:key) — integrations/settings
  publish.php         # Social publish proxy (Facebook, Instagram, LinkedIn, TikTok, Dev.to, WooCommerce)
  migrate_kv.php      # CLI: shred kv_store blobs into relational tables
  schema.sql          # kv_store table
  schema_relational.sql  # Full relational model + seeds

src/
  main.tsx            # React entrypoint — imports index.css, mounts App.tsx
  App.tsx             # Primary application component (start UI work here)
  api.ts              # Typed client for the PHP backend (token in localStorage)
  index.css           # Global CSS + Tailwind v4 import (@import 'tailwindcss')
  db.ts               # Legacy KV persistence helpers (fallback path)
  types.ts
  auth/ hooks/ utils/ components/ config/ imports/  # feature modules

supabase/functions/   # Original Deno Edge Functions (reference only — not used locally)
  server/             # KV-sync function superseded by api/kv.php + relational APIs
  social-proxy/       # Publish function ported to api/publish.php
```

Key conventions:

- **Styling:** Tailwind CSS v4 via the `@tailwindcss/vite` plugin. Use utility classes in JSX; put global CSS / theme customization in `src/index.css`. No `tailwind.config.js` or PostCSS config needed.
- **Imports:** use `@/...` for anything under `src/` (configured in both `vite.config.ts` and `tsconfig.json`).
- **JSX strings with apostrophes:** use double quotes (`"We're here"`) or escape them — an unescaped apostrophe in a single-quoted string breaks the build.
- **Components:** export as default exports.
- **Tests:** colocate as `src/**/*.test.{ts,tsx}`; run with `pnpm test`.
- **Backend:** keep `api/*.php` framework-free PDO + cURL; shared logic belongs in `api/bootstrap.php`. Never expose `pw_hash` or raw tokens in responses (only SHA-256 hashes are stored).

---

## 8. Roles & access model

| Role | Sees |
|------|------|
| **Super Admin** (`roles.sees_all = 1`) | Everything — all brands and all content, no membership rows needed |
| Admin, Brand/Content Manager, Editor, **Business**, **Client**, Viewer (`sees_all = 0`) | Only brands listed for them in `brand_members` (content inherits access via its brand) |

Rules enforced in `api/bootstrap.php` + each endpoint:

- New signups become `business` with zero memberships (a master grants access via **Team** view).
- Creating a brand makes the creator its `owner` member automatically.
- Brand deletion requires `owner` membership or super admin; role changes require super admin (a super admin can't demote themselves).
- The `member_role` values (`owner`/`editor`/`viewer`) are stored for future fine-grained rights; today any membership grants full access to that brand.

---

## 9. Developing further

1. Start Laragon (Apache + MySQL) and the dev server (`pnpm dev`), keep both running.
2. Edit `src/App.tsx` — the page hot-reloads.
3. Add components under `src/components/`, logic under `src/utils/` or `src/hooks/`, import with the `@/` alias.
4. API work: add endpoints under `api/` reusing `bootstrap.php` (`require_auth()`, `visible_brand_ids()`, `can_access_brand()`), expose them through `src/api.ts`, and verify with `php -l` plus a live `Invoke-WebRequest` round-trip.
5. Add global styles / fonts in `src/index.css` (keep `@import` statements first).
6. Site metadata (title, description, icons) lives in `.figma/make/site.json` and is applied by the `figmaSiteConfiguration` plugin in `vite.config.ts`.
7. Run `npx tsc --noEmit`, `pnpm test` and `pnpm build` before pushing to catch regressions and type/build errors.

> The `supabase/functions/` directory holds the original Edge Functions the frontend used to talk to. They are reference only now — `api/kv.php` + `api/publish.php` are their local replacements, and users/brands/content have moved to the relational model. You only need the Supabase CLI / project if you intend to revive the hosted variant.

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Port 8443 is already in use` / `strictPort` error | Stop the other process, or set `PORT` to a free port (see step 5). |
| Page is blank / `__vite...` errors | Delete `node_modules`, reinstall with the Node 22 toolchain, restart dev server. |
| API returns `{"error":"DB connection failed..."}` | Start MySQL in Laragon; check `api/config.php` credentials; keep host as `localhost` (§4). |
| Login fails after migrating to relational DB | Re-login — pre-migration browser sessions have no API token, which is what activates scoped access. |
| New user sees an empty app | Expected: signups start with zero memberships. As super admin, open **Team** and grant their brands. |
| `401 Not authenticated` from the API | Token missing/expired (30 days) — log in again. |
| `403` from the API | Your membership doesn't cover that brand (or the action needs super admin). |
| Migration aborts with unknown brands | Content rows reference brand names not present in `contentOS:brands` — fix the KV data, then re-run (nothing is committed on abort). |
| `google is not defined` / Sign-In button missing | `VITE_GOOGLE_CLIENT_ID` is empty — that disables Google Sign-In by design. |
| Env changes not picked up | Restart the dev server — Vite only reads `.env` at startup. `VITE_*` vars are also baked in at `pnpm build` time. |
| Wrong Node version | Match `.mise.toml` (Node 22): `mise install`, or switch your nvm/fnm version. |

---

## License

Private project. All rights reserved unless a `LICENSE` file states otherwise.
