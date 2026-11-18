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
const WATER_HABITAT_DEPENDS_ON_SPECIES = makeSet(["утка", "гусь", "лягушка", "черепаха"]);

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
  const answer = value.trim().toLowerCase().replace(/[.!]$/u, "");
  return answer === "да" || answer === "нет" ? answer : "не знаю";
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
    barks: s === "собака",
    toy: TOYS.has(s),
    natureRelated: living,
    canTouch,
    livesInForest: FOREST.has(s),
    livesOnFarm: FARM.has(s),
    livesInWater: WATER_HABITAT_DEPENDS_ON_SPECIES.has(s) ? null : isFish,
    isDomestic: FARM.has(s) || (AT_HOME.has(s) && living),
  };
}

// Match complete phrases so qualifiers and additional clauses reach the fallback intact.
const PREDICATES = [
  ["living", /^(?:жив(?:ое|ой|ая|ые)|живое существо|животное)$/u],
  ["thing", /^(?:вещь|предмет|нежив(?:ое|ой|ая))$/u],
  ["isBird", /^птица$/u],
  ["isFish", /^рыба$/u],
  ["hasWings", /^крыл(?:о|ья|ьев)$/u],
  ["hasBeak", /^клюв(?:а)?$/u],
  ["hasFeathers", /^пер(?:о|ья|ьев)$/u],
  ["hasLegs", /^(?:ног(?:и|а)?|лап(?:ы|а|ки|ок)?|ноги или лапы)$/u],
  ["isDomestic", /^домашн(?:ее|ий|яя)(?: животное)?$/u],
  ["atHome", /^(?:(?:бывает|можно встретить) )?дома$/u],
  ["biggerThanCat", /^(?:больше|крупнее) (?:кошки|чем кошка)$/u],
  ["handheld", /^(?:(?:можно )?(?:держать|подержать) )?(?:в руке|одной рукой)$/u],
  ["schoolItem", /^(?:школьн(?:ое|ая|ый)(?: вещь| предмет)?|для школы|(?:нужн(?:о|а|ен)|используют) в школе|связан(?:о|а)? со школой)$/u],
  ["canMove", /^(?:(?:может|умеет) двигаться|двигается)(?: сам[ао]?)?$/u],
  ["canFly", /^(?:летает|(?:умеет|может) летать)$/u],
  ["canSwim", /^(?:плавает|(?:умеет|может) плавать)$/u],
  ["canTouch", /^(?:можно )?(?:потрогать|трогать|пощупать)$/u],
  ["barks", /^(?:лает|(?:умеет|может) лаять)$/u],
  ["toy", /^(?:игрушка|можно играть как с игрушкой)$/u],
  ["natureRelated", /^(?:из природы|(?:бывает|встречается) в природе)$/u],
  ["livesInForest", /^(?:(?:живет|бывает|встречается) )?в лесу$/u],
  ["livesOnFarm", /^(?:(?:живет|бывает|встречается) )?на ферме$/u],
  ["livesInWater", /^живет в воде$/u],
];

const SECRET_QUESTION = /(?:^| )(?:какой секрет|что это за|что (?:ты )?загадал[аио]?)(?: |$)/u;
const SECRET_REQUEST = /^(?:пожалуйста )?(?:назови|подскажи)(?: (?:мне|секрет(?:ное слово)?|слово|все варианты|ответ|пожалуйста))*$/u;
const COLOR_QUESTION = /(?:^| )(?:цвет(?:а|ом|е|у)?|(?:бел|черн|темн|красн|зелен|желт|син|оранжев|розов|сер)(?:ый|ая|ое|ые|ий|яя|ее|ие|ого|его))(?: |$)/u;
const SIZE_COMPARISON = /(?:^| )(?:больше|меньше|крупнее|мельче|выше|ниже)(?: |$)/u;
const SMALLER_THAN_CAT = /^(?:меньше|мельче) (?:кошки|чем кошка)$/u;

function extractGuessCandidate(question) {
  const candidate = normalize(question).replace(/^(?:(?:а )?это|мой ответ|моя догадка) /u, "");
  return SECRET_NAMES.has(candidate) ? candidate : null;
}

function detectIntent(questionNorm) {
  const guess = extractGuessCandidate(questionNorm);
  if (guess) return { type: "guess", key: guess };

  if (SECRET_QUESTION.test(questionNorm) || SECRET_REQUEST.test(questionNorm) || COLOR_QUESTION.test(questionNorm)) {
    return { type: "alwaysUnknown" };
  }

  const phrase = questionNorm
    .replace(/^(?:а )?(?:(?:это|он|она|оно) |у (?:него|нее|этого) |есть (?:ли )?у (?:него|нее|этого) )/u, "")
    .replace(/^есть (?:ли )?/u, "")
    .replace(/^(можно|может|умеет) ли(?: это| он| она| оно)? /u, "$1 ")
    .replace(/ ли(?: это| он| она| оно)?$/u, "");
  const property = phrase.replace(/^(?:не|нет) /u, "");
  const predicate = PREDICATES.find(([, pattern]) => pattern.test(property));
  if (predicate) return { type: "predicate", key: predicate[0], negated: property !== phrase };
  if (SIZE_COMPARISON.test(questionNorm) && !SMALLER_THAN_CAT.test(property)) return { type: "alwaysUnknown" };
  return null;
}

function answerFromIntent(secret, intent) {
  if (!intent) return null;
  if (intent.type === "alwaysUnknown") return "не знаю";
  const secretName = normalize(secret);
  if (intent.type === "guess") return intent.key === secretName ? "да" : "нет";
  if (!SECRET_NAMES.has(secretName)) return null;

  const value = getSecretFeatures(secretName)[intent.key];
  if (typeof value !== "boolean") return null;
  return value !== intent.negated ? "да" : "нет";
}

export { DEFAULT_LEFT, SECRETS, normalize, safeAnswer, pickSecret, isHard, getCategoryHint, getSecretFeatures, detectIntent, extractGuessCandidate, answerFromIntent };
