import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nodeNew from "../api/new.js";
import nodeDraw from "../api/draw.js";
import nodeConfirm from "../api/confirm.js";
import { onRequest as pagesNew } from "../functions/api/new.js";
import { onRequest as pagesDraw } from "../functions/api/draw.js";
import { onRequest as pagesConfirm } from "../functions/api/confirm.js";
import { onRequest as pagesAsk } from "../functions/api/ask.js";
import { onRequest as pagesHint } from "../functions/api/hint.js";
import { onRequest as pagesAnalysis } from "../functions/api/analysis.js";
import { AI_TASKS, MAX_IMAGE_BYTES, MAX_REQUEST_BYTES } from "../shared/config.js";
import { getGame } from "../shared/store.js";

// A tiny PNG fixture tests image transport, not recognition quality.
const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const env = { STORE_KIND: "memory", OPENROUTER_API_KEY: "test", MODEL_VISION: "test/vision" };
const nodeHandlers = { new: nodeNew, draw: nodeDraw, confirm: nodeConfirm };
const pageHandlers = { new: pagesNew, draw: pagesDraw, confirm: pagesConfirm, ask: pagesAsk, hint: pagesHint, analysis: pagesAnalysis };

async function callNode(action, body, settings = env, method = "POST") {
  const keys = ["STORE_KIND", "OPENROUTER_API_KEY", "MODEL_VISION"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = settings[key] ?? "";
    let result;
    await nodeHandlers[action]({ method, body }, { statusCode: 200, json(body) { result = { status: this.statusCode, body }; } });
    return result;
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function callPages(action, body, settings = env, method = "POST") {
  const response = await pageHandlers[action]({ request: new Request(`https://game.example.test/api/${action}`, {
    method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }), env: settings });
  return { status: response.status, body: await response.json() };
}

function reply(value = { guesses: ["кошка", "лиса"], question: "Это животное?" }) {
  return Response.json({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });
}

for (const [platform, call] of [["Node", callNode], ["Pages", callPages]]) {
  test(`${platform}: drawing session is separate and has no secret`, async () => {
    const result = await call("new", { mode: "drawing", secret: "FORBIDDEN_SECRET", attemptsUsed: 99 });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "drawing");
    assert.equal(result.body.attemptsUsed, 0);
    assert.equal(result.body.latestAttempt, null);
    assert.equal(result.body.over, false);
    const stored = await getGame(env, result.body.gameId);
    assert.equal("secret" in stored, false);
    assert.equal("history" in stored, false);
    assert.equal((await call("new", { mode: "unknown" })).status, 400);
  });

  test(`${platform}: vision receives only the image and saves text without storing PNG`, async t => {
    const created = await call("new", { mode: "drawing" });
    let sent;
    t.mock.method(globalThis, "fetch", async (_, options) => { sent = JSON.parse(options.body); return reply(); });
    const result = await call("draw", { gameId: created.body.gameId, imageDataUrl: IMAGE, secret: "FORBIDDEN_SECRET", history: ["HIDDEN_HISTORY"] });
    assert.equal(result.status, 200);
    assert.equal(result.body.attemptsUsed, 1);
    assert.deepEqual(result.body.latestAttempt.guesses, ["кошка", "лиса"]);
    assert.equal(result.body.latestAttempt.feedback, null);
    assert.equal(sent.model, "test/vision");
    assert.equal(sent.max_tokens, AI_TASKS.vision.maxTokens);
    assert.equal(sent.messages[1].content[1].image_url.url, IMAGE);
    assert.equal(JSON.stringify(sent.messages).includes("FORBIDDEN_SECRET"), false);
    assert.equal(JSON.stringify(sent.messages).includes("HIDDEN_HISTORY"), false);
    const saved = await getGame(env, created.body.gameId);
    assert.equal(JSON.stringify(saved).includes(IMAGE), false);
    assert.equal("imageDataUrl" in saved, false);
    assert.equal(saved.attemptsUsed, 1);
  });

  test(`${platform}: player can reject, redraw and confirm the latest guess`, async t => {
    t.mock.method(globalThis, "fetch", async () => reply());
    const created = await call("new", { mode: "drawing" });
    const gameId = created.body.gameId;
    const first = await call("draw", { gameId, imageDataUrl: IMAGE });
    const attemptId = first.body.latestAttempt.id;
    assert.equal((await call("confirm", { gameId, attemptId, guessed: false })).body.over, false);
    assert.equal((await call("confirm", { gameId, attemptId, guessed: false })).status, 200);
    assert.equal((await call("confirm", { gameId, attemptId, guessed: true })).status, 409);
    const second = await call("draw", { gameId, imageDataUrl: IMAGE });
    assert.equal(second.body.attemptsUsed, 2);
    assert.notEqual(second.body.latestAttempt.id, attemptId);
    assert.equal((await call("confirm", { gameId, attemptId, guessed: true })).status, 409);
    const confirmed = await call("confirm", { gameId, attemptId: second.body.latestAttempt.id, guessed: true });
    assert.equal(confirmed.body.over, true);
    assert.equal((await call("confirm", { gameId, attemptId: second.body.latestAttempt.id, guessed: true })).status, 200);
    assert.equal((await call("draw", { gameId, imageDataUrl: IMAGE })).status, 409);
  });

  test(`${platform}: empty guesses require a clarification and cannot be marked correct`, async t => {
    t.mock.method(globalThis, "fetch", async () => reply({ guesses: [], question: "Можешь дорисовать детали?" }));
    const created = await call("new", { mode: "drawing" });
    const gameId = created.body.gameId;
    const result = await call("draw", { gameId, imageDataUrl: IMAGE });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.latestAttempt.guesses, []);
    const attemptId = result.body.latestAttempt.id;
    assert.equal((await call("confirm", { gameId, attemptId, guessed: true })).status, 409);
    assert.equal((await call("confirm", { gameId, attemptId, guessed: false })).status, 200);
  });

  test(`${platform}: bad images, missing sessions and invalid confirmation never call the model`, async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Must not call AI"); });
    const created = await call("new", { mode: "drawing" });
    const gameId = created.body.gameId;
    for (const imageDataUrl of [null, "", "https://example.com/image.png", "data:image/jpeg;base64,AAAA", "data:image/png;base64,????", "data:image/png;base64,AAAA"]) {
      assert.equal((await call("draw", { gameId, imageDataUrl })).status, 400);
    }
    const bytes = Buffer.from(IMAGE.split(",")[1], "base64");
    bytes.writeUInt32BE(4096, 16);
    assert.equal((await call("draw", { gameId, imageDataUrl: `data:image/png;base64,${bytes.toString("base64")}` })).status, 400);
    const large = "data:image/png;base64," + "A".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);
    assert.equal((await call("draw", { gameId, imageDataUrl: large })).status, 413);
    assert.equal((await call("draw", { gameId, imageDataUrl: IMAGE }, { ...env, OPENROUTER_API_KEY: "" })).status, 503);
    assert.equal((await call("draw", { gameId: "missing", imageDataUrl: IMAGE })).status, 404);
    assert.equal((await call("draw", { gameId: [] })).status, 400);
    assert.equal((await call("draw", {}, env, "GET")).status, 405);
    assert.equal((await call("confirm", { gameId, attemptId: "missing", guessed: "true" })).status, 400);
    assert.equal((await call("confirm", { gameId, attemptId: "missing", guessed: true })).status, 409);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal((await getGame(env, gameId)).attemptsUsed, 0);
  });

  test(`${platform}: AI errors and malformed guesses do not change the drawing session`, async t => {
    const created = await call("new", { mode: "drawing" });
    const gameId = created.body.gameId;
    const original = await getGame(env, gameId);
    const fetchMock = t.mock.method(globalThis, "fetch");
    for (const value of ["network", "quota", "not-json", { guesses: [] }, { guesses: "кошка" }, { guesses: ["a", "b", "c", "d"] }, { guesses: ["x".repeat(81)] }, { guesses: ["кошка"], question: 1 }]) {
      fetchMock.mock.mockImplementation(async () => {
        if (value === "network") throw new TypeError("Network unavailable");
        if (value === "quota") return new Response("{}", { status: 429 });
        return reply(value);
      });
      assert.equal((await call("draw", { gameId, imageDataUrl: IMAGE })).status, 503);
      assert.deepEqual(await getGame(env, gameId), original);
    }
  });
}

