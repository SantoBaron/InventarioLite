// app.js
import { openDb, getAllLines, putLine, deleteLine, clearAll, findByKey } from "./db.js";
import { parseGs1 } from "./gs1.js";
import { exportToXlsx } from "./export.js";

const STATE = {
  WAIT_LOC: "WAIT_LOC",
  WAIT_ITEMS: "WAIT_ITEMS",
  FINISHED: "FINISHED",
};

const el = {
  scanInput: document.getElementById("scanInput"), // puede no existir
  stateText: document.getElementById("stateText"),
  locText: document.getElementById("locText"),
  lastText: document.getElementById("lastText"),
  countText: document.getElementById("countText"),
  msg: document.getElementById("msg"),
  tbody: document.getElementById("tbody"),
  btnUndo: document.getElementById("btnUndo"),
  btnExport: document.getElementById("btnExport"),
  btnReset: document.getElementById("btnReset"),
};

let db;
let appState = STATE.WAIT_LOC;
let currentLoc = null;
let lastInsertedId = null;

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}

function safeOn(node, evt, fn) {
  if (!node) return;
  node.addEventListener(evt, fn);
}

function setMsg(text = "", kind = "") {
  if (!el.msg) return;
  el.msg.textContent = text;
  el.msg.className = "msg " + (kind || "");
}

function setState(s) {
  appState = s;
  if (!el.stateText) return;
  if (s === STATE.WAIT_LOC) el.stateText.textContent = "Esperando UBICACIÓN";
  if (s === STATE.WAIT_ITEMS) el.stateText.textContent = "Escaneando ARTÍCULOS";
  if (s === STATE.FINISHED) el.stateText.textContent = "FIN DE INVENTARIO";
}

