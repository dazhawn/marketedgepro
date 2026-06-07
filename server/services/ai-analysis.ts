import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface AiAnalysisResult {
  direction: string;
  confluenceScore: number;
  summary: string;
  newsFactors: string[];
  technicalFactors: string[];
  confidence: string;
}

export interface SignalContext {
  direction: string;
  signalType: string;
  price?: number | null;
  emaAlignment?: string;
  rsiValue?: number;
  renkoTrend?: string;
  mtfScore?: string;
  confluenceCount?: number;
}

function buildPrompt(
  symbol: string,
  timeframe: string,
  newsContext: string,
  marketDataContext: string,
  additionalContext?: string,
  signalData?: SignalContext
): string {
  let signalSection = "";
  if (signalData) {
    const parts = [
      `Signal Direction: ${signalData.direction}`,
      `Signal Type: ${signalData.signalType}`,
    ];
    if (signalData.price) parts.push(`Signal Price: ${signalData.price}`);
    if (signalData.emaAlignment) parts.push(`EMA Alignment: ${signalData.emaAlignment}`);
    if (signalData.rsiValue !== undefined) parts.push(`RSI Value: ${signalData.rsiValue}`);
    if (signalData.renkoTrend) parts.push(`Renko Trend: ${signalData.renkoTrend}`);
    if (signalData.mtfScore) parts.push(`Multi-Timeframe Score: ${signalData.mtfScore}`);
    if (signalData.confluenceCount !== undefined) parts.push(`Confluence Count: ${signalData.confluenceCount}`);
    signalSection = `\nTradingView Signal:\n${parts.join("\n")}`;
  }

  return `You are an expert trading analyst specializing in technical and fundamental analysis for a Renko-based multi-timeframe confluence strategy (EMA filters, RSI momentum, breakout structure, and 4-TF analysis).

Analyze the following market data and provide a trading confluence assessment:

Symbol: ${symbol}
Timeframe: ${timeframe}

Recent News:
${newsContext || "No recent news available"}

Market Data:
${marketDataContext || "No market data available"}
${signalSection}
${additionalContext ? `\nAdditional Context:\n${additionalContext}` : ""}

${signalData ? `IMPORTANT: A TradingView signal has been received. Your job is to VALIDATE this signal against the current news sentiment and market data. Consider whether the fundamental picture supports or contradicts the technical signal. If the signal aligns with the fundamentals, give a higher confluence score. If there are significant contradictions (e.g., strong bearish news vs bullish signal), lower the score and explain why.` : ""}

Provide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):
{
  "direction": "BULLISH" or "BEARISH",
  "confluenceScore": <number from 1-10, where 10 is strongest confluence>,
  "summary": "<2-3 sentence analysis summary${signalData ? ", referencing the TradingView signal validation" : ""}>",
  "newsFactors": ["<factor 1>", "<factor 2>", ...],
  "technicalFactors": ["<factor 1>", "<factor 2>", ...],
  "confidence": "HIGH" or "MEDIUM" or "LOW"
}

IMPORTANT: You MUST commit to either "BULLISH" or "BEARISH" — never output "NEUTRAL". Weigh all available evidence and pick the direction with greater weight. If the picture is mixed, choose the direction that the most significant factors support and reflect uncertainty in a lower confluenceScore and "LOW" confidence instead.

Consider these factors in your analysis:
- News sentiment and impact on the asset
- Current price action and trend direction
- Key support/resistance levels mentioned
- Volume and volatility conditions
- Multi-timeframe alignment
- Risk/reward considerations for a confluence-based swing strategy
${signalData ? "- Whether the TradingView signal direction aligns with fundamental sentiment\n- Strength of the technical signal (EMA alignment, RSI, Renko trend)\n- Multi-timeframe confluence from the indicator" : ""}`;
}

function parseAiResponse(responseText: string): AiAnalysisResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain valid JSON");
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    direction: (parsed.direction === "BULLISH" || parsed.direction === "BEARISH") ? parsed.direction : "BULLISH",
    confluenceScore: Math.min(10, Math.max(1, Number(parsed.confluenceScore) || 5)),
    summary: parsed.summary || "Analysis unavailable",
    newsFactors: Array.isArray(parsed.newsFactors) ? parsed.newsFactors : [],
    technicalFactors: Array.isArray(parsed.technicalFactors) ? parsed.technicalFactors : [],
    confidence: parsed.confidence || "MEDIUM",
  };
}

// Atlas Cloud — OpenAI-compatible endpoint.
// Set AI_PROVIDER=atlascloud + ATLASCLOUD_API_KEY to route analysis through Atlas Cloud.
// Default model: anthropic/claude-sonnet-4.6 (same Claude, via Atlas Cloud).
// Override with ATLAS_MODEL env var to use any other Atlas Cloud LLM.
async function analyzeViaAtlasCloud(prompt: string): Promise<AiAnalysisResult> {
  const apiKey = process.env.ATLASCLOUD_API_KEY;
  if (!apiKey) throw new Error("ATLASCLOUD_API_KEY is not set");

  const model = process.env.ATLAS_MODEL ?? "deepseek-ai/deepseek-v4-pro";

  const res = await fetch("https://api.atlascloud.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Atlas Cloud API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const responseText = data.choices?.[0]?.message?.content ?? "";
  console.log(`[ai-analysis] Atlas Cloud (${model}) responded`);
  return parseAiResponse(responseText);
}

async function analyzeViaAnthropic(prompt: string): Promise<AiAnalysisResult> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const responseText = message.content[0].type === "text" ? message.content[0].text : "";
  console.log("[ai-analysis] Anthropic SDK responded");
  return parseAiResponse(responseText);
}

export async function analyzeMarket(
  symbol: string,
  timeframe: string,
  newsContext: string,
  marketDataContext: string,
  additionalContext?: string,
  signalData?: SignalContext
): Promise<AiAnalysisResult> {
  const prompt = buildPrompt(symbol, timeframe, newsContext, marketDataContext, additionalContext, signalData);
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();

  try {
    if (provider === "atlascloud" || provider === "atlas") {
      return await analyzeViaAtlasCloud(prompt);
    }
    return await analyzeViaAnthropic(prompt);
  } catch (error) {
    console.error("AI analysis error:", error);
    throw error;
  }
}

// Returns which AI provider is currently active and configured
export function getAiProviderStatus(): { provider: string; model: string; configured: boolean } {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (provider === "atlascloud" || provider === "atlas") {
    return {
      provider: "atlascloud",
      model: process.env.ATLAS_MODEL ?? "deepseek-ai/deepseek-v4-pro",
      configured: !!process.env.ATLASCLOUD_API_KEY,
    };
  }
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    configured: !!process.env.ANTHROPIC_API_KEY,
  };
}
