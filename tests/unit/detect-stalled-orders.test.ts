/**
 * الغرضُ: `F12-04` — اختباراتُ مهمّةِ كشفِ الطلباتِ العالقةِ.
 * ينتمي إلى: tests/unit
 *
 * ## والاختبارُ المُلزِمُ ههنا اختبارٌ سالبٌ (`ح-7`)
 *
 * القاعدةُ الحارسةُ: **الكاشفُ يكشفُ ولا يُصلِحُ**. فلا يكفي أن نُثبِتَ أنَّه
 * يكتبُ سطراً؛ بل يجبُ أن نُثبِتَ أنَّه **لا يملكُ** طريقاً إلى تغييرِ حالةِ طلبٍ:
 * فعقدُ تبعيّاتِه لا يحملُ إلّا قراءةً وكتابةَ سطرٍ، ولو أضافَ أحدٌ في المستقبلِ
 * إلغاءً آليّاً لسقطَ هذا الملفُّ.
 */
import { describe, expect, it } from "bun:test";
import {
  detectStalledOrders,
  STALLED_ORDER_BATCH,
} from "../../apps/workers/src/jobs/detect-stalled-orders.ts";
import {
  isKnownStallSignalSource,
  STALL_SIGNAL_SOURCES,
  STALL_VERDICTS,
  type StalledOrderRow,
} from "../../packages/application/tracking/stalled-order-ports.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";

const CITY = "11111111-1111-1111-1111-111111111111" as CityId;

function row(id: string, idle: number, status = "in_progress"): StalledOrderRow {
  return {
    orderId: id as OrderId,
    status,
    idleSeconds: idle,
    thresholdMinutes: 20,
    signalSource: "DRIVER_LOCATION",
    lastSignalAt: "2026-09-19T00:00:00.000Z",
  };
}

function harness(rows: readonly StalledOrderRow[]) {
  const lines: Record<string, unknown>[] = [];
  let askedLimit: number | null = null;
  return {
    lines,
    limitSeen: () => askedLimit,
    deps: {
      stalled: {
        listStalled: async (_city: CityId, limit: number) => {
          askedLimit = limit;
          return { ok: true as const, value: rows };
        },
      },
      escalate: (fields: Record<string, unknown>) => {
        lines.push(fields);
      },
    },
  };
}

