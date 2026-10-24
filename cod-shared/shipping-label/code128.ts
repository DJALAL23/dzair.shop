/**
 * Code 128 — the barcode on CodFlow's shipping labels.
 *
 * Code 128 because every handheld and phone scanner reads it and it carries
 * an order number ("ORD-20261024-4730") in a short, dense symbol. Text is
 * written in set B; a run of digits switches to set C, two digits to a
 * symbol, where that makes the barcode shorter — narrower bars print sharper
 * on a 203 dpi thermal printer.
 *
 * The output is the bar and space widths, in modules, starting and ending
 * with a bar; a renderer draws them with a quiet zone of at least ten
 * modules on each side.
 */

/** Bar/space widths of each symbol value, 0–105, then the stop (106). */
export const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const CODE_C = 99;
const CODE_B = 100;
const START_B = 104;
const START_C = 105;
const STOP = 106;

const isDigit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";

function digitsFrom(text: string, at: number): number {
  let run = 0;
  while (isDigit(text[at + run])) run++;
  return run;
}

/** The symbol values for the text: start, data, check digit, stop. */
function symbolsOf(text: string): number[] {
  const opening = digitsFrom(text, 0);
  let inC = opening >= 4 || (opening === text.length && opening % 2 === 0);
  const values = [inC ? START_C : START_B];
  let at = 0;
  while (at < text.length) {
    const run = digitsFrom(text, at);
    if (inC) {
      if (run >= 2) {
        values.push(Number(text.slice(at, at + 2)));
        at += 2;
      } else {
        values.push(CODE_B);
        inC = false;
      }
      continue;
    }
    const toEnd = at + run === text.length;
    if (run >= 6 || (run >= 4 && toEnd)) {
      if (run % 2 === 1) values.push(text.charCodeAt(at++) - 32);
      values.push(CODE_C);
      inC = true;
      continue;
    }
    values.push(text.charCodeAt(at++) - 32);
  }
  const check = values.reduce((sum, value, i) => sum + value * Math.max(i, 1), 0) % 103;
  return [...values, check, STOP];
}

export interface Code128 {
  /** Bar and space widths in modules, bar first and last. */
  widths: number[];
  /** The symbol's width in modules, without quiet zones. */
  modules: number;
}

/** Encode printable ASCII text; throws for anything Code 128 B cannot carry. */
export function encodeCode128(text: string): Code128 {
  if (text.length === 0) throw new Error("Code 128 needs at least one character");
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char.length !== 1 || code < 32 || code > 126) throw new Error(`Code 128 cannot carry ${JSON.stringify(char)}`);
  }
  const widths = symbolsOf(text).flatMap((value) => [...CODE128_PATTERNS[value]].map(Number));
  return { widths, modules: widths.reduce((sum, width) => sum + width, 0) };
}
