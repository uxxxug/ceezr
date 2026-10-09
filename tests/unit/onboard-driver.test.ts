/**
 * الغرض: تسجيلُ السائقِ من التطبيقِ المصغَّرِ (`PRD-105` · `ADR 0257`) — الرقمُ من إثباتِ البوتِ
 *   لا من الجسم، ولا توثيقَ آليّ، والأخطاءُ برموزِها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { publicOnboardingCode } from "../../apps/gateway/src/routes/onboarding.ts";
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
  type DriverPhoneProofs,
  onboardDriver,
} from "../../packages/application/identity/onboard-driver.ts";
import { readOnboardingStatus } from "../../packages/application/identity/onboard-rider.ts";
import type { ViewerAccount } from "../../packages/application/identity/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = { id: "c-1" as never, code: "JED", name: "جدة" };

const VALID = {
  accessToken: "tok",
  fullName: "خالد سالم",
  cityId: "c-1",
  service: "transport",
  vehicleType: "sedan",
  plateNumber: "ABC 1234",
  nationalId: "1012345678",
  language: "ar",
} as const;

function memorySessions(initial?: DialogState): SessionStore & { state: DialogState | null } {
  const store = {
    state: initial ?? null,
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
  return store as SessionStore & { state: DialogState | null };
}

function harness(options: {
  readonly bot?: string;
  readonly account?: ViewerAccount | null;
  readonly phone?: string | null;
  readonly registerError?: unknown;
  readonly proofsFail?: boolean;
}) {
  const registered: RegisterDriverInput[] = [];
  const sessions = memorySessions({ ...INITIAL_STATE, draftPhone: options.phone ?? null });
  const proofs: DriverPhoneProofs = options.proofsFail
    ? {
        read: async () => err({ code: "PORT_FAILURE" } as never),
        clear: async () => ok(undefined),
      }
    : createDriverPhoneProofs(sessions);
  const drivers = {
    findByTelegramId: async () => ok(null),
    register: async (input: RegisterDriverInput) => {
      registered.push(input);
      if (options.registerError !== undefined) return err(options.registerError as never);
      return ok({} as never);
    },
  } as unknown as DriverDirectory;
  const cities: CityDirectory = { listActive: async () => ok([CITY]) };
  const deps: DriverOnboardingDeps = {
    drivers,
    cities,
    phoneProofs: proofs,
    viewer: {
      now: () => new Date(),
      sessions: {
        read: async () =>
          ok({
            telegramUserId: "555",
            bot: options.bot ?? "driver",
            sessionId: "s-1",
            issuedAtSeconds: 1,
            expiresAtSeconds: 2,
          }),
      } as never,
      accounts: { findByTelegramUserId: async () => ok(options.account ?? null) } as never,
    },
  };
  return { deps, registered, sessions };
}

describe("onboardDriver — PRD-105", () => {
  it("مسارٌ كامل: الرقمُ من إثباتِ البوت، والصورةُ null، والإثباتُ يُمحى بعدَ الكتابة", async () => {
    const h = harness({ phone: "+966500000001" });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok && result.value).toEqual({ cityName: "جدة" });
    expect(h.registered).toEqual([
      {
        telegramUserId: "555",
        cityId: CITY.id,
        fullName: "خالد سالم",
        phone: "+966500000001",
        service: "transport",
        language: "ar",
        vehicleType: "sedan",
        plateNumber: "ABC 1234",
        nationalId: "1012345678",
        vehiclePhotoFileId: null,
      },
    ]);
    expect(h.sessions.state?.draftPhone).toBeNull();
  });

  it("رقمٌ وحالةُ توثيقٍ في الجسم ⇒ يُتجاهَلانِ: لا حقلَ توثيقٍ يصلُ المنفذ", async () => {
    const h = harness({ phone: "+966500000001" });
    await onboardDriver(
      { ...VALID, phone: "+966599999999", verificationStatus: "verified" } as never,
      h.deps,
    );
    expect(h.registered[0]?.phone).toBe("+966500000001");
    expect(Object.keys(h.registered[0] ?? {})).not.toContain("verificationStatus");
  });

  it("بلا إثباتِ رقم ⇒ PHONE_NOT_VERIFIED بلا كتابة", async () => {
    const h = harness({ phone: null });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("PHONE_NOT_VERIFIED");
    expect(h.registered).toEqual([]);
  });

  it("من بوتِ الراكب ⇒ WRONG_AUDIENCE بلا كتابة", async () => {
    const h = harness({ bot: "rider", phone: "+966500000001" });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("WRONG_AUDIENCE");
    expect(h.registered).toEqual([]);
  });

  it("مسجَّلٌ ⇒ ALREADY_REGISTERED (إعادةُ المحاولةِ بعدَ النجاح لا تُكرِّر)", async () => {
    const h = harness({
      phone: "+966500000001",
      account: { role: "driver", isBlocked: false, languageCode: "ar" } as ViewerAccount,
    });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("ALREADY_REGISTERED");
    expect(h.registered).toEqual([]);
  });

  it("هويّةٌ مكرَّرةٌ في المدينة ⇒ NATIONAL_ID_TAKEN لا عطلٌ تقنيّ، والإثباتُ يبقى", async () => {
    const h = harness({
      phone: "+966500000001",
      registerError: { code: "PORT_FAILURE", detail: "drivers_city_national_id_uniq" },
    });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("NATIONAL_ID_TAKEN");
    expect(h.sessions.state?.draftPhone).toBe("+966500000001");
  });

  it("عطلُ الكتابة ⇒ REGISTRATION_FAILED", async () => {
    const h = harness({ phone: "+966500000001", registerError: { code: "PORT_FAILURE" } });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("REGISTRATION_FAILED");
  });

  it("عطلُ قراءةِ الإثبات ⇒ REGISTRATION_FAILED بلا كتابة", async () => {
    const h = harness({ proofsFail: true });
    const result = await onboardDriver(VALID, h.deps);
    expect(result.ok ? null : result.error.code).toBe("REGISTRATION_FAILED");
    expect(h.registered).toEqual([]);
  });

  const invalid: readonly [string, Record<string, unknown>, string][] = [
    ["خدمةٌ مجهولة", { service: "both" }, "SERVICE_INVALID"],
    ["مركبةٌ مجهولة", { vehicleType: "tank" }, "VEHICLE_TYPE_INVALID"],
    ["لوحةٌ بلا أرقام", { plateNumber: "ABCD" }, "PLATE_MISSING_DIGITS"],
    ["هويّةٌ ببادئةٍ خاطئة", { nationalId: "3012345678" }, "NATIONAL_ID_BAD_PREFIX"],
    ["هويّةٌ قصيرة", { nationalId: "10123" }, "NATIONAL_ID_BAD_LENGTH"],
    ["اسمٌ قصير", { fullName: "خ" }, "NAME_TOO_SHORT"],
    ["مدينةٌ غيرُ مفعَّلة", { cityId: "other" }, "CITY_NOT_AVAILABLE"],
  ];
  for (const [label, patch, code] of invalid) {
    it(`${label} ⇒ ${code} بلا كتابة`, async () => {
      const h = harness({ phone: "+966500000001" });
      const result = await onboardDriver({ ...VALID, ...patch } as never, h.deps);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(publicOnboardingCode(result.error.code, result.error.reason)).toBe(code);
      }
      expect(h.registered).toEqual([]);
    });
  }
});

describe("readOnboardingStatus — السائق (PRD-105)", () => {
  function statusDeps(phone: string | null) {
    const h = harness({ phone });
    return {
      viewer: h.deps.viewer,
      riders: {} as never,
      cities: h.deps.cities,
      driverPhoneProofs: h.deps.phoneProofs,
    };
  }

  it("سائقٌ غيرُ مسجَّلٍ بلا إثبات ⇒ المدنُ و phoneVerified=false", async () => {
    const result = await readOnboardingStatus("tok", statusDeps(null));
    expect(result.ok && result.value).toEqual({
      audience: "driver",
      registered: false,
      cities: [{ id: "c-1", name: "جدة" }],
      phoneVerified: false,
    });
  });

  it("بعدَ وصولِ البطاقةِ إلى البوت ⇒ phoneVerified=true", async () => {
    const result = await readOnboardingStatus("tok", statusDeps("+966500000001"));
    expect(result.ok && result.value.phoneVerified).toBe(true);
  });
});
