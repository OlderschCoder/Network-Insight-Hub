import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("Fred model routing", () => {
  it("routes OpenAI profiles directly even when OpenRouter is configured", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    delete process.env.FRED_ROUTINE_MODEL;
    vi.resetModules();

    const { getFredAI } = await import("./openai.js");
    const route = getFredAI("routine");

    expect(route.provider).toBe("direct");
    expect(route.model).toBe("gpt-5.6-terra");
  });

  it("uses OpenRouter only for an explicitly configured non-OpenAI model", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.FRED_DEEP_MODEL = "anthropic/claude-opus-5";
    vi.resetModules();

    const { getFredAI } = await import("./openai.js");
    const route = getFredAI("deep");

    expect(route.provider).toBe("openrouter");
    expect(route.model).toBe("anthropic/claude-opus-5");
  });
});
