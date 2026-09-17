# ContentOS

ContentOS is a multi-brand content operations app (brands, content pipeline, calendar, publishing integrations, analytics) built with **React 19 + Vite 8 + Tailwind CSS v4 + TypeScript**.

This guide takes you from `git clone` to running the app in your browser and developing further.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Git | any recent | to clone the repo |
| Node.js | **22** (see `.mise.toml`) | check with `node --version` |
| Package manager | **pnpm 10.34.3** (preferred, see `.mise.toml`) or npm (comes with Node) | check with `pnpm --version` / `npm --version` |

If you use [mise](https://mise.jdx.dev/), the correct toolchain installs automatically:

```bash
mise install
```

Otherwise just make sure Node 22 is active (via nvm/fnm/nvs or the nodejs.org installer).

---

## 2. Clone the repo

```bash
git clone https://github.com/amanullah-1/content-os.git
cd content-os
```

The default branch is `main`.

---

## 3. Install dependencies

Using pnpm (recommended — a `pnpm-lock.yaml` is committed):

```bash
pnpm install
```

Or with npm (a `package-lock.json` is also committed):

```bash
npm install
```

---

## 4. Configure environment (optional but recommended)

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
| `VITE_SUPABASE_BASE_URL` | No | URL of the Supabase Edge Function used for KV sync (`make-server-*`). Pre-filled with a default. |
| `VITE_SUPABASE_PROXY_URL` | No | URL of the social-platform proxy function. Pre-filled with a default. |
| `VITE_MASTER_EMAIL` | No | Seed admin email. Defaults to `admin@contentos.app` if empty. |
| `VITE_MASTER_PASSWORD` | No | Seed admin password. If empty, a random password is generated on first run. |
| `VITE_GOOGLE_CLIENT_ID` | No | Enables Google Sign-In. Leave empty to disable it. |

> The app runs without a `.env` file (all values have fallbacks), but cross-device sync, publishing, and Google login need real values. `.env*` files are git-ignored — never commit secrets.

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

Features of dev mode:

- Hot reload — edits to `src/**` refresh instantly.
- Changes under `**/.figma/**` are ignored by the file watcher.
- The `@` alias maps to `src/` (e.g. `import x from "@/db"`).

First-run sign-in: use the master email from step 4 (`admin@contentos.app` by default). If you left `VITE_MASTER_PASSWORD` empty, the seed uses a random password — set an explicit password in `.env` and restart if you need to log in locally.

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

src/
  main.tsx            # React entrypoint — imports index.css, mounts App.tsx
  App.tsx             # Primary application component (start UI work here)
  index.css           # Global CSS + Tailwind v4 import (@import 'tailwindcss')
  db.ts               # Local/remote persistence helpers
  types.ts
  auth/ hooks/ utils/ components/ config/ imports/  # feature modules

supabase/functions/
  server/             # KV-sync Edge Function (make-server-*)
  social-proxy/       # Social-platform proxy Edge Function
```

Key conventions:

- **Styling:** Tailwind CSS v4 via the `@tailwindcss/vite` plugin. Use utility classes in JSX; put global CSS / theme customization in `src/index.css`. No `tailwind.config.js` or PostCSS config needed.
- **Imports:** use `@/...` for anything under `src/` (configured in both `vite.config.ts` and `tsconfig.json`).
- **JSX strings with apostrophes:** use double quotes (`"We're here"`) or escape them — an unescaped apostrophe in a single-quoted string breaks the build.
- **Components:** export as default exports.
- **Tests:** colocate as `src/**/*.test.{ts,tsx}`; run with `pnpm test`.

---

## 8. Developing further

1. Start the dev server (`pnpm dev`) and keep it running.
2. Edit `src/App.tsx` — the page hot-reloads.
3. Add components under `src/components/`, logic under `src/utils/` or `src/hooks/`, import with the `@/` alias.
4. Add global styles / fonts in `src/index.css` (keep `@import` statements first).
5. Site metadata (title, description, icons) lives in `.figma/make/site.json` and is applied by the `figmaSiteConfiguration` plugin in `vite.config.ts`.
6. Run `pnpm test` and `pnpm build` before pushing to catch regressions and type/build errors.

### Supabase backend (optional)

The `supabase/functions/` directory holds the Edge Functions the frontend talks to. You only need the Supabase CLI / a Supabase project if you intend to modify or self-host those functions. For pure frontend work, the default `VITE_SUPABASE_*` URLs in `.env.example` are enough.

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Port 8443 is already in use` / `strictPort` error | Stop the other process, or set `PORT` to a free port (see step 5). |
| Page is blank / `__vite...` errors | Delete `node_modules`, reinstall with the Node 22 toolchain, restart dev server. |
| Can't log in (random master password) | Set `VITE_MASTER_EMAIL` + `VITE_MASTER_PASSWORD` in `.env` and restart `pnpm dev`. |
| Env changes not picked up | Restart the dev server — Vite only reads `.env` at startup. `VITE_*` vars are also baked in at `pnpm build` time. |
| `google is not defined` / Sign-In button missing | `VITE_GOOGLE_CLIENT_ID` is empty — that disables Google Sign-In by design. |
| Sync/publish fails | Check `VITE_SUPABASE_BASE_URL` / `VITE_SUPABASE_PROXY_URL` and network access to those endpoints. |
| Wrong Node version | Match `.mise.toml` (Node 22): `mise install`, or switch your nvm/fnm version. |

---

## License

Private project. All rights reserved unless a `LICENSE` file states otherwise.
