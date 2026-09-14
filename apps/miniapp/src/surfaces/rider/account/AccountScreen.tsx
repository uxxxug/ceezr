/**
 * الغرض: شاشةُ الحسابِ (`SR-12` · البند `F2-11`) — وفيها حقّا البيانةِ اللذانِ
 *   يوجبُ القسم 9.12 أن يكونا **عامِلَينِ لا زرَّينِ صوريَّينِ**.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`. حكمُ CI **غيرُ مقروءٍ** بعدُ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `RiderRoot.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ حسابِ السائقِ — المسارانِ واحدٌ والدورُ خادميٌّ.
 * الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
 *
 * ## ما في نصِّ `SR-12` **ولم يُبنَ ههنا**، ولماذا يُقالُ على الشاشةِ
 *
 * نصُّ البندِ عشرةُ عناصرَ. المبنيُّ منها ستّةٌ، والأربعةُ الباقيةُ — الاسمُ
 * والرقمُ تعديلاً، وجهةُ اتّصالِ الطوارئِ، وتفضيلاتُ الإشعارِ — **لا جدولَ
 * لها في القاعدةِ ولا حدَّ API**. والخياراتُ كانت ثلاثةً: أن تُخترعَ جداولُ
 * لسطحٍ لم يُصمَّمْ، أو أن تُعرَضَ حقولٌ لا تُحفَظُ، أو أن يُقالَ الحدُّ.
 * والثاني أسوأُها: حقلُ «جهةُ اتّصالٍ للطوارئِ» يُملأُ ولا يُحفَظُ **وعدُ
 * سلامةٍ كاذبٌ** يُتَّكَلُ عليه في أخطرِ لحظةٍ. فالحدُّ يُقالُ للإنسانِ نصّاً
 * على الشاشةِ نفسِها، ودَينُه مكتوبٌ في `ROADMAP.md` باسمِه (`ح-5`).
 *
 * ## ولماذا الحذفُ **كلمةٌ تُكتَبُ** لا ضغطةٌ ثانيةٌ
 *
 * الضغطةُ الثانيةُ تقعُ بالإبهامِ نفسِه في الثانيةِ نفسِها. والكتابةُ تُوجِبُ
 * وقفةً وقراءةً، وهيَ الحاجزُ الوحيدُ المتناسبُ معَ فعلٍ لا يُنقَضُ. والخادمُ
 * يُقابِلُها حرفاً (`packages/application/privacy/data-rights.ts`) فلا يكونُ
 * الحاجزُ في الطبقةِ التي تُتجاوَزُ بنداءٍ مباشرٍ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ محتوى الحزمةِ**: تُنزَّلُ ملفّاً، ولا تُبسَطُ بيانةُ إنسانٍ
 *      كاملةً على شاشةٍ قد تُرى من فوقِ كتفِه.
 *   ــ **لا تقولُ «حُذِفَ كلُّ شيءٍ»**: تعرضُ الإيصالَ بما بقيَ ولِمَ بقيَ.
 *   ــ **لا تُوجِّهُ بعدَ الحذفِ ولا تُغلِقُ التطبيقَ**: الإيصالُ يبقى معروضاً
 *      حتّى يُغلِقَه صاحبُه — وإغلاقٌ تلقائيٌّ يسلبُه الوثيقةَ قبلَ قراءتِها.
 */

import { useCallback, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { addAppToHomeScreen } from "../../../tg/index.ts";
import { newIdempotencyKey } from "../search/search-view.ts";
import {
  type DataExportResponse,
  type ErasureResponse,
  requestDataExport,
  requestErasure,
} from "./account-api.ts";
import {
  accountErrorKey,
  erasureRefusalKey,
  exportRefusalKey,
  exportSectionCount,
  isRetryableAccountError,
  type ReceiptView,
  retentionBasisKey,
  toReceiptView,
} from "./account-view.ts";

export interface AccountScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly exportData?: () => Promise<DataExportResponse>;
  readonly erase?: (input: {
    readonly confirmation: string;
    readonly idempotencyKey: string;
  }) => Promise<ErasureResponse>;
  /** يُحقَنُ في الاختبارِ: تنزيلُ ملفٍّ لا يقعُ في بيئةِ قياسٍ. */
  readonly saveFile?: (fileName: string, json: string) => void;
  readonly addToHomeScreen?: () => void;
  /**
   * مُولِّدُ مفتاحِ اللاتكرارِ — **يُحقَنُ في الاختبارِ ولا يُنسَخُ**: مبدَؤُه
   * واحدٌ في العميلِ كلِّه (`newIdempotencyKey` · `ADR 0043`)، ونسخُه ههنا
   * كانَ يُدخِلُ `crypto.randomUUID` مباشرةً فيسقطُ حاجزُ `F1-08`.
   */
  readonly makeKey?: () => string;
}

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "done"; readonly sections: number; readonly fileName: string };

