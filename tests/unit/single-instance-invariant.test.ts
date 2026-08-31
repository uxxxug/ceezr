/**
 * الغرض: إثباتُ أنّ شرطَ صحّةِ النسخةِ الواحدةِ (`R-17` · ADR 0050) يُفشِل الإقلاعَ
 *    فعلاً لا في تعليقٍ، وأنّ رسالتَه لا تكشف سرّاً.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI (`bun run test`).
 * ملاحظات مستقبلية: يومَ تُقرَّر آليةُ توزيعٍ تعبر العمليةَ يُضاف لها فرعٌ ههنا،
 *    ولا يُحذَف الفرعُ القائمُ إلّا بـADR ناسخٍ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DECIDED_EVENT_DISTRIBUTION,
  EVENT_DISTRIBUTION_MECHANISMS,
  singleInstanceInvariantViolation,
} from "../../packages/shared/config/single-instance.ts";

/**
 * قيمٌ صناعيّةٌ تُشبه الأسرارَ شكلاً ولا تُصيب شيئاً حقيقيّاً. غرضُها أن تُبحَث في
 * مخرجِ الإقلاعِ: حضورُ واحدةٍ منها فيه كشفُ سرٍّ.
 */
const FAKE_SECRETS = {
  DATABASE_URL: "postgres://fake_user:fakepassword123@127.0.0.1:5432/fake_db",
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-AAAAAAAAAAAAAAAAAAAA",
  UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token-BBBBBBBBBBBBBBBBBBBB",
  DRIVER_BOT_TOKEN: "1111111:fake-driver-bot-token-CCCCCCCCCCCC",
  RIDER_BOT_TOKEN: "2222222:fake-rider-bot-token-DDDDDDDDDDDD",
  TELEGRAM_WEBHOOK_SECRET: "fake-webhook-secret-EEEEEEEEEEEEEEEE",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "999999999",
} as const;

describe("شرطُ صحّةِ النسخةِ الواحدةِ — الحكمُ النقيُّ", () => {
  it("يقبل الطوبولوجيا المُعلَنةَ عمليةً واحدةً", () => {
    expect(
      singleInstanceInvariantViolation({
        sessionStore: "memory",
        distribution: DECIDED_EVENT_DISTRIBUTION,
      }),
    ).toBeNull();
  });

  it("يرفض طوبولوجيا متعدّدةَ العملياتِ مع ناقلٍ لا يعبر العمليةَ", () => {
    const violation = singleInstanceInvariantViolation({
      sessionStore: "redis",
      distribution: "in-process",
    });
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe("SINGLE_INSTANCE_INVARIANT");
    expect(violation?.name).toBe("SingleInstanceInvariantError");
    expect(violation).toBeInstanceOf(Error);
  });

  it("الرسالةُ تُسمّي البندَ والقرارَ والإصلاحَ — لا رمزاً غامضاً", () => {
    const violation = singleInstanceInvariantViolation({
      sessionStore: "redis",
      distribution: "in-process",
    });
    const message = violation?.message ?? "";
    expect(message).toContain("R-17");
    expect(message).toContain("ADR 0050");
    expect(message).toContain("SESSION_STORE");
    expect(message).toContain("numInstances");
  });

  /**
   * القرارُ ثابتٌ في الشيفرةِ لا متغيّرُ بيئةٍ: من جعله متغيّراً جعل شرطَ الصحّةِ
   * قابلاً للإطفاءِ من لوحةِ تحكّمٍ، وهو عينُ ما يُعالجه `R-17`.
   */
  it("آليةُ التوزيعِ المُقرَّرةُ واحدةٌ ولا محوِّلَ اختِير", () => {
    expect(EVENT_DISTRIBUTION_MECHANISMS).toEqual(["in-process"]);
    expect(DECIDED_EVENT_DISTRIBUTION).toBe("in-process");
  });

  it("مُدخلُ الحكمِ لا يحمل سرّاً — قيدُ نوعٍ لا اتفاقٌ", () => {
    const source = readFileSync("packages/shared/config/single-instance.ts", "utf8");
    // لا `process.env` ولا قراءةَ بيئةٍ في وحدةِ الحكمِ: الضبطُ يُمرَّر إليها.
    expect(source).not.toContain("process.env");
    for (const key of Object.keys(FAKE_SECRETS)) {
      if (key === "SESSION_STORE") continue;
      expect(source).not.toContain(`${key}:`);
    }
  });
});

describe("نقطةُ إقلاعِ البوابةِ — سقوطٌ حقيقيٌّ برمزِ خروجٍ", () => {
  /**
   * تشغيلٌ فعليٌّ لنقطةِ الإقلاعِ ببيئةٍ صناعيّةٍ كاملةٍ. ولا يُصيب هذا التشغيلُ
   * قاعدةً ولا Redis ولا تيليجرام: الفحصُ يسبق تركيبَ أيِّ محوِّلٍ، فالخروجُ يقع
   * قبلَ أوّلِ اتّصالٍ. وهذا رمزُ خروجٍ لا نصٌّ — والنصُّ يُقرَأ للتحقّقِ من عدمِ
   * كشفِ سرٍّ لا للحكمِ على النجاح.
   */
  const bootGateway = async (
    sessionStore: string,
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
    const child = Bun.spawn(["bun", "apps/gateway/src/index.ts"], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        SESSION_STORE: sessionStore,
        ...FAKE_SECRETS,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await child.exited;
    return {
      exitCode,
      stderr: await new Response(child.stderr).text(),
      stdout: await new Response(child.stdout).text(),
    };
  };

  it("SESSION_STORE=redis مع ناقلٍ داخلَ العمليةِ ⇒ إقلاعٌ يفشل برمزٍ غيرِ صفريٍّ", async () => {
    const result = await bootGateway("redis");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SINGLE_INSTANCE_INVARIANT");
  }, 60_000);

  it("رسالةُ الفشلِ لا تتضمّن قيمةَ سرٍّ واحدةً", async () => {
    const result = await bootGateway("redis");
    const output = `${result.stderr}\n${result.stdout}`;
    for (const value of Object.values(FAKE_SECRETS)) {
      if (value === FAKE_SECRETS.BOOTSTRAP_ADMIN_TELEGRAM_ID) continue;
      expect(output).not.toContain(value);
    }
    expect(output).not.toContain("fakepassword123");
  }, 60_000);
});
