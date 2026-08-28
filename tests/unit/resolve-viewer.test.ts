/**
 * الغرض: اختبارُ حالةِ استخدامِ تحديدِ الدور (`F1-05`): مَن يُقبَل، ومَن يُرفَض
 *   بأيِّ رمزٍ ظاهر، وأنّ القاعدةَ **لا تُقرأ قبلَ التحقّقِ من التوقيع**، وأنّ
 *   غيابَ الصفِّ حالةٌ تُعاد لا صفٌّ يُكتَب، وأنّ المحجوبَ لا يمرُّ برمزٍ صالحٍ،
 *   وأنّ السجلَّ لا يحمل رمزاً ولا معرّفَ مستخدم.
 * الحالة: اختبار فعلي — يستخدم مُصدِرَ الجلسةِ الحقيقيَّ من `F1-03` بلا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدّلِ و`request-id` ليسا في هذا البندِ فلا يُختبَران.
 *
 * والمُدخلاتُ مُصنَّعةٌ: **المُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخل**.
 */

import { describe, expect, it } from "bun:test";
import type {
  ViewerAccount,
  ViewerAccountReader,
  ViewerLookupFailureReason,
} from "../../packages/application/identity/ports.ts";
import {
  publicViewerCodeFor,
  resolveViewer,
} from "../../packages/application/identity/resolve-viewer.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
  MINIAPP_SESSION_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";

interface ReaderSpy {
  readonly reader: ViewerAccountReader;
  readonly calls: string[];
}

function accountReader(
  outcome: ViewerAccount | null | { readonly failure: ViewerLookupFailureReason },
): ReaderSpy {
  const calls: string[] = [];
  return {
    calls,
    reader: {
      findByTelegramUserId: async (id) => {
        calls.push(id);
        if (outcome !== null && "failure" in outcome) {
          return err({ code: "VIEWER_LOOKUP_FAILED", reason: outcome.failure });
        }
        return ok(outcome);
      },
    },
  };
}

function tokenFor(at: Date = NOW): string {
  const issued = createMiniAppSessionIssuer({ secret: SECRET }).issue(
    { telegramUserId: TELEGRAM_ID, bot: "rider", authDateSeconds: Math.floor(at.getTime() / 1000) },
    at.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

interface Harness {
  readonly deps: Parameters<typeof resolveViewer>[1];
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly reader: ReaderSpy;
}

function harness(
  outcome: ViewerAccount | null | { readonly failure: ViewerLookupFailureReason },
  options: { now?: Date; secret?: string } = {},
): Harness {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const reader = accountReader(outcome);
  const now = options.now ?? NOW;
  return {
    logs,
    reader,
    deps: {
      sessions: createMiniAppSessionReader(options.secret ?? SECRET),
      accounts: reader.reader,
      now: () => now,
      log: (message, meta) => {
        logs.push({ message, meta });
      },
    },
  };
}

describe("تحديد الدور: القبول", () => {
  it("١) دورُ الراكبِ يُعاد من القاعدةِ بحالةٍ نشِطة", async () => {
    const h = harness({ role: "rider", isBlocked: false });
    const result = await resolveViewer({ accessToken: tokenFor() }, h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("متوقَّع نجاح");
    expect(result.value).toEqual({ role: "rider", status: "active" });
    // المعرّفُ المستعملُ في القراءةِ هو المستخرَجُ من الرمزِ الموقَّعِ لا مُدخَلٌ.
    expect(h.reader.calls).toEqual([TELEGRAM_ID]);
  });

  it("٢) دورُ السائقِ يُعاد كما هو ولا يُخفَّض إلى راكب", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ role: "driver", isBlocked: false }).deps,
    );
    expect(result.ok && result.value.role).toBe("driver");
  });

  it("٣) دورُ المشرفِ يُعاد كما هو", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ role: "admin", isBlocked: false }).deps,
    );
    expect(result.ok && result.value.role).toBe("admin");
  });

  it("٤) `support` دورٌ قائمٌ يُعاد صريحاً ولا يُطوى على غيرِه", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ role: "support", isBlocked: false }).deps,
    );
    expect(result.ok && result.value).toEqual({ role: "support", status: "active" });
  });

  it("٥) لا صفَّ في القاعدة = «غير مسجَّل» بلا كتابةٍ وبلا دورٍ مفترَض", async () => {
    const result = await resolveViewer({ accessToken: tokenFor() }, harness(null).deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("متوقَّع نجاح");
    expect(result.value).toEqual({ role: "unknown", status: "unregistered" });
  });

  it("٦) الردُّ حقلان فقط: لا اسمَ ولا هاتفَ ولا مدينةَ ولا معرّفَ جلسة", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ role: "rider", isBlocked: false }).deps,
    );
    if (!result.ok) throw new Error("متوقَّع نجاح");
    expect(Object.keys(result.value).sort()).toEqual(["role", "status"]);
  });
});

