export function createDrawingController({ $, apiPost, setBusy, isBusy, updateControls }) {
  const canvas = $("drawingCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let drawingGameId = null;
  let drawingOver = false;
  let attempts = 0;
  let latest = null;
  let strokes = [];
  let active = null;
  let erasing = false;
  let revision = 0;
  let guessedRevision = -1;

  const status = text => { $("drawingStatus").textContent = text; };
  const editable = () => !isBusy() && !drawingOver;

  function paintPoint(stroke, point, previous) {
    ctx.fillStyle = ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    if (previous) {
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    } else {
      ctx.arc(point.x, point.y, stroke.width / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function redraw() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      stroke.points.forEach((point, index) => paintPoint(stroke, point, stroke.points[index - 1]));
    }
  }

  function changed() {
    revision++;
    if (latest && !drawingOver) status("Рисунок изменился. Нажми «Угадай», чтобы ИИ посмотрел ещё раз");
    updateControls();
  }

  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left - canvas.clientLeft) * canvas.width / canvas.clientWidth)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top - canvas.clientTop) * canvas.height / canvas.clientHeight)),
    };
  }

  function endStroke(event) {
    if (active?.pointerId === event.pointerId) active = null;
  }

  function hasVisibleDrawing() {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250)) return true;
    }
    return false;
  }

  function renderGame(data) {
    drawingGameId = data.gameId;
    drawingOver = Boolean(data.over);
    latest = data.latestAttempt;
    attempts = data.attemptsUsed;
    $("drawingAttempts").textContent = String(attempts);
    $("drawingGuesses").replaceChildren();
    for (const guess of latest?.guesses ?? []) {
      const item = document.createElement("li");
      item.textContent = guess;
      $("drawingGuesses").appendChild(item);
    }
    $("drawingGuessPanel").hidden = !latest;
    $("drawingQuestion").textContent = latest?.question || "";
    if (data.message) status(data.message);
  }

  function showError(error) {
    if (error?.data?.mode === "drawing") renderGame(error.data);
    status(error?.name === "AbortError"
      ? "ИИ не успел ответить. Рисунок сохранён на странице — попробуй ещё раз"
      : error instanceof TypeError
        ? "Нет соединения. Рисунок сохранён на странице — попробуй позже"
        : error?.message || "Не удалось получить ответ. Рисунок остаётся на странице");
  }

  async function start() {
    if (isBusy()) return;
    setBusy(true, "drawing-new");
    status("Готовлю полотно...");
    try {
      const data = await apiPost("/api/new", { mode: "drawing" });
      strokes = [];
      active = null;
      erasing = false;
      revision = 0;
      guessedRevision = -1;
      redraw();
      renderGame(data);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function guess() {
    if (!editable() || !drawingGameId) return;
    if (!hasVisibleDrawing()) {
      status("Сначала нарисуй что-нибудь на белом полотне");
      return;
    }
    setBusy(true, "drawing-guess");
    status("ИИ рассматривает рисунок...");
    try {
      const imageDataUrl = canvas.toDataURL("image/png");
      const data = await apiPost("/api/draw", { gameId: drawingGameId, imageDataUrl }, 30000);
      guessedRevision = revision;
      renderGame(data);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function confirm(guessed) {
    if (!editable() || !latest || latest.feedback !== null || guessedRevision !== revision) return;
    if (guessed && !latest.guesses.length) return;
    setBusy(true, "drawing-confirm");
    try {
      renderGame(await apiPost("/api/confirm", { gameId: drawingGameId, attemptId: latest.id, guessed }));
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  function updateDrawingControls() {
    const locked = !editable();
    for (const id of ["drawingColor", "drawingWidth", "drawingEraser"]) $(id).disabled = locked;
    $("drawingUndo").disabled = locked || !strokes.length;
    $("drawingClear").disabled = locked || !strokes.length;
    $("drawingNewBtn").disabled = isBusy();
    $("drawingGuessBtn").disabled = locked || !drawingGameId || !strokes.length;
    const canConfirm = !locked && latest && latest.feedback === null && guessedRevision === revision;
    $("drawingYes").disabled = !canConfirm || !latest?.guesses.length;
    $("drawingNo").disabled = !canConfirm;
    canvas.setAttribute("aria-disabled", String(locked));
    canvas.style.cursor = locked ? "default" : "crosshair";
    $("drawingEraser").setAttribute("aria-pressed", String(erasing));
  }

  function init() {
    redraw();
    canvas.addEventListener("pointerdown", event => {
      if (!editable() || active || event.button !== 0) return;
      event.preventDefault();
      const stroke = { color: erasing ? "#ffffff" : $("drawingColor").value, width: Number($("drawingWidth").value), points: [pointFrom(event)] };
      strokes.push(stroke);
      active = { pointerId: event.pointerId, stroke };
      canvas.setPointerCapture(event.pointerId);
      paintPoint(stroke, stroke.points[0]);
      changed();
    });
    canvas.addEventListener("pointermove", event => {
      if (!editable() || active?.pointerId !== event.pointerId) return;
      event.preventDefault();
      const point = pointFrom(event);
      const previous = active.stroke.points.at(-1);
      active.stroke.points.push(point);
      paintPoint(active.stroke, point, previous);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, endStroke);
    $("drawingColor").addEventListener("input", () => { erasing = false; updateControls(); });
    $("drawingWidth").addEventListener("input", () => { $("drawingWidthValue").textContent = $("drawingWidth").value; });
    $("drawingEraser").addEventListener("click", () => { erasing = !erasing; updateControls(); });
    $("drawingUndo").addEventListener("click", () => {
      if (!editable()) return;
      active = null;
      strokes.pop(); redraw(); changed();
    });
    $("drawingClear").addEventListener("click", () => {
      if (!editable()) return;
      active = null;
      strokes = []; redraw(); changed();
    });
    $("drawingNewBtn").addEventListener("click", start);
    $("drawingGuessBtn").addEventListener("click", guess);
    $("drawingYes").addEventListener("click", () => confirm(true));
    $("drawingNo").addEventListener("click", () => confirm(false));
  }

  return {
    init,
    ensureStarted: async () => { if (!drawingGameId) await start(); },
    updateControls: updateDrawingControls,
    setBusyLabel(label) {
      if (label === "drawing-new") $("drawingNewBtn").textContent = "Готовлю...";
      if (label === "drawing-guess") $("drawingGuessBtn").textContent = "Рассматриваю...";
      if (label === "drawing-confirm") status("Сохраняю твой ответ...");
    },
    resetLabels() {
      $("drawingNewBtn").textContent = "Новый рисунок";
      $("drawingGuessBtn").textContent = "Угадай";
    },
  };
}
