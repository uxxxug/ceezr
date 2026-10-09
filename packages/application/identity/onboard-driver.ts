/**
 * الغرض: تسجيلُ السائقِ من التطبيقِ المصغَّرِ — `POST /v1/onboarding/driver` (`PRD-105` ·
 *   `ADR 0257`). بالمنفذِ نفسِه الذي يسجّلُ به حوارُ البوتِ (`DriverDirectory.register`)، فلا
 *   مصدرَ ثانياً لقواعدِ التسجيل.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/onboarding.ts
 *
 * ## الحدود
 *
 * - **الهويّةُ من الرمزِ لا من الطلب** (`authorizeViewer`)، والجمهورُ «سائق» يُقرأُ من البوتِ
 *   الموقِّعِ للجلسةِ لا من الجسم.
 * - **الرقمُ لا يأتي من الجسمِ ألبتّة.** يُقرأُ من إثباتِ تيليجرامَ الذي كتبَه بوتُ السائقِ حينَ
 *   وصلَته بطاقةُ جهةِ الاتّصالِ وصاحبُها هو المرسِلُ نفسُه (`requestContact` في التطبيق ⇒
 *   رسالةُ `contact` إلى البوت). بلا إثباتٍ ⇒ `PHONE_NOT_VERIFIED`، لا تسجيلٌ بلا رقمٍ مضمون.
 * - **لا توثيقَ آليّ.** الصفُّ يُكتَبُ بـ`verification_status` الافتراضيِّ في القاعدة (`pending`)؛
 *   وهذه الحالةُ لا تكتبُ حالةَ توثيقٍ ولا تقبلُ حقلاً يحملُها. الاعتمادُ قرارُ مراجِعٍ في لوحةِ
 *   الإدارةِ بعدَ رفعِ الوثائقِ (`PD-042` · `ADR 0256`).
 * - **إعادةُ المحاولةِ لا تُكرِّر.** `register` يُدرِجُ بـ`on conflict` على `telegram_id` و`user_id`
 *   و`(driver_id, service)`؛ وطلبٌ ثانٍ بعدَ نجاحِ الأوّلِ يُردُّ `ALREADY_REGISTERED` فيقرأُ العميلُ
 *   الدورَ من `GET /v1/me`.
 * - **صورةُ المركبةِ لا تُطلَبُ هنا.** معرّفُها في البوتِ معرّفُ ملفِّ تيليجرام، ولا مسارَ رفعٍ لها في
 *   التطبيقِ بعدُ؛ فتبقى `null` وتظهرُ «ناقصةً» في ملفِّ السائقِ لدى المراجِع — لا قيمةٌ مختلَقة.
 */

import { parseFullName } from "../../domain/identity/value-objects.ts";
import {
  parseNationalId,
  parsePlateNumber,
  parseVehicleType,
} from "../../domain/kyc/value-objects.ts";
import { MINIAPP_LANGUAGES } from "../../shared/i18n/miniapp/index.ts";
import type { ServiceType } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { CityDirectory, DriverDirectory, SessionStore } from "../bots/types.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { OnboardingError } from "./onboard-rider.ts";
import { authorizeViewer, type ResolveViewerDeps } from "./resolve-viewer.ts";

/**
 * إثباتُ ملكيّةِ الرقمِ كما كتبَه بوتُ السائق. القراءةُ وحدَها هنا؛ والكتابةُ في الحوارِ حيثُ
 * يُقارَنُ صاحبُ البطاقةِ بالمرسِل.
 */
export interface DriverPhoneProofs {
  read(telegramUserId: string): Promise<Result<string | null, PortFailureError>>;
  /** يُمحى بعدَ التسجيلِ كي لا يبقى رقمٌ في جلسةٍ لا حاجةَ إليه. */
  clear(telegramUserId: string): Promise<Result<void, PortFailureError>>;
}

/**
 * المحوِّلُ فوقَ مخزنِ جلسةِ بوتِ السائق: `draftPhone` لا يُكتَبُ فيه إلّا من بطاقةٍ صاحبُها هو
 * المرسِلُ (`driver-dialog.ts`)، فقراءتُه إثباتٌ لا ادّعاء. والمسحُ يمسُّ الرقمَ وحدَه ويُبقي
 * لغةَ المحادثةِ وسائرَ الجلسة.
 */
export function createDriverPhoneProofs(sessions: SessionStore): DriverPhoneProofs {
  return {
    async read(telegramUserId) {
      const state = await sessions.load(telegramUserId);
      if (!state.ok) return state;
      return ok(state.value?.draftPhone ?? null);
    },
    async clear(telegramUserId) {
      const state = await sessions.load(telegramUserId);
      if (!state.ok) return state;
      if (state.value === null || state.value.draftPhone === null) return ok(undefined);
      return sessions.save(telegramUserId, { ...state.value, draftPhone: null });
    },
  };
}

