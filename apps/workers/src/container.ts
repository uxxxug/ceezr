/**
 * الغرض: تركيب تبعيات العامل الخلفي وبناء قائمة الجوبات الفعلية لكل مدينة مفعَّلة.
 *   هذا هو الموضع الوحيد الذي يعرف فيه العامل قاعدةً ومرسِلَ تيليجرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات جوبات العامل
 * ملاحظات مستقبلية: القفل الموزَّع يُبنى هنا ويُسلَّم للمشغّل، فيحمي كل مهمّة مسجَّلة.
 */

import { Api } from "grammy";
import type { BroadcastPublisher } from "../../../packages/application/broadcast/ports.ts";
import { PortFailureError } from "../../../packages/application/ports/index.ts";
import type { SafetyCardPublisher } from "../../../packages/application/safety/ports.ts";
import type { DistributedLock } from "../../../packages/application/scheduling/distributed-lock.ts";
import type { ExpiryWarningSender } from "../../../packages/application/subscription/expire-subscriptions.ts";
import type { SubscriptionNoticePublisher } from "../../../packages/application/subscription/notice-ports.ts";
import {
  createGoogleDriveStorage,
  createLocalBackupStorage,
} from "../../../packages/infrastructure/backup/index.ts";
import { createBroadcastDeliveryPort } from "../../../packages/infrastructure/broadcast/broadcast-adapters.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createExpireOffersRpc,
  createOfferRepository,
  createOfferWriter,
  createPendingOfferRepository,
  createSearchingOrderFinder,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createNegotiationWiring } from "../../../packages/infrastructure/dispatch/negotiation-wiring.ts";
import {
  createUnmatchedOrderFinder,
  createUnmatchedRiderNotifier,
} from "../../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import { createPaymentRepository } from "../../../packages/infrastructure/financial/payment-adapters.ts";
import { createPaymentProvider } from "../../../packages/infrastructure/financial/payment-provider-factory.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import {
  asIdentifyingSender,
  asOutboundSender,
  grammyTelegramSender,
} from "../../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  createBroadcastPublisher,
  grammyBroadcastApi,
} from "../../../packages/infrastructure/notification/telegram-broadcast-sender.ts";
import type { OutboundSender } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createTelegramDriverNotifier } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { IdentifyingSender } from "../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import {
  createSubscriptionNoticePublisher,
  grammyNoticeApi,
} from "../../../packages/infrastructure/notification/telegram-notice-sender.ts";
import { createSafetyCardPublisher } from "../../../packages/infrastructure/notification/telegram-safety-notifier.ts";
import {
  instrumentExpireOffersRpc,
  instrumentOfferWriter,
} from "../../../packages/infrastructure/observability/dispatch.ts";
import type { OperationalMetrics } from "../../../packages/infrastructure/observability/index.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import { createRatingRecomputePort } from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import { createSafetyDeliveryPort } from "../../../packages/infrastructure/safety/safety-adapters.ts";
import { createAdvisoryLock } from "../../../packages/infrastructure/scheduling/advisory-lock.ts";
import { createStaleAvailabilityRpc } from "../../../packages/infrastructure/scheduling/availability-adapters.ts";
import { createSubscriptionLifecycleRpc } from "../../../packages/infrastructure/subscription/lifecycle-adapters.ts";
import { createSubscriptionNoticeDeliveryPort } from "../../../packages/infrastructure/subscription/notice-adapters.ts";
import { createOrderRepository } from "../../../packages/infrastructure/transport/order-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { DEFAULT_LANGUAGE, t } from "../../../packages/shared/i18n/index.ts";
import { type CityId, systemClock } from "../../../packages/shared/kernel/index.ts";
import { err, ok } from "../../../packages/shared/result/index.ts";
import { type BackupConfig, createPgDumper, runDatabaseBackup } from "./jobs/backup-database.ts";
import { cleanupStaleSessions } from "./jobs/cleanup-stale-sessions.ts";
import { deliverBroadcasts } from "./jobs/deliver-broadcasts.ts";
import { deliverSafetyIncidents } from "./jobs/deliver-safety-incidents.ts";
import { deliverSubscriptionNotices } from "./jobs/deliver-subscription-notices.ts";
import { expireOffers } from "./jobs/expire-offers.ts";
import { expireSubscriptions, warnExpiringSoon } from "./jobs/expire-subscriptions.ts";
import { recomputeRatings } from "./jobs/recompute-ratings.ts";
import { runReconcilePendingPayments } from "./jobs/reconcile-pending-payments.ts";
import { runRedispatchSearching } from "./jobs/redispatch-searching.ts";
import { rotateUnsubscribedNegotiations } from "./jobs/rotate-unsubscribed-negotiation.ts";
import { runSweepUnmatchedOrders } from "./jobs/sweep-unmatched-orders.ts";
import { runBackupRestoreVerification } from "./jobs/verify-backup-restore.ts";
import type { JobDefinition, JobLogger } from "./runner.ts";