type EraseState =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming" }
  | { readonly kind: "working" }
  | { readonly kind: "refused"; readonly refusal: string; readonly activeOrders: number }
  | { readonly kind: "done"; readonly erasedAt: string; readonly receipt: ReceiptView | null };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** تنزيلٌ من المتصفِّحِ بلا خادمٍ وسيطٍ — الملفُّ لا يُكتَبُ عندَنا قطُّ. */
function saveViaBrowser(fileName: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** عناصرُ `SR-12` التي لا سندَ لها ههنا — تُقالُ ولا تُخترَعُ ولا يُوضَعُ لها زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "rider.account.debt.editIdentity",
  "rider.account.debt.emergencyContact",
  "rider.account.debt.notificationPrefs",
  "rider.account.debt.editPlaces",
  "rider.account.debt.privacyView",
];

export function AccountScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  exportData = requestDataExport,
  erase = requestErasure,
  saveFile = saveViaBrowser,
  addToHomeScreen = () => {
    addAppToHomeScreen();
  },
  makeKey = () => newIdempotencyKey(undefined, "erasure"),
}: AccountScreenProps) {
  const t = miniAppTranslator(language);
  const confirmInputId = useId();
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [eraseState, setEraseState] = useState<EraseState>({ kind: "idle" });
  const [typed, setTyped] = useState("");
  const [eraseKey, setEraseKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = useCallback(async () => {
    setError(null);
    setExportState({ kind: "working" });
    try {
      const response = await exportData();
      if (!response.exported) {
        setExportState({ kind: "refused", refusal: response.refusal });
        return;
      }
      saveFile(response.fileName, JSON.stringify(response.bundle, null, 2));
      setExportState({
        kind: "done",
        sections: exportSectionCount(response.bundle.sections),
        fileName: response.fileName,
      });
    } catch (thrown) {
      setExportState({ kind: "idle" });
      setError(codeOf(thrown));
    }
  }, [exportData, saveFile]);

  const openConfirm = useCallback(() => {
    setError(null);
    setTyped("");
    // المفتاحُ يُولَّدُ **مرّةً لهذه النافذةِ**: كلُّ محاولةٍ فيها الأمرُ نفسُه.
    setEraseKey(makeKey());
    setEraseState({ kind: "confirming" });
  }, [makeKey]);

  const runErase = useCallback(async () => {
    if (eraseKey === null) return;
    setError(null);
    setEraseState({ kind: "working" });
    try {
      const response = await erase({ confirmation: typed, idempotencyKey: eraseKey });
      if (!response.erased) {
        setEraseState({
          kind: "refused",
          refusal: response.refusal,
          activeOrders: response.activeOrders,
        });
        return;
      }
      setEraseState({
        kind: "done",
        erasedAt: response.erasedAt,
        receipt: response.receipt === null ? null : toReceiptView(response.receipt),
      });
    } catch (thrown) {
      setEraseState({ kind: "confirming" });
      setError(codeOf(thrown));
    }
  }, [erase, eraseKey, typed]);

  // بعدَ الحذفِ **لا شيءَ غيرُ الإيصالِ**: عرضُ أزرارِ حسابٍ لم يعُدْ قائماً عبثٌ.
  if (eraseState.kind === "done") {
    return (
      <section className="ac ac--erased" aria-labelledby="account-erased-title">
        <h1 className="ac__title" id="account-erased-title">
          {t("rider.account.erasure.doneTitle")}
        </h1>
        <p className="ac__erased-at">
          {t("rider.account.erasure.doneAt").replace("{date}", eraseState.erasedAt.slice(0, 10))}
        </p>
        {eraseState.receipt === null ? (
          <p className="sys__hint">{t("rider.account.erasure.alreadyErased")}</p>
        ) : (
          <ReceiptPanel receipt={eraseState.receipt} t={t} />
        )}
        {/* **بابُ الخروجِ بيدِ صاحبِ الإيصالِ** — لا إغلاقَ تلقائيَّ يسلبُه الوثيقةَ. */}
        {onBack !== undefined && (
          <button type="button" className="sys__action ac__close" onClick={onBack}>
            {t("rider.account.erasure.close")}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="ac" aria-labelledby="account-title">
      <h1 className="ac__title" id="account-title">
        {t("rider.account.title")}
      </h1>

      <nav className="ac__links">
        {onBack !== undefined && (
          <button type="button" className="sys__action ac__back" onClick={onBack}>
            {t("rider.account.back")}
          </button>
        )}
        {/* الوحيدُ ههنا الذي **يفعلُ شيئاً حقيقيّاً**: نداءُ مُضيفِ تيليجرامَ. */}
        <button type="button" className="sys__action" onClick={addToHomeScreen}>
          {t("rider.account.addToHomeScreen")}
        </button>
      </nav>

      {/* **الحدُّ يُقالُ**: انظرْ رأسَ المِلفِّ — حقلٌ لا يُحفَظُ أسوأُ من غيابِه. */}
      <div className="ac__debt">
        <p className="ac__debt-title">{t("rider.account.debt.title")}</p>
        <ul className="ac__debt-list">
          {DECLARED_DEBT.map((key) => (
            <li className="ac__debt-item" key={key}>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      <div className="ac__rights">
        <h2 className="ac__rights-title">{t("rider.account.rights.title")}</h2>

        {/* ــ تنزيلُ بياناتي ــ */}
        <div className="ac__export">
          <p className="ac__export-note">{t("rider.account.export.note")}</p>
          <button
            type="button"
            className="sys__action ac__export-run"
            disabled={exportState.kind === "working"}
            onClick={() => void runExport()}
          >
            {t(
              exportState.kind === "working"
                ? "rider.account.export.working"
                : "rider.account.export.run",
            )}
          </button>
          {exportState.kind === "refused" && (
            <p className="ac__export-refusal" role="alert">
              {t(exportRefusalKey(exportState.refusal))}
            </p>
          )}
          {exportState.kind === "done" && (
            <p className="ac__export-done" role="status">
              {t("rider.account.export.done")
                .replace("{sections}", String(exportState.sections))
                .replace("{file}", exportState.fileName)}
            </p>
          )}
        </div>

        {/* ــ حذفُ حسابي ــ */}
        <div className="ac__erase">
          <p className="ac__erase-warning">{t("rider.account.erasure.warning")}</p>
          <p className="ac__erase-kept">{t("rider.account.erasure.whatStays")}</p>

          {eraseState.kind === "idle" || eraseState.kind === "refused" ? (
            <>
              {eraseState.kind === "refused" && (
                <p className="ac__erase-refusal" role="alert">
                  {t(erasureRefusalKey(eraseState.refusal)).replace(
                    "{orders}",
                    String(eraseState.activeOrders),
                  )}
                </p>
              )}
              <button type="button" className="ac__erase-open" onClick={openConfirm}>
                {t("rider.account.erasure.open")}
              </button>
            </>
          ) : (
            <div className="ac__erase-confirm">
              <label className="ac__erase-label" htmlFor={confirmInputId}>
                {t("rider.account.erasure.typeToConfirm").replace(
                  "{word}",
                  t("rider.account.erasure.word"),
                )}
              </label>
              <input
                className="ac__erase-input"
                id={confirmInputId}
                onChange={(event) => setTyped(event.target.value)}
                type="text"
                value={typed}
              />
              <button
                type="button"
                className="ac__erase-run"
                disabled={eraseState.kind === "working"}
                onClick={() => void runErase()}
              >
                {t(
                  eraseState.kind === "working"
                    ? "rider.account.erasure.working"
                    : "rider.account.erasure.run",
                )}
              </button>
              <button
                type="button"
                className="sys__action ac__erase-cancel"
                disabled={eraseState.kind === "working"}
                onClick={() => {
                  setEraseState({ kind: "idle" });
                  setTyped("");
                  setEraseKey(null);
                }}
              >
                {t("rider.account.erasure.cancel")}
              </button>
            </div>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="ac__error" role="alert">
          <p>{t(accountErrorKey(error))}</p>
          {isRetryableAccountError(error) && (
            <p className="sys__hint">{t("rider.account.error.retryHint")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function ReceiptPanel({
  receipt,
  t,
}: {
  readonly receipt: ReceiptView;
  readonly t: (key: string) => string;
}) {
  return (
    <div className="ac__receipt">
      <p className="ac__receipt-total">
        {t("rider.account.receipt.total").replace("{rows}", String(receipt.totalRemoved))}
      </p>

      <h2 className="ac__receipt-heading">{t("rider.account.receipt.erased")}</h2>
      <ul className="ac__receipt-list">
        {receipt.erased.map((line) => (
          <li className="ac__receipt-item" key={`erased-${line.section}`}>
            {t(`rider.account.section.${line.section}`)} — {line.rows}
          </li>
        ))}
      </ul>

      <h2 className="ac__receipt-heading">{t("rider.account.receipt.anonymized")}</h2>
      <ul className="ac__receipt-list">
        {receipt.anonymized.map((line) => (
          <li className="ac__receipt-item" key={`anon-${line.section}`}>
            {t(`rider.account.section.${line.section}`)} — {line.rows}
          </li>
        ))}
      </ul>

      {/* **ما بقيَ ومعَه سببُه** — وهذا هوَ الفرقُ بينَ إيصالٍ وجملةِ تطمينٍ. */}
      <h2 className="ac__receipt-heading">{t("rider.account.receipt.retained")}</h2>
      <ul className="ac__receipt-list ac__receipt-list--retained">
        {receipt.retained.map((line) => (
          <li className="ac__receipt-item" key={`kept-${line.section}`}>
            <span className="ac__receipt-section">
              {t(`rider.account.section.${line.section}`)} — {line.rows}
            </span>
            <span className="ac__receipt-basis">
              {line.basis === null ? "" : t(retentionBasisKey(line.basis))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
