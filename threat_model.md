# Threat Model

## Project Overview

Trading Confluence Dashboard is a publicly deployed React/Vite + Express + PostgreSQL application for recording watchlists, receiving TradingView/MT5 webhooks, running AI-assisted market analysis, and sending Discord alerts. The production server exposes both the user-facing dashboard and the JSON API on the same origin. There is no separate admin service; any sensitive operation must therefore be protected directly at the API route layer.

## Assets

- **Trading records and portfolio history** — account balance, trades, balance history, signal-service notes, and analysis history reveal trading performance and can be tampered with to mislead the operator.
- **Webhook integrity** — TradingView and MT5 webhook inputs influence stored signals, automated analyses, Discord notifications, and portfolio metrics. Forged webhooks can corrupt operational decisions.
- **Application secrets** — `SESSION_SECRET`, `DISCORD_WEBHOOK_URL`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `NEWS_API_KEY`, and `ALPHA_VANTAGE_KEY` enable authentication, external-service access, or full backend compromise if exposed.
- **Paid / rate-limited integrations** — Anthropic, Alpha Vantage, NewsAPI, chart-img, and Discord are cost-bearing or quota-bound dependencies that can be abused through public endpoints.
- **Operational notifications** — Discord alerts and morning briefs are trusted outputs; misuse can spam operators or cause them to act on attacker-generated data.

## Trust Boundaries

- **Browser to Express API** — all client input is untrusted. Every read/write route and action trigger must enforce authentication, authorization, and abuse controls server-side.
- **Webhook senders to Express API** — TradingView/MT5-style senders are outside the trust boundary. Webhook requests must be authenticated independently of browser sessions and must not disclose their verification secret.
- **Express API to PostgreSQL** — route handlers can read and mutate all stored data. Broken access control at the API layer directly becomes database compromise.
- **Express API to external services** — the server holds privileged API keys for Anthropic, Alpha Vantage, NewsAPI, chart-img, and Discord. Publicly triggerable calls can create cost, rate-limit exhaustion, or message abuse.
- **Development-only tooling vs production** — `server/vite.ts`, Vite dev server setup, and mock/dev helpers are out of scope unless production reachability is shown. Production traffic is served through `server/index.ts`, `server/routes.ts`, `server/storage.ts`, and `server/services/*`.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes.ts`, `server/storage.ts`
- **Highest-risk areas:** webhook routes (`/api/signals/webhook`, `/api/trade`), secret-disclosure/config routes, portfolio routes, Discord/AI trigger routes, and external-service integrations in `server/services/`
- **Public surfaces:** all API routes currently appear reachable from the public app origin; verify whether any server-side auth boundary exists before assuming data is private
- **Dev-only areas usually skipped:** Vite/dev-server integration, static frontend rendering glue, attached assets, and mockup-only artifacts unless they influence production routing

## Threat Categories

### Spoofing

This project accepts machine-to-machine webhook traffic that can create trades, signals, and downstream notifications. The application must authenticate webhook callers with a secret that is never exposed to browser users, and it must not reuse a broadly shared secret for unrelated purposes.

### Tampering

The API stores analyses, watchlist items, webhook signals, portfolio balances, trades, and signal-service notes. The server must enforce who can create, update, or delete each record; client-side navigation alone is not a security boundary.

### Information Disclosure

Trading history, portfolio metrics, signal data, and secrets are sensitive even if they are not classic PII. The application must not expose webhook secrets, internal tokens, or private trading records through public API routes, logs, or browser-accessible configuration endpoints.

### Denial of Service

Several routes trigger paid or rate-limited upstream calls (Anthropic, Alpha Vantage, NewsAPI, chart-img, Discord) and some can be invoked repeatedly from the public internet. The application must apply authentication and/or rate limiting to expensive or high-fanout actions so attackers cannot drain quotas, create cost, or flood operators.

### Elevation of Privilege

Because there is no separate admin service, privileged actions such as editing balances, importing trades, deleting history, or triggering outbound notifications must be explicitly restricted at the API layer. Any public route that performs these actions effectively grants anonymous users operator privileges.
