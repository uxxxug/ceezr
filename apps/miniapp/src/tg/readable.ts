/**
 * PRD-007 · ADR 0250 — مقروئيّةُ ألوانِ `ThemeParams` (WCAG 2.2 AA · 4.5:1).
 *
 * تيليجرامُ يرسلُ في سمتِه الافتراضيّةِ ألوانًا دونَ AA للنصِّ: `hint_color #999999`
 * على أبيضَ = 2.84:1، و`#2481cc` بنصٍّ أبيضَ = 4.12:1، وفي الداكن `#708499`/`#5288c1`.
 * القرار: **تُحفَظُ سمةُ المضيف** (Layer 1، ADR 0233 §2) ولا تُستبدَلُ بلوحتِنا، لكنَّ
 * لونَ النصِّ الذي يسقطُ دونَ 4.5:1 يُزاحُ **أقلَّ إزاحةٍ** نحوَ لونِ النصِّ (أو نحوَ
 * الأسودِ/الأبيضِ للزرّ) حتّى يبلغَ العتبة. اللونُ الذي يجتازُها لا يُمسّ.
 * دوالُّ نقيّة: لا DOM ولا مضيف — تُختبَرُ وحدَها.
 */

export const AA_TEXT_CONTRAST = 4.5;

const HEX6 = /^#([0-9a-f]{6})$/i;

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb | null {
  const match = HEX6.exec(hex.trim());
  if (match === null) return null;
  const n = Number.parseInt(match[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number | null {
  const ra = rgb(a);
  const rb = rgb(b);
  if (ra === null || rb === null) return null;
  const la = luminance(ra);
  const lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * يزيحُ `color` نحوَ `toward` بخطواتٍ 5% حتّى يبلغَ تباينُه مع **كلِّ** خلفيّةٍ في
 * `against` العتبة. يعيدُ `null` إن كانَ اللونُ مجتازًا أصلًا أو تعذّرت القراءة.
 */
export function readableShift(
  color: string,
  against: readonly string[],
  toward: string,
  min: number = AA_TEXT_CONTRAST,
): string | null {
  const from = rgb(color);
  const to = rgb(toward);
  const backs = against.map(rgb).filter((v): v is Rgb => v !== null);
  if (from === null || to === null || backs.length === 0) return null;
  const passes = (c: Rgb) =>
    backs.every((bg) => {
      const l1 = luminance(c);
      const l2 = luminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) >= min;
    });
  if (passes(from)) return null;
  for (let step = 1; step <= 20; step += 1) {
    const t = step / 20;
    const mixed: Rgb = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    const rounded = rgb(hex(mixed)) as Rgb;
    if (passes(rounded)) return hex(rounded);
  }
  return hex(to);
}

/** أسودُ أو أبيضُ: الطرفُ الأبعدُ عن `color` إضاءةً. */
export function farPole(color: string): string {
  const c = rgb(color);
  if (c === null) return "#000000";
  return luminance(c) > 0.179 ? "#000000" : "#ffffff";
}
