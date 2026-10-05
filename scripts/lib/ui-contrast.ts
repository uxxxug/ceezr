/**
 * # مكتبةُ تباينِ الهويةِ اللونيةِ — UI-1 / PR 0 (`ADR 0233`)
 *
 * وحداتٌ نقيّةٌ بلا نظامِ ملفّاتٍ: حسابُ نسبةِ التباينِ (WCAG 2.x)، وقراءةُ
 * جدولِ الألوانِ من `docs/UI_UX_CANONICAL_DIRECTIVE.md` §2، وقراءةُ افتراضاتِ
 * Layer 1 من `apps/miniapp/src/styles/global.css`، ثمّ الحكمُ على أزواجِ
 * الاستعمالِ المعلنةِ في `ADR 0233`.
 *
 * **ما لا تفعلُه عن قصدٍ:** لا تُضيفُ رمزاً ولا صنفاً إلى CSS (ذلك PR 1)، ولا
 * تقيسُ سماتِ تيليجرام الحيّةَ — Layer 1 يتبدّلُ مع المستخدمِ، فالمقيسُ هوَ
 * الافتراضُ المعلنُ في `global.css` وحدَه.
 */

export type Scheme = "dark" | "light";
export type LayerTwoToken = "brand" | "amber" | "ok" | "bad";

export const LAYER_TWO_TOKENS: readonly LayerTwoToken[] = ["brand", "amber", "ok", "bad"];
export const SCHEMES: readonly Scheme[] = ["dark", "light"];

/** حدُّ WCAG 2.x AA للنصِّ العاديِّ. */
export const AA_TEXT = 4.5;

export type Palette = Record<Scheme, Record<LayerTwoToken, string>>;

/** افتراضاتُ Layer 1 المقروءةُ من `global.css` لكلِّ سمةٍ. */
export interface LayerOneFallbacks {
  readonly bg: string;
  readonly secondaryBg: string;
  readonly text: string;
  readonly hint: string;
}

/**
 * لوحةُ Layer 2 كما يُعلنُها `ADR 0233` §2 — مصدرُها جدولُ §2 في الدليلِ المعتمدِ،
 * والحاجزُ يُسقِطُ أيَّ انجرافٍ بينَهما. PR 1 يحوِّلُها رموزَ CSS ويقرأُها من هنا.
 */
export const LAYER_TWO_PALETTE: Palette = {
  dark: { brand: "#8b90ff", amber: "#f5b23e", ok: "#34d399", bad: "#ef5350" },
  light: { brand: "#4f46e5", amber: "#f5a524", ok: "#0b7a42", bad: "#c62828" },
};

/**
 * القرارُ (`ADR 0233` §3): لونُ Layer 2 لا يُكتَبُ نصّاً على سطحٍ مجهولٍ —
 * يُستعمَلُ **تعبئةً** لشارةٍ أو كتلةٍ، ونصُّها أحدُ لونَيْ «on» هذين.
 */
export type OnColor = "on-dark" | "on-light";
export const ON_COLORS: Record<OnColor, string> = {
  "on-dark": "#0f172a",
  "on-light": "#ffffff",
};

/** لونُ النصِّ المعلنُ فوقَ كلِّ تعبئةٍ (`ADR 0233` §3). */
export const FILL_TEXT: Record<Scheme, Record<LayerTwoToken, OnColor>> = {
  dark: { brand: "on-dark", amber: "on-dark", ok: "on-dark", bad: "on-dark" },
  light: { brand: "on-light", amber: "on-dark", ok: "on-light", bad: "on-light" },
};

/**
 * إخفاقاتٌ قائمةٌ مقيسةٌ **قبلَ** UI-1 ولا يُعالِجُها PR 0 (لا تغييرَ بصريّاً).
 * تُؤكَّدُ حرفيّاً: تنقصُ بقرارٍ ولا تزيدُ صامتةً.
 */
export const KNOWN_FAILURES: readonly string[] = ["mute/light/secondaryBg"];

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function normalizeHex(hex: string): string {
  const m = HEX_RE.exec(hex.trim());
  if (!m) throw new Error(`لونٌ غيرُ صالحٍ: ${hex}`);
  return `#${(m[1] ?? "").toLowerCase()}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex).slice(1);
  const r = channel(Number.parseInt(h.slice(0, 2), 16));
  const g = channel(Number.parseInt(h.slice(2, 4), 16));
  const b = channel(Number.parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * يقرأُ جدولَ §2 من الدليلِ المعتمدِ: صفوفٌ بصيغةِ `| token | #dark | #light | … |`.
 * غيابُ رمزٍ أو قيمةٍ غيرُ صالحةٍ يُسقِطُ القراءةَ — لا افتراضَ صامتاً.
 */
export function parseDirectivePalette(markdown: string): Palette {
  const dark: Partial<Record<LayerTwoToken, string>> = {};
  const light: Partial<Record<LayerTwoToken, string>> = {};
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const token = cells[1] as LayerTwoToken;
    if (!LAYER_TWO_TOKENS.includes(token)) continue;
    const d = cells[2] ?? "";
    const l = cells[3] ?? "";
    if (!HEX_RE.test(d) || !HEX_RE.test(l)) continue;
    dark[token] = normalizeHex(d);
    light[token] = normalizeHex(l);
  }
  for (const t of LAYER_TWO_TOKENS) {
    if (!dark[t] || !light[t]) throw new Error(`الرمزُ ${t} غائبٌ عن جدولِ §2 في الدليلِ المعتمد`);
  }
  return {
    dark: dark as Record<LayerTwoToken, string>,
    light: light as Record<LayerTwoToken, string>,
  };
}

