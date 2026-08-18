/**
 * الغرض: حراسةُ حرسِ العزل نفسِه — أن يبقى رافضاً كلَّ وجهةٍ غير قاعدةِ القياس.
 * الحالة: اختبار فعلي، لا يحتاج قاعدةً فيجري في CI مع كلّ تغيير.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: أيّ توسيعٍ لقائمة السماح يجب أن يُسقط اختباراً هنا أوّلاً.
 *
 * ولماذا يُختبَر حرسٌ لا يُشغَّل في الإنتاج؟ لأنّه الشيءُ الوحيد الذي يقف بين
 * أداةٍ تمحو جداولَ وقاعدةٍ حقيقيّة. وخطؤه غيرُ قابلٍ للتراجع، بخلاف خطأ قياسٍ
 * يُعطي رقماً غلطاً. فهو أحقُّ ما في المنصّة بالاختبار، ويجري في CI مع كلّ تغيير
 * لا في تشغيل القياس وحده — لأنّ من يكسره لن يكون قد نوى تشغيل قياس.
 */
import { describe, expect, it } from "bun:test";
import {
  assertIsolation,
  BENCH_DATABASE_NAMES,
  BENCH_TELEGRAM_ID_MIN,
  checkIsolation,
  type IsolationFailureCode,
} from "../../bench/isolation.ts";
import { compareStates, type StateSnapshot } from "../../bench/state.ts";

const BENCH_URL = "postgres://postgres:postgres@localhost:5432/waslah_bench";

describe("حرس العزل: ما يُقبل", () => {
  it("يقبل قاعدة القياس على مضيف محليّ", () => {
    const verdict = checkIsolation({ databaseUrl: BENCH_URL, nodeEnv: "test" });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.database).toBe("waslah_bench");
    expect(verdict.host).toBe("localhost");
  });

  it("يقبل 127.0.0.1 و ::1 كما يقبل localhost", () => {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const verdict = checkIsolation({
        databaseUrl: `postgres://u:p@${host}:5432/waslah_bench`,
        nodeEnv: "development",
      });
      expect(verdict.ok).toBe(true);
    }
  });
});

