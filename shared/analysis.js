import { AIError, requestAI } from "./ai.js";
import { answerFromIntent, detectIntent, normalize } from "./rules.js";

export function gameStats(game) {
  const history = Array.isArray(game.history) ? game.history : [];
  const groups = new Map();
  const inconsistent = new Set();
  let unknownAnswers = 0;
  history.forEach((item, index) => {
    const turn = index + 1;
    const question = normalize(item.q);
    const intent = detectIntent(question);
    const key = intent?.key ? `${intent.type}:${intent.key}` : `text:${question}`;
    if (!groups.has(key)) groups.set(key, []);
    const definite = item.a === "да" || item.a === "нет";
    const positive = definite ? (item.a === "да") !== Boolean(intent?.negated) : null;
    groups.get(key).push({ turn, positive });
    if (item.a === "не знаю") unknownAnswers++;
    const expected = answerFromIntent(game.secret, intent);
    if (definite && expected !== null && item.a !== expected) {
      inconsistent.add(turn);
    }
  });
  const repeatedTurns = [];
  for (const items of groups.values()) {
    if (items.length > 1) repeatedTurns.push(items.map(item => item.turn));
    const definite = items.filter(item => item.positive !== null);
    if (new Set(definite.map(item => item.positive)).size > 1) {
      definite.forEach(item => inconsistent.add(item.turn));
    }
  }
  return {
    turns: history.length,
    hintsUsed: Array.isArray(game.hints) ? game.hints.length : 0,
    repeats: repeatedTurns.reduce((count, turns) => count + turns.length - 1, 0),
    repeatedTurns,
    unknownAnswers,
    inconsistentTurns: [...inconsistent].sort((a, b) => a - b),
  };
}

function text(value, maxLength = 600) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new AIError("invalid_response");
  }
  return value.trim();
}

export async function generateAnalysis(env, game, stats) {
  const bestCandidates = game.history.flatMap((item, index) => {
    const turn = index + 1;
    return ["да", "нет"].includes(item.a) && !stats.inconsistentTurns.includes(turn)
      ? [{ turn, question: item.q, answer: item.a }] : [];
  });
  const raw = await requestAI(env, "analysis", {
    secret: game.secret, history: game.history, hints: game.hints ?? [],
    win: Boolean(game.win), stats, bestCandidates,
  });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AIError("invalid_response");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AIError("invalid_response");
  let bestQuestion = null;
  if (data.bestQuestion !== null) {
    const turn = data.bestQuestion?.turn;
    const source = bestCandidates.find(candidate => candidate.turn === turn);
    if (!Number.isInteger(turn) || !source) throw new AIError("invalid_response");
    bestQuestion = { ...source, reason: text(data.bestQuestion.reason) };
  }
  // Counts and the quoted question come from the server, never from model output.
  return {
    strength: text(data.strength),
    bestQuestion,
    improvement: text(data.improvement),
    nextQuestion: text(data.nextQuestion, 300),
    stats,
    generatedAt: Date.now(),
  };
}
