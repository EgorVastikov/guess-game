import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nodeAnalysis from "../api/analysis.js";
import { onRequest as pagesAnalysis } from "../functions/api/analysis.js";
import { onRequest as pagesAsk } from "../functions/api/ask.js";
import { ANALYSIS_PENDING_MS, AI_TASKS } from "../shared/config.js";
import { gameStats } from "../shared/analysis.js";
import { getGame, saveGame } from "../shared/store.js";

const env = { STORE_KIND: "memory", OPENROUTER_API_KEY: "test", MODEL_ANALYSIS: "test/analysis" };
const goodReport = {
  strength: "Ты начал с общего признака и постепенно сузил поиск.",
  bestQuestion: { turn: 1, reason: "Вопрос помог отделить живое от предметов." },
  improvement: "После общего признака попробуй уточнить место обитания.",
  nextQuestion: "Это живёт в лесу?",
};

async function seed(overrides = {}) {
  const game = {
    gameId: crypto.randomUUID(), secret: "кошка", left: 7, over: true, win: true,
    history: [{ q: "Это живое?", a: "да" }, { q: "Это бывает дома?", a: "да" }, { q: "Это кошка?", a: "да" }],
    hints: [{ key: "atHome", text: "Попробуй узнать, бывает ли это дома." }],
    version: 0, createdAt: Date.now(), lastAskAt: Date.now(), ...overrides,
  };
  await saveGame(env, game.gameId, game);
  return game;
}

async function callPages(body, settings = env, method = "POST", handler = pagesAnalysis) {
  const response = await handler({
    request: new Request("https://game.example.test/api/analysis", {
      method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }), env: settings,
  });
  return { status: response.status, body: await response.json() };
}

