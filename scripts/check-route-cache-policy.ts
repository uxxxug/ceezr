/**
 * الغرض: حارسُ سياسةِ تخزينِ المساراتِ (CAP-012) — يمنعُ نداءَ مزوّدِ التوجيهِ
 *   مباشرةً في المسارِ الساخنِ، ويُلزمُ المرورَ بطبقةِ التخزين.
 *
 * الحالة: منفّذ فعلياً — CAP-012.
 * ينتمي إلى: البند CAP-012 · ADR 0024
 * يُستخدم من: سلسلة bun run ci · خطوة مسماة في .github/workflows/ci.yml
 * يحرسه: tests/unit/check-route-cache-policy.test.ts — سالبة مزروعة
 *
 * ## ما يفحصه
 *
 * 1. أنّ طبقةَ التخزينِ (route-cache.ts) موجودةٌ وتُصدّرُ shouldRecomputeRoute.
 * 2. أنّ estimate-arrival.ts لا يُنادى مباشرةً في مسارِ البثِّ الحيِّ (ride-channel.ts).
 * 3. أنّ عتباتِ التخزينِ موجودةٌ في الهجرة.
 *
 * ## ما لا يفعله
 *
 * - لا يُثبت أنّ التخزينَ يعملُ في الإنتاج — ذلك قياسُ حملٍ (المرحلة ٢٤).
 * - لا يمنعُ النداءَ المباشرَ في غيرِ المسارِ الساخنِ — بطاقةُ الرحلةِ طلبٌ صريح.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROUTE_CACHE_PATH = "packages/application/tracking/route-cache.ts";
const ESTIMATE_ARRIVAL_PATH = "packages/application/tracking/estimate-arrival.ts";
const RIDE_CHANNEL_PATH = "apps/gateway/src/realtime/ride-channel.ts";
const MIGRATIONS_DIR = "supabase/migrations";

const REQUIRED_EXPORTS = ["shouldRecomputeRoute", "hasMeaningfulChange", "InMemoryRouteCache"];

async function checkFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    console.error(`✗ الملفُ مفقود: ${path}`);
    process.exit(1);
  }
}

async function checkMigrations(): Promise<void> {
  const files = await readdir(MIGRATIONS_DIR);
  let found = false;
  for (const f of files) {
    if (!f.endsWith(".sql")) continue;
    const content = await readFile(join(MIGRATIONS_DIR, f), "utf-8");
    if (
      content.includes("route_cache_min_change_meters") &&
      content.includes("route_cache_ttl_seconds")
    ) {
      found = true;
      break;
    }
  }
  if (!found) {
    console.error("✗ عتباتُ تخزينِ المساراتِ غير موجودةٍ في أيِّ هجرة");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // 1. route-cache.ts موجود ويُصدّر المطلوب
  const routeCache = await checkFile(ROUTE_CACHE_PATH);
  for (const exportName of REQUIRED_EXPORTS) {
    if (!routeCache.includes(exportName)) {
      console.error(`✗ ${exportName} غير مُصدَّرٍ في ${ROUTE_CACHE_PATH}`);
      process.exit(1);
    }
  }

  // 2. estimate-arrival.ts موجود
  await checkFile(ESTIMATE_ARRIVAL_PATH);

  // 3. ride-channel.ts لا ينادي estimateArrival مباشرة
  const rideChannel = await checkFile(RIDE_CHANNEL_PATH);
  if (rideChannel.includes("estimateArrival") || rideChannel.includes("estimate-arrival")) {
    console.error(`✗ ${RIDE_CHANNEL_PATH} ينادي estimateArrival مباشرة — يُمنعُ في المسار الساخن`);
    process.exit(1);
  }

  // 4. العتبات في الهجرة
  await checkMigrations();

  console.log(
    `✓ سياسةُ تخزينِ المسارات (CAP-012): ${REQUIRED_EXPORTS.length} تصديراتٍ · لا نداءَ مباشرَ في البثِّ الحيِّ · عتباتٌ في الهجرة`,
  );
}

await main();
