/**
 * الغرض: قياسُ سلوكِ المُصدِرِ الوحيدِ للسجلِّ (`F8-03` · ADR 0078) — شكلُ السطرِ،
 *    وحجبُ الحقولِ الشخصيّةِ في العمقِ لا في السطحِ وحدَه، والكنيةُ المُمَلَّحةُ،
 *    والإخفاقُ بصوتٍ عندَ رمزِ حدثٍ غيرِ مطابقٍ، وأن لا يُسقِطَ السجلُّ مسارَه أبداً.
 * الحالة: منفّذ فعلياً — اختبار وحدة.
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0078 · البند `F8-03`
 * ملاحظات مستقبلية: تصنيفُ الشدّةِ لكلِّ حدثٍ بندٌ آخرُ (`F8-02`) فلا يُقاسُ ههنا.
 */

import { describe, expect, test } from "bun:test";
import {
  createStructuredLogger,
  isPersonalFieldName,
  MAX_ARRAY_ITEMS,
  MAX_FIELD_DEPTH,
  PERSONAL_FIELD_NAMES,
  pseudonym,
  pseudonymise,
  REDACTED,
  TRUNCATED,
} from "../../packages/infrastructure/observability/structured-log.ts";

interface Captured {
  readonly lines: Record<string, unknown>[];
  readonly levels: (string | undefined)[];
}

function harness(salt = "ملحٌ ثابتٌ للقياس"): {
  readonly log: ReturnType<typeof createStructuredLogger>;
  readonly captured: Captured;
} {
  const lines: Record<string, unknown>[] = [];
  const levels: (string | undefined)[] = [];
  const log = createStructuredLogger({
    service: "gateway",
    salt,
    now: () => new Date("2026-09-10T18:00:00.000Z"),
    sink: (line, level) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
      levels.push(level);
    },
  });
  return { log, captured: { lines, levels } };
}

describe("المُصدِرُ الوحيدُ — شكلُ السطرِ", () => {
  test("١) `at` و`service` و`event` في كلِّ سطرٍ، وسطرٌ واحدٌ لا أكثر", () => {
    const { log, captured } = harness();
    log("gateway.started", { port: 8080 });
    expect(captured.lines).toHaveLength(1);
    expect(captured.lines[0]).toEqual({
      at: "2026-09-10T18:00:00.000Z",
      service: "gateway",
      event: "gateway.started",
      port: 8080,
    });
  });

  test("٢) النداءُ المباشرُ **لا يكتبُ شدّةً** — غيابُها أصدقُ من `info` كذباً", () => {
    const { log, captured } = harness();
    log("gateway.started");
    expect(captured.lines[0]).not.toHaveProperty("level");
    expect(captured.levels[0]).toBeUndefined();
  });

  test("٣) `info` و`warn` و`error` تكتبُ شدّتَها وتُبلِّغُ المَصرِفَ بها", () => {
    const { log, captured } = harness();
    log.info("gateway.started");
    log.warn("payment.webhook.untrusted");
    log.error("gateway.boot_config_invalid");
    expect(captured.lines.map((line) => line.level)).toEqual(["info", "warn", "error"]);
    expect(captured.levels).toEqual(["info", "warn", "error"]);
  });

  test("٤) الحقلُ غيرُ المُعرَّفِ يُحذَفُ ولا يُكتَبُ `null` في مكانِه", () => {
    const { log, captured } = harness();
    log("gateway.started", { port: 8080, detail: undefined });
    expect(captured.lines[0]).not.toHaveProperty("detail");
  });

  test("٥) `Error` يُسوَّى إلى رسالةٍ واسمٍ لا إلى `{}`", () => {
    const { log, captured } = harness();
    log.error("gateway.boot_config_invalid", { cause: new TypeError("مفتاحٌ ناقصٌ") });
    expect(captured.lines[0]?.cause).toEqual({ message: "مفتاحٌ ناقصٌ", name: "TypeError" });
  });
});

