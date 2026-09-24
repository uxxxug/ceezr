/**
 * الغرض: شاشةُ الترحيبِ والموافقاتِ `SR-01` — ثلاثةُ أسطرٍ تشرحُ الخدمةَ، واختيارُ
 *   لغةٍ، وموافقتانِ **منفصلتانِ** تُسجَّلُ كلٌّ منهما بختمٍ من الخادمِ، وفعلٌ
 *   أساسيٌّ واحدٌ (البند `F2-01` · القسمان 9.5 و9.12).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome (حزمة `rider-home` — 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `RiderRoot` يُركِّبُه قبلَ أيِّ شاشةِ منتَجٍ، وسيصيرُ
 *   عبورُه شرطاً لشاشةِ الطلبِ في `F2-02`.
 * ملاحظات مستقبلية: نصُّ الوثيقتَينِ كاملاً (لا ملخَّصُهما) يحتاجُ صفحةً وعنواناً
 *   ثابتاً لكلِّ إصدارٍ — بندٌ قانونيٌّ مستقلٌّ، والزرُّ إليه لا يُرسَمُ اليومَ لأنَّه
 *   لا يؤدّي إلى شيءٍ (UX-8).
 *
 * ## ما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تطلبُ إذنَ موقعٍ ولا إشعاراتٍ**: القسم 9.12 «كلُّ إذنٍ في لحظةِ
 *      الحاجةِ إليه»، والترحيبُ لا يحتاجُ أيَّهما (ADR 0093). والنصُّ يقولُ ذلكَ
 *      للمستخدمِ صراحةً بدلَ أن يسكتَ عنه.
 *   ــ **لا تجمعُ الموافقتَينِ في مربَّعٍ واحدٍ** ولا في زرٍّ واحدٍ: القسم 9.12
 *      يُوجِبُ فصلَهما، وكلُّ نداءٍ يُسجِّلُ وثيقةً واحدةً بإصدارِها.
 *   ــ لا تُتيحُ «ابدأ» قبلَ اكتمالِ ما يُطلَبُ، ولا تُخفيه: زرٌّ معطَّلٌ بسببٍ
 *      مكتوبٍ أصدقُ من زرٍّ غائبٍ بلا تفسيرٍ (UX-5).
 *   ــ لا تحسبُ «اكتملَت» عندَها: `satisfied` من الخادمِ بعدَ إعادةِ قراءةِ السجلِّ.
 *   ــ **لا تحفظُ اللغةَ في الحسابِ** مباشرةً: بل تُمرِّرُها عبر `saveLanguagePreference`
 *      إلى من يصِلُ الخادمَ (`PD-030`)، فإن غابَ المنفذُ فاللغةُ محليّةٌ فحسبُ.
 *   ــ لا تحملُ نصّاً عربيّاً داخلَ المكوّنِ: كلُّ حرفٍ من `shared/i18n/miniapp`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  isMiniAppLanguage,
  MINIAPP_DEFAULT_LANGUAGE,
  MINIAPP_LANGUAGES,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import {
  classifyFailure,
  failureFromThrown,
  shouldProbeReachability,
} from "../../../system/failure.ts";
import { deviceOnline, probeReachability } from "../../../system/health.ts";
import { Skeleton } from "../../../system/Skeleton.tsx";
import { SystemScreen } from "../../../system/SystemScreen.tsx";
import type { ScreenState } from "../../../system/state-text.ts";
import { fetchConsentStatus, submitConsent } from "./consent-api.ts";
import {
  type ConsentApiStatus,
  type ConsentRow,
  consentErrorKey,
  consentRows,
  isRetryable,
  outstandingRows,
} from "./consent-view.ts";
import { riderSurfaceTimingAttribute } from "./surface-timing.ts";

export interface WelcomeScreenProps {
  /** يُحقَنُ كي يُختبَرَ المكوّنُ بلا شبكةٍ ولا `fetch` مُرقَّعٍ. */
  readonly loadStatus?: () => Promise<ConsentApiStatus>;
  readonly recordOne?: (kind: string, version: string) => Promise<unknown>;
  /** يُنادى حينَ تكتملُ الموافقاتُ ويضغطُ المستخدمُ الفعلَ الأساسيَّ. */
  readonly onProceed?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
  /**
   * حفظُ اللغةِ في الحسابِ (`PD-030`). إن وُجِدَ نُودِيَ عندَ كلِّ اختيارِ لغةٍ،
   * وإن غابَ فاللغةُ محليّةٌ فحسبُ (شاشةُ الترحيبِ قد تُرى قبلَ التسجيلِ).
   */
  readonly saveLanguagePreference?: (language: MiniAppLanguage) => Promise<void>;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: ConsentApiStatus }
  /** فشلٌ يُصنَّفُ حالةَ نظامٍ (9.7): انقطاعٌ · تعطّلٌ · جلسةٌ. */
  | { readonly kind: "screen"; readonly screen: ScreenState }
  /** رفضٌ يخصُّ الموافقاتَ نفسَها: مفتاحُ نصٍّ لا شاشةُ نظامٍ. */
  | { readonly kind: "rejected"; readonly code: string };

