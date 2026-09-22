# Trading Confluence Dashboard

A trading confluence analysis platform designed to support the Predictive Ranges v5 strategy for TradingView. Uses AI, market data, news, and TradingView webhook signals to generate confluence scoring for trading decisions.

## Architecture

- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Neon, Launch plan) with Drizzle ORM
- **AI**: Anthropic Claude (`claude-opus-5` by default, via `ANTHROPIC_MODEL`) for market analysis, with Atlas Cloud as automatic failover
- **Data Sources**: Alpha Vantage News Sentiment + Google News RSS (market news), Alpha Vantage (price data/forex rates), TradingView webhooks (strategy signals), SERVER-1 (Smart Pullback screener + Smart Investor)
- **News relevance**: TypeSafe (Jev) ranks articles before the brief (optional, fails open)
- **Notifications**: Discord bot posting to per-market channels; admin-only issue reports

> **Operations:** hosting, scheduled jobs, alerts and runbooks live in
> [`docs/operations.md`](docs/operations.md). Incident write-ups are in
> [`docs/incidents/`](docs/incidents/). That runbook is the current reference;
> parts of this file predate it.

## Key Features

1. **Dashboard** - Watchlist overview with daily high/low prices, quick-analyze buttons, on-demand S/R pivot levels, market news headlines (top 5 with sentiment badges), recent analyses
2. **AI Analysis** - Runs Anthropic-powered confluence analysis combining news + market data + TV signals; symbol dropdown populated from watchlist
3. **TV Signals** - Receives TradingView webhook alerts from Predictive Ranges v5 strategy; displays signal data (EMA, RSI, Renko, MTF) and allows one-click AI analysis
4. **Market News** - Dual-source news (NewsAPI + Alpha Vantage News Sentiment) with category tabs (Gold, Stocks, Forex), sentiment badges (Bullish/Bearish/Neutral), and custom search
5. **Watchlist** - Customizable symbol watchlist (forex, stocks, crypto, commodities)
6. **History** - Full history of past analyses
7. **Discord Alerts** - Send analysis results to Discord as rich embeds

## Project Structure

```
shared/
  schema.ts        - Drizzle tables (analyses, watchlist, signals) + Zod schemas
  routes.ts        - API contract definitions

server/
  db.ts            - Database connection pool
  storage.ts       - DatabaseStorage class (CRUD for analyses, watchlist, signals)
  routes.ts        - Express route handlers
  services/
    news.ts        - News API integration
    market-data.ts - Alpha Vantage integration (stocks + forex)
    ai-analysis.ts - Anthropic Claude analysis engine (with signal validation)
    discord.ts     - Discord webhook sender

client/src/
  App.tsx          - Router + sidebar layout
  pages/
    dashboard.tsx      - Main dashboard
    analysis.tsx       - AI analysis page
    signals.tsx        - TradingView signals page (webhook setup + signal list)
    news.tsx           - Market news feed (category tabs: Gold, Stocks, Forex)
    watchlist-page.tsx - Watchlist management
    history.tsx        - Analysis history
  components/
    app-sidebar.tsx    - Navigation sidebar
```

## Environment Variables

The full, current list is in [`docs/operations.md`](docs/operations.md#environment-variables-railway).
The essentials: `DATABASE_URL`, `SESSION_SECRET` (also the webhook secret),
`ANTHROPIC_API_KEY`, `ALPHA_VANTAGE_KEY`, `DISCORD_BOT_TOKEN` and the
`DISCORD_*_CHANNEL_ID` values.

## Database Tables

- `analyses` - Stores AI analysis results (symbol, direction, confluence score, summary, factors, signalId)
- `watchlist` - User's tracked symbols (symbol, name, type)
- `signals` - Incoming TradingView webhook signals (symbol, timeframe, direction, signalType, price, confluenceData with EMA/RSI/Renko/MTF values)
- `screener_runs` - Uploaded Smart Pullback results from SERVER-1
- `screener_requests` - Queued Run Screener requests (the poll is answered from an in-memory mirror; see `services/screener-queue.ts`)
- `app_state` - Small key/value store for scheduler state that must survive restarts (e.g. the "brief sent today" marker)
- `waitlist` - Landing-page signups

## Alpha Vantage Caching

All Alpha Vantage API calls (GLOBAL_QUOTE, CURRENCY_EXCHANGE_RATE, FX_DAILY, TIME_SERIES_DAILY) are cached in-memory:
- Stock quotes & forex rates: 15-minute TTL
- Support/resistance levels: 30-minute TTL
- Rate limit detection: responses with "rate limit" or "call volume" messages are caught and surfaced as errors
- S/R levels load on-demand (user clicks ↕ button) to minimize API usage
- Commodity symbols (XAUUSD, XAGUSD) map to XAU/USD forex pairs; crypto (BTC, ETH, SOL) map to crypto/USD pairs

## TradingView Webhook Integration

POST `/api/signals/webhook` accepts TradingView alert webhooks with JSON payload:
- Required: symbol, direction, signalType
- Optional: timeframe, price, emaAlignment, rsiValue, renkoTrend, mtfScore, confluenceCount, autoAnalyze
- When `autoAnalyze: true`, automatically triggers AI analysis using the signal data
- AI analysis validates TV signals against news sentiment and market data for enhanced confluence scoring
