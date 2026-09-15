/**
 * الغرض: شاشةُ مَهمّةِ السائقِ النشطةِ — **زرٌّ واحدٌ للطَورِ الواحدِ** ورابطُ
 *   ملاحةٍ وراكبٌ بلا هويّةٍ تُتعقَّبُ (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — بعدَ الإنهاءِ يُقالُ سطرٌ، والحصيلةُ شاشةٌ
 *   أخرى تُقرأُ من مسارِها.
 * يحرسُه: scripts/check-driver-job-contract.ts
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ زرٌّ واحدٌ ظاهرٌ في كلِّ لحظةٍ
 *
 * لأنَّ السائقَ يقرأُ هذه الشاشةَ **وهوَ يقودُ**: ثلاثةُ أزرارٍ معروضةٍ معاً
 * تُنتِجُ ضغطةً خاطئةً تُردُّ `PHASE_MISMATCH` فتُقرأُ عطلاً، وتُنتِجُ أسوأَ من
 * ذاكَ — إنهاءَ رحلةٍ لم تبدأْ. والخادمُ يقولُ **ما يُفعَلُ الآنَ** فيُعرَضُ.
 *
 * ## ولِمَ لا مؤقّتَ ولا عدَّ تصاعديّاً في هذه الشاشةِ
 *
 * مهلةُ العرضِ (`F3-02`) حكمُ صلاحيّةٍ يُلغي فرصةً، فوجبَ عدُّها. أمّا المَهمّةُ
 * فلا مهلةَ لها: رحلةٌ تطولُ لا تُلغى بمرورِ ثانيةٍ، وعقربٌ يدقُّ على شاشةِ
 * سائقٍ يُصنَعُ ضغطاً كاذباً ويُستهلَكُ بطاريّةً بلا فائدةٍ. والأختامُ تُقالُ نصّاً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُلغي رحلةً**: لا مسارَ إلغاءٍ للسائقِ ههنا، وسياستُه مُجمَّدةٌ
 *      بقرارٍ (`F2-06`) — وزرٌّ بلا كاتبٍ خيانةُ عرضٍ.
 *   ــ **لا تتّصلُ براكبٍ ولا تُراسِلُه**: العقدُ لا يحملُ هاتفاً ولا معرِّفاً.
 *   ــ **لا تُظهِرُ زرَّ نجدةٍ**: نجدةُ السائقِ **دَينٌ مُعلَنٌ** (زيادةٌ ثانيةٌ)
 *      لأنَّ مسارَ `F2-10` يُركِّبُ الدورَ راكباً حرفاً — وزرٌّ رماديٌّ في شاشةِ
 *      سلامةٍ أسوأُ من غيابِه.
 *   ــ **لا تبثُّ موضعاً**: البثُّ بندُ `F3-04`، ولا يُشتَقُّ طَورٌ من قُربٍ.
 *   ــ **لا تُبقي حالاً بعدَ رفضٍ يعني تقادُماً**: تُعيدُ القراءةَ من القاعدةِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { openExternalLink } from "../../../tg/index.ts";
import {
  completeDriverRide,
  type DriverActiveJobResponse,
  markDriverArrived,
  readDriverActiveJob,
  startDriverRide,
} from "./job-api.ts";
import type { ApiDriverJobAction } from "./job-contract.ts";
import {
  type ActiveJobModel,
  isRetryableJobError,
  jobErrorKey,
  shouldReloadAfterJobError,
  toActiveJob,
} from "./job-view.ts";

export interface JobScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readJob?: () => Promise<DriverActiveJobResponse>;
  readonly arrive?: (orderId: string) => Promise<unknown>;
  readonly start?: (orderId: string) => Promise<unknown>;
  readonly complete?: (orderId: string) => Promise<unknown>;
  readonly openLink?: (url: string) => unknown;
}

type JobState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly job: ActiveJobModel | null }
  | { readonly kind: "failed"; readonly code: string };

type ActState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

const DONE_KEY: Readonly<Record<ApiDriverJobAction, string>> = {
  MARK_ARRIVED: "driver.job.done.MARK_ARRIVED",
  START_RIDE: "driver.job.done.START_RIDE",
  COMPLETE_RIDE: "driver.job.done.COMPLETE_RIDE",
};

function StampRow({
  labelKey,
  value,
  t,
}: {
  readonly labelKey: string;
  readonly value: string | null;
  readonly t: (key: string) => string;
}) {
  return (
    <p className={value === null ? "djb__stamp djb__stamp--absent" : "djb__stamp"}>
      {t(labelKey)}: {value ?? t("driver.job.stamp.none")}
    </p>
  );
}

export function JobScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  readJob = readDriverActiveJob,
  arrive = markDriverArrived,
  start = startDriverRide,
  complete = completeDriverRide,
  openLink = (url: string) => openExternalLink(url),
}: JobScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<JobState>({ kind: "loading" });
  const [act, setAct] = useState<ActState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await readJob();
      setState({
        kind: "ready",
        job: response.job === null ? null : toActiveJob(response.job),
      });
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readJob]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (job: ActiveJobModel) => {
      setAct({ kind: "busy" });
      const writer =
        job.action === "MARK_ARRIVED" ? arrive : job.action === "START_RIDE" ? start : complete;
      try {
        await writer(job.orderId);
        setAct({ kind: "done", key: DONE_KEY[job.action] });
        // **القاعدةُ تقولُ الطَورَ التاليَ**: لا تُحرَّكُ الشاشةُ بتخمينٍ محليٍّ.
        await load();
      } catch (thrown) {
        const code = codeOf(thrown);
        setAct({ kind: "failed", key: jobErrorKey(code) });
        if (shouldReloadAfterJobError(code)) await load();
      }
    },
    [arrive, complete, load, start],
  );

  if (state.kind === "loading") {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        <p className="djb__loading">{t("driver.job.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        <EmptyState title={t("driver.job.failed")} body={t(jobErrorKey(state.code))} />
        {isRetryableJobError(state.code) ? (
          <button type="button" className="djb__retry" onClick={() => void load()}>
            {t("driver.job.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  if (state.job === null) {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        {/* `UX-5` — الفراغُ يُقالُ صراحةً ولا يُترَكُ بياضاً يُقرأُ عطلاً. */}
        <EmptyState title={t("driver.job.none.title")} body={t("driver.job.none.body")} />
        <button type="button" className="djb__retry" onClick={() => void load()}>
          {t("driver.job.refresh")}
        </button>
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const job = state.job;

  return (
    <section className="djb" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="djb__title">
        {t("driver.job.title")}
      </h1>

      <div className="djb__head">
        <span className="djb__service">{t(job.serviceKey)}</span>
        <span className="djb__phase" role="status">
          {t(job.phaseKey)}
        </span>
      </div>

      <p className="djb__rider">
        {t("driver.job.rider")}:{" "}
        {job.riderFirstName === null || job.riderFirstName === ""
          ? t("driver.job.rider.unnamed")
          : job.riderFirstName}
        {job.riderLanguageCode === null ? null : (
          <span className="djb__rider-language"> · {job.riderLanguageCode}</span>
        )}
      </p>

      <p className="djb__place">
        {t("driver.job.pickup")}: {job.pickup.label ?? t("driver.job.place.unnamed")}
      </p>
      <p className="djb__coords">
        {job.pickup.latitude} , {job.pickup.longitude}
      </p>
      <p className="djb__place">
        {t("driver.job.dropoff")}:{" "}
        {job.dropoff === null
          ? t("driver.job.place.none")
          : (job.dropoff.label ?? t("driver.job.place.unnamed"))}
      </p>

      <p className="djb__notes">
        {t("driver.job.notes")}:{" "}
        {job.notes === null || job.notes === "" ? t("driver.job.noNotes") : job.notes}
      </p>

      <StampRow labelKey="driver.job.stamp.matchedAt" value={job.matchedAt} t={t} />
      <StampRow labelKey="driver.job.stamp.arrivedAt" value={job.arrivedAt} t={t} />
      <StampRow labelKey="driver.job.stamp.startedAt" value={job.startedAt} t={t} />

      <div className="djb__actions">
        {/* الملاحةُ **خارجَ التطبيقِ**: رابطٌ يُنقَرُ، لا خريطةٌ تُحمَّلُ. */}
        <button
          type="button"
          className="djb__navigate"
          onClick={() => {
            openLink(job.navigateTo.navigationUrl);
          }}
        >
          {t("driver.job.navigate")}
        </button>
        <button
          type="button"
          className="djb__advance"
          disabled={act.kind === "busy"}
          onClick={() => void runAction(job)}
        >
          {t(job.actionLabelKey)}
        </button>
      </div>

      {act.kind === "done" ? (
        <p className="djb__done" role="status">
          {t(act.key)}
        </p>
      ) : null}
      {act.kind === "failed" ? (
        <p className="djb__error" role="status">
          {t(act.key)}
        </p>
      ) : null}

      {onBack === undefined ? null : (
        <button type="button" className="djb__back" onClick={onBack}>
          {t("driver.job.backToBoard")}
        </button>
      )}
    </section>
  );
}
