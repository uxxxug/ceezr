/**
 * الغرض: تركيب تبعيات العامل الخلفي وبناء قائمة الجوبات الفعلية لكل مدينة مفعَّلة.
 *   هذا هو الموضع الوحيد الذي يعرف فيه العامل قاعدةً ومرسِلَ تيليجرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات جوبات العامل
 * ملاحظات مستقبلية: القفل الموزَّع يُبنى هنا ويُسلَّم للمشغّل، فيحمي كل مهمّة مسجَّلة.
 */

import { Api } from "grammy";
import { PortFailureError } from "../../../packages/application/ports/index.ts";
import type { DistributedLock } from "../../../packages/application/scheduling/distributed-lock.ts";
import type { ExpiryWarningSender } from "../../../packages/application/subscription/expire-subscriptions.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createExpireOffersRpc,
  createPendingOfferRepository,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createNegotiationWiring } from "../../../packages/infrastructure/dispatch/negotiation-wiring.ts";
import {
  createUnmatchedOrderFinder,
  createUnmatchedRiderNotifier,
} from "../../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import {
  asIdentifyingSender,
  asOutboundSender,
  grammyTelegramSender,
} from "../../../packages/infrastructure/notification/telegram-api-sender.ts";
import type { OutboundSender } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { IdentifyingSender } from "../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import { createRatingRecomputePort } from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import { createAdvisoryLock } from "../../../packages/infrastructure/scheduling/advisory-lock.ts";
import { createStaleAvailabilityRpc } from "../../../packages/infrastructure/scheduling/availability-adapters.ts";
import { createSubscriptionLifecycleRpc } from "../../../packages/infrastructure/subscription/lifecycle-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { DEFAULT_LANGUAGE, t } from "../../../packages/shared/i18n/index.ts";
import { type CityId, systemClock } from "../../../packages/shared/kernel/index.ts";
import { err, ok } from "../../../packages/shared/result/index.ts";
import { cleanupStaleSessions } from "./jobs/cleanup-stale-sessions.ts";
import { expireOffers } from "./jobs/expire-offers.ts";
import { expireSubscriptions, warnExpiringSoon } from "./jobs/expire-subscriptions.ts";
import { recomputeRatings } from "./jobs/recompute-ratings.ts";
import { rotateUnsubscribedNegotiations } from "./jobs/rotate-unsubscribed-negotiation.ts";
import { runSweepUnmatchedOrders } from "./jobs/sweep-unmatched-orders.ts";
import type { JobDefinition, JobLogger } from "./runner.ts";

/** تواتر كل مهمّة بالثواني. تقنيّة لا تجارية: لا تُقرأ من platform_settings. */
export const JOB_INTERVALS = {
  expireOffers: 60,
  rotateNegotiations: 60,
  cleanupStale: 1800,
  expireSubscriptions: 900,
  warnExpiring: 21_600,
  sweepUnmatched: 60,
  recomputeRatings: 3600,
} as const;

/** المهلة الافتراضية للتوفّر البائت حين يغيب الإعداد — ثلاث ساعات. */
const AVAILABILITY_FALLBACK_MINUTES = 180;
/** أيام التحذير الافتراضية حين يغيب الإعداد. */
const WARNING_FALLBACK_DAYS = 2;
/**
 * العتبة الاحتياطية حين يغيب الإعداد: 180 ثانية. الغياب لا يجوز أن يعني
 * "لا تُصعّد أبداً" — فذلك يُعيد بالضبط العطب الذي جاءت هذه المهمة لإصلاحه.
 */
const UNMATCHED_FALLBACK_SECONDS = 180;

/**
 * أقصى تواز للمهامّ، ومعه حجم تجمّع اتصالات القفل. الرقمان مرتبطان بالضرورة لا
 * بالاختيار: كل مهمّة جارية تحتجز اتصال قفل واحداً طول عملها، فتجمّع القفل يجب أن
 * يتّسع للتوازي كلّه وإلّا انتظرت مهمّة اتصالاً لن يتحرّر إلّا بانتهاء مهمّة أخرى.
 */
export const MAX_JOB_CONCURRENCY = 4;

