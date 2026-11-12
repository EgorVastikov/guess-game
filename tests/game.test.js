import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nodeNew from "../api/new.js";
import nodeAsk from "../api/ask.js";
import { onRequest as pagesNew } from "../functions/api/new.js";
import { onRequest as pagesAsk } from "../functions/api/ask.js";
import { AI_TASKS, DEFAULT_MODEL, GAME_TTL_SECONDS, STORE_TIMEOUT_MS } from "../shared/config.js";
import { AIError, requestAI } from "../shared/ai.js";
import { buildMessages } from "../shared/prompts.js";
import { getGame, saveGame, storeKind, StoreError } from "../shared/store.js";
import { SECRETS } from "../shared/rules.js";

const memoryEnv = { STORE_KIND: "memory", OPENROUTER_API_KEY: "" };
const redisEnv = {
  STORE_KIND: "upstash", UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "test-redis-token", OPENROUTER_API_KEY: "",
};

async function callNode(action, body, env = memoryEnv, method = "POST") {
  const keys = ["STORE_KIND", "OPENROUTER_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "MODEL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    let result;
    await (action === "new" ? nodeNew : nodeAsk)({ method, body }, {
      statusCode: 200,
      json(data) { result = { status: this.statusCode, body: data }; },
    });
    return result;
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function callPages(action, body, env = memoryEnv, method = "POST") {
  const request = new Request(`https://game.example.test/api/${action}`, {
    method,
    ...(method === "POST" ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const response = await (action === "new" ? pagesNew : pagesAsk)({ request, env });
  return { status: response.status, body: await response.json() };
}

async function seed(overrides = {}, env = memoryEnv) {
  const game = {
    gameId: `test_${crypto.randomUUID()}`, secret: "кошка", left: 10, isHard: false,
    over: false, win: false, history: [], createdAt: Date.now(), lastAskAt: 0,
    ...overrides,
  };
  await saveGame(env, game.gameId, game);
  return game;
}

for (const [platform, call] of [["Node", callNode], ["Pages", callPages]]) {
  test(`${platform}: new game returns the persisted easy/hard question budget`, async t => {
    const random = t.mock.method(Math, "random");
    for (const [secret, left] of [["кошка", 10], ["ёж", 15]]) {
      random.mock.mockImplementation(() => SECRETS.indexOf(secret) / SECRETS.length);
      const result = await call("new", {});
      assert.equal(result.status, 200);
      assert.equal(result.body.left, left);
      assert.equal(result.body.isHard, left === 15);
      assert.equal("secret" in result.body, false);
      const stored = await getGame(memoryEnv, result.body.gameId);
      assert.equal(stored.secret, secret);
      assert.equal(stored.left, left);
    }
  });

  test(`${platform}: built-in answer needs no AI and keeps the secret hidden`, async t => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
    const game = await seed();
    const result = await call("ask", { gameId: game.gameId, question: "Это живое?" });
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, "да");
    assert.equal(result.body.left, 9);
    assert.equal(result.body.secret, null);
    assert.deepEqual(result.body.history, [{ q: "Это живое?", a: "да" }]);
  });

  test(`${platform}: correct guess wins and reveals the secret`, async () => {
    const game = await seed();
    const result = await call("ask", { gameId: game.gameId, question: "Это кошка?" });
    assert.equal(result.body.answer, "да");
    assert.equal(result.body.win, true);
    assert.equal(result.body.over, true);
    assert.equal(result.body.secret, "кошка");
    const repeated = await call("ask", { gameId: game.gameId, question: "Это живое?" });
    assert.equal(repeated.body.left, result.body.left);
    assert.deepEqual(repeated.body.history, result.body.history);
  });

  test(`${platform}: final wrong guess loses and reveals the secret`, async () => {
    const game = await seed({ left: 1 });
    const result = await call("ask", { gameId: game.gameId, question: "Это собака?" });
    assert.equal(result.body.answer, "нет");
    assert.equal(result.body.left, 0);
    assert.equal(result.body.win, false);
    assert.equal(result.body.over, true);
    assert.equal(result.body.secret, "кошка");
  });

  test(`${platform}: throttle does not consume a question`, async () => {
    const game = await seed({ lastAskAt: Date.now() });
    const result = await call("ask", { gameId: game.gameId, question: "Это живое?" });
    assert.equal(result.body.left, 10);
    assert.deepEqual(result.body.history, []);
    assert.equal((await getGame(memoryEnv, game.gameId)).left, 10);
  });

  test(`${platform}: preserves the existing late-game category hint`, async () => {
    const game = await seed({ left: 4 });
    const result = await call("ask", { gameId: game.gameId, question: "Это живое?" });
    assert.equal(result.body.left, 3);
    assert.match(result.body.message, /Подсказка:/);
  });

  test(`${platform}: missing game, invalid body and HTTP method are rejected`, async () => {
    for (const body of [null, {}, { gameId: [], question: "Это живое?" }, { gameId: "missing", question: {} }, { gameId: "missing", question: "Это живое?" }]) {
      assert.equal((await call("ask", body)).status, 400);
    }
    assert.equal((await call("new", {}, memoryEnv, "GET")).status, 405);
    assert.equal((await call("ask", {}, memoryEnv, "GET")).status, 405);
  });

  test(`${platform}: missing key retains the playable offline fallback`, async () => {
    const game = await seed();
    const result = await call("ask", { gameId: game.gameId, question: "Какого это цвета?" });
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, "не знаю");
    assert.equal(result.body.left, 9);
    assert.match(result.body.message, /OPENROUTER_API_KEY/);
  });

  test(`${platform}: upstream quota failure does not change persisted state`, async t => {
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 429 }));
    const game = await seed();
    const result = await call("ask", { gameId: game.gameId, question: "Какого это цвета?" }, {
      ...memoryEnv, OPENROUTER_API_KEY: "test-ai-key",
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.left, 10);
    assert.deepEqual(await getGame(memoryEnv, game.gameId), game);
  });

  test(`${platform}: Redis failure cannot report a successful new game`, async t => {
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));
    const result = await call("new", {}, redisEnv);
    assert.equal(result.status, 503);
    assert.equal(result.body.gameId, null);
  });
}

