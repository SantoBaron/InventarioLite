// app.js
import { openDb, getAllLines, putLine, deleteLine, clearAll, findByKey } from "./db.js";
import { parseGs1 } from "./gs1.js";
import { exportToCsv, exportToXlsx } from "./export.js";

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
  btnNextLoc: document.getElementById("btnNextLoc"),
  btnNextLocCard: document.getElementById("btnNextLocCard"),
  btnFinish: document.getElementById("btnFinish"),
  btnFinishCard: document.getElementById("btnFinishCard"),
  btnManual: document.getElementById("btnManual"),
  btnManualCard: document.getElementById("btnManualCard"),
  manualDialog: document.getElementById("manualDialog"),
  manualForm: document.getElementById("manualForm"),
  manualRef: document.getElementById("manualRef"),
  manualLote: document.getElementById("manualLote"),
  manualSublote: document.getElementById("manualSublote"),
  btnManualCancel: document.getElementById("btnManualCancel"),
  btnExport: document.getElementById("btnExport"),
  btnExportCsv: document.getElementById("btnExportCsv"),
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

function safeOnMany(nodes, evt, fn) {
  for (const n of nodes) safeOn(n, evt, fn);
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
    if (l.manual) {
      tr.classList.add("manual-row");
      tr.title = "Registro introducido manualmente";
    }
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
  if (s === "SIGUIENTE" || s === "FIN UBI" || s === "FIN UBICACION") return { cmd: "NEXT_LOC" };
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
  if (appState === STATE.FINISHED) {
    setMsg("El inventario ya está finalizado.", "warn");
    return;
  }
  setState(STATE.FINISHED);
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setMsg("Inventario finalizado. Puedes exportar a Excel o CSV.", "warn");
}

async function closeCurrentLocation() {
  if (!currentLoc) {
    setMsg("No hay ubicación activa para cerrar.", "warn");
    return;
  }
  currentLoc = null;
  if (el.locText) el.locText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Ubicación cerrada. Escanea la siguiente ubicación.", "warn");
}

async function storeItem({ ref, lote, sublote, manual = false }) {
  if (!currentLoc) {
    setMsg("No hay ubicación activa. Escanea ubicación primero.", "err");
    setState(STATE.WAIT_LOC);
    return;
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
      manual,
      createdAt: Date.now(),
    };
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK: ${ref} (lote ${lote ?? "-"}) (sublote ${sublote})${manual ? " [manual]" : ""}`, "ok");
    return;
  }

  if (existing.length > 0) {
    const line = existing[0];
    line.cantidad += 1;
    line.createdAt = Date.now();
    line.manual = Boolean(line.manual || manual);
    await putLine(db, line);
    lastInsertedId = line.id;
    setMsg(`OK (agregado): ${ref} (lote ${lote ?? "-"}) → cantidad ${line.cantidad}${manual ? " [manual]" : ""}`, "ok");
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
    manual,
    createdAt: Date.now(),
  };
  await putLine(db, line);
  lastInsertedId = line.id;
  setMsg(`OK: ${ref} (lote ${lote ?? "-"})${manual ? " [manual]" : ""}`, "ok");
}

async function registerItem(scanRaw) {
  const raw = norm(scanRaw);
  if (!raw) return;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "LOC") return registerLocation(cmd.loc);
  if (cmd?.cmd === "FIN") return finishInventory();
  if (cmd?.cmd === "NEXT_LOC") return closeCurrentLocation();

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

  return storeItem({ ref, lote, sublote, manual: false });
}

function openManualDialog() {
  if (!currentLoc) {
    setMsg("Primero debes fijar una ubicación para el alta manual.", "warn");
    return;
  }

  if (!el.manualDialog?.showModal) {
    const ref = norm(window.prompt("Referencia:", ""));
    if (!ref) return;
    const lote = norm(window.prompt("Lote (opcional):", "")) || null;
    const sublote = norm(window.prompt("Sublote (opcional):", "")) || null;
    storeItem({ ref, lote, sublote, manual: true })
      .then(refresh)
      .catch((e) => {
        console.error(e);
        setMsg("ERROR: " + (e?.message || e), "err");
      });
    return;
  }

  el.manualRef.value = "";
  el.manualLote.value = "";
  el.manualSublote.value = "";
  el.manualDialog?.showModal?.();
  el.manualRef?.focus?.();
}

async function submitManualForm(evt) {
  evt.preventDefault();
  const ref = norm(el.manualRef?.value);
  const lote = norm(el.manualLote?.value) || null;
  const sublote = norm(el.manualSublote?.value) || null;

  if (!ref) {
    setMsg("Referencia obligatoria en alta manual.", "err");
    return;
  }

  await storeItem({ ref, lote, sublote, manual: true });
  el.manualDialog?.close?.();
  await refresh();
}

function handleScan(raw) {
  raw = stripDemoPrefix(raw);
  if (!raw) return;

  if (el.lastText) el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishInventory();
  if (cmd?.cmd === "NEXT_LOC") return closeCurrentLocation();
  if (cmd?.cmd === "LOC") return registerLocation(cmd.loc);

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

async function doExportCsv() {
  const lines = await getAllLines(db);
  if (!lines.length) {
    setMsg("No hay datos para exportar.", "warn");
    return;
  }
  exportToCsv(lines);
  setMsg("Exportación generada (.csv).", "ok");
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

  function scheduleFlushByState() {
    if (appState === STATE.FINISHED) return;

    const timeoutMs = appState === STATE.WAIT_LOC ? 250 : 90;

    clearTimeout(timer);
    timer = setTimeout(() => {
      // Si el lector no manda Enter/Tab, cerramos lectura por tiempo
      if (buffer.trim()) flush();
    }, timeoutMs);
  }

  function flush() {
    const value = buffer.trim();
    buffer = "";
    if (el.scanInput) el.scanInput.value = "";
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
      scheduleFlushByState();
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      scheduleFlushByState();
    }
  });

  // Algunos escáneres actúan como "teclado wedge" y escriben en el input
  // sin exponer bien todos los keydown. Este listener cubre ese caso.
  safeOn(el.scanInput, "input", () => {
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlushByState();
  });

  safeOn(el.scanInput, "paste", () => {
    const v = el.scanInput?.value ?? "";
    if (!v) return;
    buffer = v;
    scheduleFlushByState();
  });

  // Compatibilidad (no crítico)
  el.scanInput?.focus?.({ preventScroll: true });
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

  const onNextLoc = async () => {
    await closeCurrentLocation();
    await refresh();
  };

  const onFinish = async () => {
    await finishInventory();
    await refresh();
  };

  safeOnMany([el.btnNextLoc, el.btnNextLocCard], "click", () => {
    onNextLoc().catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOnMany([el.btnFinish, el.btnFinishCard], "click", () => {
    onFinish().catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOnMany([el.btnManual, el.btnManualCard], "click", () => openManualDialog());
  safeOn(el.manualForm, "submit", (evt) => {
    submitManualForm(evt).catch((e) => {
      console.error(e);
      setMsg("ERROR: " + (e?.message || e), "err");
    });
  });
  safeOn(el.btnManualCancel, "click", () => el.manualDialog?.close?.());
  safeOn(el.btnExport, "click", async () => { await doExport(); });
  safeOn(el.btnExportCsv, "click", async () => { await doExportCsv(); });
  safeOn(el.btnReset, "click", async () => { await doReset(); });

  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
}

main().catch((err) => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});