/** تواتر كل مهمّة بالثواني. تقنيّة لا تجارية: لا تُقرأ من platform_settings. */
export const JOB_INTERVALS = {
  expireOffers: 60,
  rotateNegotiations: 60,
  cleanupStale: 1800,
  expireSubscriptions: 900,
  warnExpiring: 21_600,
  sweepUnmatched: 60,
  /**
   * أقصر من مهلة العرض (45 ثانية افتراضاً) عن قصد: راكبٌ ينتظر، وعرضٌ انتهت مهلته
   * يجب أن تُفتح بعده دورةٌ في جزءٍ من مهلةٍ أخرى لا في مهلةٍ كاملة. والشوطُ الذي
   * يجد كلَّ المؤهّلين مستبعَدين بعرضٍ حيّ لا يكتب شيئاً ولا يستهلك دورةَ بثّ.
   */
  redispatchSearching: 20,
  recomputeRatings: 3600,
  backupDatabase: 86400, // يوميّ لا أقلّ — البند 7.2
  /**
   * التحقّق يوميّ مثل النسخ نفسه: نسخةٌ لم تُستعاد قطّ ليست نسخةً احتياطية بل
   * ملفٌ مجهول المحتوى، ومن اكتشف فسادها يوم الكارثة لم يكن يملك نسخاً.
   */
  verifyBackupRestore: 86400,
  deliverSafetyIncidents: 30,
  /**
   * كلّ عشر ثوانٍ: البثُّ محدودٌ بحجم دفعةٍ من إعداد المدينة (٢٥ افتراضاً)، فهذا
   * سقفٌ نظريّ حوالي ١٥٠ رسالة في الدقيقة للمدينة — تحت حدّ تلغرام بفارقٍ مريح،
   * وسريعٌ بما يكفي لئلّا يستغرق إعلانٌ لألف سائق ساعةً كاملة.
   */
  deliverBroadcasts: 10,
  /**
   * كل خمس دقائق: المراجعة ليست مسار الحسم الأساسي بل شبكة الأمان تحته. تشغيلها
   * أسرع يضاعف استدعاءات المزوّد بلا فائدة — الويبهوك أسرع منها دائماً — وتشغيلها
   * أبطأ يطيل المدّة التي يكون فيها السائق قد دفع ولا يعمل.
   */
  reconcilePendingPayments: 300,
  /**
   * كل خمس عشرة ثانية: صندوقُ إشعارات الاشتراك صغيرٌ بطبعه (تفعيلٌ أو انتهاءٌ
   * لسائقٍ واحد)، لكنّ تأخيرَه مكلف: سائقٌ دفع ولا يعرف أنّ اشتراكه سرى يعيد
   * الدفع أو يفتح تذكرةَ دعم.
   */
  deliverSubscriptionNotices: 15,
} as const;

/** المهلة الافتراضية للتوفّر البائت حين يغيب الإعداد — ثلاث ساعات. */
const AVAILABILITY_FALLBACK_MINUTES = 180;
/** أيام التحذير الافتراضية حين يغيب الإعداد. */
const WARNING_FALLBACK_DAYS = 2;

