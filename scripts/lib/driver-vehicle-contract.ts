/**
 * الغرض: قواعدُ عقدِ مركبةِ السائقِ — **قراءةٌ + تحديثٌ + شعارٌ وباركودٌ**، مقيسةٌ
 *   على نصِّ المستودعِ لا نيّةِ كاتبِه (البند `F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-vehicle-contract.ts` و`tests/unit`.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ حاجزٌ على شاشةِ مركبةٍ
 *
 * لأنَّ الأعطابَ ههنا كلَّها خضراءُ في الاختبارِ وكلُّها تخدعُ سائقاً:
 *
 *   ــ **بياناتُ مركبةٍ غائبةٌ**: لوحٌ يعرضُ «سيدان» و«١٢٣٤» بلا تاريخِ انتهاءِ
 *      وثائقِها، فلا يُعلَمُ متى تنتهي رخصةُ السيرِ أو التأمينُ.
 *   ــ **تحديثٌ بلا تحققٍ**: سنةُ صنعٍ «٩٩» تُكتَبُ بلا فحصٍ، فتُخزَّنُ «٩٩»
 *      بدلَ «١٩٩٩».
 *   ــ **شعارٌ غائبٌ بصمتٍ**: سائقٌ لا يرى هل رُفِعَ شعارُه وباركودُه أم لا.
 *   ــ **فشلٌ مفتوحٌ**: غيابُ مخزنِ المركبةِ يُجيبُ بـ`200` بلا بياناتٍ.
 *
 * ## القواعدُ
 *
 *   ١. **لا جدولَ مركبةٍ منفصلٌ**: `drivers` هو الجدولُ، ووثائقُ المركبةِ في
 *      `driver_documents` — لا جدولٌ ثانٍ.
 *   ٢. **التحديثُ يتحقَّقُ من السنةِ**: `validateVehicleYear` يُستدعى في طبقةِ
 *      التطبيقِ.
 *   ٣. **الشعارُ والباركودُ معروضانِ**: الشاشةُ تعرضُ حالَهما.
 *   ٤. **الفشلُ مُغلَقٌ**: غيابُ المخزنِ يُعلَنُ `VEHICLE_STORE_NOT_AVAILABLE`
 *      بـ`503`.
 *   ٥. **كلُّ رمزٍ منشورٍ له نصُّه** في اللغاتِ الثلاثِ.
 */

export const APPLICATION_FILE = "packages/application/driver/driver-vehicle.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-vehicle.ts";
export const DOMAIN_FILE = "packages/domain/driver/driver-vehicle.ts";
export const STORE_FILE = "packages/infrastructure/driver/driver-vehicle-store.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/driver/vehicle/vehicle-contract.ts";
export const VIEW_FILE = "apps/miniapp/src/surfaces/driver/vehicle/vehicle-view.ts";
export const SCREEN_FILE = "apps/miniapp/src/surfaces/driver/vehicle/VehicleScreen.tsx";
export const API_FILE = "apps/miniapp/src/surfaces/driver/vehicle/vehicle-api.ts";

export const SURFACE_FILES: readonly string[] = [SCREEN_FILE, API_FILE, VIEW_FILE, CONTRACT_FILE];

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

export const KEY_PREFIX = "driver.vehicle.";

/** رموزُ الخطأِ المنشورةُ — لكلٍّ منها نصٌّ في ثلاثِ لغاتٍ. */
export const PUBLIC_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "VEHICLE_STORE_NOT_AVAILABLE",
  "YEAR_INVALID",
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "CITY_NOT_READY",
];

export interface DriverVehicleContractInput {
  readonly surface: Readonly<Record<string, string>>;
  readonly domain: string;
  readonly application: string;
  readonly route: string;
  readonly store: string;
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** ١) لا جدولَ مركبةٍ منفصلٌ — `drivers` هو الجدولُ. */
export function separateTableProblems(input: DriverVehicleContractInput): readonly string[] {
  const problems: string[] = [];
  if (input.store.includes("create table") || input.store.includes("driver_vehicles")) {
    problems.push(
      `«${STORE_FILE}» يُنشئُ جدولاً منفصلاً للمركبةِ — والمركبةُ صفٌّ واحدٌ في «drivers» منذ الهجرةِ الأولى، فلا جدولَ ثانياً.`,
    );
  }
  return problems;
}

