import test from "node:test";
import assert from "node:assert/strict";
import nodeHint from "../api/hint.js";
import { onRequest as pagesHint } from "../functions/api/hint.js";
import { onRequest as pagesAsk } from "../functions/api/ask.js";
import { AI_TASKS, HINT_LIMIT, GAME_TTL_SECONDS, OPENROUTER_MODEL } from "../shared/config.js";
import { getGame, saveGame, StoreConflictError } from "../shared/store.js";
import { hintCandidates } from "../shared/hints.js";

const env = { STORE_KIND: "memory", OPENROUTER_API_KEY: "test-key", MODEL_HINT: "test/hint" };

async function seed(overrides = {}) {
  const game = {
    gameId: crypto.randomUUID(), secret: "кошка", left: 10, over: false, win: false,
    history: [], hints: [], version: 0, createdAt: Date.now(), lastAskAt: 0,
    ...overrides,
  };
  await saveGame(env, game.gameId, game);
  return game;
}

async function callPages(body, settings = env, method = "POST", handler = pagesHint) {
  const response = await handler({
    request: new Request("https://game.example.test/api/hint", {
      method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }),
    env: settings,
  });
  return { status: response.status, body: await response.json() };
}

async function callNode(body, settings = env, method = "POST") {
  const keys = ["STORE_KIND", "OPENROUTER_API_KEY", "MODEL_HINT", "AI_PROVIDER", "OPENROUTER_BASE_URL"];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (settings[key] === undefined) delete process.env[key];
      else process.env[key] = settings[key];
    }
    let result;
    await nodeHint({ method, body }, { statusCode: 200, json(body) { result = { status: this.statusCode, body }; } });
    return result;
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

function modelReply(key) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ key, text: "Секрет — кошка" }) } }] });
}