describe("تحديد الدور: الرفض", () => {
  it("٧) لا رمزَ = `SESSION_REQUIRED` ولا تُقرأ القاعدةُ إطلاقاً", async () => {
    const h = harness({ role: "rider", isBlocked: false });
    const result = await resolveViewer({ accessToken: undefined }, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("متوقَّع رفض");
    expect(result.error.publicCode).toBe("SESSION_REQUIRED");
    expect(h.reader.calls).toEqual([]);
  });

  it("٨) رمزٌ فارغٌ يُعامَل «لا رمزَ» لا رمزاً باطلاً", async () => {
    const result = await resolveViewer(
      { accessToken: "" },
      harness({ role: "rider", isBlocked: false }).deps,
    );
    expect(result.ok === false && result.error.publicCode).toBe("SESSION_REQUIRED");
  });

  it("٩) رمزٌ مشوَّهٌ = `SESSION_INVALID` بلا قراءةِ قاعدة", async () => {
    const h = harness({ role: "admin", isBlocked: false });
    const result = await resolveViewer({ accessToken: "not-a-token" }, h.deps);

    expect(result.ok === false && result.error.publicCode).toBe("SESSION_INVALID");
    expect(h.reader.calls).toEqual([]);
  });

  it("١٠) توقيعٌ من سرٍّ آخرَ = `SESSION_INVALID` ولا يفتح دوراً", async () => {
    const h = harness(
      { role: "admin", isBlocked: false },
      {
        secret: "another-test-only-secret-9876543210abcd",
      },
    );
    const result = await resolveViewer({ accessToken: tokenFor() }, h.deps);

    expect(result.ok === false && result.error.publicCode).toBe("SESSION_INVALID");
    expect(h.reader.calls).toEqual([]);
  });

  it("١١) رمزٌ منتهٍ = `SESSION_EXPIRED` — يُفرَّق عن الباطلِ ليعرف العميلُ أن يجدّد", async () => {
    const expiredAt = new Date(NOW.getTime() + (MINIAPP_SESSION_TTL_SECONDS + 1) * 1000);
    const h = harness({ role: "rider", isBlocked: false }, { now: expiredAt });
    const result = await resolveViewer({ accessToken: tokenFor() }, h.deps);

    expect(result.ok === false && result.error.publicCode).toBe("SESSION_EXPIRED");
    expect(h.reader.calls).toEqual([]);
  });

  it("١٢) سرٌّ غيرُ مهيّأ = تعطيلٌ معلَنٌ لا تسامح", async () => {
    const h = harness({ role: "rider", isBlocked: false }, { secret: "" });
    const result = await resolveViewer({ accessToken: tokenFor() }, h.deps);

    expect(result.ok === false && result.error.publicCode).toBe("SESSION_NOT_AVAILABLE");
    expect(h.reader.calls).toEqual([]);
  });

  it("١٣) محجوبٌ برمزٍ صالحٍ لا يمرّ — الحجبُ يُفحَص في كلِّ طلب", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ role: "driver", isBlocked: true }).deps,
    );
    expect(result.ok === false && result.error.publicCode).toBe("ACCOUNT_BLOCKED");
  });

  it("١٤) خطأُ قارئٍ = `PROFILE_NOT_AVAILABLE` ولا دورَ يُخترَع", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ failure: "READER_ERROR" }).deps,
    );
    expect(result.ok === false && result.error.publicCode).toBe("PROFILE_NOT_AVAILABLE");
  });

  it("١٥) دورٌ لا يعرفه الكودُ = خطأٌ معلَنٌ لا تخشينٌ إلى راكب", async () => {
    const result = await resolveViewer(
      { accessToken: tokenFor() },
      harness({ failure: "UNSUPPORTED_ROLE" }).deps,
    );
    expect(result.ok === false && result.error.publicCode).toBe("PROFILE_NOT_AVAILABLE");
  });
});

describe("تحديد الدور: الأسرارُ والسجل", () => {
  it("١٦) السجلُّ لا يحمل الرمزَ ولا جزءاً منه", async () => {
    const h = harness({ role: "rider", isBlocked: false });
    const token = tokenFor();
    await resolveViewer({ accessToken: `${token}x` }, h.deps);

    const serialised = JSON.stringify(h.logs);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(token.slice(0, 24));
  });

  it("١٧) سجلُّ الحجبِ لا يحمل معرّفَ تيليجرام", async () => {
    const h = harness({ role: "rider", isBlocked: true });
    await resolveViewer({ accessToken: tokenFor() }, h.deps);

    expect(h.logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.logs)).not.toContain(TELEGRAM_ID);
  });

  it("١٨) الرموزُ الظاهرةُ حتميةٌ: نداءان بمدخلٍ واحدٍ يعطيان الرمزَ نفسَه", async () => {
    const first = await resolveViewer({ accessToken: "bad" }, harness(null).deps);
    const second = await resolveViewer({ accessToken: "bad" }, harness(null).deps);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) throw new Error("متوقَّع رفض");
    expect(first.error).toEqual(second.error);
  });

  it("١٩) خشونةُ الترجمة: ثلاثةُ أسبابٍ داخليةٍ في رمزٍ ظاهرٍ واحد", () => {
    expect(publicViewerCodeFor("MALFORMED")).toBe("SESSION_INVALID");
    expect(publicViewerCodeFor("SIGNATURE_MISMATCH")).toBe("SESSION_INVALID");
    expect(publicViewerCodeFor("UNSUPPORTED_VERSION")).toBe("SESSION_INVALID");
    expect(publicViewerCodeFor("EXPIRED")).toBe("SESSION_EXPIRED");
    expect(publicViewerCodeFor("NOT_CONFIGURED")).toBe("SESSION_NOT_AVAILABLE");
  });
});
