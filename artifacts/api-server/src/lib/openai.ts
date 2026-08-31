import OpenAI from "openai";

export function isAIConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
}

let cached: OpenAI | null = null;
let cachedOpenRouter: OpenAI | null = null;

export type FredModelProfile = "routine" | "deep" | "verify";

const FRED_MODELS: Record<FredModelProfile, string> = {
  routine: process.env.FRED_ROUTINE_MODEL || "openai/gpt-5.6-terra",
  // Claude Opus 5 is the preferred cross-provider deep model, but OpenRouter
  // currently exposes no ZDR-compatible endpoint for this account. Keep SCCC
  // data private by default; operators can switch once a ZDR endpoint exists.
  deep: process.env.FRED_DEEP_MODEL || "openai/gpt-5.6-sol",
  verify: process.env.FRED_VERIFY_MODEL || "openai/gpt-5.6-terra",
};

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Fred uses OpenRouter for deliberately selected multi-provider profiles.
 * The existing direct OpenAI integration remains the safe fallback.
 */
export function getFredAI(profile: FredModelProfile = "routine"): { client: OpenAI; model: string; provider: "openrouter" | "direct" } {
  if (isOpenRouterConfigured()) {
    if (!cachedOpenRouter) {
      cachedOpenRouter = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://app-server2.centralus.cloudapp.azure.com",
          "X-Title": "SCCC Fred IT Insights Hub",
        },
        fetch: async (input, init) => {
          let nextInit = init;
          if (typeof init?.body === "string") {
            try {
              const body = JSON.parse(init.body);
              body.provider = {
                ...(body.provider || {}),
                zdr: true,
                data_collection: "deny",
                allow_fallbacks: false,
                require_parameters: true,
              };
              nextInit = { ...init, body: JSON.stringify(body) };
            } catch {
              // Non-JSON request bodies are passed through unchanged.
            }
          }
          return fetch(input, nextInit);
        },
      });
    }
    return { client: cachedOpenRouter, model: FRED_MODELS[profile], provider: "openrouter" };
  }
  return {
    client: getOpenAI(),
    model: process.env.FRED_DIRECT_MODEL || "gpt-5.2",
    provider: "direct",
  };
}

export function getOpenAI(): OpenAI {
  if (!isAIConfigured()) {
    throw new Error("AI service is not configured.");
  }
  if (!cached) {
    cached = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return cached;
}
