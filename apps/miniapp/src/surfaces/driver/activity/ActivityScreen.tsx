/**
 * الغرض: شاشةُ حصيلةِ السائقِ — عمَلٌ بعددِه وساعتِه، وأداءٌ **بمقاماتِه**،
 *   وعواملُ ترتيبٍ كما هيَ (البند `F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/activity
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — الاشتراكُ شاشةٌ أخرى تُقرأُ من مسارِها.
 * يحرسُه: scripts/check-driver-activity-contract.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ لا رقمَ واحدٌ كبيرٌ في أعلى الشاشةِ
 *
 * لأنَّ **لا مالَ في هذه المنصّةِ** يُجمَعُ ليكونَ ذاكَ الرقمَ (`ADR 0039` §٤):
 * فالبديلُ الصادقُ عددُ رحلاتٍ وساعاتُ إتاحةٍ، والبديلُ الكاذبُ رقمٌ يُخترَعُ من
 * تقديرِ أجرةٍ لا تعرفُها المنصّةُ ولا تحصلُ عليها.
 *
 * ## ولِمَ يُقالُ صريحاً إنَّ الرفضَ **لا يُنقِصُ الترتيبَ**
 *
 * لأنَّ الغموضَ ههنا **يُخيفُ ويكسبُ**: سائقٌ يظنُّ أنَّ رفضاً يُعاقِبُه يقبلُ
 * رحلةً لا يريدُها. ومعادلةُ المطابَقةِ اليومَ لا تقرأُ قبولاً ولا رفضاً، فقولُ
 * ذاكَ **إعادةُ سلطةٍ إلى صاحبِها**. والحقلُ من الخادمِ: يومَ تتغيَّرُ المعادلةُ
 * يتغيَّرُ النصُّ حيثُ تغيَّرَت لا في ملفِّ ترجمةٍ يُنسى.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تعرضُ مبلغاً ولا تُقدِّرُ دخلاً**: سببُ الغيابِ منشورٌ نصّاً.
 *   ــ **لا تُقارِنُ بسائقٍ آخرَ**: لا رُتبةَ ولا مِئينَ — رقمُكَ عن عملِكَ.
 *   ــ **لا تُظهِرُ صفراً موضعَ «غيرِ مقيسٍ»**: المقامُ يُعرَضُ دائماً.
 *   ــ **لا تُخفي هدفاً ولا تعرضُ شارةً**: لا تحفيزَ مُصطنَعاً على شاشةِ حقائقَ.
 *   ــ **لا مؤقّتَ ولا تحديثَ تلقائيَّ**: تقريرٌ يُقرأُ بطلبٍ، لا لوحُ مراقبةٍ
 *      ينبضُ على بطاريّةِ سائقٍ.
 *   ــ **لا هويّةَ راكبٍ في الجدولِ**: لا اسمَ ولا رقماً — رحلةٌ ووقتُها.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import {
  type DriverActivityEntriesResponse,
  type DriverActivitySummaryResponse,
  readDriverActivityEntries,
  readDriverActivitySummary,
} from "./activity-api.ts";
import type { ApiActivityPeriod } from "./activity-contract.ts";
import {
  ACTIVITY_PERIOD_ORDER,
  type ActivityLogModel,
  type ActivitySummaryModel,
  activityErrorKey,
  isRetryableActivityError,
  type RatioModel,
  toActivityLog,
  toActivitySummary,
} from "./activity-view.ts";

/** سقفُ الجدولِ المطلوبُ — والمُنفَذُ يُقرأُ من الجوابِ لا يُفترَضُ ههنا. */
const ENTRIES_LIMIT = 20;

export interface ActivityScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readSummary?: (period: ApiActivityPeriod) => Promise<DriverActivitySummaryResponse>;
  readonly readEntries?: (
    period: ApiActivityPeriod,
    limit: number,
  ) => Promise<DriverActivityEntriesResponse>;
}

type SummaryState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: ActivitySummaryModel }
  | { readonly kind: "failed"; readonly code: string };

