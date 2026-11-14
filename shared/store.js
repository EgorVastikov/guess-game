import { GAME_TTL_SECONDS, STORE_TIMEOUT_MS, setting } from "./config.js";

const memory = new Map();

// Compare the revision and write in a single operation across all instances.
const SAVE_IF_CURRENT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if tonumber(current.version or 0) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

export class StoreConflictError extends Error {
  constructor() {
    super("Game was changed by another request");
    this.name = "StoreConflictError";
  }
}

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

export async function saveGame(env, gameId, game, expectedVersion) {
  const key = `game:${gameId}`;
  const conditional = expectedVersion !== undefined;
  const next = conditional ? { ...game, version: expectedVersion + 1 } : game;
  if (storeKind(env) === "upstash") {
    if (conditional) {
      const result = await redis(env, ["EVAL", SAVE_IF_CURRENT, 1, key, expectedVersion, JSON.stringify(next), GAME_TTL_SECONDS]);
      if (result === 0) throw new StoreConflictError();
      if (result !== 1) throw new StoreError();
      return;
    }
    // One atomic Redis command sets both the data and its expiration.
    const result = await redis(env, ["SET", key, JSON.stringify(next), "EX", GAME_TTL_SECONDS]);
    if (result !== "OK") throw new StoreError();
    return;
  }
  const now = Date.now();
  for (const [storedKey, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(storedKey);
  }
  const current = memory.get(key);
  if (conditional && (!current || (current.game.version ?? 0) !== expectedVersion)) throw new StoreConflictError();
  memory.set(key, { game: structuredClone(next), expiresAt: now + GAME_TTL_SECONDS * 1000 });
}