/** رمزُ الخطأِ كما يُصدِرُه حدُّ API — ولا يُقرأُ نصُّ رسالةٍ. */
function codeOf(thrown: unknown): string | null {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

async function screenFor(thrown: unknown): Promise<ScreenState | null> {
  const failure = failureFromThrown(thrown);
  if (failure === null) return null;
  const online = deviceOnline();
  const probe = shouldProbeReachability(failure, online) ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online);
}

export function WelcomeScreen({
  loadStatus = fetchConsentStatus,
  recordOne = submitConsent,
  onProceed,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  saveLanguagePreference,
}: WelcomeScreenProps) {
  const [language, setLanguage] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ kind: string; code: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setRowError(null);
    try {
      const status = await loadStatus();
      if (mounted.current) setState({ kind: "ready", status });
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      if (screen !== null) {
        setState({ kind: "screen", screen });
        return;
      }
      setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
    }
  }, [loadStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (row: ConsentRow) => {
    setPendingKind(row.kind);
    setRowError(null);
    try {
      await recordOne(row.kind, row.version);
      // إعادةُ القراءةِ من الخادمِ لا تعديلُ الصفِّ محلّيّاً: حالةُ التهيئةِ تُقالُ
      // من السجلِّ، وتعديلٌ متفائلٌ ههنا يعرضُ «مسجَّلة» على كتابةٍ لم تثبُت.
      await load();
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      if (screen !== null) {
        setState({ kind: "screen", screen });
        return;
      }
      setRowError({ kind: row.kind, code: codeOf(thrown) ?? "UNKNOWN" });
    } finally {
      if (mounted.current) setPendingKind(null);
    }
  };

  const languagePicker = (
    <fieldset className="wc__langs">
      <legend className="sys__hint">{t("welcome.language_label")}</legend>
      {MINIAPP_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className={`wc__lang${code === language ? " wc__lang--on" : ""}`}
          aria-pressed={code === language}
          onClick={() => {
            if (isMiniAppLanguage(code)) {
              setLanguage(code);
              if (saveLanguagePreference) void saveLanguagePreference(code);
            }
          }}
        >
          {t(`welcome.language.${code}`)}
        </button>
      ))}
      <p className="sys__hint">{t("welcome.language_note")}</p>
    </fieldset>
  );

  if (state.kind === "loading") {
    return (
      <section
        className="wc"
        dir={directionFor(language)}
        aria-busy="true"
        aria-labelledby="wc-title"
      >
        <h1 id="wc-title" className="wc__title">
          {t("welcome.title")}
        </h1>
        <Skeleton />
      </section>
    );
  }

  if (state.kind === "screen") {
    // شاشةُ النظامِ نصُّها من `state-text` بالعربيّةِ اليومَ (دَينٌ مُعلَنٌ في
    // `ROADMAP.md`)، فيُثبَّتُ اتجاهُها عربيّاً لا باللغةِ المختارةِ: نصٌّ عربيٌّ
    // في إطارٍ يساريٍّ يُقرأُ مقلوباً، والكذبُ في الاتجاهِ عطلٌ مرئيٌّ.
    return (
      <div dir="rtl">
        <SystemScreen state={state.screen} onAction={() => void load()} />
      </div>
    );
  }

  if (state.kind === "rejected") {
    const retryable = isRetryable(state.code);
    return (
      <section className="wc" dir={directionFor(language)} aria-labelledby="wc-title">
        <h1 id="wc-title" className="wc__title">
          {t("welcome.title")}
        </h1>
        <div className="sys" role="alert">
          <p className="sys__body">{t(consentErrorKey(state.code))}</p>
          {retryable ? (
            <button type="button" className="sys__action" onClick={() => void load()}>
              {t("welcome.retry")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const rows = consentRows(state.status);
  const outstanding = outstandingRows(rows);
  const satisfied = state.status.onboarding.satisfied;

  return (
    <section className="wc" dir={directionFor(language)} aria-labelledby="wc-title">
      <h1 id="wc-title" className="wc__title">
        {t("welcome.title")}
      </h1>
      {/* `DEC-19`: عنصرُ قياسِ «زمنِ بلوغِ سطحِ الراكبِ المرسومِ» — هنا وحدَه، في الحالةِ الجاهزةِ لا التحميلِ. */}
      <p className="sys__body" {...riderSurfaceTimingAttribute}>
        {t("welcome.line1")}
      </p>
      <p className="sys__body">{t("welcome.line2")}</p>
      <p className="sys__body">{t("welcome.line3")}</p>

      {languagePicker}

      <h2 className="wc__heading">{t("welcome.consents_heading")}</h2>
      <p className="sys__hint">{t("welcome.consent_required_hint")}</p>

      <ul className="wc__docs">
        {rows.map((row) => {
          const busy = pendingKind === row.kind;
          const done = row.state === "satisfied";
          return (
            <li key={row.kind} className="wc__doc">
              <h3 className="wc__doc-title">{t(row.titleKey)}</h3>
              <p className="sys__hint">{t(row.summaryKey)}</p>
              <details className="wc__doc-text">
                <summary>{t("welcome.consent_read_full")}</summary>
                <pre className="wc__doc-text-body">{t(row.textKey)}</pre>
              </details>
              {/* الحالةُ مكتوبةٌ لا ملوّنةٌ وحدَها (UX-10). */}
              <p className="wc__doc-state">
                {busy ? t("welcome.consent_recording") : t(row.statusKey)}
              </p>
              {done ? null : (
                <button
                  type="button"
                  className="sys__action"
                  disabled={busy}
                  onClick={() => void accept(row)}
                  aria-label={`${t("welcome.accept_aria_prefix")} ${t(row.titleKey)}`}
                >
                  {t("welcome.accept")}
                </button>
              )}
              {rowError !== null && rowError.kind === row.kind ? (
                <p className="wc__doc-error" role="alert">
                  {t(consentErrorKey(rowError.code))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="sys__hint">{t("welcome.location_note")}</p>

      <button
        type="button"
        className="sys__action wc__primary"
        disabled={!satisfied || outstanding.length > 0}
        onClick={onProceed}
      >
        {t("welcome.start")}
      </button>

      <section className="wc__after">
        <h2 className="wc__heading">{t("welcome.after_consent_heading")}</h2>
        <p className="sys__hint">{t("welcome.after_consent_body")}</p>
      </section>
    </section>
  );
}

export default WelcomeScreen;
