import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import apiNew from "./api/new.js";
import apiAsk from "./api/ask.js";
import apiHint from "./api/hint.js";
import apiAnalysis from "./api/analysis.js";
import apiDraw from "./api/draw.js";
import apiConfirm from "./api/confirm.js";
import { MAX_REQUEST_BYTES } from "./shared/config.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(obj));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function safeJoinPublic(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const clean = decoded.replace(/\0/g, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, clean));
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_REQUEST_BYTES) {
        chunks.length = 0;
        reject(new Error("Payload too large"));
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
}

function wrapApiRes(nodeRes) {
  return {
    statusCode: 200,
    json(obj) {
      sendJson(nodeRes, this.statusCode || 200, obj);
    },
  };
}

async function handleApi(req, res, pathname) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { message: "Method not allowed" });
  }

  let rawBuf;
  try { rawBuf = await readBody(req); } catch {
    return sendJson(res, 413, { message: "Запрос слишком большой. Упрости рисунок и попробуй ещё раз" });
  }
  let rawText = "";
  try {
    rawText = rawBuf.toString("utf8");
    if (rawText.includes("\u0000")) {
      rawText = rawBuf.toString("utf16le");
    }
  } catch {
    rawText = "";
  }

  let bodyObj = {};
  try {
    bodyObj = rawText ? JSON.parse(rawText) : {};
  } catch {
    bodyObj = {};
  }

  req.body = bodyObj;

  const vres = wrapApiRes(res);

  if (pathname === "/api/new") return apiNew(req, vres);
  if (pathname === "/api/ask") return apiAsk(req, vres);
  if (pathname === "/api/hint") return apiHint(req, vres);
  if (pathname === "/api/analysis") return apiAnalysis(req, vres);
  if (pathname === "/api/draw") return apiDraw(req, vres);
  if (pathname === "/api/confirm") return apiConfirm(req, vres);

  return sendJson(res, 404, { message: "Not found" });
}

async function handleStatic(req, res, pathname) {
  let filePath;

  if (pathname === "/") {
    filePath = path.join(PUBLIC_DIR, "index.html");
  } else {
    filePath = safeJoinPublic(pathname);
    if (!filePath) return send(res, 400, "Bad request");
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const index = path.join(filePath, "index.html");
      if (fs.existsSync(index)) filePath = index;
      else return send(res, 404, "Not found");
    }

    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      return await handleApi(req, res, pathname);
    }

    return await handleStatic(req, res, pathname);
  } catch (e) {
    return sendJson(res, 500, { message: "Server error" });
  }
});

function printReady(port) {
  console.log(`Local server running: http://localhost:${port}`);
}

function start(port) {
  server.listen(port, "0.0.0.0", () => printReady(server.address().port));
}

const requestedPort = Number(process.env.PORT || 3000);

server.on("error", (err) => {
  if (
    err &&
    err.code === "EADDRINUSE" &&
    requestedPort === 3000 &&
    !process.env.PORT
  ) {
    start(3001);
    return;
  }
  throw err;
});

start(requestedPort);
