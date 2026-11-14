const DEFAULT_LEFT = 10;

const HARD_SECRETS = makeSet([
  "ёж",
  "белка",
  "попугай",
  "воробей",
  "голубь",
  "черепаха",
  "лягушка",
  "тетрадь",
  "пенал",
  "линейка",
  "зонт",
  "диван",
  "кресло",
]);

const SECRETS = [
  "кошка",
  "собака",
  "заяц",
  "лиса",
  "волк",
  "медведь",
  "ёж",
  "белка",
  "мышь",
  "лошадь",
  "корова",
  "коза",
  "овца",
  "свинья",
  "курица",
  "петух",
  "утка",
  "гусь",
  "рыба",
  "лягушка",
  "черепаха",
  "попугай",
  "воробей",
  "голубь",
  "стол",
  "стул",
  "кровать",
  "диван",
  "лампа",
  "окно",
  "дверь",
  "ложка",
  "вилка",
  "тарелка",
  "чашка",
  "бутылка",
  "зонт",
  "мяч",
  "кукла",
  "машинка",
  "книга",
  "тетрадь",
  "пенал",
  "карандаш",
  "ручка",
  "линейка",
  "рюкзак",
  "телефон",
];

const SECRET_NAMES = makeSet(SECRETS);

function isHard(secret) {
  return HARD_SECRETS.has(normalize(secret));
}

function getCategoryHint(secret) {
  const s = normalize(secret);
  if (SCHOOL_ITEM.has(s)) return "это школьная вещь";
  if (TOYS.has(s)) return "это игрушка";
  if (BIRDS.has(s)) return "это птица";
  if (FISH.has(s)) return "это водный житель";
  if (FARM.has(s)) return "это животное на ферме";
  if (FOREST.has(s)) return "это лесной житель";
  if (ANIMALS.has(s)) return "это животное";
  if (AT_HOME.has(s)) return "это бывает дома";
  return "это какой-то предмет";
}

const ANIMALS = makeSet([
  "кошка",
  "собака",
  "заяц",
  "лиса",
  "волк",
  "медведь",
  "ёж",
  "белка",
  "мышь",
  "лошадь",
  "корова",
  "коза",
  "овца",
  "свинья",
  "курица",
  "петух",
  "утка",
  "гусь",
  "рыба",
  "лягушка",
  "черепаха",
  "попугай",
  "воробей",
  "голубь",
]);

const BIRDS = makeSet([
  "курица",
  "петух",
  "утка",
  "гусь",
  "попугай",
  "воробей",
  "голубь",
]);

const FISH = makeSet(["рыба"]);

const SWIMS = makeSet(["рыба", "утка", "гусь", "лягушка", "черепаха"]);

const FOREST = makeSet([
  "заяц",
  "лиса",
  "волк",
  "медведь",
  "ёж",
  "белка",
  "мышь",
  "лягушка",
  "черепаха",
  "сова",
]);

const FARM = makeSet([
  "лошадь",
  "корова",
  "коза",
  "овца",
  "свинья",
  "курица",
  "петух",
  "утка",
  "гусь",
]);

const CAN_FLY = makeSet([
  "утка",
  "гусь",
  "попугай",
  "воробей",
  "голубь",
]);

const BIGGER_THAN_CAT = makeSet([
  "лошадь",
  "корова",
  "коза",
  "овца",
  "свинья",
  "медведь",
  "волк",
  "диван",
  "кровать",
  "стол",
  "стул",
  "дверь",
  "окно",
]);

const AT_HOME = makeSet([
  "кошка",
  "собака",
  "попугай",
  "рыба",
  "черепаха",
  "стол",
  "стул",
  "кровать",
  "диван",
  "лампа",
  "окно",
  "дверь",
  "ложка",
  "вилка",
  "тарелка",
  "чашка",
  "бутылка",
  "зонт",
  "книга",
  "тетрадь",
  "пенал",
  "карандаш",
  "ручка",
  "линейка",
  "рюкзак",
  "телефон",
  "мяч",
  "кукла",
  "машинка",
]);

const HANDHELD = makeSet([
  "ложка",
  "вилка",
  "тарелка",
  "чашка",
  "бутылка",
  "зонт",
  "мяч",
  "кукла",
  "машинка",
  "книга",
  "тетрадь",
  "пенал",
  "карандаш",
  "ручка",
  "линейка",
  "телефон",
  "мышь",
  "ёж",
  "белка",
  "лягушка",
  "черепаха",
  "попугай",
  "воробей",
  "голубь",
  "кошка",
]);

