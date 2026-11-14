// Models are fixed here for all AI tasks; environment variables cannot override them.
export const OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free";
export const OLLAMA_MODEL = "gemma4:e2b";
export const STORE_TIMEOUT_MS = 2500;
export const GAME_TTL_SECONDS = 60 * 60;
export const ASK_INTERVAL_MS = 700;
export const HINT_LIMIT = 2;
// A crashed analysis request may be retried after this lease expires.
export const ANALYSIS_PENDING_MS = 30000;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1024;
export const MAX_REQUEST_BYTES = 1536 * 1024;

// Maximum ask duration: store read + AI answer + store write = 14 seconds.
// public/index.html waits 20 seconds, leaving room for transport overhead.
export const AI_TASKS = Object.freeze({
  answer: Object.freeze({ maxTokens: 32, timeoutMs: 9000 }),
  hint: Object.freeze({ maxTokens: 160, timeoutMs: 9000 }),
  analysis: Object.freeze({ maxTokens: 1000, timeoutMs: 15000 }),
  // Allow room for three Russian names plus a question, including JSON syntax.
  // Local vision also needs time to load the model and image encoder on first use.
  vision: Object.freeze({ maxTokens: 512, timeoutMs: 15000, ollamaTimeoutMs: 30000 }),
});

export function setting(env, name, fallback = "") {
  return String(env?.[name] ?? "").trim() || fallback;
}

export function aiConnection(env) {
  const selected = setting(env, "AI_PROVIDER", "auto").toLowerCase();
  if (!["auto", "openrouter", "ollama"].includes(selected)) throw new Error("Unknown AI_PROVIDER");
  const baseUrl = setting(env, "OPENROUTER_BASE_URL", selected === "ollama"
    ? "http://127.0.0.1:11434/v1" : "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const url = new URL(baseUrl);
  const provider = selected === "auto" ? (url.port === "11434" || url.hostname === "ollama" ? "ollama" : "openrouter") : selected;
  return {
    provider, baseUrl,
    apiKey: setting(env, "OPENROUTER_API_KEY", provider === "ollama" ? "ollama" : ""),
    model: provider === "ollama" ? OLLAMA_MODEL : OPENROUTER_MODEL,
  };
}
