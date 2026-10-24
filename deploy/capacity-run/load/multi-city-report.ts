/**
 * `LOAD-01M` — تقريرُ المدنِ المتزامنةِ المكمِّلُ لـ`wave-report.ts` (لا بديلٌ عنه):
 * بواباتُ `LOAD-01` الرسميةُ (G1–G8 · P1–P9 · N1–N5) تُحكَمُ على الموجةِ كلِّها
 * بـ`wave-report.ts` بلا تغيير؛ وهذا التقريرُ يضيفُ ما لا تقيسُه:
 *
 *  ١) تفصيلَ كلِّ مدينةٍ: السيناريوهاتُ المطلقةُ والمثبتةُ وأسبابُ الفشلِ وp95 ظهورِ العرض.
 *  ٢) العدالةَ: أدنى نسبةِ إنجازٍ بينَ المدنِ وأقصاها والفرقُ بينهما — مدينةٌ تستحوذُ على
 *     الموارد المشتركة تظهرُ هنا.
 *  ٣) العزلَ من القاعدةِ (لا من المولّد):
 *     I1 طلبٌ مدينتُه ≠ مدينةِ راكبِه · I2 عرضٌ لسائقٍ من مدينةٍ أخرى ·
 *     I3 إسنادٌ لسائقٍ من مدينةٍ أخرى · I4 إشعارٌ مدينتُه ≠ مدينةِ طلبِه ·
 *     I5 إشعارٌ لمحادثةِ مستخدمٍ من مدينةٍ أخرى · I6 مدينةُ الطلبِ ≠ مدينةِ السيناريو.
 *
 * كلُّ بندِ عزلٍ يجبُ أن يساويَ صفرًا؛ والخروجُ بغيرِ الصفرِ = خرقُ عزلٍ (لا يُحكمُ هنا
 * على السعةِ — تلك لـ`wave-report.ts`).
 *
 * التشغيل: RUN_DIR=… DATABASE_URL=… bun run deploy/capacity-run/load/multi-city-report.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EV, sql } from "./lib.ts";

interface Outcome {
  kind: string;
  city?: string;
  reason?: string;
  orderId?: string;
  orderCreatedAt?: number;
  offerFoundAt?: number;
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // سطرٌ تالفٌ يُتجاهل.
    }
  }
  return rows;
}

export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? null;
}

export interface CityRow {
  city: string;
  launched: number;
  verified: number;
  completionRate: number;
  offerAppearP95Ms: number | null;
  topReasons: [string, number][];
}

/** تفصيلُ المدنِ والعدالةُ من مآلاتِ المولّدِ — دالّةٌ نقيّةٌ مختبَرة. */
export function perCity(outcomes: Outcome[]): { rows: CityRow[]; fairnessGap: number } {
  const by = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const c = o.city ?? "UNKNOWN";
    const list = by.get(c) ?? [];
    list.push(o);
    by.set(c, list);
  }
  const rows: CityRow[] = [];
  for (const [city, list] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const verified = list.filter((o) => o.kind === "verified").length;
    const reasons = new Map<string, number>();
    for (const o of list) {
      if (o.kind === "verified") continue;
      const r = (o.reason ?? o.kind).replace(/\d+/g, "N");
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    rows.push({
      city,
      launched: list.length,
      verified,
      completionRate: list.length === 0 ? 0 : verified / list.length,
      offerAppearP95Ms: p95(
        list
          .filter((o) => o.orderCreatedAt !== undefined && o.offerFoundAt !== undefined)
          .map((o) => (o.offerFoundAt ?? 0) - (o.orderCreatedAt ?? 0)),
      ),
      topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    });
  }
  const rates = rows.map((r) => r.completionRate);
  const fairnessGap = rates.length === 0 ? 0 : Math.max(...rates) - Math.min(...rates);
  return { rows, fairnessGap };
}

async function isolation(outcomes: Outcome[]): Promise<Record<string, number>> {
  const one = async (q: Promise<{ n: string }[]>): Promise<number> => Number((await q)[0]?.n ?? 0);
  const res: Record<string, number> = {
    I1_order_vs_rider_city: await one(sql`
      select count(*)::text n from orders o join riders r on r.id = o.rider_id
       where o.city_id <> r.city_id`),
    I2_offer_driver_other_city: await one(sql`
      select count(*)::text n from order_offers oo
        join orders o on o.id = oo.order_id join drivers d on d.id = oo.driver_id
       where d.city_id <> o.city_id`),
    I3_assigned_driver_other_city: await one(sql`
      select count(*)::text n from orders o join drivers d on d.id = o.assigned_driver_id
       where d.city_id <> o.city_id`),
    I4_outbox_city_vs_order_city: await one(sql`
      select count(*)::text n from notification_outbox n join orders o on o.id = n.order_id
       where n.city_id <> o.city_id`),
    I5_outbox_chat_user_other_city: await one(sql`
      select count(*)::text n from notification_outbox n
        join orders o on o.id = n.order_id
        join users u on u.telegram_id = n.chat_id
        left join riders r on r.user_id = u.id
        left join drivers d on d.user_id = u.id
       where n.chat_id > 0 and coalesce(d.city_id, r.city_id) <> o.city_id`),
    I5b_outbox_group_chat_other_city: await one(sql`
      select count(*)::text n from notification_outbox n
        join orders o on o.id = n.order_id
        join cities c on n.chat_id in (c.telegram_support_group_id,
          c.telegram_escalation_group_id, c.telegram_unsubscribed_drivers_group_id)
       where n.chat_id < 0 and c.id <> o.city_id`),
  };
  // I6 — مدينةُ الطلبِ في القاعدةِ مقابلَ مدينةِ السيناريو في المولّد.
  const pairs = outcomes.filter((o) => o.orderId !== undefined && o.city !== undefined);
  let mismatch = 0;
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500);
    const ids = chunk.map((o) => o.orderId as string);
    const rows = await sql<{ id: string; code: string }[]>`
      select o.id::text id, c.code from orders o join cities c on c.id = o.city_id
       where o.id = any(${ids}::uuid[])`;
    const code = new Map(rows.map((r) => [r.id, r.code]));
    for (const o of chunk) if (code.get(o.orderId as string) !== o.city) mismatch += 1;
  }
  res.I6_order_city_vs_scenario_city = mismatch;
  return res;
}

async function main() {
  const events = readJsonl(`${EV}/miniapp-load-events.jsonl`);
  const outcomes = events.filter((e) => e.event === "scenario.outcome") as unknown as Outcome[];
  const genStart = events.find((e) => e.event === "gen.start") as { cities?: string[] } | undefined;
  const { rows, fairnessGap } = perCity(outcomes);
  const iso = await isolation(outcomes);
  const isolationClean = Object.values(iso).every((n) => n === 0);
  const report = {
    cities: genStart?.cities ?? null,
    totals: {
      launched: outcomes.length,
      verified: outcomes.filter((o) => o.kind === "verified").length,
    },
    perCity: rows,
    fairnessGap,
    isolation: iso,
    isolationVerdict: isolationClean ? "CLEAN" : "BREACH",
  };
  writeFileSync(`${EV}/multi-city-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await sql.end({ timeout: 5 });
  process.exit(isolationClean ? 0 : 1);
}

if (import.meta.main) void main();