describe("F12-04 — كاشفُ الطلباتِ العالقةِ", () => {
  it("يكتبُ سطرَ تصعيدٍ لكلِّ طلبٍ عالقٍ لا سطراً واحداً جامعاً", async () => {
    const h = harness([row("a", 4000), row("b", 2000), row("c", 1500)]);
    const out = await detectStalledOrders(CITY, h.deps);

    expect(out.ok).toBe(true);
    // ثلاثةُ أسطرٍ لثلاثةِ طلباتٍ: عددٌ بلا معرِّفاتٍ لا يُبحَثُ به عن طلبٍ بعينِه.
    expect(h.lines).toHaveLength(3);
    expect(h.lines.map((l) => l.order_id)).toEqual(["a", "b", "c"]);
  });

  it("ينشرُ في كلِّ سطرٍ الإشارةَ والمهلةَ فلا يُقرأُ الرقمُ بلا نسبٍ", async () => {
    const h = harness([row("a", 4000)]);
    await detectStalledOrders(CITY, h.deps);

    expect(h.lines[0]).toEqual({
      city_id: CITY,
      order_id: "a",
      order_status: "in_progress",
      idle_seconds: 4000,
      threshold_minutes: 20,
      signal_source: "DRIVER_LOCATION",
      last_signal_at: "2026-09-19T00:00:00.000Z",
    });
  });

  it("يُقرِّرُ الأسوأَ بترتيبِ القاعدةِ لا بفرزٍ ثانٍ عندَه", async () => {
    const h = harness([row("a", 4000), row("b", 9999)]);
    const out = await detectStalledOrders(CITY, h.deps);

    // القاعدةُ تُرتِّبُ بأطولِ سكونٍ أوّلاً؛ ولو فَرَزَت المهمّةُ ثانيةً لكانَ
    // للترتيبِ موضعانِ يتباعدانِ. فالأوّلُ هوَ الأسوأُ بالعقدِ لا بالحسابِ.
    expect(out.ok && out.value.worstIdleSeconds).toBe(4000);
    expect(out.ok && out.value.stalled).toBe(2);
  });

  it("لا طلبَ عالقاً: لا سطرَ تصعيدٍ و`worstIdleSeconds` معدومٌ لا صفرٌ", async () => {
    const h = harness([]);
    const out = await detectStalledOrders(CITY, h.deps);

    expect(h.lines).toHaveLength(0);
    expect(out.ok && out.value.stalled).toBe(0);
    // صفرٌ يعني «عَلِقَ ولم يسكنْ»، و`null` يعني «لم يَعلَقْ» — وفرقُهما معتبَرٌ.
    expect(out.ok && out.value.worstIdleSeconds).toBeNull();
  });

  it("يُمرِّرُ حدَّ الدفعةِ المُعلَنَ لا رقماً مكتوباً ثانيةً", async () => {
    const h = harness([]);
    await detectStalledOrders(CITY, h.deps);
    expect(h.limitSeen()).toBe(STALLED_ORDER_BATCH);
  });

  it("عطبُ القاعدةِ يُردُّ عطباً ولا يُقرأُ «لا شيءَ عالقٌ»", async () => {
    const boom = { name: "PortFailureError", message: "قاعدةٌ ساقطةٌ" };
    const lines: Record<string, unknown>[] = [];
    const out = await detectStalledOrders(CITY, {
      stalled: {
        listStalled: async () => ({ ok: false as const, error: boom as never }),
      },
      escalate: (fields) => lines.push(fields),
    });

    // **وهذا هو الخطرُ**: عطبٌ يُترجَمُ صفراً يُقرأُ لوحةً خضراءَ وفي المدينةِ
    // رحلاتٌ عالقةٌ. فالعطبُ يُعلَنُ ويُسقِطُ النبضةَ لا يُبلَعُ.
    expect(out.ok).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("سالبٌ (ح-7): عقدُ التبعيّاتِ لا يحملُ أيَّ بابٍ إلى تغييرِ حالةِ طلبٍ", async () => {
    const h = harness([row("a", 9000)]);
    await detectStalledOrders(CITY, h.deps);

    // القاعدةُ الحارسةُ: الإلغاءُ والإفشالُ والعقوبةُ قرارٌ تجاريٌّ (`F2-05`) لا
    // يُخترَعُ في مهمّةٍ دوريّةٍ. فالبرهانُ بنيويٌّ: منفذُ القراءةِ لا يُعلِنُ
    // إلّا `listStalled`، ولو أُضيفَ إليه `cancel`/`fail`/`penalise` لسقطَ هذا.
    const portSurface = Object.keys(h.deps.stalled);
    expect(portSurface).toEqual(["listStalled"]);
    expect(Object.keys(h.deps).sort()).toEqual(["escalate", "stalled"]);
  });
});

/**
 * ## معجمُ الإشاراتِ والأحكامِ — عقدٌ بينَ الهجرةِ والشيفرةِ
 *
 * النوعُ يختفي عندَ الترجمةِ، والصفُّ يأتي من القاعدةِ في زمنِ التشغيلِ. فالمقيسُ
 * ههنا أنَّ **نصَّ الهجرةِ ونصَّ العقدِ يقولانِ الشيءَ نفسَه** — ولو أضافَ أحدٌ
 * حكماً في إحداهما ونسيَ الأخرى لسقطَ هذا الملفُّ.
 */
describe("F12-04 — معجمُ الإشاراتِ والأحكامِ مُطابِقٌ للهجرةِ", () => {
  const MIGRATION = "supabase/migrations/20260919060000_f12_04_stalled_order_detector.sql";

  it("كلُّ إشارةٍ وكلُّ حكمٍ في العقدِ موجودٌ في الهجرةِ حرفاً", async () => {
    const sqlText = await Bun.file(MIGRATION).text();
    for (const source of STALL_SIGNAL_SOURCES) {
      expect(sqlText).toContain(`'${source}'`);
    }
    for (const verdict of STALL_VERDICTS) {
      expect(sqlText).toContain(`'${verdict}'`);
    }
  });

  it("والهجرةُ لا تحملُ إشارةً خارجَ المعجمِ المغلقِ — وإلّا عبرَ نصٌّ مجهولٌ صامتاً", async () => {
    const sqlText = await Bun.file(MIGRATION).text();
    // كلُّ نصٍّ مُفرَدٍ بحروفٍ كبيرةٍ وشُرطاتٍ سفليّةٍ في الهجرةِ: إمّا إشارةٌ أو
    // حكمٌ مُعلَنٌ ههنا، أو حكمُ حياةِ الرابطِ، أو مصدرُ العتبةِ.
    const KNOWN = new Set<string>([
      ...STALL_SIGNAL_SOURCES,
      ...STALL_VERDICTS,
      "SETTING",
      "FALLBACK_DEFAULT",
      "LIVE_RIDE_ACTIVE",
      "LIVE_GRACE",
      "EXPIRED_RIDE_ENDED",
      "EXPIRED_RIDE_STALLED",
    ]);
    const found = [...sqlText.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1] as string);
    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found)].filter((token) => !KNOWN.has(token))).toEqual([]);
  });

  it("سالبٌ (ح-7): نصٌّ خارجَ المعجمِ لا يُقرأُ إشارةً معروفةً", () => {
    expect(isKnownStallSignalSource("DRIVER_LOCATION")).toBe(true);
    expect(isKnownStallSignalSource("ORDER_TOUCHED")).toBe(true);
    // ولو رُدَّ `true` لِما لا يُعرَفُ لَمرَّ حكمٌ ثالثٌ مُختلَقٌ بلا صوتٍ.
    expect(isKnownStallSignalSource("DRIVER_GUESSED")).toBe(false);
    expect(isKnownStallSignalSource("")).toBe(false);
  });
});
