import { AIError, requestAI } from "./ai.js";
import { HINT_LIMIT } from "./config.js";
import { detectIntent, normalize } from "./rules.js";

// The model chooses a direction; only server-owned text is shown to the player.
// These questions suggest a check without asserting anything about the secret.
const DIRECTIONS = Object.freeze([
  { key: "living", text: "Попробуй узнать, живое ли это." },
  { key: "atHome", text: "Попробуй узнать, бывает ли это дома." },
  { key: "handheld", text: "Попробуй узнать, можно ли это держать в руке." },
  { key: "biggerThanCat", text: "Попробуй сравнить размер с кошкой." },
  { key: "schoolItem", text: "Попробуй узнать, связано ли это со школой." },
  { key: "canMove", text: "Попробуй узнать, может ли это двигаться само." },
  { key: "canFly", text: "Попробуй узнать, умеет ли это летать." },
  { key: "canSwim", text: "Попробуй узнать, умеет ли это плавать." },
  { key: "toy", text: "Попробуй узнать, можно ли с этим играть как с игрушкой." },
  { key: "livesInForest", text: "Попробуй узнать, встречается ли это в лесу." },
  { key: "livesOnFarm", text: "Попробуй узнать, бывает ли это на ферме." },
  { key: "hasWings", text: "Попробуй узнать, есть ли у этого крылья." },
  { key: "hasLegs", text: "Попробуй узнать, есть ли у этого ноги или лапы." },
]);

// Some different questions reveal the same fact in our fixed game dictionary.
const RELATED = [
  ["living", "thing", "canMove", "natureRelated"],
  ["isBird", "hasWings", "hasBeak", "hasFeathers"],
];

export function hintState(game) {
  const hints = Array.isArray(game?.hints) ? game.hints : [];
  return {
    hints: hints.map(({ text }) => ({ text })),
    hintsUsed: hints.length,
    hintsLeft: Math.max(0, HINT_LIMIT - hints.length),
    hintLimit: HINT_LIMIT,
  };
}

export function hintCandidates(game) {
  const used = new Set((game.hints ?? []).map(hint => hint.key));
  for (const item of game.history ?? []) {
    const intent = detectIntent(normalize(item.q));
    if (intent?.type === "predicate" && ["да", "нет"].includes(item.a)) used.add(intent.key);
  }
  for (const group of RELATED) {
    if (group.some(key => used.has(key))) group.forEach(key => used.add(key));
  }
  return DIRECTIONS.filter(direction => !used.has(direction.key)
    && !(direction.key === "biggerThanCat" && normalize(game.secret) === "кошка"));
}

export async function chooseHint(env, game, candidates) {
  const raw = await requestAI(env, "hint", {
    secret: game.secret,
    history: game.history,
    hints: game.hints ?? [],
    candidates,
  });
  let key;
  try {
    key = JSON.parse(raw)?.key;
  } catch {
    throw new AIError("invalid_response");
  }
  const selected = candidates.find(candidate => candidate.key === key);
  if (!selected) throw new AIError("invalid_response");
  return { ...selected, createdAt: Date.now() };
}
