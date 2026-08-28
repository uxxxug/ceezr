/**
 * الغرض: بوابة CI تفرض **مرجعيةَ الدور** في البند `F1-05`: الدورُ يُقرأ من
 *    الخادمِ في كلِّ إقلاعٍ عبرَ `GET /v1/me`، ولا يُخزَّن على الجهازِ، ولا يُستنتَج
 *    من تيليجرام، ولا يُفترَض عندَ الشكّ، ولا يُقبَل من الطلبِ في البوابة، ولا
 *    يكتب محوّلُ قراءتِه صفّاً (ADR 0035 · القسم 9.8).
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml و`bun run ci`
 * ملاحظات مستقبلية: إن أُضيف سطحُ `support` أو ربطُ المستخدمِ عندَ أوّلِ جلسةٍ
 *    (القسم 9.8 خطوة 4) فالقواعدُ لا تتغيّر: مصدرُ الدورِ يبقى الخادمَ، وموضعُ
 *    قراءتِه يبقى ملفاً واحداً.
 *
 * لماذا فحصٌ لا اتفاق: `const role = session.role ?? "rider"` سطرٌ واحدٌ مغرٍ في
 * شاشةٍ مستعجلة، وهو الذي يفتح سطحاً بلا تفويضٍ من الخادمِ ويحوّل رمزَ جلسةٍ إلى
 * دليلِ صلاحية. والاتفاقُ يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 *
 * والفحصُ يُسقِط البناءَ أيضاً إن **غاب** موضعُ القراءةِ أو خلا من نداءِ المسارِ،
 * أو إن كتب محوّلُ الحسابِ صفّاً: حاجزٌ لا يمكن أن يمرَّ فراغاً.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

const MINIAPP_ROOT = "apps/miniapp/src";
const GATEWAY_ROUTES = "apps/gateway/src/routes";

/** موضعُ قراءةِ الدورِ الوحيدُ في العميل. */
const VIEWER_FILE = "apps/miniapp/src/identity/viewer.ts";
/** حاملُ الجلسةِ: لا يحمل دوراً بعدَ `F1-05`. */
const SESSION_FILE = "apps/miniapp/src/identity/session.ts";
/** مسارُ الدورِ في البوابة. */
const ME_ROUTE = "apps/gateway/src/routes/me.ts";
/** محوّلُ قراءةِ الحساب: قراءةٌ فقط. */
const READER_FILE = "packages/infrastructure/identity/viewer-account.ts";
/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً فيُستثنى من المسح. */
const SELF = "scripts/check-viewer-role-authority.ts";

const ROLE = String.raw`\brole\b`;
const ROLE_LITERAL = '"(?:rider|driver|support|admin)"';

export interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly why: string;
  readonly applies: (file: string) => boolean;
}

const inMiniapp = (file: string): boolean => file.startsWith(`${MINIAPP_ROOT}/`);
const inGatewayRoutes = (file: string): boolean => file.startsWith(`${GATEWAY_ROUTES}/`);
const isTest = (file: string): boolean => file.endsWith(".test.ts") || file.endsWith(".test.tsx");

export const RULES: readonly Rule[] = [
  {
    id: "role-not-persisted",
    pattern: new RegExp(
      `${ROLE}[^\\n]*\\b(?:setItem|getItem|secureStorage\\w*|cloudStorage\\w*|deviceStorage\\w*|persist\\w*|localStorage|sessionStorage)\\b|\\b(?:setItem|secureStorage\\w*|cloudStorage\\w*|deviceStorage\\w*|persist\\w*)\\b[^\\n]*${ROLE}`,
    ),
    why: "الدورُ لا يُخزَّن على الجهاز — يُقرأ من الخادمِ في كلِّ إقلاعٍ (F1-05)",
    applies: (file) => inMiniapp(file),
  },
  {
    id: "role-not-from-telegram",
    pattern: new RegExp(
      `${ROLE}[^\\n]*\\b(?:initData\\w*|Telegram|WebApp)\\b|\\b(?:initData\\w*|Telegram|WebApp)\\b[^\\n]*${ROLE}`,
    ),
    why: "الدورُ لا يُستنتَج من تيليجرام ولا من `initData` — مدخلُ عميلٍ لا تفويض (القسم 9.8)",
    applies: (file) => inMiniapp(file),
  },
  {
    id: "me-read-in-one-place",
    pattern: /"\/v1\/me"/,
    why: `قراءةُ \`GET /v1/me\` من ${VIEWER_FILE} وحدَه — مصدرُ دورٍ ثانٍ يصير حقيقةً ثانية (F1-05)`,
    applies: (file) => inMiniapp(file) && file !== VIEWER_FILE && !isTest(file),
  },
  {
    id: "no-default-role",
    pattern: new RegExp(String.raw`(?:\?\?|\|\|)\s*${ROLE_LITERAL}`),
    why: "لا دورَ افتراضيَّ عندَ الشكّ — الحالةُ المجهولةُ تُعلَن ولا تُرقّى (F1-05)",
    applies: (file) => (inMiniapp(file) || inGatewayRoutes(file)) && !isTest(file),
  },
  {
    id: "no-role-from-request",
    pattern: new RegExp(
      `${ROLE}[^\\n]*\\b(?:c\\.req|req\\.(?:body|query|param|header)|body|query|searchParams|header)\\b|\\b(?:c\\.req|req\\.(?:body|query|param|header)|searchParams)\\b[^\\n]*${ROLE}`,
    ),
    why: "البوابةُ لا تقبل دوراً من الطلبِ — الدورُ من القاعدةِ بمعرّفٍ من رمزٍ موقَّع (القسم 9.8)",
    applies: (file) => inGatewayRoutes(file) && !isTest(file),
  },
  {
    id: "me-route-names-no-role",
    pattern: new RegExp(ROLE_LITERAL),
    why: "مسارُ الدورِ لا يسمّي دوراً في كودِه — يمرّر ما قرأه الخادمُ كما هو (F1-05)",
    applies: (file) => file === ME_ROUTE,
  },
];

