/**
 * TypeSafe (Jev) client — relevance filtering for the news that feeds the AI brief.
 *
 * Why this exists: the news providers return articles that merely MENTION a
 * symbol, which for an index ETF means constituent news and for anything means
 * roundups and price recaps. Measured on live data, only a minority of each
 * feed bears on the instrument's next session. We were passing all of it into
 * the Claude prompt.
 *
 * Design, after three rounds of A/B on real articles:
 *   • Garbage-gate then rank — do NOT threshold. The extremes are reliable and
 *     the middle band is not, so anything above the gate is ranked and trimmed
 *     rather than cut at a relevance line.
 *   • Fail open, always. Every failure path returns the input unchanged. A
 *     TypeSafe outage must never be able to break a brief — that failure mode
 *     already cost 18 days of silence once.
 *
 * Questions and thresholds live in ./typesafe-questions.ts, deliberately apart
 * from this transport code so they can be reviewed in one place.
 */
import type { NewsArticle } from "./news";
import {
  TYPESAFE_ENDPOINT, TYPESAFE_MODEL, THRESHOLDS, newsRelevanceQuestion,
} from "./typesafe-questions";

const CONCURRENCY = 8;      // TypeSafe's own cookbook uses 12; 8 is conservative
const TIMEOUT_MS = 8_000;   // a judgment takes ~15ms; 8s means something is wrong

export function newsFilterEnabled(): boolean {
  return !!process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_NEWS_FILTER === "1";
}

/** One noul per article: probability it could move this symbol's price. */
async function scoreArticle(
  apiKey: string, symbol: string, article: NewsArticle,
): Promise<number> {
  const res = await fetch(TYPESAFE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: TYPESAFE_MODEL,
      state: {
        symbol,
        headline: article.title,
        // Only Alpha Vantage supplies a summary; Google RSS does not. Judging
        // from a headline alone is harder but still works.
        summary: article.description ?? "(no summary available)",
        source: article.source,
      },
      questions: { relevant: newsRelevanceQuestion(symbol) },
    }),
  });
  if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json() as { answers?: { relevant?: { noul?: number } } };
  const noul = data.answers?.relevant?.noul;
  if (typeof noul !== "number") throw new Error("TypeSafe returned no noul");
  return noul;
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Returns the articles most likely to bear on `symbol`, ranked, capped at
 * THRESHOLDS.newsTopK. Returns the input untouched when disabled, when any
 * call fails, or when scoring would leave nothing.
 */
export async function filterRelevantNews(
  symbol: string, articles: NewsArticle[],
): Promise<NewsArticle[]> {
  if (!newsFilterEnabled() || articles.length === 0) return articles;
  const apiKey = process.env.TYPESAFE_API_KEY!;

  try {
    const t0 = Date.now();
    const scored = await mapLimit(articles, CONCURRENCY, async article => ({
      article,
      noul: await scoreArticle(apiKey, symbol, article),
    }));

    const ranked = scored
      .filter(s => s.noul >= THRESHOLDS.newsGarbageGate)
      .sort((a, b) => b.noul - a.noul);

    // Scoring everything away is far more likely to be our bug than a genuine
    // verdict that nothing in the feed matters — keep the original feed.
    if (ranked.length === 0) {
      console.warn(`[typesafe] ${symbol}: every article gated, keeping the unfiltered feed`);
      return articles;
    }

    const kept = ranked.slice(0, THRESHOLDS.newsTopK);
    console.log(
      `[typesafe] ${symbol}: kept ${kept.length}/${articles.length} ` +
      `(top ${kept[0].noul.toFixed(2)}, gated ${articles.length - ranked.length}) in ${Date.now() - t0}ms`,
    );
    return kept.map(k => k.article);
  } catch (err) {
    // Fail open: an unfiltered brief beats no brief.
    console.error(`[typesafe] ${symbol}: filter failed, using unfiltered feed:`, err);
    return articles;
  }
}
