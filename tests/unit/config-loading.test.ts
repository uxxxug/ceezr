/**
 * الغرض: التحقّق أن الإقلاع يرفض بيئة ناقصة ويسمّي كل النواقص لا أولها.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: أي متغير بيئة جديد يُضاف إلى REQUIRED_ENV_KEYS يسقط هذه الاختبارات إن نُسي.
 */
import { describe, expect, it } from "bun:test";
import {
  missingEnvKeys,
  REQUIRED_ENV_KEYS,
  tryLoadConfig,
} from "../../packages/shared/config/index.ts";

const FULL: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.co",
  DATABASE_URL: "postgres://user:pass@db.project.supabase.co:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  DRIVER_BOT_TOKEN: "driver-token",
  RIDER_BOT_TOKEN: "rider-token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

describe("tryLoadConfig", () => {
  it("ينجح ببيئة كاملة ويستخدم المنفذ الافتراضي 3000", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(3000);
    expect(result.value.env).toBe("development");
    expect(result.value.supabaseUrl).toBe("https://project.supabase.co");
  });

  it("يجمع كل المتغيرات الناقصة في خطأ واحد", () => {
    const result = tryLoadConfig({ SUPABASE_URL: FULL.SUPABASE_URL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_ENV_VARS");
    if (result.error.code !== "MISSING_ENV_VARS") return;
    expect([...result.error.keys].sort()).toEqual(
      REQUIRED_ENV_KEYS.filter((k) => k !== "SUPABASE_URL")
        .slice()
        .sort(),
    );
  });

  it("يعتبر القيمة الفراغية ناقصة لا موجودة", () => {
    const result = tryLoadConfig({ ...FULL, DRIVER_BOT_TOKEN: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("DRIVER_BOT_TOKEN");
  });

  it("يرفض منفذاً غير صالح", () => {
    for (const port of ["abc", "0", "70000", "-1"]) {
      const result = tryLoadConfig({ ...FULL, PORT: port });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  it("يرفض رابط Supabase بلا https", () => {
    const result = tryLoadConfig({ ...FULL, SUPABASE_URL: "http://project.supabase.co" });
    expect(result.ok).toBe(false);
  });

  it("يميّز بيئة الإنتاج والاختبار ويردّ ما سواهما إلى التطوير", () => {
    const prod = tryLoadConfig({ ...FULL, NODE_ENV: "production" });
    const test = tryLoadConfig({ ...FULL, NODE_ENV: "test" });
    const weird = tryLoadConfig({ ...FULL, NODE_ENV: "staging" });
    expect(prod.ok && prod.value.env).toBe("production");
    expect(test.ok && test.value.env).toBe("test");
    expect(weird.ok && weird.value.env).toBe("development");
  });

  it("لا يقرأ أي قيمة تجارية من البيئة", () => {
    const contaminated = { ...FULL, SUBSCRIPTION_PRICE: "250", OFFER_TIMEOUT_SECONDS: "45" };
    const result = tryLoadConfig(contaminated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("250");
    expect(JSON.stringify(result.value)).not.toContain("45");
  });
});

describe("missingEnvKeys", () => {
  it("يعيد قائمة فارغة لبيئة كاملة", () => {
    expect(missingEnvKeys(FULL)).toEqual([]);
  });
  it("يعيد كل المفاتيح لبيئة خالية", () => {
    expect(missingEnvKeys({}).length).toBe(REQUIRED_ENV_KEYS.length);
  });
});

describe("DATABASE_URL", () => {
  it("يرفض رابطاً ليس رابط Postgres", () => {
    const result = tryLoadConfig({ ...FULL, DATABASE_URL: "https://db.example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ENV_VAR");
  });

  it("يقبل postgresql:// كما يقبل postgres://", () => {
    const result = tryLoadConfig({
      ...FULL,
      DATABASE_URL: "postgresql://user:pass@host:5432/postgres",
    });
    expect(result.ok).toBe(true);
  });
});
