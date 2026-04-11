# Prufs Dashboard

The Prufs.ai operator dashboard. A React SPA deployed to Cloudflare Pages, authenticated against the Prufs cloud API at `api.prufs.ai`.

## Pages

| Route | Page | Description |
|---|---|---|
| `/` | Overview | KPI cards, usage gauge, recent commits table |
| `/commits` | Commits | Branch selector, commit list, detail panel, raw JSON, Trails link |
| `/trails` | Trails | D3 force-directed causal graph, node detail drawer, export |
| `/team` | Team | Member table with role badges, invite flow, pending invitations |
| `/keys` | Keys | API key management, Ed25519 signing key registration |
| `/usage` | Usage | Tier gauges, 30-day events/commits area chart |
| `/audit` | Audit | Paginated audit log, action filter, metadata drawer |
| `/settings` | Settings | Org settings |
| `/login` | Login | API key authentication |

## Tech stack

- React 18, TypeScript, Vite
- TanStack Query v5 (data fetching, caching)
- React Router v6
- Tailwind CSS (dark navy theme)
- D3 v7 (Trails force graph)
- Recharts v3 (Usage area chart)
- Zustand (auth store)
- Cloudflare Pages (hosting)

## Local development

```bash
npm install
npm run dev
```

The app expects a `VITE_API_URL` environment variable (defaults to `https://api.prufs.ai`). Set it in `.env.local` to point at a local API during development:

```
VITE_API_URL=http://localhost:8787
```

Authentication uses an API key stored in Zustand (persisted to localStorage). The login page accepts any valid API key issued by the org.

## Build

```bash
npm run build
```

Output goes to `dist/`. Build requires React 18 — TanStack Query and React Router peer deps conflict with React 19.

## Deploy

```bash
npx wrangler pages deploy dist --project-name prufs-dashboard --commit-dirty=true
```

Production deployment is at `https://dashboard.prufs.ai` (Cloudflare Pages, custom domain).

## API

All data fetching goes through `src/lib/api.ts` (`apiFetch`). The base URL is `VITE_API_URL`. Every request carries the org API key as a Bearer token from the Zustand auth store.

### Endpoints consumed

| Method | Path | Page |
|---|---|---|
| GET | /v1/stats | Overview |
| GET | /v1/commits | Commits |
| GET | /v1/commits/:hash | Commits (detail) |
| GET | /v1/trails | Trails |
| GET | /v1/trails/:id | Trails (graph) |
| GET | /v1/members | Team |
| POST | /v1/invites | Team |
| DELETE | /v1/members/:id | Team |
| DELETE | /v1/invites/:id | Team |
| GET | /v1/api-keys | Keys |
| POST | /v1/api-keys | Keys |
| DELETE | /v1/api-keys/:id | Keys |
| GET | /v1/signing-keys | Keys |
| POST | /v1/signing-keys | Keys |
| DELETE | /v1/signing-keys/:id | Keys |
| GET | /v1/usage | Usage |
| GET | /v1/audit | Audit |

## Auth store

`src/stores/auth.ts` (Zustand). Fields: `apiKey: string | null`, `orgSlug: string | null`. Set on successful login. The `ProtectedRoutes` wrapper in `App.tsx` redirects to `/login` when `apiKey` is null.

## Package structure

This package lives at `packages/dashboard` within the `prufs` monorepo.
