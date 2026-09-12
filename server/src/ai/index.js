import * as openaiProvider from "./openaiProvider.js";

export function getProvider() {
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  throw new Error("No AI provider configured — set OPENAI_API_KEY in server/.env");
}
