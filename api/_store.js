const DEFAULT_LEFT = 10;

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

const ANIMALS = new Set([
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

const BIRDS = new Set([
  "курица",
  "петух",
  "утка",
  "гусь",
  "попугай",
  "воробей",
  "голубь",
]);

const SWIMS = new Set(["рыба", "утка", "гусь", "лягушка", "черепаха"]);

const BIGGER_THAN_CAT = new Set([
  "лошадь",
  "корова",
  "медведь",
  "волк",
  "диван",
  "кровать",
  "стол",
  "дверь",
  "окно",
]);

const AT_HOME = new Set([
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
  "телефон",
  "мяч",
  "кукла",
  "машинка",
]);

const HANDHELD = new Set([
  "ложка",
  "вилка",
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

const SCHOOL_ITEM = new Set([
  "книга",
  "тетрадь",
  "пенал",
  "карандаш",
  "ручка",
  "линейка",
  "рюкзак",
]);

const TOYS = new Set(["мяч", "кукла", "машинка"]);

const FISH = new Set(["рыба"]);

function getSecretFeatures(secret) {
  const s = normalize(secret);

  const living = ANIMALS.has(s);
  const isBird = BIRDS.has(s);
  const isFish = FISH.has(s);
  const thing = !living;

  const canMove = living;
  const canFly = BIRDS.has(s);
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
  };
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

function safeAnswer(value) {
  const t = normalize(value);
  if (t === "да" || t.startsWith("да ")) return "да";
  if (t === "нет" || t.startsWith("нет ")) return "нет";
  if (t === "не знаю" || t.startsWith("не знаю")) return "не знаю";
  return "не знаю";
}

function randomId(prefix = "game") {
  const part = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${part}`;
}


const memory = new Map();

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function storeKind() {
  const kind = normalize(env("STORE_KIND", "memory"));
  return kind || "memory";
}

function upstashConfig() {
  return {
    url: env("UPSTASH_REDIS_REST_URL"),
    token: env("UPSTASH_REDIS_REST_TOKEN"),
  };
}

async function upstashGet(key) {
  const { url, token } = upstashConfig();
  if (!url || !token) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  return data?.result ?? null;
}

async function upstashSet(key, value, ttlSeconds) {
  const { url, token } = upstashConfig();
  if (!url || !token) return false;

  const encodedValue = encodeURIComponent(value);
  const res = await fetch(
    `${url}/set/${encodeURIComponent(key)}/${encodedValue}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) return false;

  if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
    await fetch(`${url}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }

  return true;
}


async function createGame() {
  const gameId = randomId();

  if (storeKind() === "upstash") {
    const secret = pickSecret();
    const game = {
      gameId,
      secret,
      left: DEFAULT_LEFT,
      over: false,
      win: false,
      history: [],
      createdAt: nowMs(),
      lastAskAt: 0,
    };

    await saveGame(gameId, game);
  }

  return { gameId, left: DEFAULT_LEFT };
}

async function getGame(gameId) {
  if (!gameId) return null;
  const key = `game:${gameId}`;

  if (storeKind() === "upstash") {
    const raw = await upstashGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return memory.get(key) ?? null;
}

async function saveGame(gameId, game) {
  if (!gameId || !game) return false;
  const key = `game:${gameId}`;
  const ttlSeconds = 60 * 60;

  if (storeKind() === "upstash") {
    return upstashSet(key, JSON.stringify(game), ttlSeconds);
  }

  memory.set(key, game);
  return true;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (!xff) return "";
  return String(xff).split(",")[0].trim();
}

module.exports = {
  DEFAULT_LEFT,
  SECRETS,
  nowMs,
  normalize,
  isGuess,
  pickSecret,
  safeAnswer,
  getSecretFeatures,
  createGame,
  getGame,
  saveGame,
  getClientIp,
  storeKind,
};
