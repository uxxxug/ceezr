/**
 * الغرض: تسجيلُ الراكبِ من التطبيقِ المصغَّرِ — الهويّةُ من الجلسةِ، والمنفذانِ نفساهما (`ADR 0213`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { publicOnboardingCode } from "../../apps/gateway/src/routes/onboarding.ts";
import type {
  CityDirectory,
  RegisterRiderInput,
  RiderDirectory,
} from "../../packages/application/bots/types.ts";
import {
  type OnboardingDeps,
  onboardRider,
  readOnboardingStatus,
} from "../../packages/application/identity/onboard-rider.ts";
import type { ViewerAccount } from "../../packages/application/identity/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = { id: "c-1" as never, code: "MKH", name: "مكة" };

function deps(options: {
  readonly bot?: string;
  readonly account?: ViewerAccount | null;
  readonly sessionOk?: boolean;
  readonly registerFails?: boolean;
}): { readonly deps: OnboardingDeps; readonly registered: RegisterRiderInput[] } {
  const registered: RegisterRiderInput[] = [];
  const riders: RiderDirectory = {
    findByTelegramId: async () => ok(null),
    register: async (input: RegisterRiderInput) => {
      registered.push(input);
      if (options.registerFails) return err({ code: "PORT_FAILURE" } as never);
      return ok({} as never);
    },
  } as unknown as RiderDirectory;
  const cities: CityDirectory = { listActive: async () => ok([CITY]) };
  return {
    registered,
    deps: {
      riders,
      cities,
      viewer: {
        now: () => new Date(),
        sessions: {
          read: async () =>
            options.sessionOk === false
              ? err({ reason: "SIGNATURE_MISMATCH" } as never)
              : ok({
                  telegramUserId: "777",
                  bot: options.bot ?? "rider",
                  sessionId: "s-1",
                  issuedAtSeconds: 1,
                  expiresAtSeconds: 2,
                }),
        } as never,
        accounts: {
          findByTelegramUserId: async () => ok(options.account ?? null),
        } as never,
      },
    },
  };
}

describe("onboardRider", () => {
  it("غيرُ مسجَّلٍ من بوتِ الراكبِ ⇒ يُسجَّلُ بهويّةِ الجلسةِ لا الجسمِ", async () => {
    const h = deps({});
    const result = await onboardRider(
      { accessToken: "tok", fullName: "  محمد  أحمد ", cityId: "c-1", language: "en" },
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(h.registered).toEqual([
      { telegramUserId: "777", cityId: CITY.id, fullName: "محمد أحمد", language: "en" },
    ]);
  });

  it("بلا جلسةٍ ⇒ لا كتابةَ", async () => {
    const h = deps({ sessionOk: false });
    const result = await onboardRider(
      { accessToken: "bad", fullName: "محمد أحمد", cityId: "c-1", language: "ar" },
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(h.registered).toEqual([]);
  });

  it("مسجَّلٌ ⇒ ALREADY_REGISTERED بلا كتابةٍ", async () => {
    const h = deps({
      account: { role: "rider", isBlocked: false, languageCode: "ar" } as ViewerAccount,
    });
    const result = await onboardRider(
      { accessToken: "tok", fullName: "محمد أحمد", cityId: "c-1", language: "ar" },
      h.deps,
    );
    expect(result.ok ? null : result.error.code).toBe("ALREADY_REGISTERED");
    expect(h.registered).toEqual([]);
  });

  it("من بوتِ السائقِ ⇒ ONBOARDING_IN_BOT: تسجيلُ السائقِ لا يُنقَصُ", async () => {
    const h = deps({ bot: "driver" });
    const result = await onboardRider(
      { accessToken: "tok", fullName: "محمد أحمد", cityId: "c-1", language: "ar" },
      h.deps,
    );
    expect(result.ok ? null : result.error.code).toBe("ONBOARDING_IN_BOT");
    expect(h.registered).toEqual([]);
  });

  it("اسمٌ عبثيٌّ ⇒ رمزٌ بسببِه", async () => {
    const h = deps({});
    const result = await onboardRider(
      { accessToken: "tok", fullName: "ههههههه", cityId: "c-1", language: "ar" },
      h.deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(publicOnboardingCode(result.error.code, result.error.reason)).toBe(
        "NAME_LOOKS_LIKE_GIBBERISH",
      );
    }
  });

  it("مدينةٌ غيرُ مفعَّلةٍ ⇒ CITY_NOT_AVAILABLE", async () => {
    const h = deps({});
    const result = await onboardRider(
      { accessToken: "tok", fullName: "محمد أحمد", cityId: "other", language: "ar" },
      h.deps,
    );
    expect(result.ok ? null : result.error.code).toBe("CITY_NOT_AVAILABLE");
  });

  it("لغةٌ غيرُ مدعومةٍ ⇒ ar", async () => {
    const h = deps({});
    await onboardRider(
      { accessToken: "tok", fullName: "محمد أحمد", cityId: "c-1", language: "fr" },
      h.deps,
    );
    expect(h.registered[0]?.language).toBe("ar");
  });

  it("إخفاقُ الكتابةِ ⇒ REGISTRATION_FAILED", async () => {
    const h = deps({ registerFails: true });
    const result = await onboardRider(
      { accessToken: "tok", fullName: "محمد أحمد", cityId: "c-1", language: "ar" },
      h.deps,
    );
    expect(result.ok ? null : result.error.code).toBe("REGISTRATION_FAILED");
  });
});

describe("readOnboardingStatus", () => {
  it("الراكبُ غيرُ المسجَّلِ يرى المدنَ", async () => {
    const result = await readOnboardingStatus("tok", deps({}).deps);
    expect(result.ok && result.value).toEqual({
      audience: "rider",
      registered: false,
      cities: [{ id: "c-1", name: "مكة" }],
    });
  });

  it("السائقُ غيرُ المسجَّلِ ⇒ جمهورُه بلا مدنٍ", async () => {
    const result = await readOnboardingStatus("tok", deps({ bot: "driver" }).deps);
    expect(result.ok && result.value).toEqual({
      audience: "driver",
      registered: false,
      cities: [],
    });
  });
});
