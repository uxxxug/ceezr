/**
 * الغرض: شاشةُ سجلِّ الرحلاتِ — مجموعاتٌ بالشهرِ وبحثٌ بالاسمِ وتحميلٌ بمفتاحٍ
 *   (البند `F2-08` · `SR-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/history
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` (طورُ `browsed`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) تعرضُ العناوينَ نفسَها.
 *
 * ## لماذا البحثُ **بزرٍّ** لا بكلِّ حرفٍ
 *
 * كلُّ حرفٍ نداءٌ، والنداءُ الأخيرُ قد يسبقُه في الشبكةِ نداءٌ أقدمُ فتُعرَضَ
 * نتيجةُ نصٍّ لم يُكتَبْ. ومهلةٌ (debounce) تُخفي السباقَ ولا تُلغيه، وتُنتِجُ
 * شاشةً تتغيَّرُ بعدَ توقُّفِ الإصبعِ بلا سببٍ ظاهرٍ. **والزرُّ سؤالٌ واحدٌ
 * مُعلَنٌ**، ومعَه حاجزُ «سؤالٍ أخيرٍ» (`issued`) يطرحُ كلَّ ردٍّ متأخِّرٍ.
 *
 * ## ولماذا «مزيدٌ» يُضيفُ ولا يُبدِّلُ
 *
 * سجلٌّ يُقرأُ بتصفُّحٍ مستمرٍّ؛ وصفحةٌ تُبدِّلُ ما قبلَها تُفقِدُ الراكبَ موضعَه.
 * **والمجموعاتُ تُطوى عندَ الوصلِ**: صفحةٌ تبدأُ بالشهرِ الذي انتهت به سابقتُها
 * لا تُنشئُ عنواناً ثانياً لنفسِ الشهرِ.
 *
 * ## ولماذا رحلةٌ **جاريةٌ** تقودُ إلى شاشةِ المُتابَعةِ لا إلى التفاصيلِ
 *
 * لأنَّ سؤالَ الراكبِ عنها «أينَ سائقي الآنَ؟» لا «ماذا جرى؟». وتفاصيلُ ساكنةٌ
 * لرحلةٍ متحرِّكةٍ جوابٌ عن سؤالٍ لم يُسألْ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ مبلغاً ولا إيصالاً ولا مجموعَ مصروفِ شهرٍ ولا خانةً لها** —
 *      مُجمَّدةٌ بـ`ADR 0039` §٤ (`DEC-11` · `م13-7`).
 *   ــ **لا ترسمُ خريطةً ولا صورةَ مسارٍ** (`ADR 0007`).
 *   ــ **لا تعرضُ عدداً إجماليّاً للرحلاتِ**: لا يُقاسُ في هذا العقدِ، ورقمٌ
 *      غيرُ مقيسٍ لا يُعرَضُ (`ح-5`).
 *   ــ **لا تُصفِّي ولا تفرزُ محليّاً**: الحكمُ في القاعدةِ، وتصفيةٌ ههنا تُنتِجُ
 *      صفحةً ناقصةً تبدو تامّةً.
 *   ــ **لا تعِدُ ببحثٍ يتجاوزُ المُطابَقةَ الحرفيّةَ**: لا تطبيعَ عربيّاً ولا
 *      بحثاً تقريبيّاً في هذا البندِ — **دَينٌ مُصرَّحٌ** في `ADR 0108`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
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
import { SosEntry } from "../sos/SosEntry.tsx";
import { readRideHistory as readViaApi } from "./ride-history-api.ts";

import type {
  ApiRideHistoryCursor,
  ApiRideHistoryGroup,
  RideHistoryResponse,
} from "./ride-history-contract.ts";
import {
  DEFAULT_RIDE_HISTORY_PAGE_SIZE,
  historyErrorKey,
  historyRefusalKey,
  instantParts,
  MAX_RIDE_HISTORY_QUERY_LENGTH,
  monthHeading,
  monthNameKey,
  outcomeKey,
  type RideOutcomeClass,
  rideOutcomeClassOf,
  serviceKey,
  showsTimezoneNotice,
  statusLabel,
  timezoneTrustKey,
} from "./ride-history-view.ts";

export interface RideHistoryScreenProps {
  readonly read?: (input: {
    readonly query: string | null;
    readonly pageSize: number;
    readonly cursor: ApiRideHistoryCursor | null;
  }) => Promise<RideHistoryResponse>;
  /**
   * رحلةٌ منتهيةٌ أو ملغاةٌ ⇒ تفاصيلُها. وتُسلَّمُ **المنطقةُ معَ المعرِّفِ**: شاشةُ التفاصيلِ تعرضُ لحظاتِ أحداثٍ، وقراءتُها
   * بساعةٍ تخالفُ ساعةَ عنوانِ الشهرِ الذي فُتِحَت منه تُنقِضُ القائمةَ نفسَها.
   * والمنطقةُ هيَ ما أعلنَه الخادمُ لا ما يظنُّه الجهازُ (القاعدة 0.6).
   */
  readonly onOpenDetail?: (orderId: string, timeZone: string) => void;
  /** رحلةٌ جاريةٌ ⇒ شاشةُ المُتابَعةِ. وغيابُه يجعلُ البطاقةَ غيرَ قابلةٍ للفتحِ
   *  **ولا يفتحُ تفاصيلَ ساكنةً بدلاً منها**. */
  readonly onOpenActive?: (orderId: string) => void;
  readonly onBack?: () => void;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ: يُرسَمُ إذا مُرِّرَ. */
  readonly onOpenSos?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
}