describe("حجبُ الحقولِ الشخصيّةِ — دفاعٌ في العمقِ لا في السطحِ", () => {
  test("٦) حقلٌ شخصيٌّ في المستوى الأوّلِ يُحجَبُ ويُعلَنُ حجبُه", () => {
    const { log, captured } = harness();
    log("telegram.webhook.secret_mismatch", { bot: "driver", ip: "37.9.1.2" });
    expect(captured.lines[0]?.ip).toBe(REDACTED);
    expect(captured.lines[0]?.redacted).toEqual(["ip"]);
    expect(JSON.stringify(captured.lines[0])).not.toContain("37.9.1.2");
  });

  test("٧) حقلٌ شخصيٌّ **متداخلٌ** يُحجَبُ — لا حجبَ سطحيّاً يُخترَقُ بكائنٍ", () => {
    const { log, captured } = harness();
    log("session.issued", { context: { actor: { telegramId: 771122, bot: "rider" } } });
    const rendered = JSON.stringify(captured.lines[0]);
    expect(rendered).not.toContain("771122");
    expect(rendered).toContain(REDACTED);
    expect(captured.lines[0]?.redacted).toEqual(["telegramId"]);
  });

  test("٨) الحقلُ الشخصيُّ داخلَ مصفوفةٍ يُحجَبُ كذلك", () => {
    const { log, captured } = harness();
    log("admin.broadcast_created", { targets: [{ phone: "0500000000" }, { city: "jeddah" }] });
    expect(JSON.stringify(captured.lines[0])).not.toContain("0500000000");
  });

  test("٩) الاسمُ يُطابَقُ بلا حساسيةِ حالةٍ ولا فرقِ شُرطةٍ سفليّةٍ", () => {
    expect(isPersonalFieldName("phone_number")).toBe(true);
    expect(isPersonalFieldName("PhoneNumber")).toBe(true);
    expect(isPersonalFieldName("TELEGRAM_ID")).toBe(true);
    const { log, captured } = harness();
    log("session.issued", { Phone_Number: "0500000000" });
    expect(captured.lines[0]?.Phone_Number).toBe(REDACTED);
  });

  test("١٠) اسمٌ تشغيليٌّ مشروعٌ لا يُحجَبُ — وإلّا لالتُمِسَ للحاجزِ مخرجٌ", () => {
    for (const name of ["fileName", "jobName", "botName", "cityName", "name_of_job"]) {
      expect(isPersonalFieldName(name)).toBe(false);
    }
    const { log, captured } = harness();
    log("backup.record_no_cities", { fileName: "backup-2026.sql", jobName: "backup" });
    expect(captured.lines[0]?.fileName).toBe("backup-2026.sql");
    expect(captured.lines[0]).not.toHaveProperty("redacted");
  });

  test("١١) القائمةُ مغلقةٌ غيرُ فارغةٍ وتضمُّ العنوانَ والمُعرِّفَ والموضعَ", () => {
    expect(PERSONAL_FIELD_NAMES.length).toBeGreaterThan(10);
    for (const name of ["address", "ip", "actorId", "telegramId", "lat", "lng"]) {
      expect(PERSONAL_FIELD_NAMES).toContain(name);
    }
  });
});

describe("حدودُ التنقيةِ — قصٌّ مُعلَنٌ لا صامتٌ", () => {
  test("١٢) ما تجاوزَ حدَّ العمقِ يُستبدَلُ بعلامةٍ لا يُحذَفُ صامتاً", () => {
    const { log, captured } = harness();
    let deep: Record<string, unknown> = { bottom: "قيمةٌ" };
    for (let i = 0; i < MAX_FIELD_DEPTH + 2; i += 1) deep = { nested: deep };
    log("gateway.started", deep);
    expect(JSON.stringify(captured.lines[0])).toContain(TRUNCATED);
  });

  test("١٣) المصفوفةُ الطويلةُ تُقَصُّ ويُكتَبُ عددُ الباقي", () => {
    const { log, captured } = harness();
    log("gateway.started", { items: Array.from({ length: MAX_ARRAY_ITEMS + 5 }, (_, i) => i) });
    const items = captured.lines[0]?.items as unknown[];
    expect(items).toHaveLength(MAX_ARRAY_ITEMS + 1);
    expect(items[MAX_ARRAY_ITEMS]).toBe("[+5]");
  });

  /**
   * والمقيسُ ههنا **ما يحدثُ فعلاً** لا ما كان يُتوقَّعُ: حدُّ العمقِ يقطعُ الدورةَ
   * قبلَ أن يبلغَها `JSON.stringify` أصلاً، فالسطرُ يُكتَبُ سليماً بعلامةِ العمقِ
   * ولا يُعلَنُ فشلُ تسلسلٍ. وأمّا فرعُ فشلِ التسلسلِ في المُصدِرِ فيبقى حرزاً
   * **غيرَ مقيسٍ** — ولا يُدَّعى أنّه مُختبَرٌ (`ح-5`).
   */
  test("١٤) المرجعُ الدائريُّ لا يُسقِطُ المسارَ ولا يُبتلَعُ السطرُ", () => {
    const { log, captured } = harness();
    const circular: Record<string, unknown> = { label: "دائريٌّ" };
    circular.self = circular;
    expect(() => log.error("gateway.boot_config_invalid", circular)).not.toThrow();
    expect(captured.lines).toHaveLength(1);
    expect(captured.lines[0]?.event).toBe("gateway.boot_config_invalid");
    expect(captured.lines[0]?.label).toBe("دائريٌّ");
    expect(JSON.stringify(captured.lines[0])).toContain(TRUNCATED);
  });
});

