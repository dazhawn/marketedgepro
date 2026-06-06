---
name: TradingView webhook ingestion
description: How the /api/signals/webhook endpoint must accept TradingView alert payloads
---

# TradingView webhook ingestion

TradingView's native indicator alerts arrive as **plain text**, not JSON — e.g.
`[Pullback] Price retraced to Tsl line within bear trend`, `[Chart TF] Main Trend turned Bullish`.
Only fully custom alerts where the user pastes a JSON template into the alert Message box send JSON.

**Rule:** the webhook must accept BOTH plain text and JSON, never hard-reject an authenticated
non-empty body. Plain text is parsed: `[Tag]` → signalType, bull/bear keywords → direction
(BULLISH/BEARISH/NEUTRAL), raw text → message column, symbol defaults to "UNKNOWN" (native
alerts carry no ticker unless the user adds `{{ticker}}`).

**Why:** for weeks every alert was rejected with `400 Invalid JSON in request body` because the
handler only accepted strict JSON; the symptom looked like "alerts not firing."

**How to apply:** in `POST /api/signals/webhook`, on `JSON.parse` failure fall back to plain-text
parsing rather than returning 400. Discord notifications are intentionally gated to only full
trade setups (SL + TP1 present), so informational plain-text alerts save+display but don't notify.
