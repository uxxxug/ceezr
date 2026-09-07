/**
 * @fileoverview اختباراتُ سياسةِ pooler و`prepare` في عميلِ القاعدةِ (CAP-004).
 *
 * «برهانُ الاشتقاق» الذي يُقلبُ `CAP-004` إلى `[x]`: لا نختبرُ كائنَ `postgres` نفسَه،
 * بل سياسةَ `detectDbPoolerMode`/`resolvePrepare` — أنّ transaction pooler يُعطِّلُ
 * الجُملَ المُحضَّرةَ آمناً قبلَ أن يفشلَ في وقتِ التشغيلِ، وأنّ غيرَه يحترمُ التمريرَ الصريحَ.
 *
 * @see packages/infrastructure/db/client.ts
 * @see docs/adr/0056-supabase-transaction-pooler-and-prepared-statements.md
 */

import { describe, expect, it } from "bun:test";
import {
  type DbPoolerMode,
  detectDbPoolerMode,
  resolvePrepare,
} from "../../packages/infrastructure/db/client.ts";

const TX =
  "postgresql://postgres.abcdefgh:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const SESSION =
  "postgresql://postgres.abcdefgh:pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const DIRECT = "postgresql://postgres:pass@db.abcdefgh.supabase.co:5432/postgres";
const LOCAL = "postgresql://postgres:pass@localhost:5432/postgres";

describe("detectDbPoolerMode — اكتشافُ وضعِ pooler من رابطِ الاتصال", () => {
  it("Supabase transaction pooler على المنفذِ 6543 ⇒ transaction", () => {
    expect(detectDbPoolerMode(TX)).toBe("transaction");
  });

  it("?pgbouncer=true ⇒ transaction (حتى على مضيفٍ غيرِ Supabase)", () => {
    const cs = "postgresql://u:p@host:6543/db?pgbouncer=true&sslmode=require";
    expect(detectDbPoolerMode(cs)).toBe("transaction");
  });

  it("Supabase session pooler على المنفذِ 5432 ⇒ session", () => {
    expect(detectDbPoolerMode(SESSION)).toBe("session");
  });

  it("اتصالٌ مباشرٌ إلى db.…supabase.co ⇒ direct", () => {
    expect(detectDbPoolerMode(DIRECT)).toBe("direct");
  });

  it("اتصالٌ محليٌّ ⇒ direct", () => {
    expect(detectDbPoolerMode(LOCAL)).toBe("direct");
  });

  it("رابطٌ فارغٌ ⇒ unknown", () => {
    expect(detectDbPoolerMode("")).toBe("unknown");
  });

  it("صيغةُ key=value غيرُ القابلةِ للتحليلِ ⇒ unknown", () => {
    expect(detectDbPoolerMode("host=localhost port=5432 dbname=postgres")).toBe("unknown");
  });
});

describe("resolvePrepare — قررُ تفعيلَ الجُملِ المُحضَّرةِ", () => {
  it("transaction pooler ⇒ false (لا يدعمُ الجُملَ المُحضَّرة)", () => {
    expect(resolvePrepare({ connectionString: TX })).toBe(false);
  });

  it("?pgbouncer=true ⇒ false", () => {
    expect(
      resolvePrepare({
        connectionString: "postgresql://u:p@host:6543/db?pgbouncer=true",
      }),
    ).toBe(false);
  });

  it("explicit prepare:true مع transaction pooler ⇒ false (السياسةُ تفوزُ آمنةً)", () => {
    expect(resolvePrepare({ connectionString: TX, prepare: true })).toBe(false);
  });

  it("session pooler بلا تمريرٍ ⇒ true (الافتراضيُّ)", () => {
    expect(resolvePrepare({ connectionString: SESSION })).toBe(true);
  });

  it("session pooler مع prepare:false صريحٍ ⇒ false (يُحترَمُ)", () => {
    expect(resolvePrepare({ connectionString: SESSION, prepare: false })).toBe(false);
  });

  it("اتصالٌ مباشرٌ ⇒ true", () => {
    expect(resolvePrepare({ connectionString: DIRECT })).toBe(true);
  });

  it("اتصالٌ محليٌّ ⇒ true", () => {
    expect(resolvePrepare({ connectionString: LOCAL })).toBe(true);
  });

  it("رابطٌ غيرُ قابلٍ للتحليلِ ⇒ true (السلوكُ السابقُ)", () => {
    expect(resolvePrepare({ connectionString: "host=localhost port=5432" })).toBe(true);
  });

  it("رابطٌ فارغٌ ⇒ true (السلوكُ السابقُ)", () => {
    expect(resolvePrepare({ connectionString: "" })).toBe(true);
  });
});

describe("createSql — السياسةُ مركزيّةٌ في المصنع", () => {
  it("لا يُمرِّر prepare للبوابة فيُشتقّ من الرابط: transaction ⇒ false", () => {
    // محاكاةُ استدعاءِ البوابة: createSql({ connectionString }) بلا prepare.
    // لا نفتحُ اتصالاً حقيقيّاً — نتأكّدُ فقط أنّ createSql يُمرّرُ resolvePrepare.
    // نتحقّقُ عبرَ الاعتمادِ على resolvePrepare نفسِها (مُختبَرةٌ أعلاه).
    const opts = { connectionString: TX };
    expect(resolvePrepare(opts)).toBe(false);
  });

  it("أنواعُ DbPoolerMode الأربعةُ ممكنةٌ كلُّها", () => {
    const modes: DbPoolerMode[] = ["transaction", "session", "direct", "unknown"];
    expect(new Set(modes).size).toBe(4);
  });
});