test("OpenRouter gets the configured model, answer budget, disabled reasoning and six recent turns", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, ...options, payload: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: "да" } }] });
  });
  const history = Array.from({ length: 8 }, (_, i) => ({ q: `question-${i}`, a: "нет" }));
  const game = await seed({ history });
  const result = await callPages("ask", { gameId: game.gameId, question: "Какого это цвета?" }, {
    ...memoryEnv, OPENROUTER_API_KEY: "test-key", MODEL: "test/model",
    OPENROUTER_BASE_URL: "https://router.example.test/v1/",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "да");
  assert.equal(sent.url, "https://router.example.test/v1/chat/completions");
  assert.equal(sent.payload.model, "test/model");
  assert.equal(sent.payload.max_tokens, AI_TASKS.answer.maxTokens);
  assert.deepEqual(sent.payload.reasoning, { enabled: false });
  assert.deepEqual(JSON.parse(sent.payload.messages[1].content).history, history.slice(-6));
  assert.equal(sent.signal.aborted, false);
});

test("AI tasks use separate instructions/budgets and model overrides", async t => {
  const payloads = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: "Тестовый ответ" } }] });
  });
  const env = { OPENROUTER_API_KEY: "test", MODEL_HINT: "hint/model", MODEL: " " };
  for (const task of Object.keys(AI_TASKS)) {
    await requestAI(env, task, { secret: "hidden-answer", question: "test", history: [], imageDataUrl: "data:image/png;base64,AAAA" });
  }
  assert.deepEqual(payloads.map(p => p.model), [DEFAULT_MODEL, "hint/model", DEFAULT_MODEL, DEFAULT_MODEL]);
  assert.equal(new Set(payloads.map(p => p.messages[0].content)).size, 4);
  assert.deepEqual(payloads.map(p => p.max_tokens), Object.values(AI_TASKS).map(config => config.maxTokens));
  const vision = JSON.stringify(payloads[3].messages);
  assert.equal(vision.includes("hidden-answer"), false);
  assert.equal(vision.includes("data:image/png;base64,AAAA"), true);
  assert.equal(JSON.parse(buildMessages("analysis", { history: Array(10).fill({ q: "q", a: "a" }) })[1].content).history.length, 10);
});

