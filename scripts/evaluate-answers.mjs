import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { aiConnection } from "../shared/config.js";
import { buildMessages } from "../shared/prompts.js";
import * as currentGame from "../shared/game.js";
import * as currentStore from "../shared/store.js";

const CASES = [
  ["усы","кошка","У неё есть усы?","да"],
  ["хвост","кошка","Есть ли у этого хвост?","да"],
  ["перепонки","утка","У неё между пальцами перепонки?","да"],
  ["зонтик","зонт","Его раскрывают над головой, когда идёт дождь?","да"],
  ["измерение","линейка","Можно ли этим измерить длину?","да"],
  ["звонок","телефон","По нему можно позвонить другу?","да"],
  ["спинка","рюкзак","Это носят за спиной?","да"],
  ["зеркалить","тетрадь","Эта вещь предназначена, чтобы смотреться в неё?","нет"],
  ["назначение","ложка","Ей обычно режут хлеб?","нет"],
  ["электричество","ложка","Для обычного использования тут нужны батарейки?","нет"],
  ["отрицание-клюва","воробей","Правда ли, что у него нет клюва?","нет"],
  ["двойной-признак","голубь","Оно летает и плавает?","нет"],
  ["два-назначения","ручка","Это предназначено для письма и для измерения длины?","нет"],
  ["четыре-лапы","утка","У него четыре лапы?","нет"],
  ["четыре-ноги","лошадь","У неё четыре ноги?","да"],
  ["время","кошка","Сколько ей лет?","не знаю"],
  ["цвет","собака","Какого это цвета?","не знаю"],
  ["раскрытие","книга","Что ты загадал?","не знаю"],
  ["размер","зонт","Оно больше?","не знаю"],
  ["неизвестный-материал","чашка","Она сделана именно из фарфора?","не знаю"],
  ["ссылка-на-ход","ложка","А можно пользоваться этим именно так, как в моём первом вопросе?","да",[{"q":"Можно ли этим есть суп?","a":"да"},{"q":"Есть ли тут колёса?","a":"нет"}]],
  ["противоречие-в-истории","собака","Есть ли у него хвост?","да",[{"q":"Это живое?","a":"нет"}]],
  ["лай","собака","Оно лает?","да"],
  ["лай-ложный","кошка","Оно умеет лаять?","нет"],
  ["среда-собака","собака","Оно живёт в воде?","нет"],
  ["среда-рыба","рыба","Оно живёт в воде?","да"],
  ["отрицание-крыльев","голубь","У него нет крыльев?","нет"],
  ["школьная-вещь","тетрадь","Это школьная вещь?","да"],
  ["догадка","ёж","Это ёж?","да",[],true],
  ["догадка-с-вводной","кошка","Мой ответ: кошка","да",[],true],
  ["неверная-догадка","кошка","Это собака?","нет",[],false],
];

const HOLDOUT_CASES = [
  ["use-negative", "зонт", "Им обычно пользуются, чтобы бриться?", "нет"],
  ["use-positive", "карандаш", "Можно ли этим написать слово на листе?", "да"],
  ["use-book", "книга", "Эту вещь читают ради рассказа или информации?", "да"],
  ["use-nodrink", "карандаш", "Из этой вещи обычно пьют чай?", "нет"],
  ["two-legs-goat", "коза", "У неё ровно две ноги?", "нет"],
  ["two-legs-hen", "курица", "У неё ровно две ноги?", "да"],
  ["four-legs-dog", "собака", "У него две пары лап?", "да"],
  ["negative-feather", "петух", "У него вообще нет перьев?", "нет"],
  ["negated-mane", "лошадь", "Правда ли, что у неё нет гривы?", "нет"],
  ["no-horns", "лошадь", "У неё есть рога на голове?", "нет"],
  ["water-bottle", "бутылка", "Её используют, чтобы хранить питьевую воду?", "да"],
  ["pencil-invalid-both", "карандаш", "Им можно рисовать на бумаге и сдавать его вместо билета в автобусе?", "нет"],
  ["pencil-valid-both", "карандаш", "Им можно и писать слова, и рисовать картинки?", "да"],
  ["chair-material", "стул", "Этот стул сделан именно из дуба?", "не знаю"],
  ["phone-charge", "телефон", "Батарея заряжена ровно наполовину?", "не знаю"],
  ["ball-birthday", "мяч", "Этот мяч подарили на день рождения?", "не знаю"],
  ["clock-current-time", "телефон", "Он сейчас показывает ровно полдень?", "не знаю"],
  ["furniture-fold", "стол", "Его обычное назначение — отжимать бельё?", "нет"],
  ["parent-ref", "зонт", "Подходит ли он для того, о чём я спросил в самом первом ходе?", "да", [{"q":"Можно ли им укрыться от дождя?","a":"да"},{"q":"Можно ли его есть?","a":"нет"}]],
  ["prior-short", "собака", "Есть ли у этого зверя сердце?", "да", [{"q":"Это живое?","a":"нет"}]],
];

const ANSWERS = new Set(["да", "нет", "не знаю"]);
const baseAnswerMessage = buildMessages("answer", {})[0];

const { values } = parseArgs({
  options: { baseline: { type: "string" }, offline: { type: "boolean" }, holdout: { type: "boolean" } },
});
if (!values.baseline) {
  console.error("Укажи папку исходной версии: node scripts/evaluate-answers.mjs --baseline <папка> [--offline] [--holdout]");
  process.exit(1);
}