/** ٢) التحديثُ يتحقَّقُ من السنةِ. */
export function yearValidationProblems(input: DriverVehicleContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.application.includes("validateVehicleYear")) {
    problems.push(
      `«${APPLICATION_FILE}» لا يستدعي «validateVehicleYear» — وسنةُ صنعٍ «٩٩» تُخزَّنُ «٩٩» بدلَ «١٩٩٩».`,
    );
  }
  if (!input.domain.includes("VEHICLE_YEAR_MIN") || !input.domain.includes("VEHICLE_YEAR_MAX")) {
    problems.push(
      `«${DOMAIN_FILE}» لا يُعرِّفُ مجالَ السنةِ («VEHICLE_YEAR_MIN»/«VEHICLE_YEAR_MAX») — والتحققُ بلا مجالٍ يقبلُ أيَّ عددٍ.`,
    );
  }
  return problems;
}

/** ٣) الشعارُ والباركودُ معروضانِ في الشاشةِ. */
export function logoBarcodeDisplayProblems(input: DriverVehicleContractInput): readonly string[] {
  const problems: string[] = [];
  const screen = input.surface[SCREEN_FILE] ?? "";
  if (!screen.includes("logoObjectPath") && !screen.includes("logo")) {
    problems.push(`«${SCREEN_FILE}» لا تعرضُ حالَ الشعارِ — وسائقٌ لا يرى هل رُفِعَ شعارُه أم لا.`);
  }
  if (!screen.includes("barcodeObjectPath") && !screen.includes("barcode")) {
    problems.push(`«${SCREEN_FILE}» لا تعرضُ حالَ الباركودِ — وسائقٌ لا يرى هل رُفِعَ باركودُه أم لا.`);
  }
  return problems;
}

/** ٤) الفشلُ مُغلَقٌ: غيابُ المخزنِ يُعلَنُ `503`. */
export function failClosedProblems(input: DriverVehicleContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.route.includes("VEHICLE_STORE_NOT_AVAILABLE")) {
    problems.push(
      `«${ROUTE_FILE}» لا يُعرِّفُ رمزَ «VEHICLE_STORE_NOT_AVAILABLE» — وغيابُ المخزنِ يجبُ أن يُعلَنَ لا أن يُجابَ بلا بياناتٍ.`,
    );
  }
  if (!input.route.includes("503")) {
    problems.push(`«${ROUTE_FILE}» لا يردُّ «503» — وتعطيلُ مخزنٍ حالةٌ معلَنةٌ برمزِ حالةٍ لا رفضٌ عامٌّ.`);
  }
  return problems;
}

/** ٥) كلُّ رمزٍ منشورٍ له نصُّه في اللغاتِ الثلاثِ. */
export function textCoverageProblems(input: DriverVehicleContractInput): readonly string[] {
  const problems: string[] = [];
  for (const code of PUBLIC_ERROR_CODES) {
    const key = `${KEY_PREFIX}error.${code}`;
    for (const [language, dict] of Object.entries(input.translations)) {
      if (dict === undefined) continue;
      const text = dict[key];
      if (text === undefined || text.trim().length === 0) {
        problems.push(`اللغةُ «${language}» تفتقدُ نصَّ الرمزِ «${key}» — ورمزٌ بلا نصٍّ يُعرَضُ خاماً.`);
      }
    }
  }
  return problems;
}

export function driverVehicleContractProblems(
  input: DriverVehicleContractInput,
): readonly string[] {
  return [
    ...separateTableProblems(input),
    ...yearValidationProblems(input),
    ...logoBarcodeDisplayProblems(input),
    ...failClosedProblems(input),
    ...textCoverageProblems(input),
  ];
}
