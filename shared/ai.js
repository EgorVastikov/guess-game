import { AI_TASKS, DEFAULT_MODEL, setting } from "./config.js";
import { buildMessages } from "./prompts.js";

export class AIError extends Error {
  constructor(code = "unavailable") {
    super("AI service unavailable");
    this.name = "AIError";
    this.code = code;
  }
}

export function hasAIKey(env) {
  return Boolean(setting(env, "OPENROUTER_API_KEY"));
}

export async function requestAI(env, task, input) {
  const config = AI_TASKS[task];
  if (!config) throw new Error("Unknown AI task");
  const apiKey = setting(env, "OPENROUTER_API_KEY");
  if (!apiKey) throw new AIError("missing_key");
  const model = setting(env, config.modelEnv, setting(env, "MODEL", DEFAULT_MODEL));
  const baseUrl = setting(env, "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: config.maxTokens,
        reasoning: { enabled: false },
        messages: buildMessages(task, input),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new AIError(response.status === 429 ? "rate_limit" : "unavailable");
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AIError("invalid_response");
    return content.trim();
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw new AIError(controller.signal.aborted ? "timeout" : "unavailable");
  } finally {
    clearTimeout(timer);
  }
}
