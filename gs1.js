// gs1.js
// Formato esperado (vuestra planta):
// [DEMO]Ê02<REF>Ê10<LOTE>Ê04<SUBLOTE>Ê21
// Notas:
// - SUBLOTE a veces viene como "041" o "042" (sin padding): lo normalizamos a 5 dígitos si es numérico.

function padSublote(v) {
  if (!v) return null;
  const t = v.trim();
  if (/^\d+$/.test(t)) return t.padStart(5, "0");
  return t;
}

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

  // Si no tiene Ê, no intentamos parseo de vuestro GS1
  if (!input.includes("Ê")) return null;

  const segments = input.split("Ê").map(x => x.trim()).filter(Boolean);

  let ref = null;
  let lote = null;
  let sublote = null;

  for (const seg of segments) {
    if (seg.startsWith("02")) ref = seg.slice(2).trim();
    else if (seg.startsWith("10")) lote = seg.slice(2).trim();
    else if (seg.startsWith("04")) sublote = padSublote(seg.slice(2));
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