/**
 * حدود المراجعة الافتراضية حين تغيب من `platform_settings`.
 *
 * • عشر دقائق قبل السؤال: أقصر من ذلك يسأل عن دفعةٍ السائقُ في صفحتها الآن،
 *   فيقرأ `pending` ويعدّها معلّقة — استدعاءٌ بلا معلومة.
 * • يومان سقفاً للعمر: بعدهما تكون فاتورة المزوّد انتهت ولن تتغيّر حالتها أبداً،
 *   فالسؤال عنها استدعاءٌ متكرّرٌ إلى الأبد لصفٍّ ميّت.
 * • خمسون سقفاً للدفعة: يحمي حدّ استدعاءات المزوّد، والأقدمُ أوّلاً فلا يُهمَل صفّ.
 */
const RECONCILE_FALLBACK_OLDER_THAN_SECONDS = 600;
const RECONCILE_FALLBACK_MAX_AGE_SECONDS = 172_800;
const RECONCILE_FALLBACK_LIMIT = 50;

/**
 * يقرأ إعداد النسخ الاحتياطي من متغيّرات البيئة. يعيد `null` إذا غاب كلّ مخزنٍ
 * متاح — فالنسخ الاحتياطي ميزة اختيارية لا توقف الإقلاع بغيابها.
 * لا قيمة تجارية في الكود: عدد النسخ المحفوظة من متغيّر بيئة، والافتراضي 14.
 *
 * ويقوم الإعداد بوجود Google Drive **أو** مجلّد محليّ. لماذا المحليّ خيار؟ لأنّ ربط
 * النسخ بمزوّد سحابيّ واحد يجعل تعطّل اعتماداته تعطّلاً تامّاً للنسخ، ومجلّدٌ محليّ
 * على قرصٍ دائم أقلّ حمايةً لكنّه ليس عدماً.
 */
function readBackupConfig(databaseUrl: string): BackupConfig | null {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  const localDir = process.env.BACKUP_LOCAL_DIR;
  if ((!serviceAccountJson || !folderId) && !localDir) return null;
  const rawRetention = Number(process.env.BACKUP_RETENTION_COUNT ?? "14");
  const retentionCount =
    Number.isFinite(rawRetention) && rawRetention > 0 ? Math.trunc(rawRetention) : 14;
  return { databaseUrl, retentionCount };
}
/**
 * العتبة الاحتياطية حين يغيب الإعداد: 180 ثانية. الغياب لا يجوز أن يعني
 * "لا تُصعّد أبداً" — فذلك يُعيد بالضبط العطب الذي جاءت هذه المهمة لإصلاحه.
 */
const UNMATCHED_FALLBACK_SECONDS = 180;

/**
 * حدّ الدورات الاحتياطي حين يغيب `max_broadcast_rounds`: واحدة، وميلانُه مقصود.
 * الخطأ هنا له اتجاهان غير متكافئين: حدٌّ أقلّ ممّا ينبغي يُصعَّد طلباً كان له دورةٌ
 * أخرى، فيراه موظّفٌ ويتصرّف — وحدٌّ أعلى ممّا ينبغي يُعيد اليتم الذي جاء هذا المسح
 * ليغلقه، وبلا أثر. وإعدادات المدن المفعّلة تحمل المفتاح فعلاً، فهذا مسار الخراب لا المعتاد.
 */
const BROADCAST_ROUNDS_FALLBACK = 1;

/**
 * أقصى تواز للمهامّ، ومعه حجم تجمّع اتصالات القفل. الرقمان مرتبطان بالضرورة لا
 * بالاختيار: كل مهمّة جارية تحتجز اتصال قفل واحداً طول عملها، فتجمّع القفل يجب أن
 * يتّسع للتوازي كلّه وإلّا انتظرت مهمّة اتصالاً لن يتحرّر إلّا بانتهاء مهمّة أخرى.
 */
export const MAX_JOB_CONCURRENCY = 4;

/**
 * أقصى ما يُفحَص من طلبٍ عالقٍ في شوطٍ واحد لمدينة. خمسون لا «كلّها»: شوطٌ يفتح
 * دورةَ مطابقةٍ لكل طلبٍ عالقٍ في مدينةٍ تعطّل توزيعُها ساعةً كاملة يفتح مئاتها في
 * نَفَسٍ واحد، فيستنزف تجمّعَ الاتصالات ويُسقط بقيّةَ المهامّ — فيصير إصلاحُ التوزيع
 * سببَ تعطيله. والأقدمُ أوّلاً، فالمتخلّف لا يُتخطّى بل يُؤجَّل شوطاً.
 */