test("AI transport, malformed response and timeout failures are explicit", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const response of ["network", "invalid-json", { choices: [] }, { choices: [{ message: { content: " " } }] }]) {
    fetchMock.mock.mockImplementation(async () => {
      if (response === "network") throw new TypeError("fetch failed");
      if (response === "invalid-json") return new Response("not-json");
      return Response.json(response);
    });
    await assert.rejects(requestAI({ OPENROUTER_API_KEY: "test" }, "answer", {}), AIError);
  }
  t.mock.method(globalThis, "setTimeout", callback => { queueMicrotask(callback); return 0; });
  fetchMock.mock.mockImplementation(async (_, { signal }) => {
    await new Promise(resolve => queueMicrotask(resolve));
    signal.throwIfAborted();
  });
  await assert.rejects(requestAI({ OPENROUTER_API_KEY: "test" }, "answer", {}), error => error.code === "timeout");
});

test("storage selection is identical across environments and fails on typos", () => {
  assert.equal(storeKind({}), "memory");
  assert.equal(storeKind({ ...redisEnv, STORE_KIND: " " }), "upstash");
  assert.equal(storeKind({ ...redisEnv, STORE_KIND: "memory" }), "memory");
  assert.throws(() => storeKind({ STORE_KIND: "upstahs" }), StoreError);
});

test("Redis persists JSON and expiry atomically, then reads the same game", async t => {
  let record;
  const commands = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, redisEnv.UPSTASH_REDIS_REST_URL);
    assert.equal(options.headers.Authorization, "Bearer test-redis-token");
    const command = JSON.parse(options.body);
    commands.push(command);
    if (command[0] === "SET") {
      record = command[2];
      return Response.json({ result: "OK" });
    }
    return Response.json({ result: record ?? null });
  });
  const game = await seed({}, redisEnv);
  assert.deepEqual(commands[0], ["SET", `game:${game.gameId}`, JSON.stringify(game), "EX", GAME_TTL_SECONDS]);
  assert.deepEqual(await getGame(redisEnv, game.gameId), game);
  assert.deepEqual(commands[1], ["GET", `game:${game.gameId}`]);
});

test("Redis configuration, JSON errors, command errors and timeout fail explicitly", async t => {
  await assert.rejects(getGame({ STORE_KIND: "upstash" }, "x"), StoreError);
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const result of [{ error: "ERR" }, {}, { result: "not-json" }]) {
    fetchMock.mock.mockImplementation(async () => Response.json(result));
    await assert.rejects(getGame(redisEnv, "x"), StoreError);
  }
  let timeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timeout = delay; queueMicrotask(callback); return 0; });
  fetchMock.mock.mockImplementation(async (_, { signal }) => {
    await new Promise(resolve => queueMicrotask(resolve));
    signal.throwIfAborted();
  });
  await assert.rejects(getGame(redisEnv, "x"), StoreError);
  assert.equal(timeout, STORE_TIMEOUT_MS);
});

test("a failed Redis write returns 503 rather than a successful answer", async t => {
  t.mock.method(console, "error", () => {});
  const game = await seed();
  t.mock.method(globalThis, "fetch", async (_, options) => {
    const [command] = JSON.parse(options.body);
    return command === "GET" ? Response.json({ result: JSON.stringify(game) }) : Response.json({ error: "write failed" });
  });
  assert.equal((await callPages("ask", { gameId: game.gameId, question: "Это живое?" }, redisEnv)).status, 503);
});

test("memory reads are isolated and expired games cannot be resumed", async t => {
  const game = await seed();
  const copy = await getGame(memoryEnv, game.gameId);
  copy.left = 0;
  assert.equal((await getGame(memoryEnv, game.gameId)).left, 10);
  const later = Date.now() + GAME_TTL_SECONDS * 1000 + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(await getGame(memoryEnv, game.gameId), null);
});

test("Node HTTP server serves the UI and a complete API round trip", { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ["dev-local.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...memoryEnv, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
  });
  const ready = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => chunk.toString()),
    once(child, "exit").then(([code]) => { throw new Error(`Server exited early: ${code}`); }),
  ]);
  const base = ready.match(/http:\/\/localhost:\d+/)?.[0];
  assert.ok(base);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  assert.match(html, /timeoutMs = 20000/);
  const created = await (await fetch(`${base}/api/new`, { method: "POST", body: "{}" })).json();
  assert.ok(created.gameId);
  const asked = await fetch(`${base}/api/ask`, {
    method: "POST", body: JSON.stringify({ gameId: created.gameId, question: "Это живое?" }),
  });
  assert.equal(asked.status, 200);
  assert.equal((await asked.json()).left, created.left - 1);
  assert.equal((await fetch(`${base}/api/new`)).status, 405);
  assert.equal((await fetch(`${base}/api/missing`, { method: "POST", body: "{}" })).status, 404);
});