for (const [platform, call] of [["Node", callNode], ["Pages", callPages]]) {
  test(`${platform}: hint uses all history and safe text without consuming a question`, async t => {
    let sent;
    const history = [
      { q: "Это живое?", a: "да" },
      ...Array.from({ length: 7 }, () => ({ q: "Какого цвета?", a: "не знаю" })),
    ];
    const game = await seed({ history, lastAskAt: Date.now() });
    t.mock.method(globalThis, "fetch", async (_, options) => {
      sent = JSON.parse(options.body);
      return modelReply("atHome");
    });
    const result = await call({ gameId: game.gameId, secret: "собака", hintsUsed: -100 });
    assert.equal(result.status, 200);
    assert.equal(result.body.left, 10);
    assert.equal(result.body.hintsUsed, 1);
    assert.equal(result.body.hintsLeft, 1);
    assert.equal(result.body.hintLimit, HINT_LIMIT);
    assert.equal(result.body.secret, null);
    assert.deepEqual(result.body.history, history);
    assert.deepEqual(result.body.hints, [{ text: "Попробуй узнать, бывает ли это дома." }]);
    assert.equal(JSON.stringify(result.body).includes("кошка"), false);
    assert.equal(sent.model, OPENROUTER_MODEL);
    assert.equal(sent.max_tokens, AI_TASKS.hint.maxTokens);
    const data = JSON.parse(sent.messages[1].content);
    assert.equal(data.secret, "кошка");
    assert.deepEqual(data.history, history);
    assert.equal(data.candidates.some(item => ["living", "canMove", "biggerThanCat"].includes(item.key)), false);
    const saved = await getGame(env, game.gameId);
    assert.equal(saved.lastAskAt, game.lastAskAt);
    assert.equal(saved.left, game.left);
    assert.equal(saved.hints[0].key, "atHome");
    assert.equal(saved.version, 1);
  });

  test(`${platform}: a flight answer leads to a new related question without revealing the answer`, async t => {
    const history = [{ q: "Оно умеет летать?", a: "да" }];
    const game = await seed({ secret: "голубь", history, left: 9 });
    let candidates;
    t.mock.method(globalThis, "fetch", async (_, options) => {
      const { messages } = JSON.parse(options.body);
      candidates = JSON.parse(messages[1].content).candidates.map(item => item.key);
      return modelReply("canSwim");
    });
    const result = await call({ gameId: game.gameId });
    assert.equal(result.status, 200);
    assert.deepEqual(candidates, ["canSwim", "livesOnFarm", "atHome"]);
    assert.deepEqual(result.body.hints, [{ text: "Попробуй узнать, умеет ли это плавать." }]);
    assert.deepEqual(result.body.history, history);
    assert.equal(result.body.left, 9);
    assert.equal(result.body.secret, null);
    assert.equal((await getGame(env, game.gameId)).hints[0].afterTurn, 1);
  });

  test(`${platform}: two hints exhaust the server limit and cannot repeat directions`, async t => {
    const sent = [];
    const game = await seed();
    t.mock.method(globalThis, "fetch", async (_, options) => {
      const data = JSON.parse(JSON.parse(options.body).messages[1].content);
      sent.push(data);
      return modelReply(sent.length === 1 ? "atHome" : "handheld");
    });
    assert.equal((await call({ gameId: game.gameId })).body.hintsUsed, 1);
    const second = await call({ gameId: game.gameId });
    assert.equal(second.status, 200);
    assert.equal(second.body.hintsUsed, 2);
    assert.equal(second.body.hintsLeft, 0);
    assert.equal(second.body.left, 10);
    assert.equal(sent[1].candidates.some(item => item.key === "atHome"), false);
    assert.equal(sent[1].hints[0].key, "atHome");
    assert.deepEqual(sent[0].candidates.map(item => item.key).sort(), ["atHome", "handheld", "living"]);
    assert.equal(sent[1].candidates.some(item => item.key === "living"), false);
    const third = await call({ gameId: game.gameId, hintLimit: 99, hints: [] });
    assert.equal(third.status, 409);
    assert.equal(third.body.hintsUsed, 2);
    assert.equal(sent.length, 2);
    assert.equal((await getGame(env, game.gameId)).hints.length, 2);
  });

  test(`${platform}: hint errors keep both budgets and the question history intact`, async t => {
    const game = await seed();
    const fetchMock = t.mock.method(globalThis, "fetch");
    for (const reply of ["Секрет — кошка", '{"key":"not-a-direction"}', '{"key":"biggerThanCat"}', "network", "quota"]) {
      fetchMock.mock.mockImplementation(async () => {
        if (reply === "network") throw new TypeError("Network down");
        if (reply === "quota") return new Response("{}", { status: 429 });
        return Response.json({ choices: [{ message: { content: reply } }] });
      });
      const result = await call({ gameId: game.gameId });
      assert.equal(result.status, 503);
      assert.equal("hints" in result.body, false);
      assert.deepEqual(await getGame(env, game.gameId), game);
    }
  });

  test(`${platform}: no key, invalid input, finished game and exhausted directions do not call AI`, async t => {
    const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Must not call AI"); });
    const game = await seed();
    assert.equal((await call({ gameId: game.gameId }, { ...env, OPENROUTER_API_KEY: "" })).status, 503);
    for (const input of [null, {}, { gameId: [] }, { gameId: " " }]) {
      assert.equal((await call(input)).status, 400);
    }
    assert.equal((await call({ gameId: "missing" })).status, 404);
    assert.equal((await call({}, env, "GET")).status, 405);
    const finished = await seed({ over: true });
    assert.equal((await call({ gameId: finished.gameId })).status, 409);
    const allQuestions = ["Это живое?", "Это дома?", "В руке?", "Это школьное?", "Это летает?", "Это плавает?", "Это игрушка?", "Это в лесу?", "Это на ферме?", "Есть крылья?", "Есть лапы?"];
    const known = await seed({ history: allQuestions.map(q => ({ q, a: "да" })) });
    const noDirections = await call({ gameId: known.gameId });
    assert.equal(noDirections.status, 409);
    assert.equal(noDirections.body.code, "no_hint_directions");
    assert.equal(noDirections.body.hintsUsed, 0);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.deepEqual(await getGame(env, game.gameId), game);
  });

  test(`${platform}: old games without hint fields receive a fresh hint budget`, async t => {
    t.mock.method(globalThis, "fetch", async () => modelReply("atHome"));
    const game = await seed();
    delete game.hints;
    delete game.version;
    await saveGame(env, game.gameId, game);
    const result = await call({ gameId: game.gameId });
    assert.equal(result.status, 200);
    assert.equal(result.body.hintsUsed, 1);
    assert.equal(result.body.left, 10);
  });
}