const SCHOOL_ITEM = makeSet([
  "книга",
  "тетрадь",
  "пенал",
  "карандаш",
  "ручка",
  "линейка",
  "рюкзак",
]);

const TOYS = makeSet(["мяч", "кукла", "машинка"]);

function makeSet(items) {
  return new Set((items || []).map(normalize));
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function safeAnswer(value) {
  const t = normalize(value);
  if (t === "да" || t.startsWith("да ")) return "да";
  if (t === "нет" || t.startsWith("нет ")) return "нет";
  if (t === "не знаю" || t.startsWith("не знаю")) return "не знаю";
  return "не знаю";
}

function pickSecret() {
  const idx = Math.floor(Math.random() * SECRETS.length);
  return SECRETS[idx];
}

function getSecretFeatures(secret) {
  const s = normalize(secret);

  const living = ANIMALS.has(s);
  const isBird = BIRDS.has(s);
  const isFish = FISH.has(s);
  const thing = !living;

  const canMove = living;
  const canFly = CAN_FLY.has(s);
  const canSwim = SWIMS.has(s);

  const hasWings = isBird;
  const hasBeak = isBird;
  const hasFeathers = isBird;
  const hasLegs = living && !isFish;

  const canTouch = true;

  return {
    living,
    thing,
    isBird,
    isFish,
    hasLegs,
    hasWings,
    hasBeak,
    hasFeathers,
    atHome: AT_HOME.has(s),
    biggerThanCat: BIGGER_THAN_CAT.has(s),
    handheld: HANDHELD.has(s),
    schoolItem: SCHOOL_ITEM.has(s),
    canMove,
    canFly,
    canSwim,
    toy: TOYS.has(s),
    natureRelated: living,
    canTouch,
    livesInForest: FOREST.has(s),
    livesOnFarm: FARM.has(s),
    isDomestic: FARM.has(s) || (AT_HOME.has(s) && living),
  };
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

  if ((q.includes("больше") || q.includes("меньше")) && !q.includes("кошк")) {
    return { type: "alwaysUnknown", key: "relativeSize" };
  }

  if (q.includes("лес")) return { type: "predicate", key: "livesInForest" };
  if (q.includes("ферм")) return { type: "predicate", key: "livesOnFarm" };
  if (q.includes("жив")) return { type: "predicate", key: "living" };
  if (q.includes("вещ") || q.includes("предмет")) return { type: "predicate", key: "thing" };
  if (q.includes("птиц")) return { type: "predicate", key: "isBird" };
  if (q.includes("рыб")) return { type: "predicate", key: "isFish" };
  if (q.includes("крыл")) return { type: "predicate", key: "hasWings" };
  if (q.includes("клюв")) return { type: "predicate", key: "hasBeak" };
  if (q.includes("пер") && q.includes("ья")) return { type: "predicate", key: "hasFeathers" };
  if (q.includes("ног") || q.includes("лап")) return { type: "predicate", key: "hasLegs" };
  if (q.includes("домашн")) return { type: "predicate", key: "isDomestic" };
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

function extractGuessCandidate(questionNorm) {
  const q = normalize(questionNorm);
  let rest = q;
  if (rest.startsWith("это ")) rest = rest.slice(4).trim();
  if (!rest) return null;

  // Exact dictionary guesses take priority over overlapping feature stems:
  // e.g. «белка» contains the color stem «бел», «рыба» is also a category.
  if (SECRET_NAMES.has(rest)) return rest;
  if (detectIntent(q)) return null;

  const blockers = [
    "больше",
    "меньше",
    "жив",
    "вещ",
    "предмет",
    "птиц",
    "рыб",
    "крыл",
    "клюв",
    "пер",
    "ног",
    "лап",
    "дома",
    "дом",
    "школ",
    "держ",
    "рук",
    "лет",
    "плав",
    "двиг",
    "потрог",
    "трог",
    "пощуп",
    "цвет",
    "природ",
  ];
  for (const b of blockers) {
    if (rest.includes(b)) return null;
  }

  const words = rest.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 3) return null;
  return rest;
}

function isExactGuess(questionNorm, secretNorm) {
  const cand = extractGuessCandidate(questionNorm);
  if (!cand) return false;
  return normalize(cand) === normalize(secretNorm);
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


export { DEFAULT_LEFT, SECRETS, normalize, safeAnswer, pickSecret, isHard, getCategoryHint, getSecretFeatures, detectIntent, extractGuessCandidate, isExactGuess, answerFromFeatures };
