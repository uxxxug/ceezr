/**
 * الغرض: شاشةُ الحسابِ **المشتركةُ** — حقّا البيانةِ اللذانِ يوجبُ القسم 9.12 أن
 *   يكونا عامِلَينِ لا زرَّينِ صوريَّينِ، مكتوبةً مرّةً وتخدمُ الدورَينِ
 *   (`F2-11` · `SR-12` · `SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`، ومنقولٌ عن `F2-11`. حكمُ CI يُقرأُ
 *   بعدَ الدفعِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/account
 * يُستخدم من: `rider/account/AccountScreen.tsx` · `driver/account/AccountScreen.tsx`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا الحذفُ **كلمةٌ تُكتَبُ** لا ضغطةٌ ثانيةٌ
 *
 * الضغطةُ الثانيةُ تقعُ بالإبهامِ نفسِه في الثانيةِ نفسِها. والكتابةُ تُوجِبُ
 * وقفةً وقراءةً، وهيَ الحاجزُ الوحيدُ المتناسبُ معَ فعلٍ لا يُنقَضُ. والخادمُ
 * يُقابِلُها حرفاً (`packages/application/privacy/data-rights.ts`) فلا يكونُ
 * الحاجزُ في الطبقةِ التي تُتجاوَزُ بنداءٍ مباشرٍ.
 *
 * ## ولماذا مكوِّنٌ واحدٌ لا مكوِّنانِ يتشابهانِ
 *
 * لأنَّ ما يفترقُ بينَ الدورَينِ ههنا **نصٌّ ودَينٌ** لا سلوكٌ: الحقُّ واحدٌ،
 * والمنفذُ واحدٌ، وكلمةُ التأكيدِ واحدةٌ، والإيصالُ واحدُ الشكلِ. ونسخةٌ ثانيةٌ
 * تعني أنَّ إفصاحاً واجباً يُصحَّحُ في شاشةٍ ويُنسى في أختِها — وقد وقعَ ذلكَ
 * فعلاً في هذا السطحِ نفسِه قبلَ اليومِ (انظرْ حاشيةَ `account-view.ts`).
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ محتوى الحزمةِ**: تُنزَّلُ ملفّاً، ولا تُبسَطُ بيانةُ إنسانٍ
 *      كاملةً على شاشةٍ قد تُرى من فوقِ كتفِه.
 *   ــ **لا تقولُ «حُذِفَ كلُّ شيءٍ»**: تعرضُ الإيصالَ بما بقيَ ولِمَ بقيَ.
 *   ــ **لا تُوجِّهُ بعدَ الحذفِ ولا تُغلِقُ التطبيقَ**: الإيصالُ يبقى معروضاً
 *      حتّى يُغلِقَه صاحبُه — وإغلاقٌ تلقائيٌّ يسلبُه الوثيقةَ قبلَ قراءتِها.
 *   ــ **لا تُقرِّرُ نصَّ دَينٍ**: الدَّينُ مفاتيحُ من وصفِ الدورِ، فلا تُخترَعُ
 *      ههنا ولا تُخفى.
 */

import { type ReactNode, useCallback, useId, useState } from "react";
import type { MiniAppLanguage } from "../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { addAppToHomeScreen } from "../../tg/index.ts";
import { newIdempotencyKey } from "../rider/search/search-view.ts";
import { requestDataExport, requestErasure } from "./account-api.ts";
import type { DataExportResponse, ErasureResponse } from "./account-contract.ts";
import type { AccountViewModel, ReceiptView } from "./account-view.ts";
import { exportSectionCount, isRetryableAccountError, toReceiptView } from "./account-view.ts";

