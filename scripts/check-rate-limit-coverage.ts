#!/usr/bin/env bun
/**
 * # الحاجزُ: مسارٌ مكشوفٌ غيرُ مُدرَجٍ مسارٌ بلا حدٍّ — `SEC-07`
 *
 * **الغرض:** أن يستحيلَ أن يدخلَ المستودعَ مسارُ بوّابةٍ لا يُعرَفُ صنفُ كشفِه ولا
 * حدُّه ولا سببُ إعفائِه. والحاجزُ **يجردُ المساراتِ من الشيفرةِ** (لا من السِجلِّ)
 * ثمَّ يُطابِقُها بالسِجلِّ في الحدَّينِ: مسارٌ بلا مدخلٍ يُسقِطُ البناءَ، ومدخلٌ بلا
 * مسارٍ يُسقِطُه.
 *
 * **الحالة:** `SEC-07` — مُنفَّذ · مُختبَر · مبرهَنُ السقوط (`ح-7`).
 *
 * **ينتمي إلى:** البند `F8-08` (`SEC-07`) · `docs/adr/0139`.
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-rate-limit-coverage.test.ts` — سالبةٌ مزروعةٌ لكلِّ
 * قاعدةٍ.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ حدّاً يُنفَّذُ.** يُطابِقُ إعلاناً بشيفرةٍ ويطلبُ نصَّ التركيبِ.
 *   والإنفاذُ يُقاسُ بخادمٍ حقيقيٍّ في `tests/unit/rate-limit-enforced.test.ts`
 *   وبِـRedis حقيقيٍّ في `tests/integration/rate-limit-shared-window.test.ts` —
 *   و**أخضرُ هذا الحاجزِ ليسَ دليلَ حمايةٍ** بحالٍ.
 * - **لا يحكمُ على الأرقامِ.** يطلبُ تعليلاً مكتوباً ومجالاً معقولاً، ولا يعرفُ
 *   الرقمَ الصحيحَ لِسطحٍ لم يُقَسْ حِمْلُه.
 * - **لا يجردُ موجِّهاتِ لوحةِ الإدارةِ من ملفّاتِها.** بادئاتُها تُقرأُ من
 *   `admin/mount.ts` كما في الجردِ، وحدُّ القراءةِ النصّيّةِ مُعلَنٌ ثمَّ.
 */

import { readFileSync } from "node:fs";
import { Glob } from "bun";
import {
  EXEMPT_ROUTE_COUNT,
  EXPOSURE_CLASSES,
  KEY_DIMENSIONS,
  LIMIT_REQUIRED_EXPOSURES,
  LIMITED_ROUTE_COUNT,
  PUBLIC_PATH_PREFIXES,
  ROUTE_POLICIES,
  ROUTE_POLICY_COUNT,
} from "../apps/gateway/src/rate-limit/policy.ts";
import { isRouteFile, MOUNT_FILES } from "./lib/gateway-route-inventory.ts";
import { auditRateLimitCoverage } from "./lib/rate-limit-audit.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ROUTES_DIR = "apps/gateway/src/routes";

function readRouteSources(): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  const glob = new Glob("*.ts");
  for (const name of glob.scanSync({ cwd: `${ROOT}${ROUTES_DIR}`, onlyFiles: true })) {
    const relative = `${ROUTES_DIR}/${name}`;
    if (!isRouteFile(relative)) continue;
    sources.set(relative, readFileSync(`${ROOT}${relative}`, "utf8"));
  }
  return sources;
}

function readFiles(paths: readonly string[]): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const relative of paths) {
    try {
      sources.set(relative, readFileSync(`${ROOT}${relative}`, "utf8"));
    } catch {
      // الغيابُ يُبلَّغُ خرقاً في التدقيقِ لا استثناءً ههنا.
    }
  }
  return sources;
}

function main(): void {
  const routeSources = readRouteSources();
  if (routeSources.size === 0) {
    console.error("✗ لم يُقرأ أيُّ ملفِّ مسارٍ — الكشفُ نفسُه معطوبٌ، ولا يُقرَأُ ذلك نجاحاً.");
    process.exit(1);
  }
  const mountSources = readFiles(MOUNT_FILES);
  if (mountSources.size !== MOUNT_FILES.length) {
    console.error("✗ لم تُقرأ كلُّ ملفّاتِ التركيبِ — بادئةٌ غائبةٌ تُنتِجُ مساراً كاذباً.");
    process.exit(1);
  }

  const wiredFiles = new Set<string>();
  for (const policy of ROUTE_POLICIES) {
    for (const limit of policy.limits) {
      const separator = limit.wiredIn.indexOf(":");
      if (separator > 0) wiredFiles.add(limit.wiredIn.slice(0, separator));
    }
  }

  const violations = auditRateLimitCoverage({
    routeSources,
    mountSources,
    policies: ROUTE_POLICIES,
    declared: {
      routes: ROUTE_POLICY_COUNT,
      limited: LIMITED_ROUTE_COUNT,
      exempt: EXEMPT_ROUTE_COUNT,
    },
    wiredSources: readFiles([...wiredFiles]),
    exposureClasses: EXPOSURE_CLASSES,
    limitRequiredExposures: LIMIT_REQUIRED_EXPOSURES,
    keyDimensions: KEY_DIMENSIONS,
    publicPathPrefixes: PUBLIC_PATH_PREFIXES,
  });

  if (violations.length > 0) {
    console.error("✗ تغطيةُ تحديدِ المعدَّلِ غيرُ مُطابِقةٍ للشيفرةِ:\n");
    for (const violation of violations) console.error(`  ــ ${violation}`);
    console.error(
      `\n${violations.length} خرقاً. والعلاجُ في الجِذرِ: يُصنَّفُ المسارُ في ` +
        "`apps/gateway/src/rate-limit/policy.ts` ويُركَّبُ حدُّه أو يُكتَبُ سببُ إعفائِه.",
    );
    process.exit(1);
  }

  const limited = ROUTE_POLICIES.filter((policy) => policy.limits.length > 0).length;
  const exempt = ROUTE_POLICIES.filter((policy) => policy.exemption !== null).length;
  const requiredCount = ROUTE_POLICIES.filter((policy) =>
    LIMIT_REQUIRED_EXPOSURES.includes(policy.exposure),
  ).length;
  console.log(
    `✓ ${ROUTE_POLICIES.length} مساراً مُصنَّفاً · ${requiredCount} في أصنافٍ يُوجَبُ فيها حدٌّ ` +
      `· ${limited} محدوداً · ${exempt} مُعفىً بسببٍ مكتوبٍ. ` +
      "وهذا **إعلانٌ مُطابِقٌ للشيفرةِ لا حمايةٌ مُثبَتةٌ**: الإنفاذُ يُقاسُ بخادمٍ حقيقيٍّ.",
  );
}

main();
