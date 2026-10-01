/**
 * الغرض: شاشةُ الخصوصيّةِ (DEC-35) — تعرضُ الموافقاتِ المسجَّلةَ وحالاتَها
 *   للراكبِ. تعيدُ استخدامُ `consentRows` و`fetchConsentStatus` من شاشةِ الترحيبِ
 *   بلا نسخٍ ثانٍ: المنطقُ واحدٌ والعرضُ مختلفٌ.
 * الحالة: مُنفَّذٌ — تنشيطُ دَينٍ مُعلَنٍ `rider.account.debt.privacyView`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/privacy
 * يُستخدم من: `RiderRoot.tsx`.
 * الحاكم: القسم 9.12 · `F2-01` · `ADR 0126`.
 *
 * ## ولماذا لا تُنسَخُ دوالُ العرضِ
 *
 * لأنَّ `consentRows` تَدمجُ الوثائقَ بحالاتِها وتُعيدُ صفوفاً لها مفتاحُ
 * نصٍّ وحدُه — وذاكَ عينُ ما تحتاجُهُ شاشةُ المراجعةِ. ونسخُهُ يُدخِلُ
 * انحرافاً: صفٌّ يُبنى ههنا ولا يُبنى ههناك.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تُسجِّلُ موافقةً**: ذلكَ شأنُ شاشةِ الترحيبِ.
 *   ــ **لا تُعرَضُ نصَّ وثيقةٍ**: مفاتيحُ نصٍّ وحدَها (9.11)، والترجمةُ في
 *      `shared/i18n/miniapp`.
 */

import { useEffect, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { type ConsentApiStatus, consentErrorKey, consentRows } from "../welcome/consent-view.ts";

export interface PrivacyScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly fetchStatus?: () => Promise<ConsentApiStatus>;
}

type PrivacyState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: ConsentApiStatus }
  | { readonly kind: "error"; readonly code: string };

export function PrivacyScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  fetchStatus,
}: PrivacyScreenProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<PrivacyState>({ kind: "loading" });

  useEffect(() => {
    let mounted = true;
    const load = fetchStatus ?? defaultFetch;
    load()
      .then((status) => {
        if (mounted) setState({ kind: "ready", status });
      })
      .catch((thrown: unknown) => {
        if (!mounted) return;
        const code =
          thrown !== null &&
          typeof thrown === "object" &&
          "code" in thrown &&
          typeof (thrown as { code?: unknown }).code === "string"
            ? (thrown as { code: string }).code
            : "UNKNOWN";
        setState({ kind: "error", code });
      });
    return () => {
      mounted = false;
    };
  }, [fetchStatus]);

  return (
    <section className="rp" dir={directionFor(language)} aria-labelledby="rp-title">
      <h1 id="rp-title" className="rp__title">
        {t("rider.privacy.title")}
      </h1>
      {onBack !== undefined && (
        <button type="button" className="rp__back" onClick={() => onBack()}>
          {t("rider.privacy.back")}
        </button>
      )}

      {state.kind === "loading" && (
        <p className="rp__loading" role="status">
          {t("rider.privacy.loading")}
        </p>
      )}

      {state.kind === "error" && (
        <p className="rp__error" role="alert">
          {t(consentErrorKey(state.code))}
        </p>
      )}

      {state.kind === "ready" && (
        <ul className="rp__list">
          {consentRows(state.status).map((row) => (
            <li className="rp__item" key={row.kind}>
              <p className="rp__item-title">{t(row.titleKey)}</p>
              <p className="rp__item-summary">{t(row.summaryKey)}</p>
              <p className="rp__item-status">{t(row.statusKey)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function defaultFetch(): Promise<ConsentApiStatus> {
  const { fetchConsentStatus } = await import("../welcome/consent-api.ts");
  return fetchConsentStatus();
}