export interface WorkerContainerOverrides {
  readonly sql?: Sql;
  readonly warningSender?: ExpiryWarningSender;
  readonly log?: JobLogger;
  /** يُستبدل في اختبار الوحدة بقفل لا يقفل؛ الافتراضي هو القفل الحقيقي على القاعدة. */
  readonly lock?: DistributedLock;
  /** تجمّع اتصالات القفل وحده — يُمرَّر في الاختبار لتقاسم قاعدة الاختبار نفسها. */
  readonly lockSql?: Sql;
  /** مُرسِلا تيليجرام الحقيقيان — يُستبدلان في الاختبار بمُرسِل يجمع بلا شبكة. */
  readonly driverOut?: OutboundSender;
  readonly riderOut?: OutboundSender;
  readonly identifyingDriver?: IdentifyingSender;
}

/** مرسِل التحذيرات عبر واجهة تيليجرام الحقيقية، ملفوفاً في Result بلا استثناءات. */
export function grammyWarningSender(token: string): ExpiryWarningSender {
  const api = new Api(token);
  return {
    send: async ({ chatId, text }) => {
      try {
        await api.sendMessage(chatId, text);
        return ok(undefined);
      } catch (error) {
        // سائق حجب البوت يرمي هنا. هذا ليس عطل نظام بل حقيقة عن سائق واحد،
        // فيُعاد فشلاً محصوراً به ولا يُوقف بقية الدفعة.
        const detail = error instanceof Error ? error.message : String(error);
        return err(new PortFailureError("telegram.sendMessage", detail));
      }
    },
  };
}

export interface WorkerContainer {
  readonly sql: Sql;
  /** القفل الموزَّع الذي يُسلَّم للمشغّل — مكشوف حتى يُثبته الاختبار لا يفترضه. */
  readonly lock: DistributedLock;
  /** قائمة الجوبات كما ستُسلَّم للمشغّل — تُبنى مرّة عند الإقلاع. */
  jobs(): Promise<readonly JobDefinition[]>;
  close(): Promise<void>;
}