describe("رمزُ الحدثِ — إخفاقٌ بصوتٍ بلا تسريبٍ", () => {
  test("١٥) نصٌّ حرٌّ يُرفَضُ ويُعلَنُ بطولِه **لا بنصِّه**", () => {
    const { log, captured } = harness();
    log("رفض تحديث بسرّ غير مطابق من 37.9.1.2", { bot: "driver" });
    expect(captured.lines[0]?.event).toBe("log.invalid_event_code");
    expect(captured.lines[0]?.level).toBe("error");
    expect(captured.lines[0]?.requested_length).toBe(36);
    const rendered = JSON.stringify(captured.lines[0]);
    expect(rendered).not.toContain("37.9.1.2");
    expect(rendered).not.toContain("رفض");
  });

  test("١٦) رمزٌ بلا نقطةٍ أو بحرفٍ كبيرٍ أو بمسافةٍ يُرفَضُ", () => {
    for (const bad of ["gatewaystarted", "Gateway.Started", "gateway started", ".leading", "a."]) {
      const { log, captured } = harness();
      log(bad);
      expect(captured.lines[0]?.event).toBe("log.invalid_event_code");
    }
  });

  test("١٧) الرمزُ المطابقُ يُكتَبُ كما هوَ ولا يُمَسُّ", () => {
    const { log, captured } = harness();
    log("telegram.drainer.sweep_completed");
    expect(captured.lines[0]?.event).toBe("telegram.drainer.sweep_completed");
  });
});

describe("الكنيةُ — ربطٌ بلا ردٍّ إلى الأصلِ", () => {
  test("١٨) الكنيةُ ثابتةٌ للقيمةِ الواحدةِ داخلَ المُسجِّلِ الواحدِ", () => {
    const { log } = harness();
    expect(log.pseudonym("37.9.1.2")).toBe(log.pseudonym("37.9.1.2"));
    expect(log.pseudonym("37.9.1.2")).not.toBe(log.pseudonym("37.9.1.3"));
  });

  test("١٩) الكنيةُ لا تُشبِهُ الأصلَ ولا تحملُ منه شيئاً", () => {
    const { log } = harness();
    const alias = log.pseudonym("37.9.1.2");
    expect(alias).not.toContain("37.9");
    expect(alias).toMatch(/^[0-9a-f]{12}$/);
  });

  test("٢٠) مِلحانِ مختلفانِ ⇦ كنيتانِ مختلفتانِ: التهشيمُ المجرَّدُ مرفوضٌ", () => {
    expect(pseudonym("37.9.1.2", "ملحٌ أوّلُ")).not.toBe(pseudonym("37.9.1.2", "ملحٌ ثانٍ"));
  });

  test("٢١) `pseudonymise` تتّفقُ مع مُسجِّلٍ يأخذُ مِلحَ العمليةِ نفسَه", () => {
    const lines: Record<string, unknown>[] = [];
    const log = createStructuredLogger({
      service: "gateway",
      sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    expect(log.pseudonym("771122")).toBe(pseudonymise("771122"));
    expect(pseudonymise(771122)).toBe(pseudonymise("771122"));
    expect(lines).toHaveLength(0);
  });
});
