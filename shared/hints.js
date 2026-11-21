import { AIError, requestAI } from "./ai.js";
import { HINT_LIMIT } from "./config.js";
import { SECRETS, answerFromIntent, detectIntent, getSecretFeatures, normalize } from "./rules.js";

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

// A match here only steers the hint. It cannot turn a compound question into a known fact.
const TOPIC_PATTERNS = [
  ["living", /(?:^| )(?:животн(?:ое|ым)|живое существо)(?= |$)/u],
  ["isBird", /(?:^| )птиц(?:а|у|ы|ей|ами)(?= |$)/u],
  ["hasWings", /(?:^| )крыл(?:о|ья|ьев|ьями)(?= |$)/u],
  ["hasBeak", /(?:^| )клюв(?:а|ом)?(?= |$)/u],
  ["hasFeathers", /(?:^| )пер(?:о|ья|ьев)(?= |$)/u],
  ["hasLegs", /(?:^| )(?:ног(?:а|и)?|лап(?:а|ы|ки|ок)?)(?= |$)/u],
  ["canFly", /(?:^| )(?:летает|летают|летать|лететь|летит|взлетает|взлетать|полет(?:е|ы|ов|а)?|по воздуху)(?= |$)/u],
  ["canSwim", /(?:^| )(?:плавает|плавать|плывет|плыть|плавание)(?= |$)/u],
  ["livesInWater", /(?:^| )(?:в воде|в реке|в озере|в море|под водой)(?= |$)/u],
  ["livesInForest", /(?:^| )(?:в лесу|из леса)(?= |$)/u],
  ["livesOnFarm", /(?:^| )на ферм(?:е|у)(?= |$)/u],
  ["atHome", /(?:^| )(?:дома|в квартире)(?= |$)/u],
  ["handheld", /(?:^| )(?:в руке|в ладони|одной рукой)(?= |$)/u],
  ["schoolItem", /(?:^| )(?:в школе|для школы|со школой)(?= |$)/u],
  ["toy", /(?:^| )игрушк(?:а|ой|и|ами|у)(?= |$)/u],
];

const STARTING_DIRECTIONS = ["living", "atHome", "handheld", "biggerThanCat"];
const FOLLOW_UPS = [
  {
    topics: ["living", "thing", "canMove", "natureRelated"],
    directions: ["atHome", "livesInForest", "livesOnFarm", "canFly", "canSwim", "schoolItem", "handheld", "toy"],
  },
  {
    topics: ["canFly", "canSwim", "livesInWater", "isFish"],
    directions: ["canFly", "canSwim", "hasWings", "hasLegs", "livesInForest", "livesOnFarm", "atHome"],
  },
  {
    topics: ["isBird", "hasWings", "hasBeak", "hasFeathers", "hasLegs", "barks"],
    directions: ["canFly", "canSwim", "atHome", "livesOnFarm", "livesInForest", "handheld", "hasWings", "hasLegs"],
  },
  {
    topics: ["atHome", "livesInForest", "livesOnFarm", "isDomestic"],
    directions: ["atHome", "livesInForest", "livesOnFarm", "schoolItem", "toy", "handheld", "canSwim"],
  },
  {
    topics: ["schoolItem", "toy", "biggerThanCat", "handheld"],
    directions: ["schoolItem", "toy", "handheld", "biggerThanCat", "atHome"],
  },
];

function hintIntent(question) {
  const direct = detectIntent(question);
  if (direct) return direct;
  const flight = /^(?:а )?(?:(?:это|он|она|оно) )?(не )?(?:(?:может|умеет) (?:передвигаться|перемещаться)|передвигается|перемещается) по воздуху$/u.exec(question);
  return flight ? { type: "predicate", key: "canFly", negated: Boolean(flight[1]) } : null;
}

function questionTopics(question, intent) {
  if (intent?.type === "predicate") return [intent.key];
  if (intent?.type === "guess") return [];
  return TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(question)).map(([key]) => key);
}

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
  const hints = game.hints ?? [];
  const used = new Set(hints.map(hint => hint.key));
  let remaining = SECRETS;
  let focusTopics = [];
  let focusTurn = 0;
  for (const [index, item] of (game.history ?? []).entries()) {
    const question = normalize(item.q);
    const intent = hintIntent(question);
    const topics = questionTopics(question, intent);
    topics.forEach(key => used.add(key));

    const expected = answerFromIntent(game.secret, intent);
    const definite = item.a === "да" || item.a === "нет";
    const reliable = definite && expected === item.a;
    const contradictsKnownFact = definite && expected !== null && !reliable;
    if ((topics.length > 0 || intent === null) && !contradictsKnownFact) {
      focusTopics = topics;
      focusTurn = index + 1;
    }
    if (reliable) {
      remaining = remaining.filter(secret => {
        const answer = answerFromIntent(secret, intent);
        return answer === null || answer === item.a;
      });
    }
  }
  for (const group of RELATED) {
    if (group.some(key => used.has(key))) group.forEach(key => used.add(key));
  }

  const previousHint = hints.at(-1);
  if (previousHint?.key && focusTurn <= (previousHint.afterTurn ?? 0)) {
    focusTopics = [previousHint.key];
  }
  const preferred = focusTopics.length
    ? FOLLOW_UPS.filter(area => area.topics.some(key => focusTopics.includes(key))).flatMap(area => area.directions)
    : focusTurn === 0 ? STARTING_DIRECTIONS : [];
  const features = remaining.map(getSecretFeatures);
  const secret = normalize(game.secret);
  const ranked = DIRECTIONS
    .filter(({ key }) => !used.has(key) && !(key === "biggerThanCat" && secret === "кошка"))
    .map(direction => {
      const yes = features.filter(item => item[direction.key] === true).length;
      const no = features.filter(item => item[direction.key] === false).length;
      return { direction, score: Math.min(yes, no) };
    })
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score)
    .map(({ direction }) => direction);
  const related = ranked.filter(({ key }) => preferred.includes(key));
  return related.length ? related : ranked;
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
  return { ...selected, afterTurn: game.history?.length ?? 0, createdAt: Date.now() };
}