describe("حرس العزل: ما يُرفض", () => {
  const cases: readonly {
    label: string;
    url: string | undefined;
    env?: string;
    code: IsolationFailureCode;
  }[] = [
    {
      label: "بيئة إنتاج ولو كانت الوجهة سليمة",
      url: BENCH_URL,
      env: "production",
      code: "PRODUCTION_ENV",
    },
    {
      label: "مضيف Supabase",
      url: "postgres://u:p@db.abc.supabase.co:5432/postgres",
      code: "MANAGED_HOST",
    },
    {
      label: "مجمّع اتّصالات مُدار",
      url: "postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres",
      code: "MANAGED_HOST",
    },
    {
      label: "مضيف سحابيّ آخر",
      url: "postgres://u:p@ep-x.eu.neon.tech:5432/waslah_bench",
      code: "MANAGED_HOST",
    },
    {
      label: "عنوان شبكيّ خاصّ",
      url: "postgres://u:p@10.0.0.5:5432/waslah_bench",
      code: "REMOTE_HOST",
    },
    {
      label: "اسم مضيف بعيد",
      url: "postgres://u:p@db.internal:5432/waslah_bench",
      code: "REMOTE_HOST",
    },
    {
      label: "قاعدة التطوير waslah",
      url: "postgres://u:p@localhost:5432/waslah",
      code: "DATABASE_NOT_ALLOWED",
    },
    {
      label: "قاعدة postgres",
      url: "postgres://u:p@localhost:5432/postgres",
      code: "DATABASE_NOT_ALLOWED",
    },
    { label: "قاعدة بلا اسم", url: "postgres://u:p@localhost:5432/", code: "DATABASE_NOT_ALLOWED" },
    { label: "وجهة غائبة", url: undefined, code: "MISSING_DATABASE_URL" },
    { label: "وجهة فراغ", url: "   ", code: "MISSING_DATABASE_URL" },
    { label: "وجهة غير قابلة للتحليل", url: "ليس عنواناً", code: "UNPARSEABLE_DATABASE_URL" },
  ];

  for (const testCase of cases) {
    it(`يرفض ${testCase.label} بالرمز ${testCase.code}`, () => {
      const verdict = checkIsolation({
        databaseUrl: testCase.url,
        nodeEnv: testCase.env ?? "test",
      });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.code).toBe(testCase.code);
    });
  }

  /**
   * الترتيبُ نفسُه جزءٌ من العقد: وجهةٌ محليّةٌ سليمةٌ في بيئةِ إنتاجٍ يجب أن
   * تُبلَّغ «بيئة إنتاج» لا «قاعدة غير مسموحة»، لأن الرسالةَ هي ما يقرؤه من ضبط
   * الأداة على الإنتاج بالخطأ، والرسالةُ الخطأ تُرسله يبحث في المكان الخطأ.
   */
  it("بيئةُ الإنتاج تُفحَص أوّلاً ولو كان كلُّ شيءٍ آخرَ سليماً", () => {
    const verdict = checkIsolation({
      databaseUrl: "postgres://u:p@db.abc.supabase.co:5432/postgres",
      nodeEnv: "production",
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("PRODUCTION_ENV");
  });

  it("assertIsolation يرفع استثناءً يحمل الرمز، فلا يمضي مسارٌ يمحو", () => {
    expect(() => assertIsolation({ databaseUrl: BENCH_URL, nodeEnv: "production" })).toThrow(
      /PRODUCTION_ENV/,
    );
  });
});

describe("ثوابت العزل", () => {
  it("قائمةُ السماح ضيّقة، وقاعدةُ التطوير ليست فيها", () => {
    expect(BENCH_DATABASE_NAMES).toEqual(["waslah_bench"]);
    expect(BENCH_DATABASE_NAMES as readonly string[]).not.toContain("waslah");
    expect(BENCH_DATABASE_NAMES as readonly string[]).not.toContain("postgres");
  });

  it("حدُّ ملكيّة القياس فوق أيّ معرّف تيليجرام يُستخدَم في المستودع", () => {
    expect(BENCH_TELEGRAM_ID_MIN).toBe(700_000);
  });
});

function snapshot(
  tables: readonly { table: string; rows: number; digest: string }[],
): StateSnapshot {
  return {
    database: "waslah_bench",
    capturedAt: "2026-01-01T00:00:00.000Z",
    tables: tables.filter((t) => t.table !== "cities"),
    preserved: tables.filter((t) => t.table === "cities"),
    totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
  };
}

describe("مقارنة الحالة", () => {
  it("حالتان متماثلتان ⇒ تطابق", () => {
    const state = snapshot([{ table: "drivers", rows: 20, digest: "aaa" }]);
    expect(compareStates(state, state).identical).toBe(true);
  });

  /** هذا هو العطبُ الذي وُجدت المقارنةُ من أجله: بذرٌ يُضيف بدل أن يُعيد. */
  it("تضخّمُ إعادة البذر يُكتشَف ويُسمَّى بالعدد", () => {
    const result = compareStates(
      snapshot([{ table: "drivers", rows: 20, digest: "aaa" }]),
      snapshot([{ table: "drivers", rows: 40, digest: "bbb" }]),
    );
    expect(result.identical).toBe(false);
    expect(result.differences[0]?.kind).toBe("row_count");
    expect(result.differences[0]?.detail).toContain("20 ← 40");
  });

  it("عددٌ واحدٌ ومحتوىً مختلفٌ يُكتشَف — والعدد وحده لا يحرس", () => {
    const result = compareStates(
      snapshot([{ table: "drivers", rows: 20, digest: "aaa" }]),
      snapshot([{ table: "drivers", rows: 20, digest: "bbb" }]),
    );
    expect(result.identical).toBe(false);
    expect(result.differences[0]?.kind).toBe("content");
  });

  it("جدولٌ ظهر أو اختفى يُكتشَف في الاتّجاهين", () => {
    const withTable = snapshot([{ table: "orders", rows: 5, digest: "aaa" }]);
    const without = snapshot([]);
    expect(compareStates(withTable, without).differences[0]?.kind).toBe("missing_table");
    expect(compareStates(without, withTable).differences[0]?.kind).toBe("extra_table");
  });

  /**
   * الجداولُ المحفوظة تُقارَن كما تُقارَن الجداولُ التشغيليّة: مدينةٌ عُطّلت بين
   * تجربتين تُغيّر النتيجةَ جذريّاً ولا تظهر في أيّ جدولٍ تشغيليّ.
   */
  it("تغيّرُ جدولٍ محفوظٍ (المدن) يُكتشَف ولا يُستثنى", () => {
    const result = compareStates(
      snapshot([{ table: "cities", rows: 5, digest: "aaa" }]),
      snapshot([{ table: "cities", rows: 5, digest: "bbb" }]),
    );
    expect(result.identical).toBe(false);
    expect(result.differences[0]?.table).toBe("cities");
  });
});
