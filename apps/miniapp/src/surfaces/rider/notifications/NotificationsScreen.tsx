/**
 * الغرض: شاشةُ مركزِ الإشعاراتِ — موجَزٌ مقروءٌ بترقيمٍ صفحاتٍ بمؤشِّرٍ زمنيٍّ
 *   ووسمُ مقروءٍ لكلِّ عنصرٍ (البند `SS-07` · `F6-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `SS-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/notifications
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` (طورُ `notifications`)
 *
 * ## لماذا لا يُوسَمُ «مقروءاً» عندَ الفتحِ
 *
 * لأنَّ «فُتِحَ الموجَزُ» ليسَ «قُرِئَ الإشعارُ»: الوسمُ التلقائيُّ بالفتحِ يُفقِدُ
 * المستخدمَ إشعاراً حرجاً مرَّ أمامَ عينِه ولم يقرأْه، بلا أثرٍ يُرجَعُ إليه
 * (ADR 0035 §2). فالوسمُ فعلٌ صريحٌ: لمسةٌ على البطاقةِ.
 *
 * ## ولماذا المنطقةُ الزمنيّةُ مِن الجهازِ لا مِن الخادمِ
 *
 * لأنَّ الخادمَ لا يُصدِرُ منطقةً زمنيّةً في ردِّ الإشعاراتِ — وهذه ليست قائمةً
 * تُجمَّعُ بالشهرِ، بل بطاقاتٌ تُقرأُ بالتتابعِ. فأقربُ ساعةٍ متاحةٌ هيَ ساعةُ
 * الجهازِ، وذاكَ يُقالُ صراحةً لا يُسكَت.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تفكُّ حمولةَ `payload` ولا تُركِّبُ نصّاً من داخلِها** — لا عقدَ
 *      يحكمُ معاني حقولِ كلِّ نوعٍ.
 *   ــ **لا تستقصي دوريّاً**: الموجَزُ لحظةٌ لا يتحرَّكُ بنفسِه.
 *   ــ **لا تعرضُ عدداً إجماليّاً**: «unread» ما يدخلُ إلا لأنَّ الخادمَ أصدرَه.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
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
import {
  markNotificationRead as markViaApi,
  readNotifications as readViaApi,
} from "./notifications-api.ts";
import type { ApiNotificationItem, NotificationsResponse } from "./notifications-contract.ts";
import { channelKey, instantLabel, kindKey, notificationsErrorKey } from "./notifications-view.ts";

/** حجمُ الصفحةِ — يُرسَلُ إلى الخادمِ ويُقاسُ به «هل ثَمَّةَ مزيدٌ؟». */
const NOTIFICATION_PAGE_SIZE = 20;

export interface NotificationsScreenProps {
  readonly read?: (input: {
    readonly limit?: number;
    readonly before?: string;
  }) => Promise<NotificationsResponse>;
  readonly mark?: (notificationId: string) => Promise<{
    readonly ok: true;
    readonly id: string;
    readonly read_at: string;
    readonly already_read: boolean;
  }>;
  readonly onBack?: () => void;
  readonly onOpenSos?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
}

interface Loaded {
  readonly items: readonly ApiNotificationItem[];
  readonly unread: number;
  readonly hasMore: boolean;
}

type NotificationsState =
  | { readonly kind: "reading" }
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

function deviceTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved ?? "UTC";
  } catch {
    return "UTC";
  }
}

