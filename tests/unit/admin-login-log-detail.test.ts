/**
 * الغرض: إثبات أن سطر السجلّ عند فشل الدخول يحمل التفصيل الحقيقي لا النص الثابت
 *   "PORT_FAILURE"، وأن أسباب الفشل الثلاثة تُميَّز بعضها عن بعض في السجلّ.
 * الحالة: منفّذ فعلياً — إصلاح أول عطل إنتاجي (2026-08-09).
 * ينتمي إلى: tests/unit
 *
 * خلفية: فشل الدخول على الإنتاج لأن الهجرات لم تكن مطبَّقة. كان Postgres يقول
 * صراحةً `relation "admin_login_codes" does not exist`، لكن السجلّ يبتلع الرسالة
 * ويطبع "PORT_FAILURE" فقط، فضاعت ساعات في تشخيص عطلٍ كان يُعرّف نفسه.
 */

import { describe, expect, test } from "bun:test";
import { type AdminAuthPort, classifyAuth } from "../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SCHEMA_MISSING = 'relation "admin_login_codes" does not exist';

type LogEntry = { readonly message: string; readonly meta: Record<string, unknown> };

function stubAuth(overrides: Partial<AdminAuthPort> = {}): AdminAuthPort {
  const unused = async (): Promise<never> => {
    throw new Error("لم يكن ينبغي نداؤه في هذا الاختبار");
  };
  return {
    issueCode: unused,
    consumeCode: unused,
    openSession: unused,
    touchSession: unused,
    closeSession: unused,
    ...overrides,
  } as AdminAuthPort;
}

function harness(auth: AdminAuthPort): {
  readonly app: ReturnType<typeof createAdminUiRoutes>;
  readonly logs: LogEntry[];
} {
  const logs: LogEntry[] = [];
  const app = createAdminUiRoutes({
    sql: (() => {
      throw new Error("لا يلمس هذا الاختبار SQL");
    }) as never,
    auth,
    codeSender: { send: async () => true },
    log: (message, meta = {}) => {
      logs.push({ message, meta });
    },
  });
  return { app, logs };
}

async function postCode(app: ReturnType<typeof createAdminUiRoutes>): Promise<Response> {
  const body = new FormData();
  body.set("telegram_id", "123456789");
  return app.request("/login/code", { method: "POST", body });
}

describe("تصنيف فشل مصادقة اللوحة", () => {
  test("عطل المنفذ يحمل التفصيل لا النص الثابت", () => {
    const failure = classifyAuth(
      err(new PortFailureError("rpc.issue_admin_login_code", SCHEMA_MISSING)),
    );

    expect(failure.kind).toBe("db");
    expect(failure.kind === "db" ? failure.reason : "").toContain(SCHEMA_MISSING);
    expect(failure.kind === "db" ? failure.reason : "").toContain("rpc.issue_admin_login_code");
    // الشاهد الأهم: لم يعد النص الثابت وحده
    expect(failure.kind === "db" ? failure.reason : "").not.toBe("PORT_FAILURE");
  });

  test("رفض الأعمال يُصنَّف rejected لا db", () => {
    const failure = classifyAuth(ok({ ok: false as const, error: "NOT_ADMIN" }));

    expect(failure.kind).toBe("rejected");
    expect(failure.kind === "rejected" ? failure.reason : "").toBe("NOT_ADMIN");
  });

  test("النجاح لا يُنتج فشلاً", () => {
    expect(classifyAuth(ok({ ok: true as const, value: 1 })).kind).toBe("ok");
  });
});

describe("سجلّ فشل الدخول يفرّق بين الأسباب", () => {
  test("عطل القاعدة: السطر يذكر القاعدة ويحمل رسالة SQL كاملة", async () => {
    const { app, logs } = harness(
      stubAuth({
        issueCode: async () =>
          err(new PortFailureError("rpc.issue_admin_login_code", SCHEMA_MISSING)),
      }),
    );

    await postCode(app);

    expect(logs).toHaveLength(1);
    const entry = logs[0];
    expect(entry?.message).toBe("admin.login_code_issue_db_error");
    expect(String(entry?.meta.detail)).toContain(SCHEMA_MISSING);
    // لا يكفي أن يُذكر PORT_FAILURE: المطلوب أن يُذكر معه سببه
    expect(JSON.stringify(entry)).not.toMatch(/"PORT_FAILURE"\s*[},]/);
  });

  test("رفض الأعمال: سطر مختلف تماماً لا يذكر عطل القاعدة", async () => {
    const { app, logs } = harness(
      stubAuth({ issueCode: async () => ok({ ok: false as const, error: "NOT_ADMIN" }) }),
    );

    await postCode(app);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("admin.login_code_issue_rejected");
    expect(logs[0]?.message).not.toBe("admin.login_code_issue_db_error");
    expect(logs[0]?.meta.reason).toBe("NOT_ADMIN");
  });

  test("فشل تسليم تلغرام: مميَّز عن الاثنين، والرمز صدر بنجاح", async () => {
    const logs: LogEntry[] = [];
    const app = createAdminUiRoutes({
      sql: (() => {
        throw new Error("لا يلمس هذا الاختبار SQL");
      }) as never,
      auth: stubAuth({
        issueCode: async () =>
          ok({
            ok: true as const,
            value: { telegramId: "123456789", userId: "u1", cityId: "c1", languageCode: "ar" },
          }),
      }),
      codeSender: { send: async () => false },
      log: (message, meta = {}) => {
        logs.push({ message, meta });
      },
    });

    const body = new FormData();
    body.set("telegram_id", "123456789");
    await app.request("/login/code", { method: "POST", body });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("admin.login_code_delivery_failed");
    expect(logs[0]?.meta.stage).toBe("telegram_delivery");
    expect(logs[0]?.message).not.toBe("admin.login_code_issue_db_error");
  });

  test("الرسائل الثلاث متمايزة نصّاً — لا رسالة عامة واحدة", async () => {
    const messages = new Set<string>();

    for (const [auth, sender] of [
      [stubAuth({ issueCode: async () => err(new PortFailureError("p", SCHEMA_MISSING)) }), true],
      [stubAuth({ issueCode: async () => ok({ ok: false as const, error: "NOT_ADMIN" }) }), true],
      [
        stubAuth({
          issueCode: async () =>
            ok({
              ok: true as const,
              value: { telegramId: "1", userId: "u1", cityId: "c1", languageCode: "ar" },
            }),
        }),
        false,
      ],
    ] as const) {
      const logs: LogEntry[] = [];
      const app = createAdminUiRoutes({
        sql: (() => {
          throw new Error("لا يلمس هذا الاختبار SQL");
        }) as never,
        auth,
        codeSender: { send: async () => sender },
        log: (message) => {
          logs.push({ message, meta: {} });
        },
      });
      const body = new FormData();
      body.set("telegram_id", "123456789");
      await app.request("/login/code", { method: "POST", body });
      for (const entry of logs) messages.add(entry.message);
    }

    expect(messages.size).toBe(3);
  });
});
