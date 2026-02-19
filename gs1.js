function normalize(input) {
  if (!input) return "";
  let s = input.trim();
  if (s.startsWith("]C1")) s = s.slice(3);

  // Separador real en vuestro lector
  s = s.replaceAll("Ê", "|");

  // Quitar controles
  s = s.replace(/[\x00-\x1F]/g, "");

  // Limpiar separadores repetidos
  s = s.replace(/\|+/g, "|");

  return s;
}

function padSublote(v) {
  if (!v) return null;
  const t = v.trim();

  // Si es numérico, lo normalizamos a 5 dígitos (00001, 00042, etc.)
  if (/^\d+$/.test(t)) return t.padStart(5, "0");

  return t; // si no es numérico, no tocamos
}

export function parseGs1(rawInput) {
  const input = normalize(rawInput);
  if (!input) return null;

  const segments = input.split("|").filter(Boolean);

  let ref = null;
  let lote = null;
  let sublote = null;

  for (const seg of segments) {
    if (seg.startsWith("02")) ref = seg.slice(2).trim();
    else if (seg.startsWith("10")) lote = seg.slice(2).trim();
    else if (seg.startsWith("04")) sublote = padSublote(seg.slice(2));
    else if (seg.startsWith("21")) {
      // normalmente vacío en vuestro caso: ignoramos
    }
  }

  if (!ref) return null;

  return {
    ref,
    lote: lote || null,
    sublote: sublote || null,
    raw: rawInput
  };
}
