/**
 * الغرض: عقدُ HTTP لمسارِ `POST /v1/onboarding/driver` (`PRD-105` · `ADR 0257`) عبرَ الموجِّهِ
 *   الحقيقيِّ `createOnboardingRoutes` لا عبرَ `onboardDriver` مباشرةً — فيُثبَتُ توصيلُ المسارِ:
 *   رموزُ الحالة، ورفضُ الجسمِ المعطوبِ والكبيرِ قبلَ أيِّ كتابة، والرقمُ من إثباتِ البوتِ لا من
 *   الجسم، وإعادةُ الطلبِ بعدَ النجاحِ لا تُكرِّر، ولا حقلَ توثيقٍ يصلُ منفذَ الكتابة (لا اعتمادَ آليّ).
 * الحالة: منفّذ فعلياً — يسدُّ فجوةَ التغطيةِ: الاختباراتُ القائمةُ تستدعي طبقةَ التطبيقِ وحدَها.
 * ينتمي إلى: tests/unit
 * ملاحظات: بلا قاعدةٍ ولا شبكة؛ لا سجلَّ إنتاجيّ. سلوكُ القاعدةِ (pending · التزامن) في
 *   `tests/integration/driver-onboarding-miniapp.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import { createOnboardingRoutes } from "../../apps/gateway/src/routes/onboarding.ts";
import {
  type CityDirectory,
  type DialogState,
  type DriverDirectory,
  INITIAL_STATE,
  type RegisterDriverInput,
  type SessionStore,
} from "../../packages/application/bots/types.ts";
import {
  createDriverPhoneProofs,
  type DriverOnboardingDeps,
} from "../../packages/application/identity/onboard-driver.ts";
import type { ViewerAccount } from "../../packages/application/identity/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const TOKEN = "tok-driver";
const CITY = { id: "c-1" as never, code: "JED", name: "جدة" };
const BODY = {
  fullName: "خالد سالم",
  cityId: "c-1",
  service: "transport",
  vehicleType: "sedan",
  plateNumber: "ABC 1234",
  nationalId: "1012345678",
  language: "ar",
};

function harness(options: { readonly bot?: string; readonly phone?: string | null } = {}) {
  const registered: RegisterDriverInput[] = [];
  const store = {
    state: { ...INITIAL_STATE, draftPhone: options.phone ?? null } as DialogState | null,
    load: async () => ok(store.state),
    save: async (_id: string, next: DialogState) => {
      store.state = next;
      return ok(undefined);
    },
    clear: async () => {
      store.state = null;
      return ok(undefined);
    },
  };
  // الحسابُ يصيرُ «سائقاً» بعدَ أوّلِ كتابةٍ ناجحة — فيُختبَرُ تكرارُ الطلبِ كما في الحقيقة.
  let account: ViewerAccount | null = null;
  const drivers = {
    findByTelegramId: async () => ok(null),
    register: async (input: RegisterDriverInput) => {
      registered.push(input);
      account = { role: "driver", isBlocked: false, languageCode: "ar" } as ViewerAccount;
      return ok({} as never);
    },
  } as unknown as DriverDirectory;
  const cities: CityDirectory = { listActive: async () => ok([CITY]) };
  const deps: DriverOnboardingDeps = {
    drivers,
    cities,
    phoneProofs: createDriverPhoneProofs(store as unknown as SessionStore),
    viewer: {
      now: () => new Date(),
      sessions: {
        read: async (token: string) =>
          token === TOKEN
            ? ok({
                telegramUserId: "555",
                bot: options.bot ?? "driver",
                sessionId: "s-1",
                issuedAtSeconds: 1,
                expiresAtSeconds: 2,
              })
            : err({ code: "SESSION_INVALID" } as never),
      } as never,
      accounts: { findByTelegramUserId: async () => ok(account) } as never,
    },
  };
  const app = createOnboardingRoutes({ driverOnboarding: deps });
  const post = (body: string, headers: Record<string, string> = {}) =>
    app.request("/v1/onboarding/driver", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
      body,
    });
  return { app, post, registered, store };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /v1/onboarding/driver — عقدُ HTTP (PRD-105)", () => {
  it("بلا رأسِ مصادقة ⇒ 401 SESSION_REQUIRED بلا كتابة", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.app.request("/v1/onboarding/driver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ ok: false, error: "SESSION_REQUIRED" });
    expect(h.registered).toEqual([]);
  });

  it("رمزٌ غيرُ صالح ⇒ 401 بلا كتابة", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post(JSON.stringify(BODY), { authorization: "Bearer forged" });
    expect(res.status).toBe(401);
    expect(h.registered).toEqual([]);
  });

  it("JSON معطوب ⇒ 400 INVALID_BODY بلا كتابة", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post("xxxxx");
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: "INVALID_BODY" });
    expect(h.registered).toEqual([]);
  });

  it("مصفوفةٌ بدلَ كائن ⇒ 400 INVALID_BODY", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post("[]");
    expect(res.status).toBe(400);
    expect(h.registered).toEqual([]);
  });

  it("طولٌ مُعلَنٌ فوقَ الحدّ ⇒ 413 PAYLOAD_TOO_LARGE قبلَ القراءة", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post(JSON.stringify(BODY), { "content-length": "4096" });
    expect(res.status).toBe(413);
    expect(h.registered).toEqual([]);
  });

  it("حقلٌ غيرُ صالح ⇒ 400 برمزِ السبب بلا كتابة", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post(JSON.stringify({ ...BODY, plateNumber: "ABCD" }));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: "PLATE_MISSING_DIGITS" });
    expect(h.registered).toEqual([]);
  });

  it("بلا إثباتِ رقمٍ من بطاقةِ تيليجرام ⇒ 409 PHONE_NOT_VERIFIED — ورقمُ الجسمِ لا يُغني", async () => {
    const h = harness({ phone: null });
    const res = await h.post(JSON.stringify({ ...BODY, phone: "+966599999999" }));
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ ok: false, error: "PHONE_NOT_VERIFIED" });
    expect(h.registered).toEqual([]);
  });

  it("جلسةُ بوتِ الراكب ⇒ 409 WRONG_AUDIENCE بلا كتابة", async () => {
    const h = harness({ bot: "rider", phone: "+966500000001" });
    const res = await h.post(JSON.stringify(BODY));
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ ok: false, error: "WRONG_AUDIENCE" });
    expect(h.registered).toEqual([]);
  });

  it("نجاح ⇒ 201 pending؛ الرقمُ من الإثبات، وحقولُ التوثيقِ والدورِ في الجسمِ لا تصلُ المنفذ", async () => {
    const h = harness({ phone: "+966500000001" });
    const res = await h.post(
      JSON.stringify({
        ...BODY,
        phone: "+966599999999",
        verificationStatus: "verified",
        verification_status: "verified",
        role: "admin",
        isAvailable: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ ok: true, cityName: "جدة", verification: "pending" });
    expect(h.registered).toHaveLength(1);
    const written = h.registered[0] ?? ({} as RegisterDriverInput);
    expect(written.phone).toBe("+966500000001");
    const keys = Object.keys(written);
    for (const forbidden of ["verificationStatus", "verification_status", "role", "isAvailable"]) {
      expect(keys).not.toContain(forbidden);
    }
    // الإثباتُ يُمحى بعدَ النجاح: لا يُعادُ استعمالُه.
    expect(h.store.state?.draftPhone ?? null).toBeNull();
  });

  it("تكرارُ الطلبِ بعدَ النجاح ⇒ 409 ALREADY_REGISTERED وكتابةٌ واحدةٌ فقط", async () => {
    const h = harness({ phone: "+966500000001" });
    const first = await h.post(JSON.stringify(BODY));
    expect(first.status).toBe(201);
    const second = await h.post(JSON.stringify(BODY));
    expect(second.status).toBe(409);
    expect(await json(second)).toEqual({ ok: false, error: "ALREADY_REGISTERED" });
    expect(h.registered).toHaveLength(1);
  });

  it("المسارُ غيرُ موصول (لا تبعيّة) ⇒ 503 SESSION_NOT_AVAILABLE لا تسجيلٌ بلا إثبات", async () => {
    const app = createOnboardingRoutes({});
    const res = await app.request("/v1/onboarding/driver", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(BODY),
    });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ ok: false, error: "SESSION_NOT_AVAILABLE" });
  });
});
