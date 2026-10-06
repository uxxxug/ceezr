/**
 * الغرض: شاشةُ كشفِ الخصومِ التفصيليِّ للسائقِ (`DEC-37`) — تعرضُ خصومَ المحفظةِ
 *   بمرجعِ كلِّ خصمٍ ونوعِه ومبلغِه وسبَبِه وزمنِه. **قراءةٌ فقط**.
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/deductions
 * يُستخدم من: `DriverRoot.tsx`.
 * الحاكم: `ADR 0161` — سطحُ المالِ للسائقِ.
 *
 * ## ولماذا قراءةٌ فقط
 *
 * لأنَّ الاعتراضَ بلاغٌ يراجعه إنسانٌ، لا قيدٌ يُعكسُ تلقائياً. والخصمُ
 * الماليُّ قيدٌ في المحفظةِ لا يُمسُّ من ههنا.
 */

import { useEffect, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { type DeductionTraceEntry, readDeductionTrace } from "./deduction-trace-api.ts";

export interface DeductionTraceScreenProps {
  readonly language?: MiniAppLanguage;
  readonly accessToken?: string | null;
  readonly onBack?: () => void;
  /** `UI-4`: حينَ يرسمُ `ScreenFrame` العنوانَ (H1) لا يُكرَّرُ ههنا. الافتراضُ `true`. */
  readonly showTitle?: boolean;
}

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly entries: readonly DeductionTraceEntry[] };

const ENTRY_KIND_LABELS: Readonly<Record<string, string>> = {
  subscription_charge: "driver.deduction.kind.subscriptionCharge",
  administrative_system_error_adjustment: "driver.deduction.kind.adjustment",
};

export function DeductionTraceScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  accessToken = null,
  onBack,
  showTitle = true,
}: DeductionTraceScreenProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    if (accessToken === null) {
      setState({ kind: "error" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    readDeductionTrace({ accessToken, limit: 20 })
      .then((res) => {
        if (!cancelled) {
          setState({ kind: "ready", entries: res.deductions });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <section
      className="dt"
      dir={directionFor(language)}
      aria-labelledby={showTitle ? "dt-title" : undefined}
    >
      {showTitle ? (
        <h1 id="dt-title" className="dt__title">
          {t("driver.support.deductionTrace.title")}
        </h1>
      ) : null}
      {onBack !== undefined && (
        <button type="button" className="dt__back" onClick={() => onBack()}>
          {t("driver.support.deductionTrace.back")}
        </button>
      )}
      {state.kind === "loading" && (
        <p className="dt__loading">{t("driver.support.deductionTrace.loading")}</p>
      )}
      {state.kind === "error" && (
        <p className="dt__error">{t("driver.support.deductionTrace.error")}</p>
      )}
      {state.kind === "ready" && state.entries.length === 0 && (
        <p className="dt__empty">{t("driver.support.deductionTrace.empty")}</p>
      )}
      {state.kind === "ready" && state.entries.length > 0 && (
        <ul className="dt__list">
          {state.entries.map((entry) => (
            <li className="dt__item" key={entry.id}>
              <p className="dt__reference">
                {entry.reference ?? t("driver.support.deductionTrace.noReference")}
              </p>
              <p className="dt__kind">
                {t(
                  ENTRY_KIND_LABELS[entry.entryKind] ?? "driver.support.deductionTrace.unknownKind",
                )}
              </p>
              <p className="dt__amount">
                {(entry.amountMinor / 100).toFixed(2)} {entry.currency}
              </p>
              {entry.reason !== null && <p className="dt__reason">{entry.reason}</p>}
              <p className="dt__date">{entry.createdAt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