test("already-known or equivalent predicates are removed from hint candidates", () => {
  const candidates = hintCandidates({
    secret: "книга", history: [{ q: "Это птица?", a: "нет" }, { q: "Это предмет?", a: "да" }],
    hints: [{ key: "atHome" }],
  }).map(item => item.key);
  for (const key of ["living", "canMove", "atHome", "hasWings"]) assert.equal(candidates.includes(key), false);
  assert.equal(candidates.includes("schoolItem"), true);
});

test("hint directions distinguish remaining words and put more even splits first", () => {
  const game = {
    secret: "голубь",
    history: [
      { q: "Это птица?", a: "да" },
      { q: "Это живое?", a: "нет" }, // An incorrect answer saved by a previous version.
    ],
  };
  const keys = hintCandidates(game).map(item => item.key);
  assert.deepEqual(keys.slice(0, 2), ["handheld", "livesOnFarm"]);
  assert.equal(keys.includes("hasLegs"), false);
  assert.equal(keys.includes("livesInForest"), false);
  assert.equal(keys.includes("canFly"), true);
  assert.equal(keys.includes("atHome"), true);
});

test("hint topics track paraphrases and compound questions without treating them as established facts", () => {
  for (const question of ["А оно летит по воздуху?", "Оно летает и плавает?"]) {
    const keys = hintCandidates({ secret: "голубь", history: [{ q: question, a: "не знаю" }] }).map(item => item.key);
    assert.equal(keys.includes("canFly"), false, question);
    assert.equal(keys.includes("hasWings"), true, question);
    assert.equal(keys.includes("schoolItem"), false, question);
    assert.equal(keys.includes("canSwim"), !question.includes("плавает"), question);
  }
  const age = hintCandidates({ secret: "собака", history: [{ q: "Сколько ему лет?", a: "не знаю" }] });
  assert.equal(age.some(item => item.key === "canFly"), true);

  const answeredFlight = hintCandidates({
    secret: "голубь", history: [{ q: "А оно передвигается по воздуху?", a: "да" }],
  });
  assert.deepEqual(answeredFlight.map(item => item.key), ["canSwim", "livesOnFarm", "atHome"]);

  const turtle = hintCandidates({ secret: "черепаха", history: [{ q: "Оно живёт в воде?", a: "да" }] });
  assert.equal(turtle.some(item => item.key === "canSwim"), true);
  assert.equal(turtle.some(item => item.key === "schoolItem"), false);
});

test("a follow-up hint continues its predecessor until a new question changes the topic", () => {
  const history = [{ q: "Это живое?", a: "да" }];
  const game = { secret: "собака", history, hints: [{ key: "atHome", afterTurn: 1 }] };
  const next = hintCandidates(game).map(item => item.key);
  assert.equal(next.includes("handheld"), true);
  assert.equal(next.includes("canFly"), false);
  game.history.push({ q: "Оно умеет летать?", a: "нет" });
  const changed = hintCandidates(game).map(item => item.key);
  assert.equal(changed.includes("hasWings"), true);
  assert.equal(changed.includes("handheld"), false);
  assert.equal(changed.includes("canFly"), false);
});

