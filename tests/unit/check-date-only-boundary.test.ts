/**
 * الغرض: قياسُ حاجزِ «التاريخُ المجرَّدُ يعبرُ نصّاً» **بنصوصٍ مزروعةٍ** — لكلِّ
 *   حكمٍ سالبةٌ تُسقِطُه وموجبةٌ يمرُّ بها. وأهمُّ حالةٍ ههنا هيَ **عقدُ
 *   `driver_vehicle` الذي أسقطَ CI بالفعلِ في `F3-07`**: لو مرَّ لَما كانَ
 *   الحاجزُ حاجزاً.
 * الحالة: منفّذ فعلياً — يعملُ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ دالّةٍ تُخرِجُ تاريخاً مجرَّداً.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ مسحُ القرصِ**: `scripts/check-date-only-boundary.ts` غلافٌ،
 *    والحكمُ في المكتبةِ الخالصةِ.
 * ــ **لا يُقاسُ تحويلُ السائقِ نفسِه**: أنَّ `postgres.js` يُنتِجُ `Date` سلوكٌ
 *    خارجيٌّ، ودليلُه سقوطُ `tests/integration/driver-vehicle.test.ts` في CI.
 */
import { describe, expect, it } from "bun:test";
import {
  dateOnlyViolationsIn,
  describeDateOnlyViolation,
  PLANTED_NEGATIVE_FILES,
} from "../../scripts/lib/date-only-boundary.ts";

const PATH = "supabase/migrations/20990101000000_planted.sql";

describe("حاجزُ الحدِّ: لا عمودَ `date` في عقدِ خرجٍ", () => {
  it("السالبةُ التي أسقطَت CI فعلاً: عقدُ `driver_vehicle` بثلاثةِ تواريخِ انتهاءٍ", () => {
    const planted = [
      "create or replace function driver_vehicle(p_telegram_user_id bigint)",
      "returns table(",
      "  vehicle_type text,",
      "  registration_expires_at date,",
      "  insurance_expires_at date,",
      "  inspection_expires_at date",
      ")",
      "language sql as $$ select 1 $$;",
    ].join("\n");
    const found = dateOnlyViolationsIn(PATH, planted);
    expect(found).toHaveLength(3);
    expect(found.map((v) => v.column)).toEqual([
      "registration_expires_at",
      "insurance_expires_at",
      "inspection_expires_at",
    ]);
    expect(found[0]?.functionName).toBe("driver_vehicle");
    expect(found[0]?.line).toBe(4);
  });

  it("الموجبةُ: العقدُ نفسُه بـ`text` و`to_char` يمرُّ", () => {
    const clean = [
      "create or replace function driver_vehicle(p_telegram_user_id bigint)",
      "returns table(",
      "  registration_expires_at text",
      ")",
      "language sql as $$",
      "  select to_char(expires_at, 'YYYY-MM-DD') from driver_documents;",
      "$$;",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, clean)).toHaveLength(0);
  });

  it("عمودُ `date` في **جدولٍ** ليسَ خرقاً — التخزينُ تاريخاً مجرَّداً صوابٌ", () => {
    const clean = [
      "create table driver_documents (",
      "  id uuid primary key,",
      "  expires_at date",
      ");",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, clean)).toHaveLength(0);
  });

  it("مُعامِلُ دخلٍ من نوعِ `date` ليسَ خرقاً — الاتّجاهُ الآخرُ لا يمرُّ بسائقٍ", () => {
    const clean = [
      "create function archive_day(p_day date)",
      "returns table(rows_moved int)",
      "language sql as $$ select 0 $$;",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, clean)).toHaveLength(0);
  });

  it("`timestamptz` يمرُّ — اللحظةُ لها لحظةٌ وتحويلُها صادقٌ", () => {
    const clean = [
      "create function o() returns table(",
      "  created_at timestamptz,",
      "  updated_at timestamp with time zone",
      ") language sql as $$ select now(), now() $$;",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, clean)).toHaveLength(0);
  });

  it("`daterange` و`date_trunc` لا يُخدَعانِ الحاجزَ — لا خرقَ بلا نوعٍ مجرَّدٍ", () => {
    const clean = [
      "create function o() returns table(",
      "  window_range daterange,",
      "  bucket text",
      ") language sql as $$ select null, date_trunc('day', now())::text $$;",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, clean)).toHaveLength(0);
  });

  it("التعليقُ الذي يُحذِّرُ من النمطِ **ليسَ خرقاً** — وإلّا حُذِفَ الدرسُ ليخضرَّ الحاجزُ", () => {
    const lesson = [
      "create function o() returns table(",
      "  -- ممنوعٌ: expires_at date — يصلُ العميلَ `Date` فيُقرأُ عَدَماً.",
      "  expires_at text",
      ") language sql as $$ select null::text $$;",
    ].join("\n");
    expect(dateOnlyViolationsIn(PATH, lesson)).toHaveLength(0);
  });

  it("عقدانِ في هجرةٍ واحدةٍ يُعَدّانِ اثنَينِ ولكلٍّ اسمُ دالّتِه", () => {
    const planted = [
      "create function first_fn() returns table(a date) language sql as $$ select null $$;",
      "create function second_fn() returns table(b date) language sql as $$ select null $$;",
    ].join("\n");
    const found = dateOnlyViolationsIn(PATH, planted);
    expect(found).toHaveLength(2);
    expect(found.map((v) => v.functionName)).toEqual(["first_fn", "second_fn"]);
  });

  it("الرسالةُ تذكرُ الملفَّ والسطرَ والدالّةَ والبديلَ — رسالةٌ غامضةٌ تُهمَل", () => {
    const [violation] = dateOnlyViolationsIn(
      PATH,
      "create function o() returns table(d date) language sql as $$ select null $$;",
    );
    if (violation === undefined) throw new Error("لا خرقَ — والسالبةُ مزروعةٌ");
    const message = describeDateOnlyViolation(violation);
    expect(message).toContain(PATH);
    expect(message).toContain("o ⇒ d date");
    expect(message).toContain("to_char");
    expect(message).toContain("ADR 0121");
  });

  it("ملفُّ السالباتِ المزروعةِ معلَنٌ واحداً — استثناءٌ يتّسِعُ بلا قَودٍ بابٌ", () => {
    expect([...PLANTED_NEGATIVE_FILES]).toEqual(["tests/unit/check-date-only-boundary.test.ts"]);
    expect(
      dateOnlyViolationsIn(
        "tests/unit/check-date-only-boundary.test.ts",
        "create function o() returns table(d date) language sql as $$ select null $$;",
      ),
    ).toHaveLength(0);
  });
});
