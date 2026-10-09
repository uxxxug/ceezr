/**
 * الغرض: سطحُ غيرِ المسجَّلِ (`ADR 0213` · `DEC-22`). الراكبُ ينشئُ حسابَه هنا باسمِه ومدينتِه؛
 *   والسائقُ يسجّلُ بياناتِه ومركبتَه (`PRD-105` · `ADR 0257`) ويُثبِتُ رقمَه بـ`requestContact` —
 *   تيليجرامُ يُرسِلُ البطاقةَ إلى بوتِه، والخادمُ يقرأُ الرقمَ من هناك لا من النموذج. وإن لم
 *   يدعمِ الخادمُ ذلك (`phoneVerified` غائب) يبقى الدليلُ إلى البوتِ كما كان.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/onboarding
 *
 * بعد نجاحِ الإنشاءِ لا يُفترَضُ الدورُ في العميلِ: يُعادُ حلُّه من `GET /v1/me` (`onAccountChanged`)
 * كما في كلِّ إقلاعٍ (`F1-05` · `check-viewer-role-authority`).
 */

import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/core.ts";
import type { LanguageSurfaceProps } from "../../routing/RoleRouter.tsx";
import { Skeleton } from "../../system/Skeleton.tsx";
import { closeApp, requestContactPermission } from "../../tg/index.ts";
import {
  type OnboardingCity,
  type OnboardingStatusResponse,
  readOnboardingStatus,
  registerDriver,
  registerRider,
} from "./onboarding-api.ts";
import {
  canSubmitDriverOnboarding,
  canSubmitOnboarding,
  DRIVER_VEHICLE_TYPES,
  type DriverDraft,
  isAlreadyRegistered,
  onboardingErrorKey,
} from "./onboarding-view.ts";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly status: OnboardingStatusResponse };

export interface OnboardingRootProps extends LanguageSurfaceProps {
  readonly readStatus?: () => Promise<OnboardingStatusResponse>;
  readonly register?: typeof registerRider;
  readonly registerAsDriver?: typeof registerDriver;
  readonly shareContact?: typeof requestContactPermission;
  /** مهلةُ إعادةِ قراءةِ الإثباتِ بعدَ المشاركة — تُحقَنُ صفراً في الاختبار. */
  readonly pollDelayMs?: number;
}

export default function OnboardingRoot({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onAccountChanged,
  readStatus = readOnboardingStatus,
  register = registerRider,
  registerAsDriver = registerDriver,
  shareContact = requestContactPermission,
  pollDelayMs = 1500,
}: OnboardingRootProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const status = await readStatus();
      if (status.registered) {
        onAccountChanged?.();
        return;
      }
      setState({ kind: "ready", status });
    } catch {
      setState({ kind: "failed" });
    }
  }, [readStatus, onAccountChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") return <Skeleton />;

  if (state.kind === "failed") {
    return (
      <section className="ob" aria-labelledby="ob-title">
        <h1 id="ob-title" className="ob__title">
          {t("onboarding.title")}
        </h1>
        <p className="ob__error" role="alert">
          {t("onboarding.load_failed")}
        </p>
        <button type="button" className="ob__retry" onClick={() => void load()}>
          {t("onboarding.retry")}
        </button>
      </section>
    );
  }

  if (state.status.audience === "driver" && state.status.phoneVerified !== undefined) {
    return (
      <DriverOnboardingForm
        cities={state.status.cities}
        initialPhoneVerified={state.status.phoneVerified}
        language={language}
        register={registerAsDriver}
        readStatus={readStatus}
        shareContact={shareContact}
        pollDelayMs={pollDelayMs}
        {...(onAccountChanged === undefined ? {} : { onRegistered: onAccountChanged })}
      />
    );
  }

  if (state.status.audience === "driver") {
    return (
      <section className="ob" aria-labelledby="ob-title">
        <h1 id="ob-title" className="ob__title">
          {t("onboarding.driver.title")}
        </h1>
        <p className="ob__lead">{t("onboarding.driver.body")}</p>
        <button type="button" className="ob__submit" onClick={() => closeApp()}>
          {t("onboarding.driver.close")}
        </button>
      </section>
    );
  }

  return (
    <RiderOnboardingForm
      cities={state.status.cities}
      language={language}
      register={register}
      {...(onAccountChanged === undefined ? {} : { onRegistered: onAccountChanged })}
    />
  );
}

interface RiderOnboardingFormProps {
  readonly cities: readonly OnboardingCity[];
  readonly language: LanguageSurfaceProps["language"];
  readonly register: typeof registerRider;
  readonly onRegistered?: () => void;
}