export interface AccountRightsProps {
  /** نموذجُ عرضِ الدورِ — **مبنيٌّ في سطحِ الدورِ** لا ههنا. */
  readonly view: AccountViewModel;
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /**
   * فتحُ شاشةِ الدعمِ — **اختياريٌّ**: هذه الشاشةُ تُقاسُ وحدَها في الاختبارِ
   * بلا موجِّهٍ، وزرٌّ بلا مُستقبِلٍ لا يُرسَمُ أصلاً.
   */
  readonly onOpenSupport?: () => void;
  /**
   * مدخلٌ يُعرَضُ بعدَ روابطِ الشاشةِ (`PD-020`) — **عقدةٌ لا معرفةُ زرٍّ**:
   * سطحُ الراكبِ يُمرِّرُ مدخلَ الاستغاثةِ فيُوضَعُ في سياقِ الشاشةِ لا فوقَها
   * خارجَ إطارِها، وسطحُ السائقِ لا يُمرِّرُ شيئاً فلا يتغيَّرُ شيءٌ.
   */
  readonly header?: ReactNode | undefined;
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
  | {
      readonly kind: "refused";
      readonly refusal: string;
      readonly activeOrders: number;
      readonly walletBalanceMinor: number | undefined;
    }
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

export function AccountRights({
  view,
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  onOpenSupport,
  header,
  exportData = requestDataExport,
  erase = requestErasure,
  saveFile = saveViaBrowser,
  addToHomeScreen = () => {
    addAppToHomeScreen();
  },
  makeKey = () => newIdempotencyKey(undefined, "erasure"),
}: AccountRightsProps) {
  const t = miniAppTranslator(language);
  const k = view.keyPrefix;
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
          walletBalanceMinor: response.walletBalanceMinor,
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
          {t(`${k}erasure.doneTitle`)}
        </h1>
        <p className="ac__erased-at">
          {t(`${k}erasure.doneAt`).replace("{date}", eraseState.erasedAt.slice(0, 10))}
        </p>
        {eraseState.receipt === null ? (
          <p className="sys__hint">{t(`${k}erasure.alreadyErased`)}</p>
        ) : (
          <ReceiptPanel receipt={eraseState.receipt} t={t} view={view} />
        )}
        {/* **بابُ الخروجِ بيدِ صاحبِ الإيصالِ** — لا إغلاقَ تلقائيَّ يسلبُه الوثيقةَ. */}
        {onBack !== undefined && (
          <button type="button" className="sys__action ac__close" onClick={onBack}>
            {t(`${k}erasure.close`)}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="ac" aria-labelledby="account-title">
      <h1 className="ac__title" id="account-title">
        {t(`${k}title`)}
      </h1>

      <nav className="ac__links">
        {onBack !== undefined && (
          <button type="button" className="sys__action ac__back" onClick={onBack}>
            {t(`${k}back`)}
          </button>
        )}
        {/* الوحيدُ ههنا الذي **يفعلُ شيئاً حقيقيّاً**: نداءُ مُضيفِ تيليجرامَ. */}
        <button type="button" className="sys__action" onClick={addToHomeScreen}>
          {t(`${k}addToHomeScreen`)}
        </button>
        {/*
          بابُ الدعمِ — **يُرسَمُ إذا كانَ له مُستقبِلٌ فحسب**: زرُّ «الدعمُ» لا
          يفتحُ شيئاً أسوأُ من غيابِه، وهوَ عينُ ما تمنعُه هذه الشاشةُ في رأسِ
          مِلفِّها.
        */}
        {onOpenSupport !== undefined && (
          <button type="button" className="sys__action ac__support" onClick={onOpenSupport}>
            {t(`${k}support.open`)}
          </button>
        )}
      </nav>

      {/* مدخلُ سطحِ الدورِ (`PD-020`) — يُرسَمُ كما جاءَ أو لا يُرسَمُ. */}
      {header}

      {/* **الحدُّ يُقالُ**: انظرْ رأسَ المِلفِّ — حقلٌ لا يُحفَظُ أسوأُ من غيابِه. */}
      <div className="ac__debt">
        <p className="ac__debt-title">{t(`${k}debt.title`)}</p>
        <ul className="ac__debt-list">
          {view.declaredDebtKeys.map((key) => (
            <li className="ac__debt-item" key={key}>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      <div className="ac__rights">
        <h2 className="ac__rights-title">{t(`${k}rights.title`)}</h2>

        {/* ــ تنزيلُ بياناتي ــ */}
        <div className="ac__export">
          <p className="ac__export-note">{t(`${k}export.note`)}</p>
          <button
            type="button"
            className="sys__action ac__export-run"
            disabled={exportState.kind === "working"}
            onClick={() => void runExport()}
          >
            {t(exportState.kind === "working" ? `${k}export.working` : `${k}export.run`)}
          </button>
          {exportState.kind === "refused" && (
            <p className="ac__export-refusal" role="alert">
              {t(view.exportRefusalKey(exportState.refusal))}
            </p>
          )}
          {exportState.kind === "done" && (
            <p className="ac__export-done" role="status">
              {t(`${k}export.done`)
                .replace("{sections}", String(exportState.sections))
                .replace("{file}", exportState.fileName)}
            </p>
          )}
        </div>

        {/* ــ حذفُ حسابي ــ */}
        <div className="ac__erase">
          <p className="ac__erase-warning">{t(`${k}erasure.warning`)}</p>
          <p className="ac__erase-kept">{t(`${k}erasure.whatStays`)}</p>
          {/*
            `ADR 0113`: **إفصاحٌ قبلَ الضغطِ لا بعدَه**. الإيصالُ يقولُ ما بقيَ
            بعدَ أن وقعَ الحذفُ، وذاكَ متأخِّرٌ عن قرارٍ لا يُنقَضُ: مَن ضغطَ
            يظنُّ أنَّه يمحو حظراً ثمَّ وجدَه عائداً يكونُ قد خُدِعَ بالسكوتِ.
            وسطرٌ مُفصَلٌ بـ`role="note"` لا مُدمَجٌ في `whatStays` لأنَّ هذا
            **حكمٌ عليه** وذاكَ حقُّ غيرِه، فلا يُخبَّأُ في ذيلِ فقرةٍ.
          */}
          <p className="ac__erase-bar" role="note">
            {t(`${k}erasure.barStays`)}
          </p>

          {eraseState.kind === "idle" || eraseState.kind === "refused" ? (
            <>
              {eraseState.kind === "refused" && (
                <p className="ac__erase-refusal" role="alert">
                  {/*
                    **الرقمانِ يُمرَّرانِ معاً لا واحدٌ**: رفضٌ برحلةٍ جاريةٍ
                    يحملُ عدداً، ورفضٌ برصيدٍ يحملُ مبلغاً، والنصُّ الواحدُ لا
                    يحملُ إلّا ما يخصُّه — فاستبدالُ كِلَيهِما آمنٌ لأنَّ النصَّ
                    الذي لا يذكرُ رمزاً لا يتغيَّرُ به.
                  */}
                  {t(view.erasureRefusalKey(eraseState.refusal))
                    .replace("{orders}", String(eraseState.activeOrders))
                    .replace("{amount}", view.walletBalanceText(eraseState.walletBalanceMinor))}
                </p>
              )}
              <button type="button" className="ac__erase-open" onClick={openConfirm}>
                {t(`${k}erasure.open`)}
              </button>
            </>
          ) : (
            <div className="ac__erase-confirm">
              <label className="ac__erase-label" htmlFor={confirmInputId}>
                {t(`${k}erasure.typeToConfirm`).replace("{word}", t(`${k}erasure.word`))}
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
                {t(eraseState.kind === "working" ? `${k}erasure.working` : `${k}erasure.run`)}
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
                {t(`${k}erasure.cancel`)}
              </button>
            </div>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="ac__error" role="alert">
          <p>{t(view.accountErrorKey(error))}</p>
          {isRetryableAccountError(error) && (
            <p className="sys__hint">{t(`${k}error.retryHint`)}</p>
          )}
        </div>
      )}
    </section>
  );
}

function ReceiptPanel({
  receipt,
  t,
  view,
}: {
  readonly receipt: ReceiptView;
  readonly t: (key: string) => string;
  readonly view: AccountViewModel;
}) {
  const k = view.keyPrefix;
  return (
    <div className="ac__receipt">
      <p className="ac__receipt-total">
        {t(`${k}receipt.total`).replace("{rows}", String(receipt.totalRemoved))}
      </p>

      <h2 className="ac__receipt-heading">{t(`${k}receipt.erased`)}</h2>
      <ul className="ac__receipt-list">
        {receipt.erased.map((line) => (
          <li className="ac__receipt-item" key={`erased-${line.section}`}>
            {t(view.sectionKey(line.section))} — {line.rows}
          </li>
        ))}
      </ul>

      <h2 className="ac__receipt-heading">{t(`${k}receipt.anonymized`)}</h2>
      <ul className="ac__receipt-list">
        {receipt.anonymized.map((line) => (
          <li className="ac__receipt-item" key={`anon-${line.section}`}>
            {t(view.sectionKey(line.section))} — {line.rows}
          </li>
        ))}
      </ul>

      {/* **ما بقيَ ومعَه سببُه** — وهذا هوَ الفرقُ بينَ إيصالٍ وجملةِ تطمينٍ. */}
      <h2 className="ac__receipt-heading">{t(`${k}receipt.retained`)}</h2>
      <ul className="ac__receipt-list ac__receipt-list--retained">
        {receipt.retained.map((line) => (
          <li className="ac__receipt-item" key={`kept-${line.section}`}>
            <span className="ac__receipt-section">
              {t(view.sectionKey(line.section))} — {line.rows}
            </span>
            <span className="ac__receipt-basis">
              {line.basis === null ? "" : t(view.retentionBasisKey(line.basis))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
