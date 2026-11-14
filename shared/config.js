export const DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl:free";
export const STORE_TIMEOUT_MS = 2500;
export const GAME_TTL_SECONDS = 60 * 60;
export const ASK_INTERVAL_MS = 700;
export const HINT_LIMIT = 2;

// Maximum ask duration: store read + AI answer + store write = 14 seconds.
// public/index.html waits 20 seconds, leaving room for transport overhead.
export const AI_TASKS = Object.freeze({
  answer: Object.freeze({ modelEnv: "MODEL", maxTokens: 32, timeoutMs: 9000 }),
  hint: Object.freeze({ modelEnv: "MODEL_HINT", maxTokens: 160, timeoutMs: 9000 }),
  analysis: Object.freeze({ modelEnv: "MODEL_ANALYSIS", maxTokens: 1000, timeoutMs: 15000 }),
  vision: Object.freeze({ modelEnv: "MODEL_VISION", maxTokens: 256, timeoutMs: 15000 }),
});

export function setting(env, name, fallback = "") {
  return String(env?.[name] ?? "").trim() || fallback;
}
