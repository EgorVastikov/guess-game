import { runGameAction } from "./game.js";
import { MAX_REQUEST_BYTES } from "./config.js";
const TOO_LARGE = Symbol("Payload too large");

async function readPagesBody(request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return TOO_LARGE;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch { return {}; }
  finally { reader.releaseLock(); }
}

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
    const body = await readPagesBody(context.request);
    if (body === TOO_LARGE) {
      return jsonResponse({ status: 413, body: { message: "Запрос слишком большой. Упрости рисунок и попробуй ещё раз" } });
    }
    return jsonResponse(await runGameAction(action, context.env, body));
  };
}

function jsonResponse({ status, body }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
