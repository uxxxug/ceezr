/**
 * الغرض: إثباتُ أنّ حاجزَ دليلِ Redis الحقيقيِّ **يسقط** حيث يجب أن يسقط — بحقنِ
 *   خرقٍ لكلِّ قاعدةٍ فيه: مزدوجٌ بدلَ عميلٍ حقيقيٍّ، فحصٌ ناقصٌ، أوامرُ أقلُّ من
 *   الحدِّ المقيسِ، مفتاحٌ متروكٌ، وسرٌّ ظهرَ في الدليلِ.
 * الحالة: منفّذ فعلياً — `OPS-006` (ADR 0049).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على `scripts/lib/real-redis-proof.ts`.
 * ملاحظات مستقبلية: الحكمُ ههنا بعددِ المخالفاتِ ووجودِها لا بنصِّها حيثُ أمكن، حتى
 *   لا يصير الاختبارُ حارساً على صياغةٍ عربيّةٍ فيُعاق تحسينُ الرسالةِ.
 *
 * وأمّا الحاجزُ نفسُه فيُختبَر برمزِ خروجِه في `tests/unit/scripts-exit.test.ts`؟ لا —
 * بل ههنا بمنطقِه، ويُختبَر رمزُ خروجِ الملفِّ الرقيقِ في آخرِ هذا الملفِّ بتشغيلِه على
 * ملفَّي دليلٍ: سليمٍ فيخرج صفراً، ومخروقٍ فيخرج واحداً. فالحكمُ برمزِ الخروجِ لا بنصٍّ.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditRealRedisProof,
  MIN_REAL_COMMANDS,
  REQUIRED_CHECKS,
  type RealRedisProof,
  redactSecrets,
} from "../../scripts/lib/real-redis-proof.ts";

const SOUND: RealRedisProof = {
  producedAt: "2026-08-30T12:00:00.000Z",
  runId: "33300000000:1",
  usedRealClient: true,
  commandsIssued: MIN_REAL_COMMANDS + 7,
  checks: [...REQUIRED_CHECKS],
  keyPrefix: "waslah:citest:33300000000:1:ab12cd34",
  keysLeftBehind: 0,
};

describe("حاجزُ دليلِ Redis الحقيقيِّ", () => {
  it("يمرّ دليلٌ سليمٌ بلا مخالفةٍ واحدةٍ", () => {
    expect(auditRealRedisProof(SOUND)).toEqual([]);
  });

  it("يسقط حين لا يُصرَّح باستعمالِ عميلٍ حقيقيٍّ", () => {
    expect(auditRealRedisProof({ ...SOUND, usedRealClient: false })).not.toEqual([]);
    expect(auditRealRedisProof({ ...SOUND, usedRealClient: undefined })).not.toEqual([]);
  });

  it("يسقط حين تقلّ الأوامرُ الصادرةُ عن الحدِّ المقيسِ", () => {
    expect(auditRealRedisProof({ ...SOUND, commandsIssued: MIN_REAL_COMMANDS - 1 })).not.toEqual(
      [],
    );
    expect(auditRealRedisProof({ ...SOUND, commandsIssued: 0 })).not.toEqual([]);
    expect(auditRealRedisProof({ ...SOUND, commandsIssued: MIN_REAL_COMMANDS })).toEqual([]);
  });

  it("يسقط حين ينقص فحصٌ واحدٌ من القائمةِ المطلوبةِ — أيُّ فحصٍ كان", () => {
    for (const missing of REQUIRED_CHECKS) {
      const checks = REQUIRED_CHECKS.filter((name) => name !== missing);
      const violations = auditRealRedisProof({ ...SOUND, checks });
      expect(violations.some((line) => line.includes(missing))).toBe(true);
    }
  });

  it("يسقط حين يُعلَن فحصٌ خارجَ القائمةِ المغلقةِ أو مكرَّرٌ", () => {
    expect(auditRealRedisProof({ ...SOUND, checks: [...REQUIRED_CHECKS, "شيءٌ آخرُ"] })).not.toEqual(
      [],
    );
    const duplicated = [...REQUIRED_CHECKS, REQUIRED_CHECKS[0] ?? ""];
    expect(auditRealRedisProof({ ...SOUND, checks: duplicated })).not.toEqual([]);
  });

  it("يسقط حين يُترَك مفتاحٌ في الخادمِ بعدَ التشغيلِ", () => {
    expect(auditRealRedisProof({ ...SOUND, keysLeftBehind: 1 })).not.toEqual([]);
  });

  it("يسقط حين يخلو الدليلُ من بادئةٍ أو معرّفِ تشغيلٍ أو زمنٍ", () => {
    expect(auditRealRedisProof({ ...SOUND, keyPrefix: "" })).not.toEqual([]);
    expect(auditRealRedisProof({ ...SOUND, runId: "  " })).not.toEqual([]);
    expect(auditRealRedisProof({ ...SOUND, producedAt: "ليس زمناً" })).not.toEqual([]);
  });

  it("يسقط حين يكون الدليلُ غيرَ كائنٍ", () => {
    expect(auditRealRedisProof(null)).not.toEqual([]);
    expect(auditRealRedisProof([SOUND])).not.toEqual([]);
    expect(auditRealRedisProof("دليلٌ")).not.toEqual([]);
  });

  describe("كتمُ السرِّ شرطٌ في الدليلِ نفسِه", () => {
    it("يسقط حين يظهر رابطٌ في أيِّ حقلٍ نصّيٍّ", () => {
      expect(
        auditRealRedisProof({ ...SOUND, keyPrefix: "https://example.upstash.io" }),
      ).not.toEqual([]);
      expect(auditRealRedisProof({ ...SOUND, runId: "rediss://host:6379" })).not.toEqual([]);
    });

    it("يسقط حين تظهر سلسلةٌ طويلةٌ تُشبِه رمزَ تصريحٍ، أو ترويسةُ تصريحٍ", () => {
      const tokenish = "AX4hASQgYmM2ZDk5NzQtMWY0OS00YjNjLWJhNzQ";
      expect(auditRealRedisProof({ ...SOUND, keyPrefix: tokenish })).not.toEqual([]);
      expect(auditRealRedisProof({ ...SOUND, runId: "Bearer x" })).not.toEqual([]);
      expect(auditRealRedisProof({ ...SOUND, checks: [...REQUIRED_CHECKS, tokenish] })).not.toEqual(
        [],
      );
    });

    it("الكاتمُ يُبدِل النقطةَ والرمزَ ولا يترك أثراً منهما في النصِّ", () => {
      const url = "https://real-endpoint-name.upstash.io";
      const token = "AX4hASQgYmM2ZDk5NzQtMWY0OS00YjNjLWJhNzQ";
      const message = `fetch failed to ${url} with ${token}`;
      const clean = redactSecrets(message, [url, token]);
      expect(clean).not.toContain("upstash.io");
      expect(clean).not.toContain(token);
      expect(clean).not.toContain("https://");
      // ويبقى النصُّ مقروءاً: القارئُ يعرف أنّ ههنا كُتِم شيءٌ فلا يظنّ الرسالةَ ناقصةً.
      expect(clean).toContain("«");
    });

    it("الكاتمُ يعمل على رسالةٍ لا يُمرَّر إليها السرُّ صريحاً", () => {
      const clean = redactSecrets(
        "connect ECONNREFUSED https://a-very-secret-host.example/pipeline",
      );
      expect(clean).not.toContain("a-very-secret-host");
    });
  });

  describe("رمزُ خروجِ الحاجزِ لا نصُّه", () => {
    const runBarrier = async (proof: unknown): Promise<number> => {
      const dir = mkdtempSync(join(tmpdir(), "real-redis-proof-"));
      const path = join(dir, "proof.json");
      writeFileSync(path, typeof proof === "string" ? proof : JSON.stringify(proof));
      const child = Bun.spawn(["bun", "scripts/check-real-redis-proof.ts", path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      return await child.exited;
    };

    it("يخرج صفراً على دليلٍ سليمٍ وواحداً على مخروقٍ أو غائبٍ أو غيرِ مقروءٍ", async () => {
      expect(await runBarrier(SOUND)).toBe(0);
      expect(await runBarrier({ ...SOUND, usedRealClient: false })).toBe(1);
      expect(await runBarrier("{ليس JSON")).toBe(1);

      const missing = Bun.spawn(
        ["bun", "scripts/check-real-redis-proof.ts", "/tmp/لا-يوجد-دليل-قط.json"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await missing.exited).toBe(1);
    }, 30_000);
  });
});
