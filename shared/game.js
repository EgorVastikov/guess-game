import { ASK_INTERVAL_MS } from "./config.js";
import { AIError, hasAIKey, requestAI } from "./ai.js";
import { getGame, saveGame, StoreError } from "./store.js";
import {
  DEFAULT_LEFT, normalize, pickSecret, isHard, getCategoryHint,
  extractGuessCandidate, isExactGuess, answerFromFeatures, safeAnswer,
} from "./rules.js";

function snapshot(game, answer = "не знаю", message = "") {
  return {
    answer,
    left: game?.left ?? DEFAULT_LEFT,
    over: Boolean(game?.over),
    win: Boolean(game?.win),
    secret: game?.over ? game.secret : null,
    history: Array.isArray(game?.history) ? game.history : [],
    message,
  };
}

export async function newGame(env) {
  const secret = pickSecret();
  const hard = isHard(secret);
  const gameId = `game_${globalThis.crypto.randomUUID()}`;
  const game = {
    gameId, secret, left: hard ? 15 : DEFAULT_LEFT, isHard: hard,
    over: false, win: false, history: [], createdAt: Date.now(), lastAskAt: 0,
  };
  await saveGame(env, gameId, game);
  return { status: 200, body: { gameId, left: game.left, isHard: hard, message: "Игра началась" } };
}

export async function askQuestion(env, body) {
  const { gameId, question } = body ?? {};
  if (typeof gameId !== "string" || typeof question !== "string" || !gameId || !normalize(question)) {
    return { status: 400, body: snapshot(null, "не знаю", "Напиши вопрос") };
  }
  const game = await getGame(env, gameId);
  if (!game) {
    return { status: 400, body: snapshot(null, "не знаю", "Игра не найдена. Нажми 'Новая игра'.") };
  }
  if (game.over) return { status: 200, body: snapshot(game) };
  const now = Date.now();
  if (game.lastAskAt && now - game.lastAskAt < ASK_INTERVAL_MS) {
    return { status: 200, body: snapshot(game, "не знаю", "Подожди секундочку и спроси ещё раз") };
  }

  const qNorm = normalize(question);
  const guess = extractGuessCandidate(qNorm);
  let answer = "не знаю";
  let message = "";
  if (guess) {
    game.win = isExactGuess(qNorm, normalize(game.secret));
    game.over = game.win;
    answer = game.win ? "да" : "нет";
    if (game.win) message = "Победа!";
  } else {
    answer = answerFromFeatures(game.secret, qNorm);
    if (answer === "не знаю") {
      if (hasAIKey(env)) {
        try {
          answer = safeAnswer(await requestAI(env, "answer", { secret: game.secret, question, history: game.history }));
        } catch (error) {
          if (!(error instanceof AIError)) throw error;
          const text = error.code === "rate_limit"
            ? "ИИ занят. Подожди немного и повтори вопрос"
            : "ИИ не ответил. Попробуй ещё раз";
          return { status: 503, body: snapshot(game, "не знаю", text) };
        }
      } else {
        message = "Нужен ключ OPENROUTER_API_KEY";
      }
    }
  }
  game.lastAskAt = now;
  game.left = Math.max(0, game.left - 1);
  if (!Array.isArray(game.history)) game.history = [];
  game.history.push({ q: question, a: answer });
  if (!game.over && game.left === 0) {
    game.over = true;
    game.win = false;
    message = "Вопросы закончились";
  } else if (!game.over && game.left <= 3 && !message) {
    message = `Осталось мало вопросов! Подсказка: ${getCategoryHint(game.secret)}`;
  }
  await saveGame(env, gameId, game);
  return { status: 200, body: snapshot(game, answer, message) };
}

export async function runGameAction(action, env, body) {
  try {
    if (action === "new") return await newGame(env);
    if (action === "ask") return await askQuestion(env, body);
    return { status: 404, body: { message: "Not found" } };
  } catch (error) {
    // Log only the error category; questions, secrets and API tokens stay out of logs.
    console.error(`[game:${action}] ${error instanceof StoreError ? "storage_unavailable" : "internal_error"}`);
    return {
      status: error instanceof StoreError ? 503 : 500,
      body: action === "new"
        ? { gameId: null, left: DEFAULT_LEFT, message: "Сервис занят, попробуй ещё раз" }
        : snapshot(null, "не знаю", "Сервис занят, попробуй ещё раз"),
    };
  }
}