export interface DriverOnboardingDeps {
  readonly viewer: ResolveViewerDeps;
  readonly drivers: DriverDirectory;
  readonly cities: CityDirectory;
  readonly phoneProofs: DriverPhoneProofs;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface OnboardDriverInput {
  readonly accessToken: string | undefined;
  readonly fullName: unknown;
  readonly cityId: unknown;
  readonly service: unknown;
  readonly vehicleType: unknown;
  readonly plateNumber: unknown;
  readonly nationalId: unknown;
  readonly language: unknown;
}

function isServiceType(value: unknown): value is ServiceType {
  return value === "transport" || value === "delivery";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** ازدواجُ الهويّةِ في المدينةِ رفضٌ مفهومٌ لا عطل — الفحصُ نفسُه الذي يستعملُه حوارُ البوت. */
export function isDuplicateNationalIdFailure(error: unknown): boolean {
  const detail = (error as { readonly detail?: string } | null)?.detail ?? "";
  return detail.includes("drivers_city_national_id_uniq");
}

/** هل لهذا المستخدمِ رقمٌ مُثبَتٌ ينتظرُ؟ — لشاشةِ التسجيلِ قبلَ الإرسال. */
export async function readDriverPhoneVerified(
  telegramUserId: string,
  proofs: DriverPhoneProofs,
): Promise<Result<boolean, OnboardingError>> {
  const proof = await proofs.read(telegramUserId);
  if (!proof.ok) return err({ code: "REGISTRATION_FAILED" });
  return ok(proof.value !== null);
}

export async function onboardDriver(
  input: OnboardDriverInput,
  deps: DriverOnboardingDeps,
): Promise<Result<{ readonly cityName: string }, OnboardingError>> {
  const viewer = await authorizeViewer({ accessToken: input.accessToken }, deps.viewer);
  if (!viewer.ok) return err({ code: viewer.error.publicCode });
  if (viewer.value.status !== "unregistered") return err({ code: "ALREADY_REGISTERED" });
  if (viewer.value.bot !== "driver") return err({ code: "WRONG_AUDIENCE" });

  const name = parseFullName(text(input.fullName));
  if (!name.ok) return err({ code: "NAME_INVALID", reason: name.error.reason });
  if (!isServiceType(input.service)) return err({ code: "SERVICE_INVALID" });
  const vehicleType = parseVehicleType(text(input.vehicleType));
  if (!vehicleType.ok) return err({ code: "VEHICLE_TYPE_INVALID" });
  const plate = parsePlateNumber(text(input.plateNumber));
  if (!plate.ok) return err({ code: "PLATE_INVALID", reason: plate.error.reason });
  const nationalId = parseNationalId(text(input.nationalId));
  if (!nationalId.ok) return err({ code: "NATIONAL_ID_INVALID", reason: nationalId.error.reason });

  const cities = await deps.cities.listActive();
  if (!cities.ok) return err({ code: "CITIES_NOT_AVAILABLE" });
  const city = cities.value.find((candidate) => String(candidate.id) === input.cityId);
  if (city === undefined) return err({ code: "CITY_NOT_AVAILABLE" });

  const telegramUserId = viewer.value.telegramUserId;
  const phone = await deps.phoneProofs.read(telegramUserId);
  if (!phone.ok) return err({ code: "REGISTRATION_FAILED" });
  if (phone.value === null) return err({ code: "PHONE_NOT_VERIFIED" });

  const language =
    typeof input.language === "string" &&
    (MINIAPP_LANGUAGES as readonly string[]).includes(input.language)
      ? input.language
      : "ar";

  const registered = await deps.drivers.register({
    telegramUserId,
    cityId: city.id,
    fullName: name.value,
    phone: phone.value,
    service: input.service,
    language,
    vehicleType: vehicleType.value,
    plateNumber: plate.value,
    nationalId: nationalId.value,
    vehiclePhotoFileId: null,
  });
  if (!registered.ok) {
    if (isDuplicateNationalIdFailure(registered.error)) return err({ code: "NATIONAL_ID_TAKEN" });
    deps.log?.("onboarding.driver_register_failed", { sessionId: viewer.value.sessionId });
    return err({ code: "REGISTRATION_FAILED" });
  }
  // المسحُ بعدَ الكتابة: إخفاقُه لا يُبطِلُ تسجيلاً تمَّ، والرقمُ صارَ في القاعدةِ على أيِّ حال.
  await deps.phoneProofs.clear(telegramUserId);
  // السجلُّ بلا اسمٍ ولا رقمٍ ولا هويّةٍ ولا معرّفِ تيليجرام (`F1-03`).
  deps.log?.("onboarding.driver_registered", {
    sessionId: viewer.value.sessionId,
    cityCode: city.code,
  });
  return ok({ cityName: city.name });
}
