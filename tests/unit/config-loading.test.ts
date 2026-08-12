/**
 * الغرض: التحقّق أن الإقلاع يرفض بيئة ناقصة ويسمّي كل النواقص لا أولها.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: أي متغير بيئة جديد يُضاف إلى REQUIRED_ENV_KEYS يسقط هذه الاختبارات إن نُسي.
 */
import { describe, expect, it } from "bun:test";
import {
  MIN_WEBHOOK_SECRET_LENGTH,
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
    // الإنتاج يفرض حدّاً أدنى لطول سرّ الويبهوك، وموضوع هذا الاختبار قراءة اسم
    // البيئة لا قوّة السرّ، فيُمرَّر سرّ مستوفٍ حتى لا يقيس شيئين معاً.
    const prod = tryLoadConfig({
      ...FULL,
      NODE_ENV: "production",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH),
    });
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

  // سرّ الويبهوك هو الحدّ الوحيد بين محادثة حقيقية وانتحال كامل لهوية أي
  // سائق أو راكب، لأن ما بعده يثق بـ from.id بلا تحقق إضافي.
  describe("قوّة سرّ الويبهوك", () => {
    const STRONG = "a".repeat(MIN_WEBHOOK_SECRET_LENGTH);

    it("يرفض سرّاً أقصر من الحدّ الأدنى في الإنتاج", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH - 1),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      if (result.error.code !== "INVALID_ENV_VAR") return;
      expect(result.error.key).toBe("TELEGRAM_WEBHOOK_SECRET");
    });

    it("يرفض محارف لا يقبلها تلغرام حتى لو طال السرّ", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: `${"س".repeat(MIN_WEBHOOK_SECRET_LENGTH)}`,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      if (result.error.code !== "INVALID_ENV_VAR") return;
      expect(result.error.key).toBe("TELEGRAM_WEBHOOK_SECRET");
    });

    it("يقبل سرّاً مستوفياً في الإنتاج", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: STRONG,
      });
      expect(result.ok).toBe(true);
    });

    // القيد إنتاجي عمداً: التطوير والاختبار يستعملان أسراراً قصيرة مقروءة.
    it("لا يفرض القيد خارج الإنتاج", () => {
      expect(tryLoadConfig({ ...FULL, TELEGRAM_WEBHOOK_SECRET: "short" }).ok).toBe(true);
      expect(
        tryLoadConfig({ ...FULL, NODE_ENV: "test", TELEGRAM_WEBHOOK_SECRET: "short" }).ok,
      ).toBe(true);
    });
  });
});

describe("ضبط الخريطة (المرحلة ١٠)", () => {
  it("الافتراض بلا متغيّرات: none وبلا نمطٍ ولا مفتاح", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapProvider).toBe("none");
    expect(result.value.mapStyleUrl).toBeNull();
    expect(result.value.mapTilesPublicKey).toBeNull();
  });

  it("المتغيّرات الثلاثة تُقرأ فعلاً — كانت تُهمَل كلُّها قبل هذه المرحلة", () => {
    const result = tryLoadConfig({
      ...FULL,
      MAP_PROVIDER: "maplibre",
      MAP_STYLE_URL: "https://tiles.example.org/style.json",
      MAP_TILES_PUBLIC_KEY: "pk-123",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapProvider).toBe("maplibre");
    expect(result.value.mapStyleUrl).toBe("https://tiles.example.org/style.json");
    expect(result.value.mapTilesPublicKey).toBe("pk-123");
  });

  it("مزوّدٌ مجهول يمنع الإقلاع — لا يُقبل بصمتٍ كما كان", () => {
    // `google` مدرجٌ قصداً: كان موعوداً به في `.env.example` ولم يُنفّذ، فمن يضبطه
    // يجب أن يُمنع لا أن يُعطى لوحةً بلا خريطةٍ بلا سبب.
    for (const MAP_PROVIDER of ["leaflet", "google", "mapbox", "مزيّف", "non"]) {
      const result = tryLoadConfig({ ...FULL, MAP_PROVIDER });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  it("تسويةُ الحالة والمسافات مقصودة، وعلى نفس سابقة TRANSLATION_PROVIDER", () => {
    // من يكتب متغيّرات البيئة إنسان، و`MapLibre ` ليس خطأً في النيّة بل في الرسم.
    // ورفضُه كان سيخالف ما يفعله `TRANSLATION_PROVIDER` في نفس الدالّة، فيصير
    // للملفّ قاعدتان مختلفتان لنفس الشيء.
    for (const MAP_PROVIDER of ["MapLibre", "maplibre ", " MAPLIBRE"]) {
      const result = tryLoadConfig({ ...FULL, MAP_PROVIDER });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.mapProvider).toBe("maplibre");
    }
  });

  it("MAP_TILES_URL لم يُعد اسماً معروفاً: اسمٌ واحد لا اسمان", () => {
    // كان `.env.example` يُعلن MAP_TILES_URL و`render.yaml` يُعلن MAP_STYLE_URL،
    // وكلاهما لم يُقرأ. الاسم القانوني الآن MAP_STYLE_URL وحده، وهذا الاختبار
    // يمنع عودةَ الاسم الميت من باب التوافق.
    const result = tryLoadConfig({ ...FULL, MAP_TILES_URL: "https://old.example.org/t.json" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapStyleUrl).toBeNull();
  });

  it("القيم الفارغة أو المسافات تُقرأ null لا نصّاً فارغاً", () => {
    const result = tryLoadConfig({ ...FULL, MAP_STYLE_URL: "   ", MAP_TILES_PUBLIC_KEY: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapStyleUrl).toBeNull();
    expect(result.value.mapTilesPublicKey).toBeNull();
  });
});
