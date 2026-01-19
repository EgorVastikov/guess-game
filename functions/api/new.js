import { createGame, DEFAULT_LEFT } from "../_store.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const created = await createGame(context.env);
    return json({
      gameId: created.gameId,
      left: DEFAULT_LEFT,
      message: "Игра началась",
    });
  } catch {
    return json({
      gameId: null,
      left: DEFAULT_LEFT,
      message: "Сервис занят, попробуй ещё раз",
    }, 500);
  }
}
