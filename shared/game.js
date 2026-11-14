import { ASK_INTERVAL_MS, ANALYSIS_PENDING_MS } from "./config.js";
import { AIError, hasAIKey, requestAI } from "./ai.js";
import { getGame, saveGame, StoreError, StoreConflictError } from "./store.js";
import { chooseHint, hintCandidates, hintState } from "./hints.js";
import { gameStats, generateAnalysis } from "./analysis.js";
import { newDrawingGame, guessDrawing, confirmDrawing } from "./drawing.js";
import { ImageInputError } from "./image-input.js";
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
    ...(game?.over ? { stats: gameStats(game), analysis: game.analysis ?? null } : {}),
    message,
  };
}

export async function newGame(env, body) {
  const mode = body?.mode ?? "word";
  if (mode === "drawing") return newDrawingGame(env);
  if (mode !== "word") return { status: 400, body: { message: "Выбери режим игры" } };
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
  if (game.mode === "drawing") return { status: 409, body: { message: "В этой партии нужно отправлять рисунок" } };
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
        message = "На этот вопрос пока не могу ответить. Попробуй спросить иначе";
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
  if (game.mode === "drawing") return { status: 409, body: { message: "Подсказки доступны в игре со словами" } };
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

function analysisReply(game, cached = true) {
  return { status: 200, body: { analysis: game.analysis, cached } };
}

function analysisPending(game) {
  return Boolean(game.analysisPending && Date.now() - game.analysisPending.startedAt < ANALYSIS_PENDING_MS);
}

function pendingReply(stats) {
  return { status: 202, body: { pending: true, stats, message: "Разбор уже готовится. Проверь его чуть позже" } };
}

export async function requestAnalysis(env, body) {
  const gameId = body?.gameId;
  if (typeof gameId !== "string" || !gameId.trim()) {
    return { status: 400, body: { message: "Сначала сыграй партию" } };
  }
  const game = await getGame(env, gameId);
  if (!game) return { status: 404, body: { message: "Игра не найдена. Начни новую партию" } };
  if (game.mode === "drawing") return { status: 409, body: { message: "Разбор вопросов доступен в игре со словами" } };
  if (!game.over) return { status: 409, body: { message: "Разбор появится после окончания игры" } };
  if (game.analysis) return analysisReply(game);
  const stats = gameStats(game);
  if (!stats.turns) return { status: 409, body: { stats, message: "В этой партии ещё нет вопросов для разбора" } };
  if (analysisPending(game)) return pendingReply(stats);
  if (!hasAIKey(env)) {
    return { status: 503, body: { stats, message: "Разбор сейчас недоступен. Можно начать новую игру" } };
  }

  // Claim this analysis before asking the model, including across server instances.
  // The lease expires if the worker stops before completing or releasing it.
  game.analysisPending = { startedAt: Date.now() };
  try {
    await saveGame(env, gameId, game, game.version ?? 0);
  } catch (error) {
    if (!(error instanceof StoreConflictError)) throw error;
    const current = await getGame(env, gameId);
    if (current?.analysis) return analysisReply(current);
    if (current && analysisPending(current)) return pendingReply(gameStats(current));
    throw error;
  }
  game.version = (game.version ?? 0) + 1;
  try {
    const analysis = await generateAnalysis(env, game, stats);
    game.analysis = analysis;
    delete game.analysisPending;
    await saveGame(env, gameId, game, game.version);
    return analysisReply(game, false);
  } catch (error) {
    // Failed/invalid responses must not become a cached result or block retries.
    delete game.analysis;
    delete game.analysisPending;
    try {
      await saveGame(env, gameId, game, game.version);
    } catch (cleanupError) {
      if (!(cleanupError instanceof StoreConflictError) && !(cleanupError instanceof StoreError)) throw cleanupError;
    }
    if (error instanceof StoreConflictError) {
      const current = await getGame(env, gameId);
      if (current?.analysis) return analysisReply(current);
    }
    if (!(error instanceof AIError)) throw error;
    const message = error.code === "rate_limit"
      ? "ИИ занят. Попробуй разобрать игру немного позже"
      : "Не удалось подготовить разбор. Попробуй ещё раз";
    return { status: 503, body: { stats, message } };
  }
}

export async function runGameAction(action, env, body) {
  try {
    if (action === "new") return await newGame(env, body);
    if (action === "ask") return await askQuestion(env, body);
    if (action === "hint") return await requestHint(env, body);
    if (action === "analysis") return await requestAnalysis(env, body);
    if (action === "draw") return await guessDrawing(env, body);
    if (action === "confirm") return await confirmDrawing(env, body);
    return { status: 404, body: { message: "Not found" } };
  } catch (error) {
    if (error instanceof ImageInputError) return { status: error.status, body: { message: error.message } };
    if (error instanceof StoreConflictError) {
      return { status: 409, body: { message: "Игра уже изменилась. Повтори действие" } };
    }
    // Log only the error category; questions, secrets and API tokens stay out of logs.
    console.error(`[game:${action}] ${error instanceof StoreError ? "storage_unavailable" : "internal_error"}`);
    return {
      status: error instanceof StoreError ? 503 : 500,
      body: ["draw", "confirm"].includes(action)
        ? { message: "Не удалось сохранить результат. Рисунок остаётся на странице — попробуй ещё раз" }
        : action === "analysis"
        ? { message: "Не удалось сохранить разбор. Попробуй открыть его позже" }
        : action === "hint"
        ? { message: "Не удалось сохранить подсказку. Попробуй ещё раз" }
        : action === "new"
        ? { gameId: null, left: DEFAULT_LEFT, message: "Сервис занят, попробуй ещё раз" }
        : snapshot(null, "не знаю", "Сервис занят, попробуй ещё раз"),
    };
  }
}