/**
 * شارةُ مآلٍ: المآلُ **ومعدِّلُ الصنفِ مكتوباً حرفاً**.
 *
 * ## ولماذا جدولٌ لا `` `hs__badge--${outcome.toLowerCase()}` ``
 *
 * لأنَّ حاجزَ تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ النصَّ الساكنَ،
 * وصنفٌ يُبنى في زمنِ التشغيلِ **يمرُّ في كلِّ بوّابةٍ** ولو كانَ بلا قاعدةٍ في
 * ورقةِ النمطِ — فيراهُ الراكبُ وحدَه عنصراً عارياً. والشكلُ من جدولِ
 * `Skeleton.tsx` نفسِه: مفتاحُ `modifier` بقيمةٍ حرفيةٍ يراهُ الحاجزُ.
 */
interface OutcomeBadge {
  readonly outcome: RideOutcomeClass;
  readonly modifier: string;
}

const OUTCOME_BADGES: readonly OutcomeBadge[] = [
  { outcome: "IN_FLIGHT", modifier: "hs__badge--in-flight" },
  { outcome: "COMPLETED", modifier: "hs__badge--completed" },
  { outcome: "NOT_COMPLETED", modifier: "hs__badge--not-completed" },
  { outcome: "OTHER", modifier: "hs__badge--other" },
];

/**
 * مآلٌ لا صفَّ له يأخذُ `--other`: شارةٌ مقروءةٌ **ولا عنصرٌ عارٍ**. والسقوطُ
 * مكتوبٌ ولو كانَ الاتحادُ مُقفَلاً اليومَ: إضافةُ صنفٍ رابعٍ في `packages/domain`
 * لا يجوزُ أن تتركَ الشارةَ بلا مُحدِّدٍ.
 */
const FALLBACK_BADGE: OutcomeBadge = { outcome: "OTHER", modifier: "hs__badge--other" };

function badgeOf(outcome: RideOutcomeClass): OutcomeBadge {
  return OUTCOME_BADGES.find((row) => row.outcome === outcome) ?? FALLBACK_BADGE;
}

type Accepted = Extract<RideHistoryResponse, { accepted: true }>;

interface Loaded {
  readonly groups: readonly ApiRideHistoryGroup[];
  readonly hasMore: boolean;
  readonly nextCursor: ApiRideHistoryCursor | null;
  readonly monthTimezone: string;
  readonly monthTimezoneTrust: string;
  readonly query: string | null;
}

type HistoryState =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "ready"; readonly loaded: Loaded };

type SystemState = { readonly screen: ScreenState } | null;

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

/**
 * يَصِلُ صفحةً بما قبلَها — **ويطوي المجموعةَ المتّصلةَ** ولا يُنشئُ عنواناً
 * ثانياً للشهرِ نفسِه. ولا يفرزُ: الترتيبُ حكمُ القاعدةِ.
 */
function appendGroups(
  current: readonly ApiRideHistoryGroup[],
  next: readonly ApiRideHistoryGroup[],
): readonly ApiRideHistoryGroup[] {
  if (next.length === 0) return current;
  if (current.length === 0) return next;
  const last = current[current.length - 1];
  const first = next[0];
  if (last === undefined || first === undefined || last.monthKey !== first.monthKey) {
    return [...current, ...next];
  }
  return [
    ...current.slice(0, -1),
    { monthKey: last.monthKey, rides: [...last.rides, ...first.rides] },
    ...next.slice(1),
  ];
}

