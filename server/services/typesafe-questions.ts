/**
 * TypeSafe (Jev) question definitions and thresholds — ALL IN ONE FILE.
 *
 * TypeSafe's own guidance is that the questions and thresholds are the part a
 * human must review, so they live here rather than being scattered through the
 * services that call them. Change wording here, not at the call sites.
 *
 * Primitive choice, per https://docs.typesafe.ai/primitives.md:
 *   • noul  — probability that the answer is YES. No separate confidence.
 *   • score — probability-weighted position on ordered levels, plus confidence.
 *
 * IMPORTANT: `confidence` on a score is distribution concentration, NOT
 * correctness and NOT permission to act. Never surface it to subscribers as
 * anything resembling a win probability.
 */

export const TYPESAFE_MODEL = "jev-latest";
export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

// ── Thresholds ──────────────────────────────────────────────────────────────
// Starting points only. TypeSafe is explicit that thresholds must be evaluated
// on our own data and consequences, not inherited from cookbooks.
export const THRESHOLDS = {
  /**
   * Hard-drop a headline below this noul. Deliberately LOW: measured on real
   * data, the extremes are reliable and the 0.4–0.65 band is not, so this is a
   * garbage gate rather than a relevance cutoff. Articles above it are ranked
   * and trimmed to `newsTopK`, not thresholded.
   *
   * Evidence at 0.15 over 47 live articles: correctly gated "Current price of
   * gold as of September 17" (0.04), "RYUMC to SGD: Yum China Stock Price in
   * Singapore Dollar" (0.02), and — from Alpha Vantage's SPY constituent feed —
   * a McDonald's dividend raise and an AutoZone earnings preview (0.07–0.10).
   * No true positive was gated.
   */
  newsGarbageGate: 0.15,

  /** Articles kept per symbol after ranking by relevance. */
  newsTopK: 6,
};

// ── News relevance ──────────────────────────────────────────────────────────
/**
 * We currently push every article the news API returns (11–12 per symbol) into
 * the Claude brief prompt. Much of it is noise — "stocks to watch" roundups,
 * price recaps with no new information, and genuinely unrelated companies. One
 * real example from an ADBE alert's headline set: a story about Victoria's
 * Secret hiring a Starbucks executive.
 *
 * Criteria carry the exclusions because that is where the yes/no boundary is
 * subtle — a sector story IS relevant, a listicle mentioning the ticker is not.
 */
export function newsRelevanceQuestion(symbol: string) {
  return {
    type: "noul" as const,
    instructions:
      `This headline was retrieved for a trader monitoring ${symbol}. Does it report a ` +
      `development that could plausibly move the price of ${symbol} within the next ` +
      `trading session?`,
    criteria: {
      true:
        `Concerns ${symbol} itself, its issuer, its sector, or a macro driver that ` +
        `transmits to it — earnings or guidance, regulatory or legal action, a product or ` +
        `contract event, analyst re-rating, rate or inflation data, commodity supply, or ` +
        `a geopolitical development with a clear channel to this instrument.`,
      false:
        `Mentions ${symbol} only in passing; is a roundup, listicle or "stocks to watch" ` +
        `piece; recaps past price action without new information; is older commentary with ` +
        `no new fact; or concerns an unrelated company or market.`,
    },
  };
}

/**
 * v3 — v1's instructions VERBATIM, with only the `false` criteria extended.
 *
 * Round two tried reframing the question around whether the article's central
 * subject was the instrument. That inverted the result: it scored "Current price
 * of gold as of September 16" at 0.91 and "Treasury Sanctions Iranian Crypto
 * Exchange Over Bitcoin Transfers" at 0.22, because topical aboutness is not
 * price materiality. v1's framing is correct and is left untouched here.
 *
 * The only change is naming the two error classes round one actually exhibited:
 * insider/option transactions at OTHER companies (the Ambiq Micro story scored
 * 0.63 for Mastercard), and the content-farm genres that dominate this feed.
 */
export function newsRelevanceQuestionV3(symbol: string) {
  return {
    type: "noul" as const,
    // Identical to v1 — do not reword without re-running the A/B.
    instructions:
      `This headline was retrieved for a trader monitoring ${symbol}. Does it report a ` +
      `development that could plausibly move the price of ${symbol} within the next ` +
      `trading session?`,
    criteria: {
      true:
        `Concerns ${symbol} itself, its issuer, its sector, or a macro driver that ` +
        `transmits to it — earnings or guidance, regulatory or legal action, a product or ` +
        `contract event, analyst re-rating, rate or inflation data, commodity supply, or ` +
        `a geopolitical development with a clear channel to this instrument.`,
      false:
        `Mentions ${symbol} only in passing; is a roundup, listicle or "stocks to watch" ` +
        `piece; recaps past price action without new information; is older commentary with ` +
        `no new fact; or concerns an unrelated company or market. Also false for insider ` +
        `dealings, option activity or filings at a company OTHER than ${symbol}'s issuer; ` +
        `for Zacks or analyst-blog digests naming several tickers; for "why is X in focus", ` +
        `"what's driving interest in X" and "X vs Y: which is the better buy" pieces; for ` +
        `multi-year return retrospectives; and for daily "current price of" or "price today" ` +
        `pages that restate the quote without reporting a cause.`,
    },
  };
}

// ── Pullback setup quality ──────────────────────────────────────────────────
/**
 * The live screener returns 19–29 rows daily and we show the top 8, ordered by
 * barsAgo then historical profit factor. That ordering ignores everything else
 * in the row. A score per row lets the weaker signals combine, and TypeSafe's
 * guidance is that comparable per-item scores are the way to do graded ranking.
 *
 * Levels describe concrete situations and must stand on their own.
 */
export const pullbackQualityQuestion = {
  type: "score" as const,
  instructions:
    "Judge this pullback setup as a swing-trade candidate over the coming days, using " +
    "its historical backtest statistics and where price now sits relative to its " +
    "Chandelier stop. A short sample size or a stop far from price both weaken a setup " +
    "regardless of how good the profit factor looks.",
  criteria: [
    "Weak — profit factor near or below 1, or fewer than 10 historical trades, or price " +
      "so far from the Chandelier stop that the risk per unit is unattractive.",
    "Marginal — profit factor between 1 and 1.5 on a modest sample, or a win rate under " +
      "35% without a large average win to justify it.",
    "Solid — profit factor comfortably above 1.5 across at least 15 trades, price within " +
      "a sensible distance of its stop, and the signal is recent.",
    "Strong — high profit factor on a meaningful sample, a tight stop relative to price, " +
      "and the signal fired today or yesterday rather than several bars ago.",
  ],
};
