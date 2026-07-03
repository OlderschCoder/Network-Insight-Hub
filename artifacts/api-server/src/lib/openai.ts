import OpenAI from "openai";

export function isAIConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
}

let cached: OpenAI | null = null;

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
