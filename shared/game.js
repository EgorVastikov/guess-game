import { ASK_INTERVAL_MS } from "./config.js";
import { AIError, hasAIKey, requestAI } from "./ai.js";
import { getGame, saveGame, StoreError, StoreConflictError } from "./store.js";
import { chooseHint, hintCandidates, hintState } from "./hints.js";
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
    ...hintState(game),
    message,
  };
}

export async function newGame(env) {
  const secret = pickSecret();
  const hard = isHard(secret);
  const gameId = `game_${globalThis.crypto.randomUUID()}`;
  const game = {
    gameId, secret, left: hard ? 15 : DEFAULT_LEFT, isHard: hard,
    over: false, win: false, history: [], hints: [], version: 0, createdAt: Date.now(), lastAskAt: 0,
  };
  await saveGame(env, gameId, game);
  return { status: 200, body: { gameId, left: game.left, isHard: hard, ...hintState(game), message: "Игра началась" } };
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
  await saveGame(env, gameId, game, game.version ?? 0);
  return { status: 200, body: snapshot(game, answer, message) };
}

export async function requestHint(env, body) {
  const gameId = body?.gameId;
  if (typeof gameId !== "string" || !gameId.trim()) {
    return { status: 400, body: { message: "Сначала начни новую игру" } };
  }
  const game = await getGame(env, gameId);
  if (!game) return { status: 404, body: { message: "Игра не найдена. Нажми 'Новая игра'." } };
  if (game.over) {
    return { status: 409, body: snapshot(game, "не знаю", "Игра окончена. Начни новую, чтобы получить подсказку") };
  }
  if (hintState(game).hintsLeft === 0) {
    return { status: 409, body: snapshot(game, "не знаю", "Все подсказки в этой игре уже использованы") };
  }
  const candidates = hintCandidates(game);
  if (!candidates.length) {
    return { status: 409, body: {
      ...snapshot(game, "не знаю", "Все направления уже проверены. Попробуй угадать!"),
      code: "no_hint_directions",
    } };
  }
  if (!hasAIKey(env)) {
    return { status: 503, body: { message: "Подсказки сейчас недоступны. Можно продолжить задавать вопросы" } };
  }
  let hint;
  try {
    hint = await chooseHint(env, game, candidates);
  } catch (error) {
    if (!(error instanceof AIError)) throw error;
    const message = error.code === "rate_limit"
      ? "ИИ занят. Подожди немного и попробуй получить подсказку ещё раз"
      : "Не удалось получить подсказку. Попробуй ещё раз или продолжай игру";
    return { status: 503, body: { message } };
  }
  game.hints = [...(game.hints ?? []), hint];
  await saveGame(env, gameId, game, game.version ?? 0);
  return { status: 200, body: snapshot(game, "не знаю", "Подсказка готова. Вопросы не потрачены") };
}

export async function runGameAction(action, env, body) {
  try {
    if (action === "new") return await newGame(env);
    if (action === "ask") return await askQuestion(env, body);
    if (action === "hint") return await requestHint(env, body);
    return { status: 404, body: { message: "Not found" } };
  } catch (error) {
    if (error instanceof StoreConflictError) {
      return { status: 409, body: { message: "Игра уже изменилась. Повтори действие" } };
    }
    // Log only the error category; questions, secrets and API tokens stay out of logs.
    console.error(`[game:${action}] ${error instanceof StoreError ? "storage_unavailable" : "internal_error"}`);
    return {
      status: error instanceof StoreError ? 503 : 500,
      body: action === "hint"
        ? { message: "Не удалось сохранить подсказку. Попробуй ещё раз" }
        : action === "new"
        ? { gameId: null, left: DEFAULT_LEFT, message: "Сервис занят, попробуй ещё раз" }
        : snapshot(null, "не знаю", "Сервис занят, попробуй ещё раз"),
    };
  }
}
