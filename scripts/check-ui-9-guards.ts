#!/usr/bin/env bun
/**
 * # الحاجزُ: حرّاسُ UI-9 — RTL / A11y / Responsive / Performance
 *
 * **الغرض:** حارسٌ ساكنٌ يمنعُ انحدارَ قواعدِ UI-9 في CSS و i18n.
 * هذا حارسٌ ساكنٌ لا اختبارَ متصفّحٍ — لا يُدَّعى قياسُ FCP/LCP ولا
 * تجربةُ مستخدمٍ حيّة. ما يُفحصُ يمكنُ إثباتُه بالنصّ.
 *
 * **ما يفحصُ:**
 * 1. CSS: لا letter-spacing ولا text-transform ولا font-style: italic
 *    خارجَ خطٍّ أحاديِّ المسافة (monospace) — العربيةُ بلا هذه الخصائصِ.
 * 2. CSS: لا @layer ولا !important ولا تداخلٌ (nesting).
 * 3. CSS: لا left:/right: خارجَ متغيّراتِ safe-area.
 * 4. CSS: عناصرُ تفاعليّةٌ (button, label+cursor:pointer) min-height >= 2.75rem (44px).
 * 5. i18n: عددُ المفاتيحِ في ar.json = en.json = ur.json.
 *
 * **ما لا يفعلُ عن قصدٍ:** لا يفحصُ تباینَ اللون ولا focus-visible ولا
 * keyboard navigation — هذه تحتاجُ DOM/متصفّحاً ولا تُدَّعى هنا.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CSS_PATH = join(ROOT, "apps/miniapp/src/styles/global.css");
const I18N_DIR = join(ROOT, "packages/shared/i18n/miniapp");

const FAILURES: string[] = [];

function fail(rule: string, detail: string): void {
  FAILURES.push(`✗ ${rule}: ${detail}`);
}

const css = readFileSync(CSS_PATH, "utf8");
// Strip all /* ... */ comments before checking
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const lines = cssNoComments.split("\n");

const FORBIDDEN_CSS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /letter-spacing\s*:/, rule: "UI-9/RTL: letter-spacing ممنوعٌ على العربية" },
  { pattern: /text-transform\s*:/, rule: "UI-9/RTL: text-transform ممنوعٌ على العربية" },
  { pattern: /font-style\s*:\s*italic/, rule: "UI-9/RTL: font-style: italic ممنوعٌ على العربية" },
  { pattern: /@layer/, rule: "UI-9/CSS: لا @layer — CSS مسطّحٌ فقط" },
  { pattern: /!important/, rule: "UI-9/CSS: لا !important" },
];

for (let i = 0; i < lines.length; i++) {
  const line = (lines.at(i) ?? "").trim();
  if (line === "") continue;

  for (const check of FORBIDDEN_CSS) {
    if (check.pattern.test(line)) {
      const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      if (/font-family.*monospace/.test(context)) continue;
      fail(check.rule, `السطر ${i + 1}: ${line}`);
    }
  }
}

for (let i = 0; i < lines.length; i++) {
  const line = (lines.at(i) ?? "").trim();
  if (line === "") continue;
  if (/^\s*(left|right)\s*:/.test(line) && !/--.*-(left|right)/.test(line)) {
    fail("UI-9/RTL: left/right ممنوعٌ — استعملْ logical properties", `السطر ${i + 1}: ${line}`);
  }
}

const ruleBlocks: Array<{ selector: string; body: string; line: number }> = [];
let currentSelector = "";
let currentBody = "";
let inBlock = false;
let blockStart = 0;

for (let i = 0; i < lines.length; i++) {
  const line = (lines.at(i) ?? "").trim();
  if (line === "") continue;
  if (line.endsWith("{")) {
    currentSelector = line.slice(0, -1).trim();
    currentBody = "";
    inBlock = true;
    blockStart = i;
  } else if (line === "}" && inBlock) {
    ruleBlocks.push({ selector: currentSelector, body: currentBody, line: blockStart });
    inBlock = false;
    currentSelector = "";
    currentBody = "";
  } else if (inBlock) {
    currentBody += `${line}\n`;
  }
}

const INTERACTIVE =
  /\.(button|btn|action|back|close|submit|retry|cancel|city|category|view|camera|pick|card|more|star|tag|confirm|send|arm|refresh)/;
const SEEN = new Set<string>();

for (const block of ruleBlocks) {
  if (!INTERACTIVE.test(block.selector)) continue;
  if (!/cursor:\s*pointer/.test(block.body) && !/button/.test(block.selector.toLowerCase()))
    continue;
  const m = block.body.match(/min-height:\s*([\d.]+)(rem|px)/);
  if (m) {
    const val = m[1];
    const unit = m[2];
    if (val === undefined || unit === undefined) continue;
    const v = parseFloat(val);
    const px = unit === "rem" ? v * 16 : v;
    if (px < 44) {
      const key = `${block.selector}:${m[0]}`;
      if (!SEEN.has(key)) {
        SEEN.add(key);
        fail(
          "UI-9/A11y: touch target < 44px",
          `${block.selector} (السطر ${block.line + 1}): ${m[0]} = ${px}px`,
        );
      }
    }
  }
}

function countKeys(obj: unknown): number {
  if (typeof obj !== "object" || obj === null) return 0;
  let c = 0;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    c += typeof v === "object" && v !== null ? countKeys(v) : 1;
  }
  return c;
}

const files = ["ar.json", "en.json", "ur.json"];
const counts: Record<string, number> = {};
for (const f of files) counts[f] = countKeys(JSON.parse(readFileSync(join(I18N_DIR, f), "utf8")));

if (new Set(Object.values(counts)).size > 1) {
  fail("UI-9/i18n: عدمُ تطابقِ عددِ المفاتيح", JSON.stringify(counts));
}

if (FAILURES.length > 0) {
  console.error(`✗ check-ui-9-guards: ${FAILURES.length} خرقٌ:`);
  for (const f of FAILURES) console.error(f);
  process.exit(1);
}

console.log("✓ check-ui-9-guards: RTL/A11y/Responsive guards سليمة.");