export function NotificationsScreen({
  read = readViaApi,
  mark = markViaApi,
  onBack,
  onOpenSos,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: NotificationsScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<NotificationsState>({ kind: "reading" });
  const [system, setSystem] = useState<SystemState>(null);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const timeZone = useRef(deviceTimeZone());
  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (input: {
      readonly before?: string;
      readonly previous: readonly ApiNotificationItem[] | null;
    }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await read({
          limit: NOTIFICATION_PAGE_SIZE,
          ...(input.before === undefined ? {} : { before: input.before }),
        });
        if (!mounted.current) return;
        const items =
          input.previous === null ? response.items : [...input.previous, ...response.items];
        const oldest = response.items[response.items.length - 1];
        setState({
          kind: "ready",
          loaded: {
            items,
            unread: response.unread,
            // «مزيدٌ» يُرسَمُ فقط حين تَمتلِئُ الصفحةُ: صفحةٌ ناقصةٌ تعني أنَّ ما
            // قبلَها قد استَنفَدَ، و«مزيدٌ» بلا ما بعده زرٌّ لا يُردُّ.
            hasMore: response.items.length >= NOTIFICATION_PAGE_SIZE && oldest !== undefined,
          },
        });
      } catch (thrown) {
        if (!mounted.current) return;
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

  useEffect(() => {
    void load({ previous: null });
  }, [load]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (marking !== null) return;
      setMarking(notificationId);
      try {
        const result = await mark(notificationId);
        if (!mounted.current) return;
        // وقتُ القراءةِ من الخادمِ لا من الجهازِ: الخادمُ هو مصدرُ الحقيقةِ،
        // وساعتُه هيَ التي تُقارَنُ بها الأحداثُ لا ساعةُ الهاتفِ.
        setState((prev) => {
          if (prev.kind !== "ready") return prev;
          return {
            kind: "ready",
            loaded: {
              ...prev.loaded,
              items: prev.loaded.items.map((item) =>
                item.id === notificationId ? { ...item, read_at: result.read_at } : item,
              ),
              unread: result.already_read
                ? prev.loaded.unread
                : Math.max(0, prev.loaded.unread - 1),
            },
          };
        });
      } catch {
        // فشلُ الوسمِ لا يُسقِطُ الموجَزَ: البطاقةُ باقيةٌ ويمكنُ إعادتُه.
      } finally {
        if (mounted.current) setMarking(null);
      }
    },
    [mark, marking],
  );

  if (system !== null) {
    return (
      <SystemScreen
        state={system.screen}
        onAction={() => void load({ previous: null })}
        busy={busy}
      />
    );
  }

  const notificationCard = (item: ApiNotificationItem) => {
    const unread = item.read_at === null;
    const when = instantLabel(item.created_at, timeZone.current);
    return (
      <li className="nc__item" key={item.id}>
        <button
          type="button"
          className={unread ? "nc__card nc__card--unread" : "nc__card nc__card--read"}
          disabled={!unread || marking !== null}
          onClick={() => void markRead(item.id)}
        >
          <span className="nc__kind">{t(kindKey(item.kind)).replace("{kind}", item.kind)}</span>
          <span className="nc__channel">{t(channelKey(item.channel))}</span>
          <span className="nc__when">
            {when.known
              ? t(when.key)
                  .replace("{day}", String(when.parts.day))
                  .replace("{month}", String(when.parts.month))
                  .replace("{year}", String(when.parts.year))
                  .replace("{hour}", String(when.parts.hour).padStart(2, "0"))
                  .replace("{minute}", String(when.parts.minute).padStart(2, "0"))
              : t(when.key).replace("{raw}", when.raw)}
          </span>
          {unread ? (
            <span className="nc__dot" role="img" aria-label={t("rider.notifications.unread")} />
          ) : null}
        </button>
      </li>
    );
  };

  const body = () => {
    if (state.kind === "reading") {
      return (
        <div className="nc__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.notifications.reading")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(notificationsErrorKey(state.code))}</p>
          <button
            type="button"
            className="sys__action"
            onClick={() => void load({ previous: null })}
          >
            {t("rider.notifications.retry")}
          </button>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.notifications.back")}
          </button>
        </div>
      );
    }

    const { loaded } = state;
    const empty = loaded.items.length === 0;

    return (
      <>
        {loaded.unread > 0 ? (
          <p className="nc__unread-count" role="status">
            {t("rider.notifications.unreadCount").replace("{count}", String(loaded.unread))}
          </p>
        ) : null}

        {empty ? (
          <p className="nc__empty">{t("rider.notifications.empty")}</p>
        ) : (
          <ul className="nc__list">{loaded.items.map((item) => notificationCard(item))}</ul>
        )}

        {loaded.hasMore ? (
          <button
            type="button"
            className="nc__more"
            disabled={busy}
            onClick={() => {
              const oldest = loaded.items[loaded.items.length - 1];
              if (oldest === undefined) return;
              void load({ before: oldest.created_at, previous: loaded.items });
            }}
          >
            {t(busy ? "rider.notifications.more.loading" : "rider.notifications.more")}
          </button>
        ) : null}

        <button type="button" className="nc__back" onClick={() => onBack?.()}>
          {t("rider.notifications.back")}
        </button>

        {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
      </>
    );
  };

  return (
    <section className="nc" dir={directionFor(language)} aria-labelledby="nc-title">
      <h1 className="nc__title" id="nc-title">
        {t("rider.notifications.title")}
      </h1>
      {body()}
    </section>
  );
}