export function buildWorkerContainer(
  config: AppConfig,
  overrides: WorkerContainerOverrides = {},
): WorkerContainer {
  const sql =
    overrides.sql ?? createSql({ connectionString: config.databaseUrl, max: 5, prepare: false });
  const log: JobLogger = overrides.log ?? {
    info: (message, fields) => console.log(JSON.stringify({ level: "info", message, ...fields })),
    error: (message, fields) =>
      console.error(JSON.stringify({ level: "error", message, ...fields })),
  };

  /**
   * تجمّع اتصالات مستقلّ للأقفال، وهذا ليس ترفاً.
   *
   * القفل الاستشاري ملكُ الجلسة، فالمهمّة تحتجز اتصالها طول عملها بينما هو خاملٌ
   * لا يُنفّذ استعلاماً. لو خرج هذا الاتصال من تجمّع الاستعلامات لتنافس الخاملُ
   * المحتجزُ مع العاملِ المحتاج على نفس الميزانية — وهو ما حدث فعلاً أوّل تشغيل:
   * ستّ مهامّ متوازية احتجزت أقفالها من تجمّع سعته خمسة، فلم يبقَ اتصال لاستعلاماتها
   * وسقط الملفّ كلّه بمهلة انتظار لا بخطأ مفهوم. الميزانيتان منفصلتان بحكم طبيعتَي
   * الاستهلاك: واحدة للانتظار وأخرى للعمل.
   */
  const lockSql =
    overrides.lockSql ??
    createSql({
      connectionString: config.databaseUrl,
      max: MAX_JOB_CONCURRENCY + 1,
      prepare: false,
    });

  // الافتراضي هو القفل الحقيقي لا المُعطَّل: نسيان تمريره في الإنتاج يجب أن يكون
  // مستحيلاً، لا أن يكون خطأً صامتاً يظهر بعد مضاعفة عدد النسخ على Render.
  const lock = overrides.lock ?? createAdvisoryLock(lockSql);

  const cities = createCityDirectory(sql);
  const settings = createSettingsRepository(sql);
  const offers = createPendingOfferRepository(sql);
  const expireRpc = createExpireOffersRpc(sql);
  const lifecycleRpc = createSubscriptionLifecycleRpc(sql);
  const availabilityRpc = createStaleAvailabilityRpc(sql);
  const recomputePort = createRatingRecomputePort(sql);
  const warningSender = overrides.warningSender ?? grammyWarningSender(config.driverBotToken);

  /**
   * العامل ينشر في قروب غير المشتركين ويصعّد الطلبات، فيحتاج مُرسِلاً حقيقياً تماماً
   * كالبوابة. المُرسِل المبني على رمز بوت السائق هو الصحيح: أزرار القروب يضغطها
   * سائقون، وردّ الضغطة يجب أن يعود إلى البوت الذي نشرها لا إلى بوت العميل.
   */
  const telegram = grammyTelegramSender(config.driverBotToken);
  const driverOut = overrides.driverOut ?? asOutboundSender(telegram);

  /**
   * الراكب يُراسَل ببوت الراكب لا ببوت السائق. كان الافتراضي هنا driverOut،
   * وهو خطأ صامت لا يظهر في أي اختبار لأن الاختبارات تمرّر riderOut دائماً:
   * الراكب لم يبدأ محادثة مع بوت السائق قط، وتيليجرام يرفض أن يبتدئ بوتٌ
   * محادثةً مع مستخدم لم يفتحها. فكل رسالة تفاوض موجَّهة للراكب كانت تسقط
   * في الإنتاج بـ403 بلا أثر مرئي — لا خطأ يوقظ أحداً، ولا رسالة تصل.
   */
  const riderTelegram = grammyTelegramSender(config.riderBotToken);
  const riderOut = overrides.riderOut ?? asOutboundSender(riderTelegram);

  const unmatchedFinder = createUnmatchedOrderFinder(sql);
  const unmatchedNotifier = createUnmatchedRiderNotifier(riderOut, (order) => {
    const say = t(order.riderLanguage ?? DEFAULT_LANGUAGE);
    return order.service === "delivery"
      ? say("rider.no_driver_found_delivery")
      : say("rider.no_driver_found");
  });

  const negotiation = createNegotiationWiring(sql, {
    driverOut,
    riderOut,
    identifyingDriver: overrides.identifyingDriver ?? asIdentifyingSender(telegram),
  });

  /**
   * المدن تُقرأ عند بناء القائمة لا في كل شوط: تفعيل مدينة جديدة حدثٌ نادر
   * يستحقّ إعادة نشر العامل، واستعلامُ المدن كل دقيقة إنفاقٌ بلا مقابل.
   */
  async function activeCityIds(): Promise<readonly CityId[]> {
    const list = await cities.listActive();
    if (!list.ok) {
      log.error("worker.cities_failed", { detail: list.error.detail });
      return [];
    }
    return list.value.map((city) => city.id);
  }

  async function warningDays(cityId: CityId): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return WARNING_FALLBACK_DAYS;
    const row = raw.value.find((entry) => entry.key === "subscription_expiry_warning_days");
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : WARNING_FALLBACK_DAYS;
  }

  async function unmatchedThreshold(cityId: CityId): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return UNMATCHED_FALLBACK_SECONDS;
    const row = raw.value.find((entry) => entry.key === "unmatched_escalate_after_seconds");
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : UNMATCHED_FALLBACK_SECONDS;
  }

  return {
    sql,
    lock,

    jobs: async (): Promise<readonly JobDefinition[]> => {
      const cityIds = await activeCityIds();
      if (cityIds.length === 0) {
        // لا مدينة مفعَّلة يعني نظاماً لم يُفتَح بعد. المهامّ العامّة تبقى، والمدنية
        // تغيب — وهذا يُسجَّل صراحةً لأن عاملاً بلا مهامّ مدنية عرضٌ مشبوه.
        log.info("worker.no_active_cities", {});
      }

      const perCity: JobDefinition[] = cityIds.flatMap((cityId): JobDefinition[] => [
        {
          name: `expire-offers:${cityId}`,
          everySeconds: JOB_INTERVALS.expireOffers,
          runOnStart: true,
          run: async () => {
            const report = await expireOffers(cityId, {
              offers,
              settings,
              rpc: expireRpc,
              clock: systemClock,
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `examined=${report.value.examined} expired=${report.value.appliedCount}`;
          },
        },
        {
          name: `sweep-unmatched:${cityId}`,
          everySeconds: JOB_INTERVALS.sweepUnmatched,
          runOnStart: true,
          run: async () => {
            const report = await runSweepUnmatchedOrders(cityId, {
              finder: unmatchedFinder,
              escalate: negotiation.escalate,
              notifier: unmatchedNotifier,
              staleAfterSeconds: await unmatchedThreshold(cityId),
              log: (message, meta) => log.info(message, meta),
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            return `examined=${value.examined} escalated=${value.escalated.length} notified=${value.notified.length} already=${value.alreadyEscalated} failed=${value.failed}`;
          },
        },
        {
          name: `rotate-negotiations:${cityId}`,
          everySeconds: JOB_INTERVALS.rotateNegotiations,
          runOnStart: true,
          run: async () => {
            const report = await rotateUnsubscribedNegotiations(cityId, {
              snapshots: negotiation.snapshots,
              rotate: negotiation.rotate,
              republish: negotiation.republish,
              escalate: negotiation.escalate,
              clock: systemClock,
              log: (message, meta) => log.info(message, meta),
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            return `advanced=${value.advanced.length} republished=${value.republished.length} escalated=${value.escalated.length} failures=${value.failures.length}`;
          },
        },
        {
          name: `cleanup-stale:${cityId}`,
          everySeconds: JOB_INTERVALS.cleanupStale,
          run: async () => {
            const report = await cleanupStaleSessions(
              { cityId },
              {
                settings,
                rpc: availabilityRpc,
                fallbackMinutes: AVAILABILITY_FALLBACK_MINUTES,
              },
            );
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `deactivated=${report.value.availability.deactivated} staleMinutes=${report.value.availability.staleMinutes}`;
          },
        },
        {
          name: `warn-expiring:${cityId}`,
          everySeconds: JOB_INTERVALS.warnExpiring,
          runOnStart: true,
          run: async () => {
            const days = await warningDays(cityId);
            const report = await warnExpiringSoon(
              { days },
              {
                rpc: lifecycleRpc,
                sender: warningSender,
                onSendFailure: (subscriptionId, failure) =>
                  log.error("warn_expiring.send_failed", {
                    subscriptionId,
                    detail: failure.detail,
                  }),
              },
            );
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `days=${days} examined=${report.value.examined} warned=${report.value.warned} failed=${report.value.failed.length}`;
          },
        },
      ]);

      // مهامّ لا تخصّ مدينة بعينها: الدالّتان تعملان على القاعدة كلّها في نداء واحد،
      // فتشغيلهما لكل مدينة كان سيكرّر نفس العمل بعدد المدن.
      const global: JobDefinition[] = [
        {
          name: "expire-subscriptions",
          everySeconds: JOB_INTERVALS.expireSubscriptions,
          runOnStart: true,
          run: async () => {
            const report = await expireSubscriptions({ rpc: lifecycleRpc });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `expired=${report.value.expiredCount}`;
          },
        },
        {
          name: "recompute-ratings",
          everySeconds: JOB_INTERVALS.recomputeRatings,
          run: async () => {
            const report = await recomputeRatings({ recompute: recomputePort });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `drivers=${report.value.driversUpdated} riders=${report.value.ridersUpdated}`;
          },
        },
      ];

      return [...perCity, ...global];
    },

    close: async () => {
      // تجمّع القفل يُغلق أولاً: اتصالٌ يحمل قفلاً يُنهى فيسقط القفل معه فوراً،
      // فلا تنتظر النسخة التالية انقضاء مهلة اتصال ميت لتأخذ ما هو متروك أصلاً.
      if (overrides.lockSql === undefined) await lockSql.end({ timeout: 5 });
      if (overrides.sql === undefined) await sql.end({ timeout: 5 });
    },
  };
}
