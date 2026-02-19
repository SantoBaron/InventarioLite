const GS = "\u001D"; // separador lógico interno (Group Separator)

/**
 * Normaliza la lectura:
 * - Quita ]C1 si viene
 * - Convierte caracteres de control y 'Ê' en GS
 */
function normalize(input) {
  if (!input) return "";
  let s = input.trim();

  // Prefijo AIM típico
  if (s.startsWith("]C1")) s = s.slice(3);

  // En vuestro caso, el lector usa Ê como separador
  s = s.replaceAll("Ê", GS);

  // Cualquier control ASCII -> GS
  s = s.replace(/[\x00-\x1F]/g, GS);

  // Limpieza: colapsa GS repetidos
  s = s.replace(new RegExp(`${GS}+`, "g"), GS);

  return s;
}

/**
 * Trocea por separador y extrae (ai, value).
 * Admite AIs de 2 a 4 dígitos al inicio del segmento.
 */
function parseSegments(raw) {
  const s = normalize(raw);
  if (!s) return [];

  const parts = s.split(GS).map(p => p.trim()).filter(Boolean);

  return parts.map(seg => {
    const m = seg.match(/^(\d{2,4})(.*)$/);
    if (!m) return { ai: null, value: seg };
    return { ai: m[1], value: (m[2] || "").trim() };
  });
}

/**
 * Parser flexible para vuestro “GS1-like”:
 * - REF: prioriza 01, luego 02, luego 240/241; si no, primer segmento sin ai.
 * - LOTE: AI 10
 * - SUBLOTE: AI 21; si 21 vacío y hay 04 con valor -> usa 04 como sublote
 */
export function parseGs1(rawInput) {
  const segs = parseSegments(rawInput);
  if (!segs.length) return null;

  const get = (ai) => segs.find(x => x.ai === ai)?.value ?? null;

  const v01 = get("01");
  const v02 = get("02");
  const v240 = get("240");
  const v241 = get("241");

  const lote = get("10");
  let sublote = get("21");

  const v04 = get("04");

  // Si 21 existe pero vacío (o null) y hay 04, tomamos 04 como sublote interno
  if (!sublote && v04) sublote = v04;

  // REF: no asumimos numérico
  const ref =
    (v01 && v01.length ? v01 : null) ||
    (v02 && v02.length ? v02 : null) ||
    (v240 && v240.length ? v240 : null) ||
    (v241 && v241.length ? v241 : null) ||
    (segs.find(x => !x.ai)?.value ?? null);

  // Si no tenemos ref, no lo consideramos válido
  if (!ref) return null;

  return {
    ref,
    lote: lote && lote.length ? lote : null,
    sublote: sublote && sublote.length ? sublote : null,
    raw: rawInput
  };
}
