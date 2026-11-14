import { AIError, hasAIKey, requestAI } from "./ai.js";
import { getGame, saveGame } from "./store.js";
import { validateDrawingImage } from "./image-input.js";

export function drawingSnapshot(game) {
  return {
    gameId: game.gameId, mode: "drawing", over: Boolean(game.over),
    attemptsUsed: game.attemptsUsed ?? 0,
    latestAttempt: game.latestAttempt ?? null,
  };
}

export async function newDrawingGame(env) {
  const game = {
    gameId: `drawing_${crypto.randomUUID()}`, mode: "drawing", over: false,
    attemptsUsed: 0, latestAttempt: null, version: 0, createdAt: Date.now(),
  };
  await saveGame(env, game.gameId, game);
  return { status: 200, body: { ...drawingSnapshot(game), message: "Нарисуй что-нибудь и нажми «Угадай»" } };
}

async function loadDrawing(env, gameId) {
  if (typeof gameId !== "string" || !gameId.trim()) {
    return { error: { status: 400, body: { message: "Сначала начни новый рисунок" } } };
  }
  const game = await getGame(env, gameId);
  if (!game) return { error: { status: 404, body: { message: "Рисунок не найден. Нажми «Новый рисунок»" } } };
  if (game.mode !== "drawing") return { error: { status: 409, body: { message: "Эта партия относится к игре со словами" } } };
  return { game };
}

function parseGuess(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new AIError("invalid_response"); }
  if (!data || !Array.isArray(data.guesses) || data.guesses.length > 3) throw new AIError("invalid_response");
  const guesses = data.guesses.map(value => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new AIError("invalid_response");
    return value.trim();
  });
  const question = data.question == null ? null : data.question;
  if (question !== null && (typeof question !== "string" || !question.trim() || question.length > 200)) {
    throw new AIError("invalid_response");
  }
  if (!guesses.length && !question) throw new AIError("invalid_response");
  return { guesses: [...new Set(guesses)], question: question?.trim() ?? null };
}

export async function guessDrawing(env, body) {
  const { game, error } = await loadDrawing(env, body?.gameId);
  if (error) return error;
  if (game.over) return { status: 409, body: { ...drawingSnapshot(game), message: "ИИ уже угадал. Начни новый рисунок" } };
  validateDrawingImage(body?.imageDataUrl);
  if (!hasAIKey(env)) {
    return { status: 503, body: { message: "ИИ сейчас недоступен. Рисунок остаётся на странице — можно дорисовать его" } };
  }
  let guess;
  try {
    // Explicit whitelist: neither a supplied secret nor word-game history reaches vision.
    guess = parseGuess(await requestAI(env, "vision", { imageDataUrl: body.imageDataUrl }));
  } catch (error) {
    if (!(error instanceof AIError)) throw error;
    return { status: 503, body: { message: error.code === "rate_limit"
      ? "ИИ занят. Подожди немного и отправь рисунок ещё раз"
      : "Не удалось угадать рисунок. Дорисуй детали или попробуй ещё раз" } };
  }
  game.latestAttempt = { id: crypto.randomUUID(), ...guess, feedback: null, createdAt: Date.now() };
  game.attemptsUsed = (game.attemptsUsed ?? 0) + 1;
  // Store text and feedback only. The PNG is sent to the model, not saved in Redis.
  await saveGame(env, game.gameId, game, game.version ?? 0);
  return { status: 200, body: { ...drawingSnapshot(game), message: guess.guesses.length
    ? "Похоже? Подтверди ответ или дорисуй подробности" : "Попробуй добавить детали на рисунок" } };
}

export async function confirmDrawing(env, body) {
  const { game, error } = await loadDrawing(env, body?.gameId);
  if (error) return error;
  const attempt = game.latestAttempt;
  if (typeof body.guessed !== "boolean" || typeof body.attemptId !== "string") {
    return { status: 400, body: { message: "Выбери «Угадал» или «Не угадал»" } };
  }
  if (!attempt || attempt.id !== body.attemptId) {
    return { status: 409, body: { ...drawingSnapshot(game), message: "Сначала отправь рисунок и проверь последнее предположение" } };
  }
  if (body.guessed && !attempt.guesses.length) {
    return { status: 409, body: { message: "ИИ пока не предложил вариант. Попробуй дорисовать детали" } };
  }
  if (attempt.feedback === body.guessed) return { status: 200, body: drawingSnapshot(game) };
  if (attempt.feedback !== null || game.over) {
    return { status: 409, body: { ...drawingSnapshot(game), message: "Этот ответ уже отмечен. Отправь обновлённый рисунок" } };
  }
  attempt.feedback = body.guessed;
  game.over = body.guessed;
  await saveGame(env, game.gameId, game, game.version ?? 0);
  return { status: 200, body: { ...drawingSnapshot(game), message: body.guessed
    ? "Ура, ИИ угадал! Можно начать новый рисунок"
    : "Дорисуй подробности и нажми «Угадай» ещё раз" } };
}
