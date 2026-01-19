const {
  createGame,
  saveGame,
  pickSecret,
  nowMs,
  DEFAULT_LEFT,
  storeKind,
} = require("./_store");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.json({ message: "Method not allowed" });
    }

    const created = await createGame();

    if (storeKind() !== "upstash") {
      const secret = pickSecret();
      const game = {
        gameId: created.gameId,
        secret,
        left: DEFAULT_LEFT,
        over: false,
        win: false,
        history: [],
        createdAt: nowMs(),
        lastAskAt: 0,
      };

      await saveGame(created.gameId, game);
    }

    res.statusCode = 200;
    return res.json({
      gameId: created.gameId,
      left: DEFAULT_LEFT,
      message: "Игра началась",
    });
  } catch (e) {
    res.statusCode = 500;
    return res.json({
      gameId: null,
      left: 10,
      message: "Сервис занят, попробуй ещё раз",
    });
  }
};
