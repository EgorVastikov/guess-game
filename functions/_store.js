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

function isHard(secret) {
  return HARD_SECRETS.has(normalize(secret));
}

function getCategoryHint(secret) {
  const s = normalize(secret);
  if (SCHOOL_ITEM.has(s)) return "это школьная вещь";
  if (TOYS.has(s)) return "это игрушка";
  if (BIRDS.has(s)) return "это птица";
  if (FISH.has(s)) return "это водный житель";
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

function nowMs() {
  return Date.now();
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

function isGuess(questionNorm, secretNorm) {
  const q = normalize(questionNorm);
  const s = normalize(secretNorm);
  if (!q || !s) return false;

  if (s.includes(" ")) {
    return q.includes(s);
  }

  const words = q.split(" ");
  return words.includes(s);
}

function pickSecret() {
  const idx = Math.floor(Math.random() * SECRETS.length);
  return SECRETS[idx];
}

function randomId(prefix = "game") {
  const uuid = (crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx").replace(/-/g, "");
  return `${prefix}_${nowMs().toString(36)}_${uuid.slice(0, 10)}`;
}

function storeKind(env) {
  const raw = normalize(env?.STORE_KIND ?? "");
  if (raw === "upstash" || raw === "memory") return raw;

  const hasUpstash = Boolean(env?.UPSTASH_REDIS_REST_URL && env?.UPSTASH_REDIS_REST_TOKEN);
  return hasUpstash ? "upstash" : "memory";
}

async function upstashGet(env, key) {
  const url = env?.UPSTASH_REDIS_REST_URL;
  const token = env?.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  return data?.result ?? null;
}

async function upstashSet(env, key, value, ttlSeconds) {
  const url = env?.UPSTASH_REDIS_REST_URL;
  const token = env?.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;

  const encodedValue = encodeURIComponent(value);
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodedValue}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;

  if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
    await fetch(`${url}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }

  return true;
}

const memory = new Map();

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
  };
}

async function createGame(env) {
  const gameId = randomId();
  const secret = pickSecret();
  
  const hard = isHard(secret);
  const left = hard ? 15 : 10;
  
  const game = {
    gameId,
    secret,
    left,
    over: false,
    win: false,
    history: [],
    createdAt: nowMs(),
    lastAskAt: 0,
    isHard: hard,
  };

  await saveGame(env, gameId, game);
  return { gameId, left, isHard: hard };
}

async function getGame(env, gameId) {
  if (!gameId) return null;
  const key = `game:${gameId}`;

  if (storeKind(env) === "upstash") {
    const raw = await upstashGet(env, key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return memory.get(key) ?? null;
}

async function saveGame(env, gameId, game) {
  if (!gameId || !game) return false;
  const key = `game:${gameId}`;
  const ttlSeconds = 60 * 60;

  if (storeKind(env) === "upstash") {
    return upstashSet(env, key, JSON.stringify(game), ttlSeconds);
  }

  memory.set(key, game);
  return true;
}

export {
  DEFAULT_LEFT,
  SECRETS,
  nowMs,
  normalize,
  safeAnswer,
  isGuess,
  pickSecret,
  isHard,
  getCategoryHint,
  getSecretFeatures,
  createGame,
  getGame,
  saveGame,
  storeKind,
};