type LogState =
  | { readonly kind: "closed" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly log: ActivityLogModel }
  | { readonly kind: "failed"; readonly code: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/**
 * سطرُ الكسرِ. و**المقامُ يُعرَضُ في الحالَينِ**: مقيساً ليُفهَمَ من أينَ جاءت
 * النسبةُ، وغيرَ مقيسٍ ليُعلَمَ أنَّ الفراغَ سببُه أنَّه لم يُعرَضْ شيءٌ.
 */
function RatioRow({
  labelKey,
  ratio,
  t,
}: {
  readonly labelKey: string;
  readonly ratio: RatioModel;
  readonly t: (key: string) => string;
}) {
  return (
    <p className="dac__ratio">
      <span className="dac__ratio-label">{t(labelKey)}</span>
      <span className="dac__ratio-value">
        {ratio.verdict === "UNMEASURED"
          ? t("driver.activity.ratio.unmeasured")
          : `${String(ratio.percent)}%`}
      </span>
      <span className="dac__ratio-basis">
        {t("driver.activity.ratio.basis")
          .replace("{numerator}", String(ratio.numerator))
          .replace("{denominator}", String(ratio.denominator))}
      </span>
    </p>
  );
}

export function ActivityScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  readSummary = readDriverActivitySummary,
  readEntries = readDriverActivityEntries,
}: ActivityScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [period, setPeriod] = useState<ApiActivityPeriod>("day");
  const [state, setState] = useState<SummaryState>({ kind: "loading" });
  const [log, setLog] = useState<LogState>({ kind: "closed" });

  const load = useCallback(
    async (next: ApiActivityPeriod) => {
      setState({ kind: "loading" });
      // **الجدولُ يُغلَقُ عندَ تغيُّرِ المُدّةِ**: صفوفُ أسبوعٍ تحتَ عنوانِ يومٍ
      // كذبٌ صامتٌ، وإبقاؤها ريثما يُقرأُ الجديدُ يُريهِ لحظةً كاذبةً.
      setLog({ kind: "closed" });
      try {
        setState({ kind: "ready", summary: toActivitySummary(await readSummary(next)) });
      } catch (thrown) {
        setState({ kind: "failed", code: codeOf(thrown) });
      }
    },
    [readSummary],
  );

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const openLog = useCallback(async () => {
    setLog({ kind: "loading" });
    try {
      setLog({ kind: "ready", log: toActivityLog(await readEntries(period, ENTRIES_LIMIT)) });
    } catch (thrown) {
      setLog({ kind: "failed", code: codeOf(thrown) });
    }
  }, [period, readEntries]);

  function PeriodTabs() {
    // `fieldset` لا `div role="group"`: العنصرُ الأصليُّ يحملُ المعنى في شجرةِ
    // الوصولِ بلا وسمٍ يُضافُ ويُنسى (كما في `sm__stars`).
    return (
      <fieldset className="dac__periods" aria-label={t("driver.activity.period.label")}>
        {ACTIVITY_PERIOD_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={option === period ? "dac__period dac__period--active" : "dac__period"}
            aria-pressed={option === period}
            onClick={() => setPeriod(option)}
          >
            {t(`driver.activity.period.${option}`)}
          </button>
        ))}
      </fieldset>
    );
  }

  if (state.kind === "loading") {
    return (
      <section className="dac" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="dac__title">
          {t("driver.activity.title")}
        </h1>
        <PeriodTabs />
        <p className="dac__loading">{t("driver.activity.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dac" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="dac__title">
          {t("driver.activity.title")}
        </h1>
        <PeriodTabs />
        <EmptyState title={t("driver.activity.failed")} body={t(activityErrorKey(state.code))} />
        {isRetryableActivityError(state.code) ? (
          <button type="button" className="dac__retry" onClick={() => void load(period)}>
            {t("driver.activity.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dac__back" onClick={onBack}>
            {t("driver.activity.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const summary = state.summary;

  return (
    <section className="dac" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="dac__title">
        {t("driver.activity.title")}
      </h1>
      <PeriodTabs />

      {/* النافذةُ **بمنطقةِ زمنِها**: حدُّ «اليومِ» يُقالُ ولا يُترَكُ لحسبانِ جهازٍ. */}
      <p className="dac__window">
        {t("driver.activity.window")
          .replace("{from}", summary.from)
          .replace("{to}", summary.to)
          .replace("{timezone}", summary.timezone)}
      </p>

      <div className="dac__facts">
        <p className="dac__fact">
          <span className="dac__fact-label">{t("driver.activity.rides")}</span>
          <span className="dac__fact-value">{summary.ridesCompleted}</span>
        </p>
        <p className="dac__fact">
          <span className="dac__fact-label">{t("driver.activity.hours")}</span>
          <span className="dac__fact-value">
            {t("driver.activity.hours.value")
              .replace("{hours}", String(summary.duration.hours))
              .replace("{minutes}", String(summary.duration.minutes))}
          </span>
          {/* فترةٌ جاريةٌ: الرقمُ **ما زالَ يزيدُ** فيُقالُ ولا يُقرأُ نهائيّاً. */}
          {summary.attendanceOpen ? (
            <span className="dac__fact-note">{t("driver.activity.hours.open")}</span>
          ) : null}
        </p>
      </div>

      {/* المالُ **غيابٌ مُعلَنٌ بسببِه** — لا صفرٌ ولا فراغٌ (`ADR 0039` §٤). */}
      <p className="dac__money">{t(summary.moneyBasisKey)}</p>

      <h2 className="dac__section">{t("driver.activity.performance")}</h2>
      <RatioRow labelKey="driver.activity.acceptance" ratio={summary.acceptance} t={t} />
      <RatioRow labelKey="driver.activity.cancellation" ratio={summary.cancellation} t={t} />

      <p className="dac__rating">
        <span className="dac__rating-label">{t("driver.activity.rating")}</span>
        <span className="dac__rating-value">
          {summary.ratingAverage === null
            ? t("driver.activity.rating.none")
            : summary.ratingAverage.toFixed(2)}
        </span>
        <span className="dac__rating-count">
          {t("driver.activity.rating.count").replace("{count}", String(summary.ratingCount))}
        </span>
      </p>
      {/* حدُّ الثقةِ يُقالُ **رقماً** لا وصفاً: سائقٌ يعرفُ كم يبقى له. */}
      {summary.ratingTrustMinCount === null ? null : (
        <p className="dac__trust">
          {summary.ratingBelowTrust === true
            ? t("driver.activity.rating.belowTrust").replace(
                "{count}",
                String(summary.ratingTrustMinCount),
              )
            : t("driver.activity.rating.trusted")}
        </p>
      )}

      <h2 className="dac__section">{t("driver.activity.ranking")}</h2>
      <ul className="dac__factors">
        {summary.rankingFactors.map((factor) => (
          <li key={factor.key} className="dac__factor">
            <span className="dac__factor-label">{t(factor.labelKey)}</span>
            <span className="dac__factor-weight">
              {factor.weight === null
                ? t("driver.activity.ranking.weight.unknown")
                : String(factor.weight)}
            </span>
          </li>
        ))}
      </ul>
      {/* **الحقيقةُ من الخادمِ**: نصٌّ لكلِّ حالٍ، ولا يُخمَّنُ في الترجمةِ. */}
      <p className="dac__behaviour">
        {summary.behaviourAffectsRanking
          ? t("driver.activity.ranking.behaviourCounts")
          : t("driver.activity.ranking.behaviourIgnored")}
      </p>

      <h2 className="dac__section">{t("driver.activity.log")}</h2>
      {log.kind === "closed" ? (
        <button type="button" className="dac__open-log" onClick={() => void openLog()}>
          {t("driver.activity.log.open")}
        </button>
      ) : null}
      {log.kind === "loading" ? (
        <p className="dac__loading">{t("driver.activity.loading")}</p>
      ) : null}
      {log.kind === "failed" ? (
        <>
          <p className="dac__error" role="status">
            {t(activityErrorKey(log.code))}
          </p>
          <button type="button" className="dac__open-log" onClick={() => void openLog()}>
            {t("driver.activity.retry")}
          </button>
        </>
      ) : null}
      {log.kind === "ready" ? (
        log.log.entries.length === 0 ? (
          // `UX-5` — الفراغُ يُقالُ صراحةً ولا يُترَكُ بياضاً يُقرأُ عطلاً.
          <EmptyState
            title={t("driver.activity.log.empty.title")}
            body={t("driver.activity.log.empty.body")}
          />
        ) : (
          <ul className="dac__entries">
            {log.log.entries.map((entry) => (
              <li key={entry.orderId} className="dac__entry">
                <span className="dac__entry-service">{t(entry.serviceKey)}</span>
                <span className="dac__entry-time">{entry.completedAt}</span>
                <span className="dac__entry-duration">
                  {entry.duration === null
                    ? t("driver.activity.entry.duration.unknown")
                    : t("driver.activity.hours.value")
                        .replace("{hours}", String(entry.duration.hours))
                        .replace("{minutes}", String(entry.duration.minutes))}
                </span>
                {/* المسافةُ **موسومةٌ بأساسِها**: خطٌّ مستقيمٌ لا طريقٌ مقطوعٌ. */}
                <span className="dac__entry-distance">
                  {entry.distanceKm === null || entry.distanceBasisKey === null
                    ? t("driver.activity.entry.distance.unknown")
                    : `${entry.distanceKm.toFixed(1)} · ${t(entry.distanceBasisKey)}`}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <button type="button" className="dac__retry" onClick={() => void load(period)}>
        {t("driver.activity.refresh")}
      </button>
      {onBack === undefined ? null : (
        <button type="button" className="dac__back" onClick={onBack}>
          {t("driver.activity.backToBoard")}
        </button>
      )}
    </section>
  );
}
