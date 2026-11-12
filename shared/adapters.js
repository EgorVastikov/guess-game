import { runGameAction } from "./game.js";

export function nodeHandler(action) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.json({ message: "Method not allowed" });
    }
    let body = req.body ?? {};
    if (typeof body === "string" || body instanceof Uint8Array) {
      try {
        body = JSON.parse(typeof body === "string" ? body : new TextDecoder().decode(body));
      } catch {
        body = {};
      }
    }
    const result = await runGameAction(action, process.env, body);
    res.statusCode = result.status;
    return res.json(result.body);
  };
}

export function pagesHandler(action) {
  return async function onRequest(context) {
    if (context.request.method !== "POST") {
      return jsonResponse({ status: 405, body: { message: "Method not allowed" } });
    }
    const body = await context.request.json().catch(() => ({}));
    return jsonResponse(await runGameAction(action, context.env, body));
  };
}

function jsonResponse({ status, body }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