async function callNode(body, settings = env, method = "POST") {
  const keys = ["STORE_KIND", "OPENROUTER_API_KEY", "MODEL_ANALYSIS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = settings[key] ?? "";
    let result;
    await nodeAnalysis({ method, body }, { statusCode: 200, json(body) { result = { status: this.statusCode, body }; } });
    return result;
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function reply(report = goodReport) {
  return Response.json({ choices: [{ message: { content: typeof report === "string" ? report : JSON.stringify(report) } }] });
}

for (const [platform, call] of [["Node", callNode], ["Pages", callPages]]) {
  test(`${platform}: completed game analysis uses real history and server-owned facts`, async t => {
    let sent;
    const game = await seed({ history: Array.from({ length: 10 }, (_, i) => ({ q: i === 0 ? "Это живое?" : `Вопрос ${i}?`, a: "да" })) });
    t.mock.method(globalThis, "fetch", async (_, options) => {
      sent = JSON.parse(options.body);
      return reply({ ...goodReport, stats: { turns: 999 }, bestQuestion: { ...goodReport.bestQuestion, question: "Выдуманный вопрос" } });
    });
    const result = await call({ gameId: game.gameId, history: [], secret: "собака", win: false });
    assert.equal(result.status, 200);
    assert.equal(result.body.cached, false);
    const report = result.body.analysis;
    assert.equal(report.stats.turns, 10);
    assert.equal(report.stats.hintsUsed, 1);
    assert.equal(report.bestQuestion.question, game.history[0].q);
    assert.equal(report.bestQuestion.answer, "да");
    assert.equal(report.strength, goodReport.strength);
    assert.equal(report.improvement, goodReport.improvement);
    assert.equal(report.nextQuestion, goodReport.nextQuestion);
    assert.equal(typeof report.generatedAt, "number");
    const input = JSON.parse(sent.messages[1].content);
    assert.deepEqual(input.history, game.history);
    assert.deepEqual(input.hints, game.hints);
    assert.equal(input.secret, "кошка");
    assert.equal(input.win, true);
    assert.deepEqual(input.stats, gameStats(game));
    assert.equal(sent.model, "test/analysis");
    assert.equal(sent.max_tokens, AI_TASKS.analysis.maxTokens);
    const saved = await getGame(env, game.gameId);
    assert.deepEqual(saved.analysis, report);
    assert.equal(saved.analysisPending, undefined);
    assert.equal(saved.left, game.left);
    assert.deepEqual(saved.history, game.history);
    assert.deepEqual(saved.hints, game.hints);
    assert.equal(saved.win, true);
  });

  test(`${platform}: cached analysis is reused even without an AI key`, async t => {
    const game = await seed();
    const fetchMock = t.mock.method(globalThis, "fetch", async () => reply());
    const first = await call({ gameId: game.gameId });
    const second = await call({ gameId: game.gameId }, { ...env, OPENROUTER_API_KEY: "" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.cached, true);
    assert.deepEqual(second.body.analysis, first.body.analysis);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test(`${platform}: unfinished game cannot reveal analytics through a forged request`, async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected AI request"); });
    const game = await seed({ over: false, win: false });
    const result = await call({ gameId: game.gameId, over: true, secret: "собака" });
    assert.equal(result.status, 409);
    assert.equal("analysis" in result.body, false);
    assert.equal(JSON.stringify(result.body).includes("кошка"), false);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.deepEqual(await getGame(env, game.gameId), game);
  });

  test(`${platform}: missing game, invalid input, no key and no history avoid AI`, async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected AI request"); });
    for (const input of [null, {}, { gameId: [] }, { gameId: " " }]) assert.equal((await call(input)).status, 400);
    assert.equal((await call({ gameId: "missing" })).status, 404);
    assert.equal((await call({}, env, "GET")).status, 405);
    const game = await seed();
    const noKey = await call({ gameId: game.gameId }, { ...env, OPENROUTER_API_KEY: "" });
    assert.equal(noKey.status, 503);
    assert.equal(noKey.body.stats.turns, 3);
    assert.deepEqual(await getGame(env, game.gameId), game);
    const empty = await seed({ history: [] });
    assert.equal((await call({ gameId: empty.gameId })).status, 409);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test(`${platform}: failed/invalid analysis releases the claim without caching a result`, async t => {
    const game = await seed();
    const fetchMock = t.mock.method(globalThis, "fetch");
    for (const invalid of ["quota", "network", "invalid-json", { ...goodReport, bestQuestion: { turn: 99, reason: "Нет такого хода" } }, { ...goodReport, bestQuestion: { turn: "1", reason: "Неверный тип" } }, { ...goodReport, improvement: "" }, { ...goodReport, strength: "x".repeat(601) }, { ...goodReport, nextQuestion: "x".repeat(301) }]) {
      fetchMock.mock.mockImplementation(async () => {
        if (invalid === "quota") return new Response("{}", { status: 429 });
        if (invalid === "network") throw new TypeError("Network down");
        return reply(invalid);
      });
      const result = await call({ gameId: game.gameId });
      assert.equal(result.status, 503);
      assert.equal(result.body.stats.turns, game.history.length);
      const saved = await getGame(env, game.gameId);
      assert.equal(saved.analysis, undefined);
      assert.equal(saved.analysisPending, undefined);
      assert.equal(saved.left, game.left);
      assert.deepEqual(saved.history, game.history);
      assert.deepEqual(saved.hints, game.hints);
    }
    fetchMock.mock.mockImplementation(async () => reply());
    assert.equal((await call({ gameId: game.gameId })).status, 200);
  });

  test(`${platform}: a lost game with only unknown answers can omit the best question`, async t => {
    const game = await seed({ win: false, left: 0, history: [{ q: "Какого цвета?", a: "не знаю" }] });
    t.mock.method(globalThis, "fetch", async () => reply({ ...goodReport, bestQuestion: null }));
    const result = await call({ gameId: game.gameId });
    assert.equal(result.status, 200);
    assert.equal(result.body.analysis.bestQuestion, null);
    assert.equal(result.body.analysis.stats.unknownAnswers, 1);
    assert.equal((await getGame(env, game.gameId)).win, false);
  });
}

test("statistics count normalized/equivalent repeats and identify conflicting answers", () => {
  const stats = gameStats({ secret: "кошка", hints: [{}, {}], history: [
    { q: "Это живое?", a: "да" }, { q: "это ЖИВОЕ!!!", a: "да" },
    { q: "Это бывает дома?", a: "да" }, { q: "Это дома?", a: "нет" },
    { q: "Какого цвета?", a: "не знаю" },
  ] });
  assert.deepEqual(stats, {
    turns: 5, hintsUsed: 2, repeats: 2, repeatedTurns: [[1, 2], [3, 4]], unknownAnswers: 1, inconsistentTurns: [3, 4],
  });
});

test("an answer contradicting known features cannot become the best question", async t => {
  const game = await seed({ history: [{ q: "Это живое?", a: "нет" }, { q: "Это бывает дома?", a: "да" }] });
  let input;
  const fetchMock = t.mock.method(globalThis, "fetch", async (_, options) => {
    input = JSON.parse(JSON.parse(options.body).messages[1].content);
    return reply();
  });
  assert.equal((await callPages({ gameId: game.gameId })).status, 503);
  assert.deepEqual(input.stats.inconsistentTurns, [1]);
  assert.deepEqual(input.bestCandidates.map(item => item.turn), [2]);
  fetchMock.mock.mockImplementation(async () => reply({ ...goodReport, bestQuestion: { turn: 2, reason: "Уточняет место" } }));
  const result = await callPages({ gameId: game.gameId });
  assert.equal(result.status, 200);
  assert.equal(result.body.analysis.bestQuestion.turn, 2);
});

test("simultaneous analysis requests share a persisted claim and call AI once", { timeout: 5000 }, async t => {
  const game = await seed();
  let finish;
  const fetchMock = t.mock.method(globalThis, "fetch", () => new Promise(resolve => { finish = () => resolve(reply()); }));
  const first = callPages({ gameId: game.gameId });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const second = await callPages({ gameId: game.gameId });
  assert.equal(second.status, 202);
  assert.equal(second.body.pending, true);
  assert.equal(fetchMock.mock.callCount(), 1);
  finish();
  assert.equal((await first).status, 200);
  assert.equal((await callPages({ gameId: game.gameId })).body.cached, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("racing claims cannot both reach the model", async t => {
  const game = await seed();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => reply());
  const results = await Promise.all([callPages({ gameId: game.gameId }), callPages({ gameId: game.gameId })]);
  assert.ok(results.every(result => [200, 202].includes(result.status)));
  assert.equal(results.filter(result => result.status === 200).length >= 1, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("abandoned analysis claim expires and old games without hint/revision fields still work", async t => {
  const game = await seed({ analysisPending: { startedAt: Date.now() - ANALYSIS_PENDING_MS - 1 } });
  delete game.hints;
  delete game.version;
  await saveGame(env, game.gameId, game);
  t.mock.method(globalThis, "fetch", async () => reply());
  const result = await callPages({ gameId: game.gameId });
  assert.equal(result.status, 200);
  assert.equal(result.body.analysis.stats.hintsUsed, 0);
});

test("a late worker cannot overwrite a report generated after its expired lease", { timeout: 5000 }, async t => {
  const game = await seed();
  const finish = [];
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => finish.push(report => resolve(reply(report)))));
  const first = callPages({ gameId: game.gameId });
  while (finish.length < 1) await new Promise(resolve => setImmediate(resolve));
  const later = Date.now() + ANALYSIS_PENDING_MS + 1;
  t.mock.method(Date, "now", () => later);
  const second = callPages({ gameId: game.gameId });
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  const newer = { ...goodReport, strength: "Новый разбор" };
  finish[1](newer);
  assert.equal((await second).status, 200);
  finish[0](goodReport);
  const late = await first;
  assert.equal(late.status, 200);
  assert.equal(late.body.cached, true);
  assert.equal(late.body.analysis.strength, newer.strength);
  assert.equal((await getGame(env, game.gameId)).analysis.strength, newer.strength);
});

test("finished-game snapshots include server stats and the cached report", async t => {
  const game = await seed();
  t.mock.method(globalThis, "fetch", async () => reply());
  const report = await callPages({ gameId: game.gameId });
  const asked = await callPages({ gameId: game.gameId, question: "Любой вопрос" }, env, "POST", pagesAsk);
  assert.equal(asked.status, 200);
  assert.deepEqual(asked.body.analysis, report.body.analysis);
  assert.deepEqual(asked.body.stats, gameStats(game));
});

test("Redis save failure cannot return an unsaved analysis", async t => {
  t.mock.method(console, "error", () => {});
  const game = await seed();
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("chat/completions")) return reply();
    const [command] = JSON.parse(options.body);
    if (command === "GET") return Response.json({ result: JSON.stringify(game) });
    writes++;
    return writes === 1 ? Response.json({ result: 1 }) : Response.json({ error: "write failed" });
  });
  const result = await callPages({ gameId: game.gameId }, {
    ...env, STORE_KIND: "upstash", UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "test",
  });
  assert.equal(result.status, 503);
  assert.equal("analysis" in result.body, false);
});

test("HTTP analysis round trip saves and reuses a report through a local AI server", { timeout: 10000 }, async t => {
  let aiCalls = 0;
  const aiServer = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(JSON.parse(raw).messages[1].content);
    assert.equal(data.secret, "кошка");
    assert.equal(data.history.length, 1);
    aiCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodReport) } }] }));
  });
  await new Promise(resolve => aiServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    aiServer.closeAllConnections();
    await new Promise(resolve => aiServer.close(resolve));
  });
  const child = spawn(process.execPath, ["--input-type=module", "-e", "Math.random = () => 0; await import('./dev-local.js');"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env, PORT: "0", OPENROUTER_BASE_URL: `http://127.0.0.1:${aiServer.address().port}` },
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
  const post = async (action, body) => {
    const response = await fetch(`${base}/api/${action}`, { method: "POST", body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const created = await post("new", {});
  const gameId = created.body.gameId;
  assert.equal((await post("analysis", { gameId })).status, 409);
  const finished = await post("ask", { gameId, question: "Это кошка?" });
  assert.equal(finished.body.win, true);
  const first = await post("analysis", { gameId });
  const second = await post("analysis", { gameId });
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  assert.deepEqual(second.body.analysis, first.body.analysis);
  assert.equal(first.body.analysis.stats.turns, 1);
  assert.equal(first.body.analysis.bestQuestion.question, "Это кошка?");
  assert.equal(aiCalls, 1);
});
