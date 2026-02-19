// gs1.js
// Formato esperado (vuestra planta):
// [DEMO]Ê02<REF>Ê10<LOTE>Ê04<SUBLOTE>Ê21
// Notas:
// - Se respeta el formato leído para sublote (p.ej. "041").

function normalize(input) {
  if (!input) return "";
  let s = input.trim();

  // Quitar DEMO si viene pegado (no afecta al etiquetado; solo para parsear)
  if (s.toUpperCase().startsWith("DEMO")) s = s.slice(4).trim();

  // Quitar AIM si aparece
  if (s.startsWith("]C1")) s = s.slice(3);

  // Mojibake típico
  s = s.replaceAll("ÃŠ", "Ê");
  s = s.replaceAll("Â", "");

  // Convertir controles (si alguno llega como GS) a Ê para unificar
  s = s.replace(/[\x00-\x1F]/g, "Ê");

  // Colapsar separadores repetidos
  s = s.replace(/Ê+/g, "Ê");

  return s;
}

export function parseGs1(rawInput) {
  const input = normalize(rawInput);
  if (!input) return null;

  // Caso A: con separadores Ê
  if (input.includes("Ê")) {
    const segments = input.split("Ê").map(x => x.trim()).filter(Boolean);

    let ref = null;
    let lote = null;
    let sublote = null;

    for (const seg of segments) {
      if (seg.startsWith("02")) ref = seg.slice(2).trim();
      else if (seg.startsWith("10")) lote = seg.slice(2).trim();
      else if (seg.startsWith("04")) {
        // En algunas lecturas llega "041" (sin prefijo AI separado).
        sublote = seg.length <= 3 ? seg.trim() : seg.slice(2).trim();
      }
      else if (seg.startsWith("21")) {
        // en vuestro caso suele ir vacío como terminador
      }
    }

    if (!ref) return null;

    return {
      ref,
      lote: lote || null,
      sublote: sublote || null,
      raw: rawInput,
    };
  }

  // Caso B: lectura concatenada sin separadores (sin Enter/GS)
  // Ejemplo: 02COMPO-007451019-02600404121
  const flat = input.replaceAll(" ", "");
  if (flat.startsWith("02") && flat.endsWith("21") && flat.length > 4) {
    const payload = flat.slice(2, -2);

    let work = payload;
    let sublote = null;

    const idx04 = work.lastIndexOf("04");
    if (idx04 >= 0) {
      const maybeSublote = work.slice(idx04 + 2).trim();
      if (maybeSublote) {
        sublote = maybeSublote;
        work = work.slice(0, idx04);
      }
    }

    const idx10 = work.lastIndexOf("10");
    const ref = (idx10 >= 0 ? work.slice(0, idx10) : work).trim() || null;
    const lote = (idx10 >= 0 ? work.slice(idx10 + 2) : "").trim() || null;

    if (!ref) {
      return null;
    }
    return { ref, lote, sublote, raw: rawInput };
  }

  return null;
}