function norm(s) {
  return (s ?? "").trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTable(lines) {
  if (!el.tbody) return;
  el.tbody.innerHTML = "";
  for (const l of lines) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(l.ubicacion)}</td>
      <td class="mono">${escapeHtml(l.ref)}</td>
      <td class="mono">${escapeHtml(l.lote ?? "")}</td>
      <td class="mono">${escapeHtml(l.sublote ?? "")}</td>
      <td class="num mono">${l.cantidad}</td>
    `;
    el.tbody.appendChild(tr);
  }
  if (el.countText) el.countText.textContent = String(lines.length);
}

async function refresh() {
  if (!db) return;
  const lines = await getAllLines(db);
  renderTable(lines);
}

function makeKey(ubicacion, ref, lote, sublote) {
  const u = norm(ubicacion).toUpperCase();
  const r = norm(ref).toUpperCase();
  const l = norm(lote || "");
  const sl = norm(sublote || "");
  return `${u}|${r}|${l}|${sl}`;
}

// --- Comandos (opcionales) ---
function parseCommand(raw) {
  const s = norm(raw).toUpperCase();
  if (s === "FIN" || s === "FIN DE INVENTARIO") return { cmd: "FIN" };
  if (s.startsWith("LOC:") || s.startsWith("UBI:")) return { cmd: "LOC", loc: raw.slice(4).trim() };
  return null;
}

// --- Limpieza de entrada: quita DEMO si viene como prefijo ---
function stripDemoPrefix(raw) {
  let s = (raw ?? "").trim();
  const up = s.toUpperCase();
  if (up === "DEMO") return "";
  if (up.startsWith("DEMO")) s = s.slice(4).trim();
  return s;
}

async function registerLocation(locRaw) {
  const loc = norm(locRaw);
  if (!loc) {
    setMsg("Ubicación vacía. Vuelve a escanear.", "err");
    return;
  }
  currentLoc = loc;
  if (el.locText) el.locText.textContent = currentLoc;
  setState(STATE.WAIT_ITEMS);
  setMsg(`Ubicación fijada: ${currentLoc}. Escanea artículos…`, "ok");
}

async function finishInventory() {
  setState(STATE.FINISHED);
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setMsg("Inventario finalizado. Puedes exportar a Excel.", "warn");
}

async function registerItem(scanRaw) {
  const raw = norm(scanRaw);
  if (!raw) return;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "LOC") return registerLocation(cmd.loc);
  if (cmd?.cmd === "FIN") return finishInventory();

  if (!currentLoc) {
    setMsg("No hay ubicación activa. Escanea ubicación primero.", "err");
    setState(STATE.WAIT_LOC);
    return;
  }

  // Parseo GS1 (custom)
  let ref, lote, sublote;
  const gs1 = parseGs1(raw);

  if (gs1) {
    ref = gs1.ref;
    lote = gs1.lote;
    sublote = gs1.sublote;
  } else {
    // si no parsea, registramos el raw completo como REF (tal como pediste)
    ref = raw;
    lote = null;
    sublote = null;
  }

  const key = makeKey(currentLoc, ref, lote, sublote);
  const existing = await findByKey(db, key);

  // Si hay sublote: no permitimos duplicados
  if (sublote) {
    if (existing.length > 0) {
      setMsg(`DUPLICADO (con sublote) rechazado: ${ref} / ${lote ?? "-"} / ${sublote}`, "err");
      return;
    }
    const line = {
      id: uuid(),
      key,
      ubicacion: currentLoc,
      ref,
      lote: lote ?? null,
      sublote: sublote ?? null,
      cantidad: 1,
      createdAt: Date.now(),
    };
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK: ${ref} (lote ${lote ?? "-"}) (sublote ${sublote})`, "ok");
    return;
  }

  // Sin sublote: agregamos cantidad
  if (existing.length > 0) {
    const line = existing[0];
    line.cantidad += 1;
    line.createdAt = Date.now();
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK (agregado): ${ref} (lote ${lote ?? "-"}) → cantidad ${line.cantidad}`, "ok");
    return;
  }

  const line = {
    id: uuid(),
    key,
    ubicacion: currentLoc,
    ref,
    lote: lote ?? null,
    sublote: null,
    cantidad: 1,
    createdAt: Date.now(),
  };
  await putLine(db, line);
  lastInsertedId = line.id;
  setMsg(`OK: ${ref} (lote ${lote ?? "-"})`, "ok");
}

function handleScan(raw) {
  raw = stripDemoPrefix(raw);
  if (!raw) return;

  if (el.lastText) el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishInventory();

  if (appState === STATE.FINISHED) {
    setState(STATE.WAIT_LOC);
    setMsg("Se reanuda captura: escanea UBICACIÓN.", "warn");
  }

  if (appState === STATE.WAIT_LOC) return registerLocation(raw);
  if (appState === STATE.WAIT_ITEMS) return registerItem(raw);
}

async function undoLast() {
  if (!lastInsertedId) {
    setMsg("Nada que deshacer.", "warn");
    return;
  }
  await deleteLine(db, lastInsertedId);
  setMsg("Undo OK (último registro eliminado).", "ok");
  lastInsertedId = null;
  await refresh();
}

async function doExport() {
  const lines = await getAllLines(db);
  if (!lines.length) {
    setMsg("No hay datos para exportar.", "warn");
    return;
  }
  exportToXlsx(lines);
  setMsg("Exportación generada (.xlsx).", "ok");
}

async function doReset() {
  await clearAll(db);
  currentLoc = null;
  lastInsertedId = null;
  if (el.locText) el.locText.textContent = "—";
  if (el.lastText) el.lastText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Base limpiada. Escanea UBICACIÓN para empezar.", "warn");
  await refresh();
}

// --- Captura global de teclado (NO depende de foco) ---
function hookScannerInput() {
  let buffer = "";
  let timer = null;

  function scheduleFlushIfWaitingLocation() {
    // Solo hacemos timeout-flush en modo UBICACIÓN
    if (appState !== STATE.WAIT_LOC) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      // Si el lector no manda Enter para ubicación, cerramos lectura por tiempo
      if (buffer.trim()) flush();
    }, 250); // 250ms suele ser seguro para lectura completa de ubicación
  }

  function flush() {
    const value = buffer.trim();
    buffer = "";
    clearTimeout(timer);
    timer = null;

    if (!value) return;

    Promise.resolve(handleScan(value))
      .then(refresh)
      .catch((e) => {
        console.error(e);
        setMsg("ERROR: " + (e?.message || e), "err");
      });
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // Terminadores clásicos del escáner
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      flush();
      return;
    }

    if (e.key === "Backspace") {
      buffer = buffer.slice(0, -1);
      scheduleFlushIfWaitingLocation();
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      scheduleFlushIfWaitingLocation();
    }
  });

  // Compatibilidad (no crítico)
  safeOn(document, "click", () => el.scanInput?.focus?.({ preventScroll: true }));
  safeOn(window, "focus", () => el.scanInput?.focus?.({ preventScroll: true }));
}
async function main() {
  // Reporta errores sin matar la app
  window.addEventListener("error", (e) => {
    const msg = e?.error?.message || e?.message || String(e);
    console.error(e);
    setMsg("ERROR JS: " + msg, "err");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e);
    setMsg("PROMISE ERROR: " + (e?.reason?.message || e?.reason || e), "err");
  });

  db = await openDb();

  hookScannerInput();

  safeOn(el.btnUndo, "click", async () => { await undoLast(); });
  safeOn(el.btnExport, "click", async () => { await doExport(); });
  safeOn(el.btnReset, "click", async () => { await doReset(); });

  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
}

main().catch((err) => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});

