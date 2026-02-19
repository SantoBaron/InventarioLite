function normalize(input) {
  if (!input) return "";

  let s = input.trim();

  // Quitar prefijo AIM
  if (s.startsWith("]C1")) s = s.slice(3);

  // En vuestro entorno el separador es Ê
  s = s.replaceAll("Ê", "|");

  // Eliminar caracteres de control
  s = s.replace(/[\x00-\x1F]/g, "");

  return s;
}

export function parseGs1(rawInput) {
  if (!rawInput) return null;

  const input = normalize(rawInput);

  // Si no contiene 02 o 10 no lo tratamos como GS1 interno
  if (!input.includes("02") && !input.includes("|02")) return null;

  // Segmentación por |
  const segments = input.split("|").filter(Boolean);

  let ref = null;
  let lote = null;
  let sublote = null;

  for (const seg of segments) {
    if (seg.startsWith("02")) {
      ref = seg.slice(2);
    } else if (seg.startsWith("10")) {
      lote = seg.slice(2);
    } else if (seg.startsWith("04")) {
      sublote = seg.slice(2);
    } else if (seg.startsWith("21")) {
      // normalmente vacío
      continue;
    }
  }

  if (!ref) return null;

  return {
    ref: ref || null,
    lote: lote || null,
    sublote: sublote || null,
    raw: rawInput
  };
}