try { process.loadEnvFile?.(); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const baselineRoot = resolve(values.baseline);
const [baselineGame, baselineStore, baselineConfig] = await Promise.all(
  ["game", "store", "config"].map(name => import(pathToFileURL(resolve(baselineRoot, "shared", name + ".js")).href)),
);
const baseline = { ...baselineGame, ...baselineStore };
const current = { ...currentGame, ...currentStore };
const env = values.offline
  ? { AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "offline-evaluation", STORE_KIND: "memory" }
  : { ...process.env, STORE_KIND: "memory" };
const { model, provider, apiKey, baseUrl } = aiConnection(env);
const baselineConnection = baselineConfig.aiConnection(env);
if (!apiKey || model !== baselineConnection.model || provider !== baselineConnection.provider
    || baseUrl !== baselineConnection.baseUrl) {
  console.error("Для сравнения нужен один настроенный провайдер и одна модель для обеих версий.");
  process.exit(1);
}

const originalFetch = globalThis.fetch;
const replies = new Map();
let observation;
let requests = 0;
globalThis.fetch = async (url, options) => {
  observation.called = true;
  const data = JSON.parse(options.body);
  if (observation.basePrompt) data.messages[0] = baseAnswerMessage;
  const body = JSON.stringify(data);
  const key = JSON.stringify([url, body]);
  let response = replies.get(key)?.clone();
  if (!response) {
    requests++;
    response = values.offline
      ? Response.json({ choices: [{ message: { content: "не знаю" } }] })
      : await originalFetch(url, { ...options, body });
    if (response.ok) replies.set(key, response.clone());
  }
  observation.httpStatus = response.status;
  if (response.ok) {
    const parsed = await response.clone().json().catch(() => null);
    const choice = parsed?.choices?.[0];
    const content = choice?.message?.content;
    const answer = typeof content === "string" ? content.trim().toLowerCase().replace(/[.!]$/u, "") : null;
    if (choice?.finish_reason !== "length" && ANSWERS.has(answer)) observation.modelAnswer = answer;
  }
  return response;
};

async function play(version, [, secret, question, , history = []], basePrompt = false) {
  observation = { called: false, basePrompt, modelAnswer: null, httpStatus: null };
  const gameId = randomUUID();
  await version.saveGame(env, gameId, {
    gameId, secret, left: 10, over: false, win: false, history, lastAskAt: 0, version: 0,
  });
  const { status, body } = await version.askQuestion(env, { gameId, question });
  return { ...observation, status, answer: status === 200 ? body.answer : null, win: status === 200 ? body.win : null };
}

function summarize(rows, field, evaluateWins = false) {
  const counts = { cases: rows.length, correct: 0, wrongDefinite: 0, resolvable: 0, definiteOnResolvable: 0, missingOrInvalid: 0 };
  for (const { example: [, , , expected, , win], result } of rows) {
    const answer = result[field];
    if (answer === expected && (!evaluateWins || win === undefined || win === result.win)) counts.correct++;
    if (answer === null) counts.missingOrInvalid++;
    const definite = answer === "да" || answer === "нет";
    if (definite && answer !== expected) counts.wrongDefinite++;
    if (expected !== "не знаю") {
      counts.resolvable++;
      if (definite) counts.definiteOnResolvable++;
    }
  }
  return counts;
}

const rows = [];
try {
  for (const example of values.holdout ? HOLDOUT_CASES : CASES) {
    const before = await play(baseline, example);
    const after = await play(current, example);
    if (!values.offline && rows.length === 0 &&
        ![before.httpStatus, after.httpStatus].some(status => status >= 200 && status < 300)) {
      console.error("Первый запрос к модели не прошёл.", { provider, model, before: before.httpStatus, after: after.httpStatus });
      process.exitCode = 1;
      break;
    }
    const basePrompt = !values.offline && provider === "ollama" && after.called ? await play(current, example, true) : null;
    rows.push({ example, before, after, basePrompt });
  }
} finally {
  globalThis.fetch = originalFetch;
}

if (!process.exitCode) {
  const select = (name, entries = rows) => entries.map(row => ({ example: row.example, result: row[name] }));
  const paired = rows.filter(row => row.before.called && row.after.called);
  const currentModelCases = rows.filter(row => row.after.called);
  console.log(JSON.stringify({
    mode: values.offline ? "server-only, simulated model always says не знаю" : "live",
    provider: values.offline ? null : provider,
    model: values.offline ? null : model,
    uniqueRequests: requests,
    app: {
      before: summarize(select("before"), "answer", true),
      after: summarize(select("after"), "answer", true),
      routedToModel: { before: rows.filter(row => row.before.called).length, after: currentModelCases.length, both: paired.length },
    },
    modelOnly: values.offline ? null : {
      beforeVsAfter: {
        before: summarize(select("before", paired), "modelAnswer"),
        after: summarize(select("after", paired), "modelAnswer"),
      },
      gemmaPrompt: provider === "ollama" ? {
        before: summarize(select("basePrompt", currentModelCases), "modelAnswer"),
        after: summarize(select("after", currentModelCases), "modelAnswer"),
      } : null,
    },
    cases: rows.map(({ example: [id, , , expected, , expectedWin], before, after, basePrompt }) => ({
      id, expected, expectedWin,
      before: { answer: before.answer, win: before.win, model: before.called, ...(values.offline ? {} : { modelAnswer: before.modelAnswer }) },
      after: { answer: after.answer, win: after.win, model: after.called, ...(values.offline ? {} : { modelAnswer: after.modelAnswer }) },
      ...(basePrompt ? { basePromptModelAnswer: basePrompt.modelAnswer } : {}),
    })),
  }, null, 2));
}
