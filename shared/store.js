import { GAME_TTL_SECONDS, STORE_TIMEOUT_MS, setting } from "./config.js";

const memory = new Map();

export class StoreError extends Error {
  constructor() {
    super("Game storage unavailable");
    this.name = "StoreError";
  }
}

export function storeKind(env) {
  const kind = setting(env, "STORE_KIND").toLowerCase();
  if (kind === "memory" || kind === "upstash") return kind;
  if (kind) throw new StoreError();
  return setting(env, "UPSTASH_REDIS_REST_URL") && setting(env, "UPSTASH_REDIS_REST_TOKEN")
    ? "upstash" : "memory";
}

async function redis(env, command) {
  const url = setting(env, "UPSTASH_REDIS_REST_URL").replace(/\/$/, "");
  const token = setting(env, "UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new StoreError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!response.ok) throw new StoreError();
    const data = await response.json();
    if (!data || data.error || !("result" in data)) throw new StoreError();
    return data.result;
  } catch {
    // Do not log Redis credentials, URLs or stored game content.
    throw new StoreError();
  } finally {
    clearTimeout(timer);
  }
}

export async function getGame(env, gameId) {
  const key = `game:${gameId}`;
  if (storeKind(env) === "upstash") {
    const raw = await redis(env, ["GET", key]);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError();
    }
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  // Work on a copy, so a failed request cannot partially update a game.
  return structuredClone(entry.game);
}

export async function saveGame(env, gameId, game) {
  const key = `game:${gameId}`;
  if (storeKind(env) === "upstash") {
    // One atomic Redis command sets both the data and its expiration.
    const result = await redis(env, ["SET", key, JSON.stringify(game), "EX", GAME_TTL_SECONDS]);
    if (result !== "OK") throw new StoreError();
    return;
  }
  const now = Date.now();
  for (const [storedKey, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(storedKey);
  }
  memory.set(key, { game: structuredClone(game), expiresAt: now + GAME_TTL_SECONDS * 1000 });
}
