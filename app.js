import { openDb, getAllLines, putLine, deleteLine, clearAll, findByKey } from "./db.js";
import { parseGs1 } from "./gs1.js";
import { exportToXlsx } from "./export.js";

const STATE = {
  WAIT_LOC: "WAIT_LOC",
  WAIT_ITEMS: "WAIT_ITEMS",
  FINISHED: "FINISHED"
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
  // Suficiente para este caso
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
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
  el.scanInput.focus({ preventScroll: true });
}

function parseCommand(raw) {
  const s = norm(raw).toUpperCase();
  if (s === "FIN" || s === "FIN DE INVENTARIO") return { cmd: "FIN" };
  // Si quisieras comandos explícitos:
  // LOC:AAA / UBI:AAA
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

  // Si escanean una ubicación cuando ya estás en items: lo interpretamos como cambio de ubicación
  // Para evitar falsos positivos: si parece GS1, lo tratamos como artículo. Si NO parece GS1, lo tratamos como ubicación.
  const gs1 = parseGs1(raw);

  // Si no es GS1, lo consideramos:
  // - si es muy corto/alfanumérico -> ubicación o ref simple
  // En modo WAIT_ITEMS, por defecto lo tomamos como REF_ARTICULO (ref simple) salvo que el usuario quiera forzar cambio de ubicación.
  // Para minimizar interacción, usaremos una regla:
  // - Si empieza por "U-" o contiene "-" y "/" etc... podría ser ubicación, pero eso varía por empresa.
  // -> Solución robusta: permitimos cambio de ubicación escaneando "LOC:xxxx" o "UBI:xxxx".
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

  // Construir el registro
  let ref, lote, sublote;

  if (gs1) {
    ref = gs1.gtin;
    lote = gs1.lote;
    sublote = gs1.sublote;
  } else {
    // Código interno simple
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
      createdAt: Date.now()
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
    createdAt: Date.now()
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

function handleScan(raw) {
  el.lastText.textContent = raw;

  const cmd = parseCommand(raw);
  if (cmd?.cmd === "FIN") return finishInventory();

  if (appState === STATE.FINISHED) {
    // Si escanean después de FIN, reiniciamos a esperar ubicación
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
  el.locText.textContent = "—";
  el.lastText.textContent = "—";
  setState(STATE.WAIT_LOC);
  setMsg("Base limpiada. Escanea UBICACIÓN para empezar.", "warn");
  await refresh();
}

function hookScannerInput() {
  // El escáner suele mandar ENTER al final
  el.scanInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = el.scanInput.value;
      el.scanInput.value = "";
      await Promise.resolve(handleScan(value));
      await refresh();
      focusScanner();
    }
  });

  // Mantener foco siempre
  document.addEventListener("click", () => focusScanner());
  window.addEventListener("focus", () => focusScanner());
}

async function main() {
  db = await openDb();
  hookScannerInput();

  el.btnUndo.addEventListener("click", async () => { await undoLast(); focusScanner(); });
  el.btnExport.addEventListener("click", async () => { await doExport(); focusScanner(); });
  el.btnReset.addEventListener("click", async () => { await doReset(); focusScanner(); });

  setState(STATE.WAIT_LOC);
  setMsg("Listo. Escanea una UBICACIÓN.", "ok");
  await refresh();
  focusScanner();
}

main().catch(err => {
  console.error(err);
  setMsg("Error inicializando la app: " + (err?.message || err), "err");
});