export function RideHistoryScreen({
  read = readViaApi,
  onOpenDetail,
  onOpenActive,
  onBack,
  onOpenSos,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: RideHistoryScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<HistoryState>({ kind: "reading" });
  const [system, setSystem] = useState<SystemState>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  /** حاجزُ تزامنٍ **مرجعٌ**: قراءةٌ واحدةٌ بلا تغييرِ هويّةِ دالّةٍ. */
  const busyRef = useRef(false);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-05`). */
  const issued = useRef(0);
  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (input: {
      readonly query: string | null;
      readonly cursor: ApiRideHistoryCursor | null;
      readonly previous: readonly ApiRideHistoryGroup[] | null;
    }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const question = ++issued.current;
      try {
        const response = await read({
          query: input.query,
          pageSize: DEFAULT_RIDE_HISTORY_PAGE_SIZE,
          cursor: input.cursor,
        });
        if (!mounted.current || question !== issued.current) return;
        if (!response.accepted) {
          setState({ kind: "refused", refusal: response.refusal });
          return;
        }
        const page: Accepted = response;
        setState({
          kind: "ready",
          loaded: {
            groups:
              input.previous === null ? page.groups : appendGroups(input.previous, page.groups),
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            monthTimezone: page.monthTimezone,
            monthTimezoneTrust: page.monthTimezoneTrust,
            query: page.query,
          },
        });
      } catch (thrown) {
        if (!mounted.current || question !== issued.current) return;
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) setSystem({ screen });
        else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [read],
  );

  /** نداءٌ واحدٌ عندَ الدخولِ — السجلُّ ماضٍ لا يتحرَّكُ بنفسِه. */
  useEffect(() => {
    void load({ query: null, cursor: null, previous: null });
  }, [load]);

  const search = useCallback(() => {
    const trimmed = draft.trim();
    // **بحثٌ جديدٌ يبدأُ من رأسِ السجلِّ**: مفتاحُ صفحةٍ قديمٍ لا معنى له في
    // نتيجةِ نصٍّ آخرَ، واستعمالُه يُنتِجُ صفحةً تبدو أوّلاً وليست أوّلاً.
    void load({ query: trimmed.length === 0 ? null : trimmed, cursor: null, previous: null });
  }, [draft, load]);

  if (system !== null) {
    return (
      <SystemScreen
        state={system.screen}
        onAction={() => void load({ query: null, cursor: null, previous: null })}
        busy={busy}
      />
    );
  }

  const searchBar = (
    <div className="hs__search">
      <label className="hs__search-label" htmlFor="hs-query">
        {t("rider.history.search.label")}
      </label>
      <input
        className="hs__search-input"
        id="hs-query"
        type="search"
        maxLength={MAX_RIDE_HISTORY_QUERY_LENGTH}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" className="hs__search-submit" disabled={busy} onClick={() => search()}>
        {t(busy ? "rider.history.search.searching" : "rider.history.search.submit")}
      </button>
      {/* «بحثٌ حرفيٌّ» يُقالُ صراحةً: وعدٌ بأقلَّ مما يُتوقَّعُ أصدقُ من صمتٍ
          يُقرأُ وعداً بأكثرَ. */}
      <p className="hs__search-hint">{t("rider.history.search.hint")}</p>
    </div>
  );

  const rideCard = (ride: ApiRideHistoryGroup["rides"][number], timeZone: string) => {
    const outcome = rideOutcomeClassOf(ride.status);
    // يُربَطُ الصفُّ بمتغيّرٍ كي يكونَ الإحلالُ `badge.modifier` — الشكلُ الذي يقرأُه
    // حاجزُ تغطيةِ الأنماطِ من جدولٍ حرفيٍّ في الملفِّ نفسِه (`ADR 0105` · القاعدة ٣).
    const badge = badgeOf(outcome);
    const label = statusLabel(ride.status);
    const created = instantParts(ride.createdAt, timeZone);
    const open =
      outcome === "IN_FLIGHT"
        ? onOpenActive === undefined
          ? undefined
          : () => onOpenActive(ride.orderId)
        : onOpenDetail === undefined
          ? undefined
          : () => onOpenDetail(ride.orderId, timeZone);

    return (
      <li className="hs__item" key={ride.orderId}>
        <button
          type="button"
          className="hs__card"
          disabled={open === undefined}
          onClick={() => open?.()}
        >
          <span className={`hs__badge ${badge.modifier}`}>{t(outcomeKey(outcome))}</span>
          <span className="hs__status">
            {label.known ? t(label.key) : t(label.key).replace("{status}", label.raw)}
          </span>
          <span className="hs__service">{t(serviceKey(ride.service))}</span>
          <span className="hs__route">
            {t("rider.history.route")
              .replace("{pickup}", ride.pickupLabel ?? t("rider.history.point.unlabeled"))
              .replace("{dropoff}", ride.dropoffLabel ?? t("rider.history.point.unlabeled"))}
          </span>
          {/* لحظةٌ لا تُقرأُ **تُقالُ غياباً** ولا تُستبدَلُ بلحظةِ جهازٍ. */}
          <span className="hs__when">
            {created === null
              ? t("rider.history.when.unreadable")
              : t("rider.history.when")
                  .replace("{day}", String(created.day))
                  .replace("{month}", t(monthNameKey(created.month)))
                  .replace("{hour}", String(created.hour).padStart(2, "0"))
                  .replace("{minute}", String(created.minute).padStart(2, "0"))}
          </span>
        </button>
      </li>
    );
  };

  const body = () => {
    if (state.kind === "reading") {
      return (
        <div className="hs__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.history.reading")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(historyRefusalKey(state.refusal))}</p>
          <button
            type="button"
            className="sys__action"
            onClick={() => void load({ query: null, cursor: null, previous: null })}
          >
            {t("rider.history.reset")}
          </button>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.history.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(historyErrorKey(state.code))}</p>
          <button
            type="button"
            className="sys__action"
            onClick={() => void load({ query: null, cursor: null, previous: null })}
          >
            {t("rider.history.retry")}
          </button>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.history.back")}
          </button>
        </div>
      );
    }

    const { loaded } = state;
    const empty = loaded.groups.every((group) => group.rides.length === 0);

    return (
      <>
        {searchBar}

        {/* إنذارُ منطقةِ التصنيفِ **حينَ يكونُ إنذاراً** وحدَه. */}
        {showsTimezoneNotice(loaded.monthTimezoneTrust) ? (
          <p className="hs__timezone" role="status">
            {t(timezoneTrustKey(loaded.monthTimezoneTrust)).replace(
              "{timezone}",
              loaded.monthTimezone,
            )}
          </p>
        ) : null}

        {empty ? (
          <p className="hs__empty">
            {t(loaded.query === null ? "rider.history.empty" : "rider.history.emptySearch")}
          </p>
        ) : (
          loaded.groups.map((group) => {
            const heading = monthHeading(group.monthKey);
            return (
              <section className="hs__month" key={group.monthKey}>
                <h2 className="hs__month-title">
                  {heading.known
                    ? t(heading.key)
                        .replace("{month}", t(monthNameKey(heading.month)))
                        .replace("{year}", String(heading.year))
                    : t(heading.key).replace("{raw}", heading.raw)}
                </h2>
                <ul className="hs__list">
                  {group.rides.map((ride) => rideCard(ride, loaded.monthTimezone))}
                </ul>
              </section>
            );
          })
        )}

        {/* «مزيدٌ» يُرسَمُ بمفتاحٍ قائمٍ وحدَه: زرٌّ بلا مفتاحٍ وعدٌ لا يُنفَّذُ. */}
        {loaded.hasMore && loaded.nextCursor !== null ? (
          <button
            type="button"
            className="hs__more"
            disabled={busy}
            onClick={() =>
              void load({
                query: loaded.query,
                cursor: loaded.nextCursor,
                previous: loaded.groups,
              })
            }
          >
            {t(busy ? "rider.history.more.loading" : "rider.history.more")}
          </button>
        ) : null}

        <button type="button" className="hs__back" onClick={() => onBack?.()}>
          {t("rider.history.back")}
        </button>

        {/* مدخلُ الاستغاثةِ (`PD-020`) — رحلةٌ في السجلِّ جاريةٌ أو مضَت قريباً. */}
        {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
      </>
    );
  };

  return (
    <section className="hs" dir={directionFor(language)} aria-labelledby="hs-title">
      <h1 className="hs__title" id="hs-title">
        {t("rider.history.title")}
      </h1>
      {body()}
    </section>
  );
}
