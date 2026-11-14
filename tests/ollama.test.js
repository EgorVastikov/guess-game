import test from "node:test";
import assert from "node:assert/strict";
import { AIError, hasAIKey, requestAI } from "../shared/ai.js";
import { aiConnection, AI_TASKS, DEFAULT_MODEL, DEFAULT_OLLAMA_MODEL } from "../shared/config.js";
import { chooseHint } from "../shared/hints.js";

test("Ollama is detected on its standard port without treating cloud endpoints as local", () => {
  for (const url of ["http://127.0.0.1:11434/v1", "http://localhost:11434/v1/", "http://host.docker.internal:11434/v1", "http://ollama/v1"]) {
    const env = { OPENROUTER_BASE_URL: url };
    assert.equal(aiConnection(env).provider, "ollama");
    assert.equal(aiConnection(env).defaultModel, DEFAULT_OLLAMA_MODEL);
    assert.equal(hasAIKey(env), true);
  }
  assert.equal(aiConnection({}).provider, "openrouter");
  assert.equal(aiConnection({}).defaultModel, DEFAULT_MODEL);
  assert.equal(hasAIKey({}), false);
  assert.equal(aiConnection({ AI_PROVIDER: "ollama" }).baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(aiConnection({ AI_PROVIDER: "ollama", OPENROUTER_BASE_URL: "http://localhost:8000/v1" }).provider, "ollama");
  assert.equal(aiConnection({ AI_PROVIDER: "openrouter", OPENROUTER_BASE_URL: "http://localhost:11434/v1" }).provider, "openrouter");
  assert.throws(() => aiConnection({ AI_PROVIDER: "typo" }), /AI_PROVIDER/);
});

test("Ollama hints disable thinking and constrain the generated key to available candidates", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent = { url, options, payload: JSON.parse(options.body) };
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"key":"atHome"}' } }] });
  });
  const candidates = [{ key: "atHome", text: "Попробуй узнать, бывает ли это дома." }];
  const hint = await chooseHint({ OPENROUTER_BASE_URL: "http://127.0.0.1:11434/v1", MODEL: "gemma4:e2b" }, {
    secret: "кошка", history: [], hints: [],
  }, candidates);
  assert.equal(hint.key, "atHome");
  assert.equal(sent.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(sent.payload.reasoning_effort, "none");
  assert.equal("reasoning" in sent.payload, false);
  assert.equal(sent.payload.stream, false);
  assert.equal(sent.payload.max_tokens, AI_TASKS.hint.maxTokens);
  assert.equal(sent.payload.model, "gemma4:e2b");
  assert.equal(sent.options.headers.Authorization, "Bearer ollama");
  assert.equal(sent.payload.response_format.type, "json_schema");
  assert.deepEqual(sent.payload.response_format.json_schema.schema.properties.key.enum, ["atHome"]);
});

test("analysis and vision use their own Ollama JSON schemas; ordinary answers remain text", async t => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: "test" } }] });
  });
  const env = { AI_PROVIDER: "ollama", MODEL: "gemma4:e4b" };
  await requestAI(env, "answer", { secret: "кошка", question: "Это живое?" });
  await requestAI(env, "analysis", { bestCandidates: [{ turn: 2 }, { turn: 4 }] });
  await requestAI(env, "analysis", { bestCandidates: [] });
  await requestAI(env, "vision", { imageDataUrl: "data:image/png;base64,AAAA", secret: "PRIVATE_SECRET" });
  assert.equal("response_format" in sent[0], false);
  assert.deepEqual(sent[1].response_format.json_schema.schema.properties.bestQuestion.anyOf[0].properties.turn.enum, [2, 4]);
  assert.deepEqual(sent[2].response_format.json_schema.schema.properties.bestQuestion, { type: "null" });
  assert.equal(sent[3].response_format.json_schema.schema.properties.guesses.maxItems, 3);
  assert.equal(JSON.stringify(sent[3].messages).includes("PRIVATE_SECRET"), false);
  assert.ok(sent.every(payload => payload.reasoning_effort === "none"));
});

test("HTTP 200 with a token-limited empty answer is a truncated response, not a valid hint", async t => {
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{ finish_reason: "length", message: { content: "", reasoning: "private model reasoning" } }],
  }));
  await assert.rejects(requestAI({ AI_PROVIDER: "ollama", OPENROUTER_API_KEY: "SECRET_KEY" }, "hint", {
    secret: "SECRET_WORD", candidates: [{ key: "atHome" }],
  }), error => error instanceof AIError && error.code === "truncated_response");
  assert.deepEqual(warnings, ["[ai:hint] provider=ollama code=truncated_response"]);
});

test("OpenRouter keeps its existing reasoning settings and does not receive Ollama-only schema controls", async t => {
  let sent;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: '{"key":"atHome"}' } }] });
  });
  await requestAI({ OPENROUTER_API_KEY: "cloud-test" }, "hint", { candidates: [{ key: "atHome" }] });
  assert.deepEqual(sent.reasoning, { enabled: false });
  assert.equal("reasoning_effort" in sent, false);
  assert.equal("response_format" in sent, false);
});

for (const provider of ["ollama", "openrouter"]) {
  test(`${provider}: vision deadline aborts a slow request and allows for local model loading`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(console, "warn", () => {});
    let signal;
    t.mock.method(globalThis, "fetch", async (_, options) => {
      signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const pending = requestAI({ AI_PROVIDER: provider, OPENROUTER_API_KEY: "test" }, "vision", { imageDataUrl: "data:image/png;base64,AAAA" });
    const rejected = assert.rejects(pending, error => error instanceof AIError && error.code === "timeout");
    const deadline = provider === "ollama" ? AI_TASKS.vision.ollamaTimeoutMs : AI_TASKS.vision.timeoutMs;
    if (provider === "ollama") {
      t.mock.timers.tick(AI_TASKS.vision.timeoutMs);
      assert.equal(signal.aborted, false, "A locally loading model should outlive the cloud deadline");
      t.mock.timers.tick(deadline - AI_TASKS.vision.timeoutMs - 1);
    } else t.mock.timers.tick(deadline - 1);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal.aborted, true);
  });
}