test("a hint can change topics when all related directions have been asked", () => {
  const history = [
    "Оно плавает?", "У него есть крылья?", "У него есть лапы?", "Оно бывает дома?",
    "Оно бывает на ферме?", "Оно бывает в лесу?", "Оно умеет летать?",
  ].map(q => ({ q, a: "не знаю" }));
  const keys = hintCandidates({ secret: "голубь", history }).map(item => item.key);
  assert.equal(keys.includes("living"), true);
  assert.equal(keys.includes("canFly"), false);
});

test("a repeated model direction cannot consume a second hint", async t => {
  const game = await seed({ hints: [{ key: "atHome", text: "Попробуй узнать, бывает ли это дома." }] });
  t.mock.method(globalThis, "fetch", async () => modelReply("atHome"));
  assert.equal((await callPages({ gameId: game.gameId })).status, 503);
  assert.deepEqual(await getGame(env, game.gameId), game);
});

test("simultaneous hint requests cannot overwrite each other or exceed the budget", async t => {
  const game = await seed({ hints: [{ key: "handheld", text: "Подсказка" }] });
  const finish = [];
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => finish.push(() => resolve(modelReply("atHome")))));
  const requests = [callPages({ gameId: game.gameId }), callPages({ gameId: game.gameId })];
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  finish.forEach(done => done());
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await getGame(env, game.gameId);
  assert.equal(saved.hints.length, 2);
  assert.equal(saved.left, 10);
});

test("a slow hint cannot undo a question answered while the model was thinking", async t => {
  const game = await seed();
  let finish;
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { finish = () => resolve(modelReply("atHome")); }));
  const pending = callPages({ gameId: game.gameId });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const asked = await callPages({ gameId: game.gameId, question: "Это живое?" }, env, "POST", pagesAsk);
  assert.equal(asked.status, 200);
  finish();
  assert.equal((await pending).status, 409);
  const saved = await getGame(env, game.gameId);
  assert.equal(saved.left, 9);
  assert.deepEqual(saved.history, [{ q: "Это живое?", a: "да" }]);
  assert.deepEqual(saved.hints, []);
});

test("answer snapshots keep previously received hints", async () => {
  const game = await seed({ hints: [{ key: "atHome", text: "Попробуй узнать, бывает ли это дома." }] });
  const asked = await callPages({ gameId: game.gameId, question: "Это живое?" }, env, "POST", pagesAsk);
  assert.equal(asked.body.hintsUsed, 1);
  assert.equal(asked.body.hintsLeft, 1);
  assert.deepEqual(asked.body.hints, [{ text: game.hints[0].text }]);
});

test("Redis writes check revisions atomically and reject stale state", async t => {
  const commands = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    commands.push(JSON.parse(options.body));
    return Response.json({ result: commands.length === 1 ? 1 : 0 });
  });
  const redisEnv = { ...env, STORE_KIND: "upstash", UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "test" };
  const game = { gameId: "game", version: 3, left: 10, hints: [] };
  await saveGame(redisEnv, "game", game, 3);
  assert.equal(commands[0][0], "EVAL");
  assert.match(commands[0][1], /current.version or 0/);
  assert.deepEqual(commands[0].slice(2, 5), [1, "game:game", 3]);
  assert.equal(JSON.parse(commands[0][5]).version, 4);
  assert.equal(commands[0][6], GAME_TTL_SECONDS);
  await assert.rejects(saveGame(redisEnv, "game", game, 3), StoreConflictError);
});

test("a failed Redis save never returns or charges the chosen hint", async t => {
  t.mock.method(console, "error", () => {});
  const game = await seed();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("chat/completions")) return modelReply("atHome");
    const [command] = JSON.parse(options.body);
    return command === "GET" ? Response.json({ result: JSON.stringify(game) }) : Response.json({ error: "write failed" });
  });
  const result = await callPages({ gameId: game.gameId }, {
    ...env, STORE_KIND: "upstash", UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "test",
  });
  assert.equal(result.status, 503);
  assert.equal("hints" in result.body, false);
});
