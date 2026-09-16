/**
 * الغرض: سلوكُ سياقِ الارتباطِ نفسِه (`F8-01`): توليدٌ بشكلٍ معلومٍ، وتوارُثٌ عبرَ
 *    الانتظارِ غيرِ المتزامنِ، وعزلُ شوطينِ متوازيينِ عن بعضِهما، وقراءةٌ لا تُلفِّقُ،
 *    وإلحاقُ المعرِّفِ بسطرِ السجلِّ، وضبطُ المتغيّرِ الجلسيِّ في المعاملةِ **أوّلاً**.
 * الحالة: منفّذ فعلياً — اختبارُ وحدةٍ.
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0129 · البند `F8-01`
 * ملاحظات مستقبلية: وصولُ المعرِّفِ إلى صفٍّ حقيقيٍّ في القاعدةِ يُقاسُ في
 *    `tests/integration/request-correlation.test.ts` على PostgreSQL حقيقيٍّ — لا ههنا:
 *    مُزيَّفٌ يُثبتُ أنَّ الأمرَ أُرسِلَ، والقاعدةُ وحدَها تُثبتُ أنَّه وصلَ.
 */

import { describe, expect, test } from "bun:test";
import { type Sql, withRequestContext } from "../../packages/infrastructure/db/client.ts";
import {
  CORRELATION_ID_SHAPE,
  createCorrelation,
  currentCorrelation,
  currentRequestId,
  isCorrelationId,
  newCorrelationId,
  newWorkerCorrelationId,
  readCorrelationId,
  runWithCorrelation,
  runWithCorrelationId,
  WORKER_CORRELATION_PREFIX,
} from "../../packages/infrastructure/observability/correlation.ts";
import { createStructuredLogger } from "../../packages/infrastructure/observability/structured-log.ts";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** مُزيَّفٌ يسجِّلُ ما أُرسِلَ ويُمرِّرُ `begin` كمعاملةٍ واحدةٍ. */
function fakeSql(): { sql: Sql; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const tagged = async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return [] as unknown[];
  };
  const sql = Object.assign(tagged, {
    begin: (run: (tx: unknown) => unknown) => run(sql),
  }) as unknown as Sql;
  return { sql, calls };
}

