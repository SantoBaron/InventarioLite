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
  scanInput: document.getElementById("scanInput"),
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

function makeKey(ubicacion, ref, lote, sublote) {
  const u = norm(ubicacion).toUpperCase();
  const r = norm(ref).toUpperCase();
  const l = norm(lote || "");
  const sl = norm(sublote || "");
  return `${u}|${r}|${l}|${sl}`;
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

function focusScanner() {
  el.scanInput?.focus?.({ preventScroll: true });
}

function parseCommand(raw) {
  const s = norm(raw).toUpperCase();
  if (s === "FIN" || s === "FIN DE INVENTARIO") return { cmd: "FIN" };
  if (s.startsWith("LOC:") || s.startsWith("UBI:")) {
    return { cmd: "LOC", loc: raw.slice(4).trim() };
  }
  return null;
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

  let ref, lote, sublote;

  // ✅ Si parseGs1 falla por cualquier motivo, NO paramos la app
  let gs1 = null;
  try {
    gs1 = parseGs1(raw);
  } catch (e) {
    console.error(e);
    setMsg(`ERROR parseGs1: ${e?.message || e}`, "err");
    gs1 = null;
  }

  if (gs1) {
    ref = gs1.ref;
    lote = gs1.lote;
    sublote = gs1.sublote;
  } else {
    ref = raw;
    lote = null;
    sublote = null;
  }

  const key = makeKey(currentLoc, ref, lote, sublote);
  const existing = await findByKey(db, key);

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

async function finishInventory() {
  setState(STATE.FINISHED);
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setMsg("Inventario finalizado. Puedes exportar a Excel.", "warn");
}

function stripDemoPrefix(raw) {
  let s = (raw ?? "").trim();
  const up = s.toUpperCase();
  if (up === "DEMO") return "";
  if (up.startsWith("DEMO")) s = s.slice(4).trim();
  return s;
}

function handleScan(raw) {
  raw = stripDemoPrefix(raw);
  if (!raw) return;

  if (el.lastText) el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishInventory();

  // ✅ Ubicación
  if (appState === STATE.WAIT_LOC) return registerLocation(raw);

  // ✅ Artículos
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

function hookScannerInput() {
  let buffer = "";

  function flush() {
    const value = buffer.trim();
    buffer = "";
    if (!value) return;

    Promise.resolve(handleScan(value))
      .then(refresh)
      .catch((e) => {
        console.error(e);
        setMsg(`ERROR: ${e?.message || e}`, "err");
      });

    focusScanner();
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      flush();
      return;
    }

    if (e.key === "Backspace") {
      buffer = buffer.slice(0, -1);
      return;
    }

    if (e.key.length === 1) buffer += e.key;
  });

  document.addEventListener("click", () => focusScanner());
  window.addEventListener("focus", () => focusScanner());
}

function safeOn(elm, evt, fn) {
  if (!elm) return;
  elm.addEventListener(evt, fn);
}

async function main() {
  // ✅ Captura errores globales y los muestra
  window.addEventListener("error", (e) => {
    const msg = e?.error?.message || e?.message || String(e);
    console.error(e);
    setMsg(`ERROR JS: ${msg}`, "err");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e);
    setMsg(`PROMISE ERROR: ${e?.reason?.message || e?.reason || e}`, "err");
  });

  db = await openDb();
  hookScannerInput();

  safeOn(el.btnUndo, "click", async () => { await undoLast(); focusScanner(); });
  safeOn(el.btnExport, "click", async () => { await doExport(); focusScanner(); });
  safeOn(el.btnReset, "click", async () => { await doReset(); focusScanner(); });

  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
  focusScanner();
}

main().catch((err) => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});
