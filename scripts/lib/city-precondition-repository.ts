/**
 * # قراءةُ المستودعِ لعقدِ تفعيلِ المدينةِ — قارئٌ واحدٌ لا قارئانِ (`OPS-020`)
 *
 * **الغرض:** فصلُ **القراءةِ** عن **الحكمِ**: الحَكَمُ نقيٌّ في
 * `city-precondition-audit.ts` كي تُزرَعَ فيه السوالبُ بلا كتابةِ قرصٍ، وهذا
 * الملفُّ وحدَه يلمسُ القرصَ. فمَن نادى الحَكَمَ من نقطتَي دخولٍ نادى **نفسَ**
 * المُدخلِ، فلا يُوسِّعُ أحدُهما نطاقَه ويُضيِّقُ الآخرُ.
 *
 * **الحالة:** `OPS-020` — منفَّذ (`ADR 0148`).
 *
 * **ينتمي إلى:** `scripts/lib` · الحجزُ `OPS-020` في `ROADMAP.md`.
 *
 * **يُستخدم من:** `scripts/check-integration-city-precondition.ts`
 * و`scripts/check-test-city-activation.ts` و`tests/unit/` للحكمِ على المستودعِ
 * كما هوَ.
 */

import type { Dirent } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import {
  type AuditedFile,
  type CityPreconditionInput,
  HELPER_PATH,
} from "./city-precondition-audit.ts";
import { CITY_PRECONDITION_EXEMPTIONS } from "./city-precondition-exemptions.ts";
import { toPosixPath } from "./repo-path.ts";

/** مجلَّدُ اختباراتِ التكاملِ — نطاقُ القواعدِ ١ و٢ و٣. */
export const INTEGRATION_DIR = "tests/integration";

/**
 * نطاقُ القاعدةِ ٦ كما كانَ في الحاجزِ القديمِ حرفاً — **لا يُضيَّقُ** (`OPS-020`
 * «ما لا يُمَسُّ»).
 */
export const ACTIVATION_ROOTS = ["tests/integration", "tests/e2e", "tests/unit"] as const;

/** نطاقُ القاعدةِ ٧: كلُّ شِفرةِ `scripts/` — فيها يظهرُ سجلٌّ ثانٍ لو ظهرَ. */
export const SCRIPTS_DIR = "scripts";

function listFiles(root: string, suffix: string): readonly string[] {
  const found: string[] = [];
  // النوعُ مكتوبٌ صراحةً: استنتاجُه من `readdir` يحلُّ إلى أوّلِ تحميلةٍ لا إلى
  // ما يردُّ مع `withFileTypes`، فينفجرُ الفحصُ لحظةَ يصيرُ الملفُّ مستورداً.
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = toPosixPath(`${root}/${entry.name}`);
    if (entry.isDirectory()) found.push(...listFiles(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found.sort();
}

function read(paths: readonly string[]): readonly AuditedFile[] {
  return paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

/**
 * يقرأُ المستودعَ كما هوَ ويردُّ مُدخلَ الحَكَمِ كاملاً. مُصدَّرٌ كي يُنادِيَه
 * اختبارُ الوحدةِ فيحكُمَ على الشِّفرةِ الحقيقيّةِ لا على مُصنَّعٍ فقط.
 */
export function readRepository(): CityPreconditionInput {
  const integrationNames = listFiles(INTEGRATION_DIR, ".test.ts");
  const activationNames = ACTIVATION_ROOTS.flatMap((root) => listFiles(root, ".test.ts"));
  let helper: string | undefined;
  try {
    helper = readFileSync(HELPER_PATH, "utf8");
  } catch {
    helper = undefined;
  }
  return {
    integrationFiles: read(integrationNames),
    activationFiles: read([...new Set(activationNames)].sort()),
    scriptFiles: read(listFiles(SCRIPTS_DIR, ".ts")),
    helper,
    exemptions: CITY_PRECONDITION_EXEMPTIONS,
  };
}