describe("سياقُ ارتباطِ الطلبِ — F8-01", () => {
  test("المعرِّفُ المولَّدُ يطابقُ الشكلَ المُعلَنَ", () => {
    const id = newCorrelationId();
    expect(CORRELATION_ID_SHAPE.test(id)).toBe(true);
    expect(isCorrelationId(id)).toBe(true);
  });

  test("معرِّفُ الشوطِ يحملُ بادئتَه فلا يتنكّرُ بمعرِّفِ طلبٍ", () => {
    const id = newWorkerCorrelationId();
    expect(id.startsWith(WORKER_CORRELATION_PREFIX)).toBe(true);
    expect(isCorrelationId(id)).toBe(true);
  });

  test("خارجَ السياقِ لا معرِّفَ — ولا يُولَّدُ واحدٌ بالقراءةِ", () => {
    expect(currentRequestId()).toBeUndefined();
    expect(currentCorrelation()).toBeUndefined();
  });

  test("سياقٌ بمعرِّفٍ فاسدٍ لا يُنشَأُ — والبديلُ لا سياقَ لا سياقٌ مُلفَّقٌ", () => {
    expect(createCorrelation({ requestId: "short", entry: "gateway" })).toBeNull();
    const withBadCausation = createCorrelation({
      requestId: "valid-request-id-1",
      entry: "worker",
      causationId: "!!",
    });
    expect(withBadCausation?.causationId).toBeUndefined();
  });

  test("القراءةُ تردُّ ما خالفَ الشكلَ `null` ولا تُصلِحُه", () => {
    expect(readCorrelationId("ab")).toBeNull();
    expect(readCorrelationId("ok-valid-id-1234")).toBe("ok-valid-id-1234");
    expect(readCorrelationId(null)).toBeNull();
    expect(readCorrelationId(undefined)).toBeNull();
    expect(readCorrelationId(12345678)).toBeNull();
    expect(readCorrelationId("has space in it")).toBeNull();
  });

  test("المعرِّفُ يُتوارَثُ عبرَ الانتظارِ غيرِ المتزامنِ", async () => {
    const correlation = createCorrelation({
      requestId: newCorrelationId(),
      entry: "gateway",
    });
    if (correlation === null) throw new Error("معرِّفٌ مولَّدٌ لا يطابقُ شكلَه — عطبٌ في المولِّدِ");
    const seen = await runWithCorrelation(correlation, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentRequestId();
    });
    expect(seen).toBe(correlation.requestId);
    expect(currentRequestId()).toBeUndefined();
  });

  test("شوطانِ متوازيانِ لا يتبادلانِ معرِّفَيهما", async () => {
    const [first, second] = await Promise.all([
      runWithCorrelationId({ requestId: "first-request-id", entry: "gateway" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentRequestId();
      }),
      runWithCorrelationId({ requestId: "second-request-id", entry: "worker" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentRequestId();
      }),
    ]);
    expect(first).toBe("first-request-id");
    expect(second).toBe("second-request-id");
  });

  test("سياقٌ داخليٌّ يَغلبُ الخارجيَّ ثمَّ يُستعادُ الخارجيُّ", async () => {
    await runWithCorrelationId({ requestId: "outer-request-id", entry: "worker" }, async () => {
      const inner = await runWithCorrelationId(
        { requestId: "inner-request-id", entry: "worker" },
        async () => currentRequestId(),
      );
      expect(inner).toBe("inner-request-id");
      expect(currentRequestId()).toBe("outer-request-id");
    });
  });

  test("`withRequestContext` تضبطُ المتغيّرَ الجلسيَّ أوّلَ أمرٍ في المعاملةِ", async () => {
    const { sql, calls } = fakeSql();
    await runWithCorrelationId({ requestId: "ctx-request-id-1", entry: "gateway" }, () =>
      withRequestContext(sql, (tx) => tx`select claim_ride()`),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("set_config");
    expect(calls[0]?.values).toContain("ctx-request-id-1");
    expect(calls[1]?.text).toContain("claim_ride");
  });

  test("بلا سياقٍ: معاملةٌ تُفتَحُ ولا يُضبَطُ شيءٌ ولا يُلفَّقُ معرِّفٌ", async () => {
    const { sql, calls } = fakeSql();
    await withRequestContext(sql, (tx) => tx`select claim_ride()`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("claim_ride");
    expect(calls.some((call) => call.text.includes("set_config"))).toBe(false);
  });

  test("سطرُ السجلِّ يحملُ المعرِّفَ داخلَ السياقِ ولا يحملُه خارجَه", async () => {
    const lines: string[] = [];
    const log = createStructuredLogger({
      service: "test",
      sink: (line) => {
        lines.push(line);
      },
    });

    log("job.ran", { job: "deliver-notifications" });
    await runWithCorrelationId({ requestId: "log-request-id-01", entry: "gateway" }, async () => {
      log("job.ran", { job: "deliver-notifications" });
    });

    const outside = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const inside = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(outside.request_id).toBeUndefined();
    expect(inside.request_id).toBe("log-request-id-01");
  });

  test("حقلُ موضعِ النداءِ لا يُكتَمُ بالمعرِّفِ المُلحَقِ", async () => {
    const lines: string[] = [];
    const log = createStructuredLogger({
      service: "test",
      sink: (line) => {
        lines.push(line);
      },
    });
    await runWithCorrelationId({ requestId: "ambient-request-id", entry: "worker" }, async () => {
      log("job.ran", { request_id: "explicit-request-id" });
    });
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line.request_id).toBe("explicit-request-id");
  });

  test("رمزُ حدثٍ غيرُ مطابقٍ يُخفِقُ بصوتٍ **وهوَ مُرتبِطٌ**", async () => {
    const lines: string[] = [];
    const log = createStructuredLogger({
      service: "test",
      sink: (line) => {
        lines.push(line);
      },
    });
    await runWithCorrelationId(
      { requestId: "invalid-event-request", entry: "gateway" },
      async () => {
        log("نصٌّ حرٌّ");
      },
    );
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line.event).toBe("log.invalid_event_code");
    expect(line.request_id).toBe("invalid-event-request");
  });
});