function readVar(block: string, name: string): string | undefined {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`);
  const m = re.exec(block);
  return m?.[1] ? normalizeHex(m[1]) : undefined;
}

function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`المحدِّدُ ${selector} غائبٌ عن global.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** يقرأُ افتراضاتِ Layer 1: `:root` (داكن) و`:root[data-tg-scheme="light"]` (فاتح). */
export function parseLayerOneFallbacks(css: string): Record<Scheme, LayerOneFallbacks> {
  const lightSel = ':root[data-tg-scheme="light"]';
  const darkBlock = blockAfter(css, ":root {");
  const lightBlock = blockAfter(css, lightSel);
  const pick = (block: string, label: string): LayerOneFallbacks => {
    const bg = readVar(block, "tg-bg-color");
    const secondaryBg = readVar(block, "tg-secondary-bg-color");
    const text = readVar(block, "tg-text-color");
    const hint = readVar(block, "tg-hint-color");
    if (!bg || !secondaryBg || !text || !hint) {
      throw new Error(`افتراضاتُ Layer 1 ناقصةٌ في كتلةِ ${label}`);
    }
    return { bg, secondaryBg, text, hint };
  };
  return { dark: pick(darkBlock, ":root"), light: pick(lightBlock, lightSel) };
}

export interface ContrastCheck {
  readonly id: string;
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

export interface ContrastVerdict {
  readonly ok: boolean;
  readonly checks: readonly ContrastCheck[];
  readonly problems: readonly string[];
}

export interface ContrastInput {
  readonly declared: Palette;
  readonly directive: Palette;
  readonly layerOne: Record<Scheme, LayerOneFallbacks>;
  readonly fillText?: Record<Scheme, Record<LayerTwoToken, OnColor>>;
  readonly knownFailures?: readonly string[];
}

function check(id: string, fg: string, bg: string, min: number): ContrastCheck {
  const ratio = contrastRatio(fg, bg);
  return { id, fg, bg, ratio, min, pass: ratio >= min };
}

/** الحكمُ النقيُّ. */
export function evaluateContrast(input: ContrastInput): ContrastVerdict {
  const fillText = input.fillText ?? FILL_TEXT;
  const known = new Set(input.knownFailures ?? KNOWN_FAILURES);
  const problems: string[] = [];
  const checks: ContrastCheck[] = [];

  // 1) لا انجرافَ بينَ اللوحةِ المعلنةِ في الشيفرةِ وجدولِ §2 في الدليلِ.
  for (const s of SCHEMES) {
    for (const t of LAYER_TWO_TOKENS) {
      const a = normalizeHex(input.declared[s][t]);
      const b = normalizeHex(input.directive[s][t]);
      if (a !== b) problems.push(`انجرافُ اللوحةِ: ${t}/${s} = ${a} في الشيفرةِ و${b} في الدليل`);
    }
  }

  // 2) كلُّ تعبئةٍ من Layer 2 ونصُّها المعلنُ ≥ 4.5:1.
  for (const s of SCHEMES) {
    for (const t of LAYER_TWO_TOKENS) {
      const on = ON_COLORS[fillText[s][t]];
      checks.push(check(`fill/${t}/${s}`, on, input.declared[s][t], AA_TEXT));
    }
  }

  // 3) `mute` = نصٌّ ثانويٌّ من Layer 1 (`--tg-hint-color`) على السطحَين المعلنَين.
  for (const s of SCHEMES) {
    const l1 = input.layerOne[s];
    checks.push(check(`mute/${s}/bg`, l1.hint, l1.bg, AA_TEXT));
    checks.push(check(`mute/${s}/secondaryBg`, l1.hint, l1.secondaryBg, AA_TEXT));
  }

  const failing = checks.filter((c) => !c.pass).map((c) => c.id);
  for (const id of failing) {
    if (!known.has(id)) {
      const c = checks.find((x) => x.id === id);
      problems.push(`تباينٌ دونَ الحدِّ: ${id} = ${c?.ratio.toFixed(2)}:1 < ${AA_TEXT}:1`);
    }
  }
  for (const id of known) {
    if (!failing.includes(id)) {
      problems.push(`إخفاقٌ معلنٌ لم يَعُد قائماً: ${id} — أزِلْه من KNOWN_FAILURES بقرارٍ`);
    }
  }

  return { ok: problems.length === 0, checks, problems };
}
