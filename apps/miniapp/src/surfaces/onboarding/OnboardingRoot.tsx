/**
 * الغرض: سطحُ غيرِ المسجَّلِ (`ADR 0213` · `DEC-22`). الراكبُ ينشئُ حسابَه هنا باسمِه ومدينتِه
 *   فلا يحتاجُ إلى حوارِ البوتِ ليبدأَ؛ والسائقُ يُدَلُّ على بوتِه لأنّ تسجيلَه يحتاجُ إثباتَ
 *   ملكيّةِ الرقمِ وصورةَ المركبةِ ولا بديلَ لهما مبنيٌّ في التطبيقِ بعدُ.
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
import { closeApp } from "../../tg/index.ts";
import {
  type OnboardingCity,
  type OnboardingStatusResponse,
  readOnboardingStatus,
  registerRider,
} from "./onboarding-api.ts";
import { canSubmitOnboarding, isAlreadyRegistered, onboardingErrorKey } from "./onboarding-view.ts";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly status: OnboardingStatusResponse };

export interface OnboardingRootProps extends LanguageSurfaceProps {
  readonly readStatus?: () => Promise<OnboardingStatusResponse>;
  readonly register?: typeof registerRider;
}

export default function OnboardingRoot({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onAccountChanged,
  readStatus = readOnboardingStatus,
  register = registerRider,
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
