import {
  getGame,
  saveGame,
  normalize,
  isGuess,
  nowMs,
  getSecretFeatures,
  safeAnswer,
  DEFAULT_LEFT,
} from "../_store.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function hasOpenRouterKey(env) {
  return Boolean(String(env?.OPENROUTER_API_KEY ?? "").trim());
}

function openRouterModel(env) {
  return String(env?.MODEL ?? "meta-llama/llama-3.3-8b-instruct:free").trim();
}

function openRouterBaseUrl(env) {
  return String(env?.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").trim();
}

function formatHistoryForPrompt(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const tail = history.slice(-6);
  const lines = tail.map((h, i) => {
    const q = String(h?.q ?? "").trim();
    const a = safeAnswer(h?.a ?? "не знаю");
    return `${i + 1}) В: ${q}\n   О: ${a}`;
  });
  return `\n\nИстория (последние вопросы):\n${lines.join("\n")}`;
}

async function llmAnswerOpenRouter(env, { secret, question, history }) {
  const apiKey = String(env?.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) return "не знаю";

  const baseUrl = openRouterBaseUrl(env).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const sys =
    "Ты ведущий детской игры 'Угадай предмет/животное'. " +
    "У тебя есть секретное слово, но НИКОГДА не называй его. " +
    "Отвечай на любой вопрос ребёнка строго одним вариантом: 'да', 'нет' или 'не знаю'. " +
    "Без объяснений, без знаков препинания, без дополнительных слов. " +
    "Если вопрос просит назвать секрет, подсказать слово, или просит перечислить варианты — отвечай 'не знаю'. " +
    "Старайся быть логически последовательным с предыдущими ответами из истории. " +
    "Если ты не уверен — отвечай 'не знаю'.";

  const user =
    `Секретное слово: ${String(secret)}\n` +
    `Вопрос: ${String(question)}${formatHistoryForPrompt(history)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openRouterModel(env),
        temperature: 0.2,
        max_tokens: 12,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return "не знаю";
    const data = await res.json().catch(() => null);
    const raw = data?.choices?.[0]?.message?.content ?? "";
    return safeAnswer(raw);
  } catch {
    return "не знаю";
  } finally {
    clearTimeout(t);
  }
}

function detectIntent(questionNorm) {
  const q = String(questionNorm || "");

  if (
    q.includes("что загад") ||
    q.includes("что зага") ||
    q.includes("какой секрет") ||
    q.includes("назови") ||
    q.includes("подскажи") ||
    q.includes("что это за")
  ) {
    return { type: "alwaysUnknown", key: "secretReveal" };
  }

  if (
    q.includes("какого цвет") ||
    q.includes("цвет") ||
    q.includes("бел") ||
    q.includes("черн") ||
    q.includes("тёмн") ||
    q.includes("темн") ||
    q.includes("красн") ||
    q.includes("син") ||
    q.includes("зел")
  ) {
    return { type: "alwaysUnknown", key: "color" };
  }

  if (q.includes("жив")) return { type: "predicate", key: "living" };
  if (q.includes("вещ") || q.includes("предмет")) return { type: "predicate", key: "thing" };
  if (q.includes("птиц")) return { type: "predicate", key: "isBird" };
  if (q.includes("рыб")) return { type: "predicate", key: "isFish" };
  if (q.includes("крыл")) return { type: "predicate", key: "hasWings" };
  if (q.includes("клюв")) return { type: "predicate", key: "hasBeak" };
  if (q.includes("пер") && q.includes("ья")) return { type: "predicate", key: "hasFeathers" };
  if (q.includes("ног") || q.includes("лап")) return { type: "predicate", key: "hasLegs" };
  if (q.includes("дома") || q.includes("дом")) return { type: "predicate", key: "atHome" };
  if (q.includes("больше") && q.includes("кошк")) return { type: "predicate", key: "biggerThanCat" };
  if ((q.includes("держ") && q.includes("рук")) || q.includes("в руке")) return { type: "predicate", key: "handheld" };
  if (q.includes("школь") || q.includes("школ")) return { type: "predicate", key: "schoolItem" };
  if (q.includes("двиг")) return { type: "predicate", key: "canMove" };
  if (q.includes("лет")) return { type: "predicate", key: "canFly" };
  if (q.includes("плав")) return { type: "predicate", key: "canSwim" };
  if (q.includes("потрог") || q.includes("трог") || q.includes("пощуп")) return { type: "predicate", key: "canTouch" };
  if (q.includes("игруш")) return { type: "predicate", key: "toy" };
  if (q.includes("природ")) return { type: "predicate", key: "natureRelated" };

  return null;
}

function isGuessAttempt(questionNorm) {
  const q = String(questionNorm || "").trim();
  if (!q.startsWith("это ")) return false;

  if (detectIntent(q)) return false;

  const words = q.split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

function answerFromFeatures(secret, questionNorm) {
  const intent = detectIntent(questionNorm);
  if (!intent) return "не знаю";
  if (intent.type === "alwaysUnknown") return "не знаю";

  const features = getSecretFeatures(secret);
  const value = features?.[intent.key];
  if (typeof value !== "boolean") return "не знаю";
  return value ? "да" : "нет";
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    const body = await request.json().catch(() => ({}));
    const gameId = body?.gameId;
    const question = body?.question;

    if (!gameId || !question || !normalize(question)) {
      return json(
        {
          answer: "не знаю",
          left: DEFAULT_LEFT,
          over: false,
          win: false,
          secret: null,
          history: [],
          message: "Напиши вопрос",
        },
        400
      );
    }

    const game = await getGame(env, gameId);

    if (!game) {
      return json(
        {
          answer: "не знаю",
          left: DEFAULT_LEFT,
          over: false,
          win: false,
          secret: null,
          history: [],
          message: "Игра не найдена. Нажми 'Новая игра'.",
        },
        400
      );
    }

    if (game.over) {
      return json({
        answer: "не знаю",
        left: game.left,
        over: true,
        win: Boolean(game.win),
        secret: game.secret,
        history: Array.isArray(game.history) ? game.history : [],
        message: "",
      });
    }

    const now = nowMs();
    const lastAskAt = Number(game.lastAskAt || 0);
    if (lastAskAt && now - lastAskAt < 700) {
      return json({
        answer: "не знаю",
        left: Number(game.left || 0),
        over: false,
        win: Boolean(game.win),
        secret: null,
        history: Array.isArray(game.history) ? game.history : [],
        message: "Подожди секундочку и спроси ещё раз",
      });
    }

    game.lastAskAt = now;
    if (!Array.isArray(game.history)) game.history = [];

    const qNorm = normalize(question);
    const sNorm = normalize(game.secret);
    const guessAttempt = isGuessAttempt(qNorm);
    const correctGuess = isGuess(qNorm, sNorm);

    let answer = "не знаю";
    let message = "";

    if (guessAttempt) {
      if (correctGuess) {
        answer = "да";
        game.win = true;
        game.over = true;
        message = "Победа!";
      } else {
        answer = "нет";
        game.win = false;
        game.over = false;
      }
    } else {
      const byFeatures = answerFromFeatures(game.secret, qNorm);
      if (byFeatures !== "не знаю") {
        answer = byFeatures;
      } else if (hasOpenRouterKey(env)) {
        answer = await llmAnswerOpenRouter(env, {
          secret: game.secret,
          question: String(question),
          history: game.history,
        });
      } else {
        answer = "не знаю";
        message = "Нужен ключ OPENROUTER_API_KEY";
      }
    }

    game.left = Math.max(0, Number(game.left || 0) - 1);
    game.history.push({ q: String(question), a: answer });

    if (!game.over && game.left === 0) {
      game.over = true;
      game.win = false;
      message = "Вопросы закончились";
    }

    await saveGame(env, gameId, game);

    return json({
      answer,
      left: game.left,
      over: game.over,
      win: game.win,
      secret: game.over ? game.secret : null,
      history: game.history,
      message,
    });
  } catch {
    return json({
      answer: "не знаю",
      left: DEFAULT_LEFT,
      over: false,
      win: false,
      secret: null,
      history: [],
      message: "Сервис занят, попробуй ещё раз",
    }, 500);
  }
}