export const REDISPATCH_LIMIT = 50;

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
  /** بطاقة SOS قابلة للاستبدال في اختبار فشل تيليجرام ثم إعادة التسليم. */
  readonly safetyPublisher?: SafetyCardPublisher;
  /** ناشر البثّ الجماعي — يُستبدل في الاختبار بناشرٍ يجمع ويُخفق عند الطلب. */
  readonly broadcastPublisher?: BroadcastPublisher;
  /** ناشر إشعارات الاشتراك — يُستبدل في الاختبار بناشرٍ يجمع ويُخفق عند الطلب. */
  readonly subscriptionNoticePublisher?: SubscriptionNoticePublisher;
  /**
   * سجلّ المقاييس. يُلَفّ به منفذُ إسقاط العروض بمهلتها، فيُعَدّ ما لا يظهر في أيّ
   * سجلٍّ آخر: عرضٌ عُرِض ولم يُقبل. ومصدرُ العدّ نتيجةُ RPC — أي عددُ الصفوف التي
   * انتقلت فعلاً — لا نيّةُ المهمّة، فلا يُعَدّ إسقاطٌ لم يحدث.
   */
  readonly metrics?: OperationalMetrics;
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
  const expireRpc =
    overrides.metrics === undefined
      ? createExpireOffersRpc(sql)
      : instrumentExpireOffersRpc(createExpireOffersRpc(sql), overrides.metrics);
  const lifecycleRpc = createSubscriptionLifecycleRpc(sql);
  const availabilityRpc = createStaleAvailabilityRpc(sql);
  const recomputePort = createRatingRecomputePort(sql);

  /**
   * مزوّد الدفع في العامل يُبنى من نفس متغيّرات البيئة التي تبنيه في البوابة، لا
   * من إعدادٍ ثانٍ: مزوّدان مختلفان في عمليّتين على قاعدةٍ واحدة يعني أن يُراجَع
   * صفٌّ أنشأه مزوّدٌ بسؤال مزوّدٍ آخر.
   *
   * وغيابه ليس خطأً يُسقِط العامل: بقيّة المهامّ (العروض، التوزيع، الاشتراكات،
   * النسخ) لا تتوقّف على الدفع. وكذلك `manual`: مزوّدٌ لا خادم له لا يُسأل، فلا
   * تُسجَّل المهمّة أصلاً بدل أن تفشل كل خمس دقائق إلى الأبد.
   */
  const paymentProviderName = process.env.PAYMENT_PROVIDER;
  const reconcileProvider = (() => {
    if (paymentProviderName === undefined || paymentProviderName === "manual") return null;
    const built = createPaymentProvider(paymentProviderName, {
      moyasar: {
        secretKey: process.env.MOYASAR_SECRET_KEY ?? "",
        webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET ?? "",
        callbackUrl: process.env.MOYASAR_CALLBACK_URL ?? "",
      },
      tap: {
        secretKey: process.env.TAP_SECRET_KEY ?? "",
        redirectUrl: process.env.TAP_REDIRECT_URL ?? "",
      },
    });
    if (!built.ok) {
      log.error("worker.payment_provider_invalid", {
        provider: paymentProviderName,
        detail: built.error.detail,
      });
      return null;
    }
    return built.value;
  })();
  const payments = createPaymentRepository(sql, async (driverId) => {
    const rows = await sql<{ city_id: string }[]>`
      select city_id from drivers where id = ${driverId}::uuid
    `;
    return rows[0]?.city_id ?? null;
  });
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
  const safetyPublisher = overrides.safetyPublisher ?? createSafetyCardPublisher(telegram);
  const safetyDeliveries = createSafetyDeliveryPort(sql);

  /**
   * البثُّ يُرسَل ببوت الجمهور المقصود، ولذلك ناشران لا واحد: رسالةُ الركّاب من
   * بوت الراكب ورسالةُ السائقين من بوت السائق. بوتٌ واحد للاثنين كان سيُردّ
   * بـ403 على كل مستقبِلٍ لم يفتح محادثةً معه — أي على الجمهور كلّه.
   */
  const driverBroadcastPublisher =
    overrides.broadcastPublisher ??
    createBroadcastPublisher(grammyBroadcastApi(config.driverBotToken));
  const riderBroadcastPublisher =
    overrides.broadcastPublisher ??
    createBroadcastPublisher(grammyBroadcastApi(config.riderBotToken));
  const broadcastDeliveries = createBroadcastDeliveryPort(sql);
  // بوت السائق لا بوت الراكب: كلُّ إشعارات دورة حياة الاشتراك تخصّ سائقاً.
  const subscriptionNoticePublisher =
    overrides.subscriptionNoticePublisher ??
    createSubscriptionNoticePublisher(grammyNoticeApi(config.driverBotToken));
  const subscriptionNotices = createSubscriptionNoticeDeliveryPort(sql);

  const searchingFinder = createSearchingOrderFinder(sql);

  /**
   * **نفسُ** تبعيّات البثّ التي تبنيها البوابة عند إنشاء الطلب، لا نسخةٌ مبسّطة:
   * أيّ فرقٍ بين ما يُبَثّ عند الإنشاء وما يُبَثّ عند الإعادة هو تفرّعُ سلوكٍ لا
   * يظهر إلّا كشكوى «العرض الثاني يذهب لسائقٍ أبعد» ولا يفسّره أحد.
   */
  const redispatchBroadcast = {
    orders: createOrderRepository(sql),
    offers: createOfferRepository(sql),
    candidates: createDriverCandidateRepository(sql),
    settings,
    offerWriter:
      overrides.metrics === undefined
        ? createOfferWriter(sql)
        : instrumentOfferWriter(createOfferWriter(sql), overrides.metrics),
    notifier: createTelegramDriverNotifier(sql, driverOut),
    clock: systemClock,
    log: (message: string, meta: Record<string, unknown>) => log.info(message, meta),
  };

  const unmatchedFinder = createUnmatchedOrderFinder(sql);
  const unmatchedNotifier = createUnmatchedRiderNotifier(riderOut, (order) => {
    const say = t(order.riderLanguage ?? DEFAULT_LANGUAGE);
    /**
     * البند 6.3: النصّ كان يقول «أرسل /cancel» وللإلغاء زرّ في القائمة منذ البند 2.1.
     * ومن لا يجد سائقاً هو أسوأ من يُطلب منه أن يتعلّم أمراً مكتوباً. واسم الزرّ
     * يُقرأ من مفتاحه لا يُكتب في القاموس، فلا يكذب النصّ إن تغيّر الزرّ.
     */
    const params = { cancel_button: say("menu.rider.cancel") };
    return order.service === "delivery"
      ? say("rider.no_driver_found_delivery", params)
      : say("rider.no_driver_found", params);
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

  /**
   * يقرأ حدّاً رقمياً من إعدادات المدينة، ويعود للاحتياطي عند غيابه أو تلفه.
   *
   * الاحتياطي ليس ترفاً: إعدادٌ ناقص لمدينةٍ لا يجوز أن يعني «لا تُراجَع دفعاتها
   * أبداً» — فذلك يُعيد الثقب الذي جاءت المراجعة لإغلاقه، وبصمتٍ تام.
   */
  async function numericSetting(cityId: CityId, key: string, fallback: number): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return fallback;
    const row = raw.value.find((entry) => entry.key === key);
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
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
          /**
           * قبل التصعيد لا بعده: الطلبُ الذي يمكن بثُّه ثانيةً يجب أن يُبَثّ قبل أن
           * يُقال للراكب «لا سائق»، لا أن يُبَشَّر بالفشل ثم يُخدَم.
           */
          name: `redispatch-searching:${cityId}`,
          everySeconds: JOB_INTERVALS.redispatchSearching,
          runOnStart: true,
          run: async () => {
            const report = await runRedispatchSearching(cityId, {
              finder: searchingFinder,
              broadcast: redispatchBroadcast,
              limit: REDISPATCH_LIMIT,
              log: (message, meta) => log.info(message, meta),
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            return `examined=${value.examined} rebroadcast=${value.rebroadcast.length} noDriver=${value.stillNoDriver.length} exhausted=${value.exhausted.length} raced=${value.raced.length} failed=${value.failed}`;
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
              maxBroadcastRounds: await numericSetting(
                cityId,
                "max_broadcast_rounds",
                BROADCAST_ROUNDS_FALLBACK,
              ),
              log: (message, meta) => log.info(message, meta),
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            return `examined=${value.examined} escalated=${value.escalated.length} notified=${value.notified.length} already=${value.alreadyEscalated} broadcasting=${value.stillBroadcasting} failed=${value.failed}`;
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
        ...(reconcileProvider === null
          ? []
          : [
              {
                /**
                 * شبكة الأمان تحت الويبهوك: تسأل خادم المزوّد عن كل دفعةٍ بقيت
                 * معلّقة، فتحسم ما دُفِع ولم يُفعَّل. بلاها كان الويبهوك الضائع
                 * خسارةً نهائية لا يعرف بها أحد.
                 */
                name: `reconcile-pending-payments:${cityId}`,
                everySeconds: JOB_INTERVALS.reconcilePendingPayments,
                run: async () => {
                  const report = await runReconcilePendingPayments(
                    {
                      cityId,
                      olderThanSeconds: await numericSetting(
                        cityId,
                        "payment_reconcile_after_seconds",
                        RECONCILE_FALLBACK_OLDER_THAN_SECONDS,
                      ),
                      maxAgeSeconds: await numericSetting(
                        cityId,
                        "payment_reconcile_max_age_seconds",
                        RECONCILE_FALLBACK_MAX_AGE_SECONDS,
                      ),
                      limit: await numericSetting(
                        cityId,
                        "payment_reconcile_batch_limit",
                        RECONCILE_FALLBACK_LIMIT,
                      ),
                    },
                    {
                      payments,
                      provider: reconcileProvider,
                      log: (message, meta) => log.info(message, meta),
                    },
                  );
                  if (!report.ok) throw new Error(report.error.detail);
                  const value = report.value;
                  return `examined=${value.examined} settled=${value.settled} pending=${value.stillPending} already=${value.alreadySettled} failed=${value.failed}`;
                },
              },
            ]),
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
        {
          /**
           * مهمّةٌ لكلّ مدينة لا مهمّةٌ عامّة، لأنّ حدّ الدفعة وموعدَ إعادةِ المحاولة
           * يُقرأان من `platform_settings` المُفتاحة بالمدينة. ومهمّةٌ واحدة عابرةٌ
           * للمدن كانت ستجعل مدينةً مزدحمة تستنزف دفعةَ غيرها في كلّ شوط.
           */
          name: `deliver-broadcasts:${cityId}`,
          everySeconds: JOB_INTERVALS.deliverBroadcasts,
          runOnStart: true,
          run: async () => {
            const report = await deliverBroadcasts(cityId, {
              deliveries: broadcastDeliveries,
              publishers: {
                drivers: driverBroadcastPublisher,
                riders: riderBroadcastPublisher,
              },
            });
            if (!report.ok) throw new Error(report.error.detail);
            const value = report.value;
            return `claimed=${value.claimed} sent=${value.sent} failed=${value.failed} retried=${value.retried}`;
          },
        },
        {
          /**
           * إشعاراتُ الاشتراك تُكتب في القاعدة داخل معاملة تغيُّر الحالة، فلا يُفقد
           * إشعارٌ لأنّ تلغرام كان محجوباً لحظةَ التفعيل. وهذه المهمّة تسلّمها فقط.
           */
          name: `deliver-subscription-notices:${cityId}`,
          everySeconds: JOB_INTERVALS.deliverSubscriptionNotices,
          runOnStart: true,
          run: async () => {
            const report = await deliverSubscriptionNotices(cityId, {
              notices: subscriptionNotices,
              publisher: subscriptionNoticePublisher,
            });
            if (!report.ok) throw new Error(report.error.detail);
            const value = report.value;
            return `claimed=${value.claimed} sent=${value.sent} failed=${value.failed} retried=${value.retried}`;
          },
        },
      ]);

      // مهامّ لا تخصّ مدينة بعينها: الدالّتان تعملان على القاعدة كلّها في نداء واحد،
      // فتشغيلهما لكل مدينة كان سيكرّر نفس العمل بعدد المدن.
      // المهامّ العامة تشمل النسخ الاحتياطي اليوميّ إلى Google Drive (البند 7).
      // لا يُفعَّل إلا عند توفر اعتمادات Google Drive، فغيابها تخطّي صامت لا خطأ.
      const backupConfig = readBackupConfig(config.databaseUrl);
      const backupLocalDir = process.env.BACKUP_LOCAL_DIR;
      const backupStorage =
        backupConfig === null
          ? null
          : backupLocalDir
            ? createLocalBackupStorage({ directory: backupLocalDir })
            : createGoogleDriveStorage({
                serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
                folderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID ?? "",
              });

      const global: JobDefinition[] = [
        ...(cityIds.length === 0
          ? []
          : [
              {
                // القفل باسم ثابت يجعل نسختين من العامل تتسابقان على outbox واحداً من
                // دون إرسال بطاقتين؛ وSKIP LOCKED داخل RPC يحمي كذلك تعدد العناصر.
                name: "deliver-safety-incidents",
                everySeconds: JOB_INTERVALS.deliverSafetyIncidents,
                runOnStart: true,
                run: async () => {
                  const report = await deliverSafetyIncidents({
                    deliveries: safetyDeliveries,
                    publisher: safetyPublisher,
                  });
                  if (!report.ok) throw new Error(report.error.detail);
                  // المؤجَّل يُذكر باسمه في سطر السجلّ: نداءُ استغاثةٍ لا يُسلَّم
                  // لنقص إعدادٍ يجب أن يظهر في كل دورة حتى يُضبط الإعداد.
                  const deferred = report.value.deferred
                    .map((entry) => `${entry.cityId}:${entry.reason}`)
                    .join(",");
                  return [
                    `claimed=${report.value.claimed}`,
                    `delivered=${report.value.delivered}`,
                    `failed=${report.value.failed}`,
                    deferred === ""
                      ? "deferred=0"
                      : `deferred=${report.value.deferred.length} (${deferred})`,
                  ].join(" ");
                },
              },
            ]),
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

      // النسخ الاحتياطي مهمّة عامّة لا لكل مدينة: قاعدة واحدة نسخة واحدة.
      if (backupStorage !== null && backupConfig !== null) {
        global.push({
          name: "backup-database",
          everySeconds: JOB_INTERVALS.backupDatabase,
          run: async () => {
            const report = await runDatabaseBackup(
              backupConfig,
              {
                storage: backupStorage,
                sql,
                clock: systemClock,
                log: (message, meta) => log.info(message, meta),
              },
              createPgDumper(),
            );
            if (!report.ok) throw new Error(report.error.detail);
            const v = report.value;
            return v.status === "uploaded"
              ? `uploaded bytes=${v.bytes ?? 0} pruned=${v.pruned ?? 0}`
              : `skipped (${v.status})`;
          },
        });

        /**
         * تحقّق الاستعادة: يُنزِل أحدث أرشيف ويستعيده فعلاً في قاعدةٍ معزولة، ويعدّ
         * الجداول والدوال وسياسات RLS والقُيود. يُسجّل مع مهمة النسخ نفسها وبنفس
         * شرطها: تحقّقٌ بلا نسخٍ لا معنى له، ونسخٌ بلا تحقّق وعدٌ لم يُختبر قطّ.
         * القفل الموزّع في runner يمنع تمرينين متزامنين يتسابقان على قاعدة التمرين.
         */
        global.push({
          name: "verify-backup-restore",
          everySeconds: JOB_INTERVALS.verifyBackupRestore,
          run: async () => {
            const report = await runBackupRestoreVerification(
              { databaseUrl: config.databaseUrl },
              { storage: backupStorage, sql, log: (message, meta) => log.info(message, meta) },
            );
            if (!report.ok) throw new Error(report.error.detail);
            return `${report.value.status} run=${report.value.backupRunId ?? "none"}`;
          },
        });
      }

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
