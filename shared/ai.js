import { AI_TASKS, aiConnection, setting } from "./config.js";
import { buildMessages } from "./prompts.js";
import { responseFormat } from "./ai-schemas.js";

export class AIError extends Error {
  constructor(code = "unavailable") {
    super("AI service unavailable");
    this.name = "AIError";
    this.code = code;
  }
}

export function hasAIKey(env) {
  // The local Ollama API needs no real key; keep cloud requests opt-in.
  return Boolean(aiConnection(env).apiKey);
}

export function logAIFailure(env, task, error) {
  if (aiConnection(env).provider === "ollama") {
    console.warn(`[ai:${task}] provider=ollama code=${error.code}`);
  }
}

export async function requestAI(env, task, input) {
  const config = AI_TASKS[task];
  if (!config) throw new Error("Unknown AI task");
  const { provider, baseUrl, apiKey, defaultModel } = aiConnection(env);
  if (!apiKey) throw new AIError("missing_key");
  const model = setting(env, config.modelEnv, setting(env, "MODEL", defaultModel));
  const format = provider === "ollama" ? responseFormat(task, input) : null;
  const controller = new AbortController();
  const timeoutMs = provider === "ollama" ? config.ollamaTimeoutMs ?? config.timeoutMs : config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: config.maxTokens,
        stream: false,
        ...(provider === "ollama" ? { reasoning_effort: "none" } : { reasoning: { enabled: false } }),
        ...(format ? { response_format: format } : {}),
        messages: buildMessages(task, input),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new AIError(response.status === 429 ? "rate_limit" : "unavailable");
    const data = await response.json();
    if (data?.choices?.[0]?.finish_reason === "length") throw new AIError("truncated_response");
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AIError("invalid_response");
    return content.trim();
  } catch (error) {
    const failure = error instanceof AIError ? error : new AIError(controller.signal.aborted ? "timeout" : "unavailable");
    logAIFailure(env, task, failure);
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
