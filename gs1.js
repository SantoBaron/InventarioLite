const GS = "\u001d"; // Group Separator (FNC1)

function stripParens(s) {
  // Convierte "(01)123(10)ABC(21)XYZ" en "01|123|10|ABC|21|XYZ" por pares
  const parts = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "(") {
      const j = s.indexOf(")", i);
      if (j === -1) break;
      const ai = s.slice(i + 1, j);
      i = j + 1;
      let next = s.indexOf("(", i);
      const val = (next === -1) ? s.slice(i) : s.slice(i, next);
      parts.push([ai, val]);
      i = (next === -1) ? s.length : next;
    } else {
      // No tiene formato con paréntesis
      return null;
    }
  }
  return parts.length ? parts : null;
}

/**
 * Parser mínimo:
 * - 01: GTIN (14 fijo)
 * - 10: Lote (variable, termina en GS o fin)
 * - 21: Serial/Sublote (variable, termina en GS o fin)
 *
 * Devuelve null si no parece GS1.
 */
export function parseGs1(inputRaw) {
  const input = (inputRaw || "").trim();
  if (!input) return null;

  // Caso 1: Con paréntesis
  const pairs = stripParens(input);
  if (pairs) {
    const out = {};
    for (const [ai, val] of pairs) out[ai] = val;
    if (out["01"]) {
      return {
        gtin: out["01"],
        lote: out["10"] ?? null,
        sublote: out["21"] ?? null,
        raw: input
      };
    }
    return null;
  }

  // Caso 2: Sin paréntesis: AIs concatenados con GS para los variables
  // Heurística: empieza por 01 y tiene al menos 14 dígitos tras el 01
  if (!input.startsWith("01")) return null;
  if (input.length < 2 + 14) return null;

  const gtin = input.slice(2, 16);
  if (!/^\d{14}$/.test(gtin)) return null;

  let i = 16;
  let lote = null;
  let sublote = null;

  while (i < input.length) {
    const ai = input.slice(i, i + 2);
    i += 2;

    if (ai === "10" || ai === "21") {
      const end = input.indexOf(GS, i);
      const val = (end === -1) ? input.slice(i) : input.slice(i, end);
      i = (end === -1) ? input.length : end + 1;
      if (ai === "10") lote = val || null;
      if (ai === "21") sublote = val || null;
    } else {
      // AI no contemplado → salimos (no rompemos la app)
      break;
    }
  }

  return { gtin, lote, sublote, raw: input };
}
