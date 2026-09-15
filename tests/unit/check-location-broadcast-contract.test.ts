/**
 * الغرض: برهانُ سقوطِ حاجزِ عقدِ بثِّ الموقعِ — **حالةٌ سلبيّةٌ مصنوعةٌ لكلِّ
 *   قاعدةٍ من الثمانِ**، وحالةٌ موجبةٌ واحدةٌ على المستودعِ الحقيقيِّ (`ح-7`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُزادُ في الحاجزِ تُزادُ لها حالةٌ ههنا،
 *   وإلّا فهيَ **غيرُ مُنفَذةٍ** ولو كانَ الحاجزُ أخضرَ.
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ولِمَ المستودعُ الحقيقيُّ أساساً: مدخلٌ مصنوعٌ من الصفرِ يُثبِتُ مُطابَقةَ نمطٍ
 * لا انطباقَ قاعدةٍ على ما كُتِبَ فعلاً. فكلُّ حالةٍ ههنا **تفسدُ نسخةً من
 * الحقيقةِ بفسادٍ واحدٍ**، وتقيسُ أنَّ الحاجزَ يراهُ وأنَّ الأصلَ نظيفٌ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ سلوكَ مُضيفٍ ولا بطاريّةً**: يقيسُ حكمَ الحاجزِ فحسب.
 * - **لا يدَّعي استيعابَ كلِّ إفسادٍ**: يُثبِتُ أنَّ لكلِّ قاعدةٍ سنّاً.
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-location-broadcast-contract.ts";
import {
  absenceHonestyProblems,
  backoffProblems,
  inventedIntervalProblems,
  type LocationBroadcastContractInput,
  locationBroadcastContractProblems,
  publishedBlockProblems,
  purityProblems,
  reasonSourceProblems,
  SURFACE_FILES,
  singleSenderProblems,
  textCoverageProblems,
} from "../../scripts/lib/location-broadcast-contract.ts";

const REAL: LocationBroadcastContractInput = readRepository();
const SCREEN = SURFACE_FILES[0] as string;

function spoil(patch: Partial<LocationBroadcastContractInput>): LocationBroadcastContractInput {
  return { ...REAL, ...patch };
}

function withSurface(
  path: string,
  mutate: (source: string) => string,
): LocationBroadcastContractInput {
  const source = REAL.surface[path];
  if (source === undefined) throw new Error(`${path}: غيرُ مقروءٍ في المستودعِ.`);
  return spoil({ surface: { ...REAL.surface, [path]: mutate(source) } });
}

describe("حاجزُ عقدِ بثِّ الموقعِ — الحالةُ الموجبةُ", () => {
  test("المستودعُ الحقيقيُّ بلا مأخذٍ", () => {
    expect(locationBroadcastContractProblems(REAL)).toEqual([]);
  });
});

describe("١) الكتلةُ في الجذرِ في المَخرجَينِ", () => {
  test("مَخرجٌ واحدٌ ينشُرُها فيسقطُ — سائقٌ متاحٌ بلا مَهمّةٍ لا يبثُّ", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replace("'location_broadcast',", "'lb_block',"),
    });
    expect(publishedBlockProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("بوّابةٌ لا تنشُرُ الكتلةَ فيسقطُ — حكمُ القاعدةِ لا يبلغُ العميلَ", () => {
    const spoiled = spoil({ route: REAL.route.replaceAll("location_broadcast", "lb_block") });
    expect(publishedBlockProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("ختمُ انتهاءٍ بدلَ مُدّةٍ فيسقطُ — ساعةُ الجهازِ ليسَت حَكَماً", () => {
    const spoiled = spoil({ route: `${REAL.route}\nconst expires_at = 0;\n` });
    expect(publishedBlockProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٢) لا مُدّةَ مُخترَعةً في العميلِ", () => {
  test("ارتدادٌ إلى رقمٍ فيسقطُ — ثابتُ ثوانٍ يُلغي إعدادَ المدينةِ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\nconst intervalFallback = policyInterval ?? 30;\n`,
    );
    expect(inventedIntervalProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("اسمُ إعدادٍ في العميلِ فيسقطُ — مصدرُ حقيقةٍ ثانٍ يوشكُ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\nconst key = "location_broadcast_seconds_on_trip";\n`,
    );
    expect(inventedIntervalProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٣) الغيابُ لا يُقرأُ صفراً", () => {
  test("ارتدادٌ إلى صفرٍ فيسقطُ — صفرٌ بثٌّ متّصلٌ لا سكونٌ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\nconst intervalSeconds = published ?? 0;\n`,
    );
    expect(absenceHonestyProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مُهايِئٌ بلا تحقُّقٍ فيسقطُ — كتلةٌ مُشوَّهةٌ تُسكِتُ البثَّ صامتةً", () => {
    const spoiled = spoil({
      store: REAL.store.replaceAll("readBroadcastPolicy", "readLbShape"),
    });
    expect(absenceHonestyProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("هجرةٌ لا تنشُرُ عَدَماً فيسقطُ — فشلٌ مفتوحٌ يخترعُ مُدّةً", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll(
        "'interval_seconds', null",
        "'interval_seconds', 1",
      ),
    });
    expect(absenceHonestyProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٤) القرارُ نقيٌّ", () => {
  test("ساعةٌ في النطاقِ فتسقطُ — حالٌ خفيٌّ يجعلُ التراجعَ غيرَ مقيسٍ", () => {
    const spoiled = spoil({ domain: `${REAL.domain}\nconst t = Date.now();\n` });
    expect(purityProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مؤقّتٌ في النطاقِ فيسقطُ — الغلافُ يملكُ المؤقّتَ لا الحكمُ", () => {
    const spoiled = spoil({ domain: `${REAL.domain}\nsetInterval(() => {}, 1);\n` });
    expect(purityProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٥) السببُ من الخادمِ", () => {
  test("مقارنةُ حالةٍ في السطحِ فتسقطُ — آلةُ حالاتٍ ثانيةٌ تتقادَمُ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\nconst onTrip = job.status === "in_progress";\n`,
    );
    expect(reasonSourceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("سببٌ لا تقولُه القاعدةُ فيسقطُ — سببٌ مُشتَقٌّ في المكانِ الخطأِ", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'ON_TRIP'", "'BUSY_STATE'"),
    });
    expect(reasonSourceProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٦) تراجعٌ بسقفٍ ورموزٌ قاتلةٌ", () => {
  test("تراجعٌ بلا سقفٍ فيسقطُ — نبضةٌ في الساعةِ بعدَ انقطاعٍ عابرٍ", () => {
    const spoiled = spoil({
      domain: REAL.domain.replaceAll("MAX_BACKOFF_DOUBLINGS", "BACKOFF_STEPS_UNBOUNDED"),
    });
    expect(backoffProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("رمزٌ قاتلٌ غيرُ مذكورٍ فيسقطُ — إعادةٌ أبديّةٌ لا تُصلِحُ", () => {
    const spoiled = spoil({
      domain: REAL.domain.replaceAll("DRIVER_NOT_REGISTERED", "NO_DRIVER_ROW"),
    });
    expect(backoffProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٧) مُرسِلٌ واحدٌ", () => {
  test("مُرسِلٌ ثانٍ فيسقطُ — نبضتانِ بمُدّتَينِ وحدُّ معدَّلٍ يُستهلَكُ مرّتَينِ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\napiFetch<unknown>("/v1/driver/location", { method: "POST" });\n`,
    );
    expect(singleSenderProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مسارُ استقبالٍ ثانٍ فيسقطُ — كاتبانِ للموقعِ", () => {
    const spoiled = withSurface(
      SCREEN,
      (source) => `${source}\nconst second = "/v1/driver/live-location";\n`,
    );
    expect(singleSenderProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٨) لكلِّ سببٍ نصُّه", () => {
  test("نصٌّ ناقصٌ في لغةٍ فيسقطُ — رمزٌ خامٌ على شاشةِ سائقٍ", () => {
    const trimmed = { ...REAL.translations.ur } as Record<string, string>;
    delete trimmed["driver.location.stop.PERMISSION_NOT_GRANTED"];
    const spoiled = spoil({ translations: { ...REAL.translations, ur: trimmed } });
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مُدّةٌ بلا مقدارٍ في النصِّ فتسقطُ — إعلانٌ عن بثٍّ بلا رقمٍ", () => {
    const patched = { ...REAL.translations.ar } as Record<string, string>;
    patched["driver.location.onEvery"] = "يُبَثُّ موضعُك دوريّاً.";
    const spoiled = spoil({ translations: { ...REAL.translations, ar: patched } });
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });
});
