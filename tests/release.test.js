import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nodeAsk from "../api/ask.js";
import { onRequest as pagesAsk } from "../functions/api/ask.js";
import { saveGame } from "../shared/store.js";
import { SECRETS, extractGuessCandidate, normalize } from "../shared/rules.js";

const env = { STORE_KIND: "memory", OPENROUTER_API_KEY: "" };

for (const platform of ["Node", "Pages"]) {
  test(`${platform}: every dictionary secret can be guessed without AI`, async t => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("A dictionary guess must never call AI"); });
    const previous = { STORE_KIND: process.env.STORE_KIND, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
    process.env.STORE_KIND = "memory";
    process.env.OPENROUTER_API_KEY = "";
    try {
      for (const secret of SECRETS) {
        const guesses = [secret, `Это ${secret}?`, `А это ${secret}?`, `Мой ответ: ${secret}`, `Моя догадка: ${secret}`];
        for (const question of guesses) {
          assert.equal(extractGuessCandidate(normalize(question)), normalize(secret), question);
          const gameId = crypto.randomUUID();
          await saveGame(env, gameId, { gameId, secret, left: 10, over: false, win: false, history: [], lastAskAt: 0 });
          let status, body;
          if (platform === "Node") {
            await nodeAsk({ method: "POST", body: { gameId, question } }, {
              statusCode: 200, json(result) { status = this.statusCode; body = result; },
            });
          } else {
            const response = await pagesAsk({ request: new Request("https://game.example.test/api/ask", {
              method: "POST", body: JSON.stringify({ gameId, question }),
            }), env });
            status = response.status;
            body = await response.json();
          }
          assert.equal(status, 200, question);
          assert.equal(body.win, true, question);
          assert.equal(body.over, true, question);
          assert.equal(body.secret, secret, question);
          assert.equal(body.left, 9, question);
        }
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}

test("dictionary guesses still distinguish wrong guesses from feature questions", () => {
  assert.equal(extractGuessCandidate("это белка"), "белка");
  assert.equal(extractGuessCandidate("это рыба"), "рыба");
  for (const question of ["это белое", "это живое", "это больше кошки", "это школьная вещь"]) {
    assert.equal(extractGuessCandidate(question), null);
  }
});

test("static server refuses malformed paths and paths into similarly named sibling folders", { timeout: 10000 }, async t => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const sibling = fs.mkdtempSync(path.join(root, "public-check-"));
  const probe = path.join(sibling, "probe.txt");
  fs.writeFileSync(probe, "private sibling content");
  t.after(() => { fs.unlinkSync(probe); fs.rmdirSync(sibling); });
  const child = spawn(process.execPath, ["dev-local.js"], {
    cwd: root, env: { ...process.env, ...env, PORT: "0", AI_PROVIDER: "openrouter", OPENROUTER_BASE_URL: "https://router.invalid/v1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, "exit"); child.kill(); await stopped;
    }
  });
  const ready = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => chunk.toString()),
    once(child, "exit").then(([code]) => { throw new Error(`Server exited early: ${code}`); }),
  ]);
  const base = ready.match(/http:\/\/localhost:\d+/)?.[0];
  assert.ok(base);
  const escape = encodeURIComponent(`../${path.basename(sibling)}/probe.txt`);
  const response = await fetch(`${base}/${escape}`);
  assert.equal(response.status, 400);
  assert.equal((await response.text()).includes("private sibling content"), false);
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/%00index.html`)).status, 400);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/drawing.js`)).status, 200);
});