test("word and drawing endpoints reject each other's game identifiers", async () => {
  const drawing = await callPages("new", { mode: "drawing" });
  const word = await callPages("new", {});
  for (const action of ["ask", "hint", "analysis"]) {
    assert.equal((await callPages(action, { gameId: drawing.body.gameId, question: "Это живое?" })).status, 409);
  }
  for (const action of ["draw", "confirm"]) {
    assert.equal((await callPages(action, { gameId: word.body.gameId, imageDataUrl: IMAGE, guessed: true })).status, 409);
  }
});

test("parallel guesses cannot overwrite each other or inflate the attempt count", { timeout: 5000 }, async t => {
  const created = await callPages("new", { mode: "drawing" });
  const gameId = created.body.gameId;
  const finish = [];
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => finish.push(() => resolve(reply()))));
  const calls = [callPages("draw", { gameId, imageDataUrl: IMAGE }), callPages("draw", { gameId, imageDataUrl: IMAGE })];
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  finish.forEach(done => done());
  assert.deepEqual((await Promise.all(calls)).map(result => result.status).sort(), [200, 409]);
  assert.equal((await getGame(env, gameId)).attemptsUsed, 1);
});

test("a late model response cannot undo a confirmed win", { timeout: 5000 }, async t => {
  const created = await callPages("new", { mode: "drawing" });
  const gameId = created.body.gameId;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => reply());
  const first = await callPages("draw", { gameId, imageDataUrl: IMAGE });
  let finish;
  fetchMock.mock.mockImplementation(() => new Promise(resolve => { finish = () => resolve(reply({ guesses: ["собака"] })); }));
  const pending = callPages("draw", { gameId, imageDataUrl: IMAGE });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await callPages("confirm", { gameId, attemptId: first.body.latestAttempt.id, guessed: true })).status, 200);
  finish();
  assert.equal((await pending).status, 409);
  const saved = await getGame(env, gameId);
  assert.equal(saved.over, true);
  assert.deepEqual(saved.latestAttempt.guesses, ["кошка", "лиса"]);
});

