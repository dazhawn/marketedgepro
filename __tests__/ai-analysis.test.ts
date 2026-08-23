import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const mockFetch = jest.fn<typeof fetch>();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.AI_PROVIDER;
  delete process.env.ATLASCLOUD_API_KEY;
  delete process.env.ATLAS_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("getAiProviderStatus", () => {
  it("returns anthropic when AI_PROVIDER is not set", async () => {
    const { getAiProviderStatus } = await import("../server/services/ai-analysis.js");
    const status = getAiProviderStatus();
    expect(status.provider).toBe("anthropic");
    expect(status.model).toBe("claude-opus-5");
  });

  it("returns atlascloud when AI_PROVIDER=atlascloud", async () => {
    process.env.AI_PROVIDER = "atlascloud";
    process.env.ATLASCLOUD_API_KEY = "test-key";
    const { getAiProviderStatus } = await import("../server/services/ai-analysis.js");
    const status = getAiProviderStatus();
    expect(status.provider).toBe("atlascloud");
    expect(status.configured).toBe(true);
    expect(status.model).toBe("deepseek-ai/deepseek-v4-pro");
  });

  it("uses ATLAS_MODEL override when set", async () => {
    process.env.AI_PROVIDER = "atlascloud";
    process.env.ATLASCLOUD_API_KEY = "test-key";
    process.env.ATLAS_MODEL = "deepseek-ai/deepseek-v3.2";
    const { getAiProviderStatus } = await import("../server/services/ai-analysis.js");
    const status = getAiProviderStatus();
    expect(status.model).toBe("deepseek-ai/deepseek-v3.2");
  });

  it("reports not configured when ATLASCLOUD_API_KEY is missing", async () => {
    process.env.AI_PROVIDER = "atlascloud";
    const { getAiProviderStatus } = await import("../server/services/ai-analysis.js");
    const status = getAiProviderStatus();
    expect(status.configured).toBe(false);
  });
});

describe("analyzeMarket via Atlas Cloud", () => {
  it("calls Atlas Cloud endpoint with correct headers", async () => {
    process.env.AI_PROVIDER = "atlascloud";
    process.env.ATLASCLOUD_API_KEY = "atlas-test-key";

    const fakeResult = {
      direction: "BULLISH",
      confluenceScore: 7,
      summary: "Test summary.",
      newsFactors: ["Factor A"],
      technicalFactors: ["EMA aligned"],
      confidence: "HIGH",
    };

    mockFetch.mockResolvedValueOnce(new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(fakeResult) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ) as Response);

    const { analyzeMarket } = await import("../server/services/ai-analysis.js");
    const result = await analyzeMarket("EURUSD", "1H", "No news", "Price: 1.0800");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.atlascloud.ai/v1/chat/completions");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer atlas-test-key");
    expect(result.direction).toBe("BULLISH");
    expect(result.confluenceScore).toBe(7);
  });
});