function RiderOnboardingForm({
  cities,
  language,
  register,
  onRegistered,
}: RiderOnboardingFormProps) {
  const t = miniAppTranslator(language);
  const nameId = useId();
  const [fullName, setFullName] = useState("");
  const [cityId, setCityId] = useState<string | null>(
    cities.length === 1 ? (cities[0]?.id ?? null) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  if (cities.length === 0) {
    return (
      <section className="ob" aria-labelledby="ob-title">
        <h1 id="ob-title" className="ob__title">
          {t("onboarding.title")}
        </h1>
        <p className="ob__lead">{t("onboarding.no_cities")}</p>
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !canSubmitOnboarding(fullName, cityId, cities) || cityId === null) return;
    setSubmitting(true);
    setErrorKey(null);
    try {
      await register({ fullName: fullName.trim(), cityId, language });
      onRegistered?.();
    } catch (error) {
      if (isAlreadyRegistered(error)) {
        onRegistered?.();
        return;
      }
      setErrorKey(onboardingErrorKey(error));
      setSubmitting(false);
    }
  };

  return (
    <section className="ob" aria-labelledby="ob-title">
      <h1 id="ob-title" className="ob__title">
        {t("onboarding.title")}
      </h1>
      <p className="ob__lead">{t("onboarding.lead")}</p>
      <form className="ob__form" onSubmit={(event) => void submit(event)}>
        <label className="ob__label" htmlFor={nameId}>
          {t("onboarding.name_label")}
        </label>
        <input
          id={nameId}
          className="ob__input"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <fieldset className="ob__cities">
          <legend className="ob__legend">{t("onboarding.city_legend")}</legend>
          {cities.map((city) => (
            <label key={city.id} className="ob__city">
              <input
                type="radio"
                name="ob-city"
                value={city.id}
                checked={cityId === city.id}
                onChange={() => setCityId(city.id)}
              />
              <span className="ob__city-name">{city.name}</span>
            </label>
          ))}
        </fieldset>
        {errorKey === null ? null : (
          <p className="ob__error" role="alert">
            {t(errorKey)}
          </p>
        )}
        <button
          type="submit"
          className="ob__submit"
          disabled={submitting || !canSubmitOnboarding(fullName, cityId, cities)}
          aria-busy={submitting ? "true" : undefined}
        >
          {submitting ? t("onboarding.submitting") : t("onboarding.submit")}
        </button>
      </form>
    </section>
  );
}

interface DriverOnboardingFormProps {
  readonly cities: readonly OnboardingCity[];
  readonly initialPhoneVerified: boolean;
  readonly language: LanguageSurfaceProps["language"];
  readonly register: typeof registerDriver;
  readonly readStatus: () => Promise<OnboardingStatusResponse>;
  readonly shareContact: typeof requestContactPermission;
  readonly pollDelayMs: number;
  readonly onRegistered?: () => void;
}

const PHONE_POLL_ATTEMPTS = 8;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function DriverOnboardingForm({
  cities,
  initialPhoneVerified,
  language,
  register,
  readStatus,
  shareContact,
  pollDelayMs,
  onRegistered,
}: DriverOnboardingFormProps) {
  const t = miniAppTranslator(language);
  const nameId = useId();
  const vehicleId = useId();
  const plateId = useId();
  const nationalId = useId();
  const [draft, setDraft] = useState<DriverDraft>({
    fullName: "",
    cityId: cities.length === 1 ? (cities[0]?.id ?? null) : null,
    service: null,
    vehicleType: null,
    plateNumber: "",
    nationalId: "",
  });
  const [phoneVerified, setPhoneVerified] = useState(initialPhoneVerified);
  const [phoneState, setPhoneState] = useState<"idle" | "waiting" | "missing">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const patch = (next: Partial<DriverDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  if (cities.length === 0) {
    return (
      <section className="ob" aria-labelledby="ob-title">
        <h1 id="ob-title" className="ob__title">
          {t("onboarding.driver.title")}
        </h1>
        <p className="ob__lead">{t("onboarding.no_cities")}</p>
      </section>
    );
  }

  /**
   * المشاركةُ لا تُعيدُ الرقمَ إلى التطبيق: تيليجرامُ يُرسِلُه إلى البوت. فبعدَها يُعادُ قراءةُ
   * الحالِ من الخادمِ بضعَ مرّاتٍ حتّى يصلَ الإثبات — لا قراءةٌ دوريّةٌ دائمة (`ADR 0035`).
   */
  const share = async () => {
    setPhoneState("waiting");
    const outcome = await shareContact();
    if (!outcome.ok || outcome.value !== true) {
      setPhoneState("missing");
      return;
    }
    for (let attempt = 0; attempt < PHONE_POLL_ATTEMPTS; attempt += 1) {
      await wait(pollDelayMs);
      try {
        const status = await readStatus();
        if (status.registered) {
          onRegistered?.();
          return;
        }
        if (status.phoneVerified === true) {
          setPhoneVerified(true);
          setPhoneState("idle");
          return;
        }
      } catch {
        // عطلٌ عابرٌ في القراءة: المحاولةُ التالية تحسم، ولا يُدَّعى وصولٌ لم يحدث.
      }
    }
    setPhoneState("missing");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !canSubmitDriverOnboarding(draft, cities, phoneVerified)) return;
    if (draft.cityId === null || draft.service === null || draft.vehicleType === null) return;
    setSubmitting(true);
    setErrorKey(null);
    try {
      await register({
        fullName: draft.fullName.trim(),
        cityId: draft.cityId,
        service: draft.service,
        vehicleType: draft.vehicleType,
        plateNumber: draft.plateNumber.trim(),
        nationalId: draft.nationalId.trim(),
        language,
      });
      onRegistered?.();
    } catch (error) {
      if (isAlreadyRegistered(error)) {
        onRegistered?.();
        return;
      }
      const key = onboardingErrorKey(error);
      if (key === "onboarding.error.phone") setPhoneVerified(false);
      setErrorKey(key);
      setSubmitting(false);
    }
  };

  return (
    <section className="ob" aria-labelledby="ob-title">
      <h1 id="ob-title" className="ob__title">
        {t("onboarding.driver.title")}
      </h1>
      <p className="ob__lead">{t("onboarding.driver.form_lead")}</p>
      <form className="ob__form" onSubmit={(event) => void submit(event)}>
        <label className="ob__label" htmlFor={nameId}>
          {t("onboarding.name_label")}
        </label>
        <input
          id={nameId}
          className="ob__input"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={draft.fullName}
          onChange={(event) => patch({ fullName: event.target.value })}
        />
        <fieldset className="ob__cities">
          <legend className="ob__legend">{t("onboarding.driver.phone_legend")}</legend>
          {phoneVerified ? (
            <p className="ob__lead" role="status">
              {t("onboarding.driver.phone_ok")}
            </p>
          ) : (
            <>
              <button
                type="button"
                className="ob__retry"
                disabled={phoneState === "waiting"}
                aria-busy={phoneState === "waiting" ? "true" : undefined}
                onClick={() => void share()}
              >
                {phoneState === "waiting"
                  ? t("onboarding.driver.phone_waiting")
                  : t("onboarding.driver.phone_share")}
              </button>
              {phoneState === "missing" ? (
                <p className="ob__error" role="alert">
                  {t("onboarding.driver.phone_missing")}
                </p>
              ) : null}
            </>
          )}
        </fieldset>
        <fieldset className="ob__cities">
          <legend className="ob__legend">{t("onboarding.city_legend")}</legend>
          {cities.map((city) => (
            <label key={city.id} className="ob__city">
              <input
                type="radio"
                name="ob-driver-city"
                value={city.id}
                checked={draft.cityId === city.id}
                onChange={() => patch({ cityId: city.id })}
              />
              <span className="ob__city-name">{city.name}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ob__cities">
          <legend className="ob__legend">{t("onboarding.driver.service_legend")}</legend>
          {(["transport", "delivery"] as const).map((service) => (
            <label key={service} className="ob__city">
              <input
                type="radio"
                name="ob-driver-service"
                value={service}
                checked={draft.service === service}
                onChange={() => patch({ service })}
              />
              <span className="ob__city-name">{t(`onboarding.driver.service.${service}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="ob__label" htmlFor={vehicleId}>
          {t("onboarding.driver.vehicle_label")}
        </label>
        <select
          id={vehicleId}
          className="ob__input"
          value={draft.vehicleType ?? ""}
          onChange={(event) => patch({ vehicleType: event.target.value || null })}
        >
          <option value="" disabled>
            {t("onboarding.driver.vehicle_label")}
          </option>
          {DRIVER_VEHICLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`onboarding.driver.vehicle.${type}`)}
            </option>
          ))}
        </select>
        <label className="ob__label" htmlFor={plateId}>
          {t("onboarding.driver.plate_label")}
        </label>
        <input
          id={plateId}
          className="ob__input"
          type="text"
          autoComplete="off"
          maxLength={12}
          value={draft.plateNumber}
          onChange={(event) => patch({ plateNumber: event.target.value })}
        />
        <label className="ob__label" htmlFor={nationalId}>
          {t("onboarding.driver.national_id_label")}
        </label>
        <input
          id={nationalId}
          className="ob__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={draft.nationalId}
          onChange={(event) => patch({ nationalId: event.target.value })}
        />
        {errorKey === null ? null : (
          <p className="ob__error" role="alert">
            {t(errorKey)}
          </p>
        )}
        <button
          type="submit"
          className="ob__submit"
          disabled={submitting || !canSubmitDriverOnboarding(draft, cities, phoneVerified)}
          aria-busy={submitting ? "true" : undefined}
        >
          {submitting ? t("onboarding.submitting") : t("onboarding.driver.submit")}
        </button>
      </form>
    </section>
  );
}