test("Pages stops reading oversized streamed requests before parsing JSON", async () => {
  const response = await pagesDraw({ request: new Request("https://game.example.test/api/draw", {
    method: "POST", body: JSON.stringify({ ignored: "x".repeat(MAX_REQUEST_BYTES) }),
  }), env });
  assert.equal(response.status, 413);
});

test("HTTP drawing round trip supports rejection, redraw and confirmation", { timeout: 10000 }, async t => {
  let aiCalls = 0;
  const aiServer = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    assert.equal(payload.messages[1].content[1].image_url.url, IMAGE);
    aiCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ guesses: ["кошка"], question: null }) } }] }));
  });
  await new Promise(resolve => aiServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => { aiServer.closeAllConnections(); await new Promise(resolve => aiServer.close(resolve)); });
  const child = spawn(process.execPath, ["dev-local.js"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, ...env, PORT: "0", OPENROUTER_BASE_URL: `http://127.0.0.1:${aiServer.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; } });
  const ready = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => chunk.toString()),
    once(child, "exit").then(([code]) => { throw new Error(`Server exited early: ${code}`); }),
  ]);
  const base = ready.match(/http:\/\/localhost:\d+/)?.[0];
  const post = async (action, body) => {
    const response = await fetch(`${base}/api/${action}`, { method: "POST", body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await fetch(`${base}/drawing.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/draw`)).status, 405);
  const created = await post("new", { mode: "drawing" });
  const gameId = created.body.gameId;
  const first = await post("draw", { gameId, imageDataUrl: IMAGE });
  assert.equal(first.status, 200);
  assert.equal((await post("confirm", { gameId, attemptId: first.body.latestAttempt.id, guessed: false })).body.over, false);
  const second = await post("draw", { gameId, imageDataUrl: IMAGE });
  assert.equal((await post("confirm", { gameId, attemptId: second.body.latestAttempt.id, guessed: true })).body.over, true);
  assert.equal(second.body.attemptsUsed, 2);
  assert.equal(aiCalls, 2);
  assert.equal((await post("draw", { ignored: "x".repeat(MAX_REQUEST_BYTES) })).status, 413);
});
