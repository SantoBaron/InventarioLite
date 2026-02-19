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
  el.msg.textContent = text;
  el.msg.className = "msg " + (kind || "");
}

function setState(s) {
  appState = s;
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

function renderTable(lines) {
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
  el.countText.textContent = String(lines.length);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refresh() {
  const lines = await getAllLines(db);
  renderTable(lines);
}

function focusScanner() {
  // Mantener por compatibilidad (algunos lectores “necesitan” un input)
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
  el.locText.textContent = currentLoc;
  setState(STATE.WAIT_ITEMS);
  setMsg(`Ubicación fijada: ${currentLoc}. Escanea artículos…`, "ok");
}

async function registerItem(scanRaw) {
  const raw = norm(scanRaw);
  if (!raw) return;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "LOC") {
    await registerLocation(cmd.loc);
    return;
  }
  if (cmd?.cmd === "FIN") {
    await finishInventory();
    return;
  }

  if (!currentLoc) {
    setMsg("No hay ubicación activa. Escanea ubicación primero.", "err");
    setState(STATE.WAIT_LOC);
    return;
  }

  let ref, lote, sublote;

  const gs1 = parseGs1(raw);
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

  // Si hay sublote: no permitimos duplicados
  if (sublote) {
    if (existing.length > 0) {
      setMsg(
        `DUPLICADO (con sublote) rechazado: ${ref} / ${lote ?? "-"} / ${sublote}`,
        "err"
      );
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

  // Si NO hay sublote: agregamos cantidad sobre la misma key
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
  el.locText.textContent = "—";
  setMsg("Inventario finalizado. Puedes exportar a Excel.", "warn");
}

function stripDemoPrefix(raw) {
  let s = (raw ?? "").trim();
  const up = s.toUpperCase();

  // Si llega DEMO solo, lo descartamos
  if (up === "DEMO") return "";

  // Si llega como prefijo, lo quitamos
  if (up.startsWith("DEMO")) {
    s = s.slice(4).trim();
  }

  return s;
}

function handleScan(raw) {
  raw = stripDemoPrefix(raw);
  if (!raw) return;

  el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishInventory();

  // Si estamos esperando ubicación, cualquier lectura es una ubicación
  if (appState === STATE.WAIT_LOC) {
    return registerLocation(raw);
  }

  // Si estamos en ARTÍCULOS, procesamos como artículo (sin filtrar contenido aquí)
  if (appState === STATE.WAIT_ITEMS) {
    return registerItem(raw);
  }
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
  el.locText.textContent = "—";
  el.lastText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Base limpiada. Escanea UBICACIÓN para empezar.", "warn");
  await refresh();
}

/**
 * Captura para lectores tipo “keyboard wedge”:
 * - Acumula teclas
 * - Flushea SOLO con Enter/Tab
 */
function hookScannerInput() {
  let buffer = "";

  function flush() {
    const value = buffer.trim();
    buffer = "";
    if (!value) return;

    Promise.resolve(handleScan(value))
      .then(refresh)
      .catch(console.error);

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

    if (e.key.length === 1) {
      buffer += e.key;
    }
  });

  document.addEventListener("click", () => focusScanner());
  window.addEventListener("focus", () => focusScanner());
}

async function main() {
  db = await openDb();
  hookScannerInput();

  el.btnUndo.addEventListener("click", async () => {
    await undoLast();
    focusScanner();
  });
  el.btnExport.addEventListener("click", async () => {
    await doExport();
    focusScanner();
  });
  el.btnReset.addEventListener("click", async () => {
    await doReset();
    focusScanner();
  });

  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
  focusScanner();
}

main().catch((err) => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});
