---
name: Auth model (admin-protected, not full-site gate)
description: Which routes require auth vs are public, and why; how the client detects admin.
---

# Auth model: admin-protected (public read, protected write)

The app is NOT behind a full-site password. Anyone can VIEW; only admin actions require login.

**Rule:** GET read routes are public (dashboard/news/signals list/history/watchlist/market-data/levels/economic-calendar). `requireAuth` is kept on: writes (analyses create+delete, watchlist create+delete), expensive upstream calls (ai/analyze, discord/alert, morning-brief/trigger), and secret-exposing routes (signals/webhook-info exposes the webhook secret).

**Why:** Client-side `{isAdmin && ...}` gating is cosmetic only — the server route layer is the real boundary (see threat_model.md). Any new write/expensive/secret route MUST add `requireAuth` or it grants anonymous operator privileges.

**How to apply:**
- Client admin detection: `useAuth()` (`client/src/hooks/use-auth.ts`) queries `GET /api/auth/session` with `getQueryFn({ on401: "returnNull" })` → `{ isAdmin }`. Gate any admin-only query with `enabled: isAdmin` to avoid needless 401s.
- Webhook (`POST /api/signals/webhook`) is authed by a shared secret (currently `SESSION_SECRET`), independent of session. It is fail-closed: returns 503 if the secret env var is unset (never open ingestion). Note: webhook secret is currently coupled to the session signing secret — decoupling into a dedicated `WEBHOOK_SECRET` was deferred because it would force the user to reconfigure existing TradingView alerts.
