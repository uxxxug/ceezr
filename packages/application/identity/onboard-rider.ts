/**
 * الغرض: تسجيلُ الراكبِ من التطبيقِ المصغَّرِ — الاسمُ والمدينةُ، بالمنفذَين نفسَيهما اللذَين
 *   يسجّلُ بهما حوارُ البوتِ (`RiderDirectory.register` · `CityDirectory.listActive`)؛ فلا
 *   مصدرَ ثانياً لقواعدِ التسجيلِ (`ADR 0213` · `DEC-22`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/onboarding.ts
 *
 * ## الحدودُ
 *
 * - **الهويّةُ من الرمزِ لا من الطلبِ.** معرّفُ تيليجرامَ والبوتُ الموقِّعُ يُقرآنِ من الجلسةِ
 *   الموقَّعةِ (`authorizeViewer`)؛ الطلبُ يحملُ الاسمَ والمدينةَ فقط.
 * - **الراكبُ وحدَه.** تسجيلُ السائقِ يحتاجُ إثباتَ ملكيّةِ الرقمِ ببطاقةِ جهةِ اتصالِ تيليجرامَ
 *   وصورةَ المركبةِ، ولا بديلَ مبنيٌّ لهما في التطبيقِ بعدُ — فيُعادُ `ONBOARDING_IN_BOT` صريحاً
 *   لا تسجيلٌ ناقصٌ.
 * - **الدورُ لا يُقبَلُ من الطلبِ** (`check-viewer-role-authority`): الدورُ نتيجةُ الكتابةِ في
 *   القاعدةِ، يقرؤه التطبيقُ بعدَها من `GET /v1/me` كما في كلِّ إقلاعٍ.
 * - **لا تسجيلَ ثانٍ.** من له حسابٌ يُردُّ بـ`ALREADY_REGISTERED`؛ وسباقُ طلبَين متزامنَين يحسمُه
 *   قيدُ التفرّدِ في القاعدةِ عبرَ `register` نفسِه (الحوارُ القديمُ يعتمدُ عليه كذلك).
 */

import { parseFullName } from "../../domain/identity/value-objects.ts";
import { MINIAPP_LANGUAGES } from "../../shared/i18n/miniapp/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { CityDirectory, CityRef, RiderDirectory } from "../bots/types.ts";
import {
  type AuthorizedViewer,
  authorizeViewer,
  type ResolveViewerDeps,
  type ViewerPublicErrorCode,
} from "./resolve-viewer.ts";

export interface OnboardingDeps {
  readonly viewer: ResolveViewerDeps;
  readonly riders: RiderDirectory;
  readonly cities: CityDirectory;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export type OnboardingAudience = "rider" | "driver";

export type OnboardingErrorCode =
  | ViewerPublicErrorCode
  | "ALREADY_REGISTERED"
  | "ONBOARDING_IN_BOT"
  | "NAME_INVALID"
  | "CITY_NOT_AVAILABLE"
  | "CITIES_NOT_AVAILABLE"
  | "REGISTRATION_FAILED";

export interface OnboardingError {
  readonly code: OnboardingErrorCode;
  /** سببُ رفضِ الاسمِ — يُعرَضُ نصُّه المترجَمُ في التطبيقِ. */
  readonly reason?: string;
}

export interface OnboardingStatus {
  readonly audience: OnboardingAudience;
  readonly registered: boolean;
  /** المدنُ المفعَّلةُ — للراكبِ غيرِ المسجَّلِ وحدَه، وإلّا فارغةٌ. */
  readonly cities: readonly { readonly id: string; readonly name: string }[];
}

function audienceOf(viewer: AuthorizedViewer): OnboardingAudience {
  return viewer.bot === "driver" ? "driver" : "rider";
}

function publicCities(cities: readonly CityRef[]): OnboardingStatus["cities"] {
  return cities.map((city) => ({ id: String(city.id), name: city.name }));
}

/** ما يحتاجُه التطبيقُ ليعرضَ شاشةَ التسجيلِ: الجمهورُ، وهل سُجِّلَ، والمدنُ. */
export async function readOnboardingStatus(
  accessToken: string | undefined,
  deps: OnboardingDeps,
): Promise<Result<OnboardingStatus, OnboardingError>> {
  const viewer = await authorizeViewer({ accessToken }, deps.viewer);
  if (!viewer.ok) return err({ code: viewer.error.publicCode });
  const audience = audienceOf(viewer.value);
  const registered = viewer.value.status !== "unregistered";
  if (registered || audience === "driver") return ok({ audience, registered, cities: [] });
  const cities = await deps.cities.listActive();
  if (!cities.ok) return err({ code: "CITIES_NOT_AVAILABLE" });
  return ok({ audience, registered, cities: publicCities(cities.value) });
}

export interface OnboardRiderInput {
  readonly accessToken: string | undefined;
  readonly fullName: unknown;
  readonly cityId: unknown;
  readonly language: unknown;
}

export async function onboardRider(
  input: OnboardRiderInput,
  deps: OnboardingDeps,
): Promise<Result<{ readonly cityName: string }, OnboardingError>> {
  const viewer = await authorizeViewer({ accessToken: input.accessToken }, deps.viewer);
  if (!viewer.ok) return err({ code: viewer.error.publicCode });
  if (viewer.value.status !== "unregistered") return err({ code: "ALREADY_REGISTERED" });
  if (audienceOf(viewer.value) !== "rider") return err({ code: "ONBOARDING_IN_BOT" });

  const name = parseFullName(typeof input.fullName === "string" ? input.fullName : "");
  if (!name.ok) return err({ code: "NAME_INVALID", reason: name.error.reason });

  const cities = await deps.cities.listActive();
  if (!cities.ok) return err({ code: "CITIES_NOT_AVAILABLE" });
  const city = cities.value.find((candidate) => String(candidate.id) === input.cityId);
  if (city === undefined) return err({ code: "CITY_NOT_AVAILABLE" });

  const language =
    typeof input.language === "string" &&
    (MINIAPP_LANGUAGES as readonly string[]).includes(input.language)
      ? input.language
      : "ar";

  const registered = await deps.riders.register({
    telegramUserId: viewer.value.telegramUserId,
    cityId: city.id,
    fullName: name.value,
    language,
  });
  if (!registered.ok) {
    deps.log?.("onboarding.rider_register_failed", { sessionId: viewer.value.sessionId });
    return err({ code: "REGISTRATION_FAILED" });
  }
  // السجلُّ بلا اسمٍ ولا معرّفِ تيليجرامَ (`F1-03`): الجلسةُ والمدينةُ تكفيانِ للتتبّع.
  deps.log?.("onboarding.rider_registered", {
    sessionId: viewer.value.sessionId,
    cityCode: city.code,
  });
  return ok({ cityName: city.name });
}