/**
 * يُفرِّغ التعليقاتَ قبلَ المطابقة: التعليقاتُ تشرح القاعدةَ فتذكر الأسماءَ
 * الممنوعةَ نصّاً، ولا تُنفِّذ شيئاً. والتفريغُ يُبقي أرقامَ الأسطرِ صحيحةً.
 */
export function blankComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (two === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += "  ";
      index += 2;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly why: string;
}

export function findViolations(file: string, source: string): Violation[] {
  const found: Violation[] = [];
  const lines = blankComments(source).split("\n");
  for (const [index, text] of lines.entries()) {
    for (const rule of RULES) {
      if (!rule.applies(file)) continue;
      if (!rule.pattern.test(text)) continue;
      found.push({ file, line: index + 1, rule: rule.id, why: rule.why });
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

interface Presence {
  readonly file: string;
  readonly required: readonly string[];
  readonly forbidden: readonly string[];
  readonly why: string;
}

/**
 * حاجزٌ لا يمرُّ فراغاً: لو حُذِف موضعُ القراءةِ أو صار المسارُ يجيب بلا تحقّقٍ أو
 * صار المحوّلُ يكتب صفّاً، فالقواعدُ السطريةُ وحدَها تمرُّ صامتةً — فتُفحَص البِنيةُ
 * أيضاً لا الأسطرُ فقط.
 */
const PRESENCE: readonly Presence[] = [
  {
    file: VIEWER_FILE,
    required: ['"/v1/me"', "apiFetch"],
    forbidden: [],
    why: "موضعُ قراءةِ الدورِ من الخادم (F1-05)",
  },
  {
    file: SESSION_FILE,
    required: [],
    forbidden: ["role"],
    why: "حاملُ الجلسةِ لا يحمل دوراً (F1-05)",
  },
  {
    file: ME_ROUTE,
    required: ["resolveViewer(", "bearerTokenFrom("],
    forbidden: [],
    why: "مسارُ الدورِ يحسم الجلسةَ عبرَ حالةِ الاستخدامِ لا في المسار (F1-05)",
  },
  {
    file: READER_FILE,
    required: ["select "],
    forbidden: ["insert ", "update ", "upsert", "delete "],
    why: "محوّلُ قراءةِ الحسابِ قراءةٌ فقط — لا حالةَ أعمالٍ تُنشأ من التطبيقِ المصغَّر (ADR 0035)",
  },
];

function main(): void {
  const files = [...walk(MINIAPP_ROOT), ...walk(GATEWAY_ROUTES)].filter((file) => file !== SELF);

  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(...findViolations(file, readFileSync(file, "utf8")));
  }

  for (const check of PRESENCE) {
    let source: string;
    try {
      source = blankComments(readFileSync(check.file, "utf8"));
    } catch {
      console.error(`✗ ملفٌّ لازمٌ مفقود: ${check.file} — ${check.why}`);
      process.exit(1);
    }
    const lowered = source.toLowerCase();
    const missing = check.required.filter((needle) => !source.includes(needle));
    if (missing.length > 0) {
      console.error(`✗ ${check.file} لا يحتوي: ${missing.join(" · ")} — ${check.why}`);
      process.exit(1);
    }
    const present = check.forbidden.filter((needle) => lowered.includes(needle));
    if (present.length > 0) {
      console.error(`✗ ${check.file} يحتوي ما لا يجوز: ${present.join(" · ")} — ${check.why}`);
      process.exit(1);
    }
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لمرجعيةِ الدور (F1-05):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line} [${violation.rule}]`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ الدورُ يُقرأ من الخادمِ وحدَه ولا يُخزَّن ولا يُفترَض (${files.length} ملفاً مفحوصاً · ${RULES.length} قواعد · ${PRESENCE.length} بِنى)`,
  );
}

if (import.meta.main) main();
