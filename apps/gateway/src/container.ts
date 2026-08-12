/**
 * الغرض: تركيب التبعيات: يحوّل مجموعة منافذ جاهزة إلى معالج تحديثات يفهمه مسار الـ webhook،
 *   ويبني تلك المنافذ من محوّلات قاعدة البيانات الحقيقية عند الإقلاع.
 *   هذا هو الموضع الوحيد الذي يعرف "من يُنفِّذ ماذا"، فلا يعرفه منطق الحوار.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر على قاعدة حقيقية في tests/integration.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، apps/workers
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد هنا، بلا لمس أي منطق.
 */

import type { DriverBotDependencies } from "../../../packages/application/bots/driver-dialog.ts";
import type { RiderBotDependencies } from "../../../packages/application/bots/rider-dialog.ts";
import type { SupportDialogDependencies } from "../../../packages/application/bots/support-dialog.ts";
import type { SessionStore } from "../../../packages/application/bots/types.ts";
import type { EscalateUnmatchedOrderDependencies } from "../../../packages/application/dispatch/escalate-unmatched-order.ts";
import type { PublishToUnsubscribedGroupDependencies } from "../../../packages/application/dispatch/publish-to-unsubscribed-group.ts";
import { redispatchSearchingOrders } from "../../../packages/application/dispatch/redispatch-searching-orders.ts";
import type { RepublishDependencies } from "../../../packages/application/dispatch/republish-order-card.ts";
import type { RotateNegotiationDependencies } from "../../../packages/application/dispatch/rotate-negotiation-turn.ts";
import type { SubscriptionWalletRpcPort } from "../../../packages/application/financial/ports.ts";
import type { TranslationProvider } from "../../../packages/application/i18n-translation/index.ts";
import {
  type CustomerLiveRelay,
  createCustomerLiveRelay,
  type LiveLocationChannel,
} from "../../../packages/application/tracking/customer-live-relay.ts";
import type { DriverTripCardReader } from "../../../packages/application/tracking/driver-trip-card.ts";
import {
  createLiveTracking,
  type LiveTrackingPort,
} from "../../../packages/application/tracking/live-tracking.ts";
import type { TranslationFailure } from "../../../packages/domain/i18n-translation/index.ts";
import { DEFAULT_SESSION_POLICY } from "../../../packages/domain/tracking/session.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDispatchRpc,
  createDriverCandidateRepository,
  createOfferDecisionPort,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import {
  createActiveNegotiationLookup,
  createClaimRegistrationPort,
  createEscalationPort,
  createNegotiationPartiesReader,
  createNegotiationRotationPort,
  createNegotiationSnapshotReader,
  createNegotiationTimeoutReader,
  createOrderNotesReader,
  createUnsubscribedCyclePort,
} from "../../../packages/infrastructure/dispatch/negotiation-adapters.ts";
import { createAgentMeasurementPort } from "../../../packages/infrastructure/dispute/agent-measurement-adapters.ts";
import {
  createSupportCardRecorder,
  createSupportClaimPort,
  createSupportResolutionPort,
  createSupportTicketContextReader,
  createSupportTicketPort,
} from "../../../packages/infrastructure/dispute/support-adapters.ts";
import { createSubscriptionWalletRpc } from "../../../packages/infrastructure/financial/subscription-wallet-adapters.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import {
  createLanguagePreferencePort,
  createMemoryTranslationCache,
  createTranslationProvider,
} from "../../../packages/infrastructure/i18n-translation/index.ts";
import { createBootstrapAdminPort } from "../../../packages/infrastructure/identity/bootstrap-admin.ts";
import {
  createDriverDirectory,
  createRiderDirectory,
} from "../../../packages/infrastructure/identity/directories.ts";
import { createTelegramDriverNotifier } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import {
  grammyLiveLocationChannel,
  TELEGRAM_MAX_LIVE_PERIOD_SECONDS,
} from "../../../packages/infrastructure/notification/telegram-live-location.ts";
import {
  createEscalationGroupPublisher,
  createTelegramNegotiationNotifier,
  createTelegramRelaySender,
  createUnsubscribedGroupPublisher,
} from "../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import {
  createSupportCardPublisher,
  createTicketOwnerNotifier,
} from "../../../packages/infrastructure/notification/telegram-support-notifier.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import {
  createRatingPort,
  createRideLifecyclePort,
} from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import {
  createSubscriptionReader,
  createTrialRpc,
} from "../../../packages/infrastructure/subscription/subscription-adapters.ts";
import { createSubscriptionChangeRpc } from "../../../packages/infrastructure/subscription/subscription-change-adapters.ts";
import {
  createTrackingEventBus,
  type TrackingEventBus,
} from "../../../packages/infrastructure/tracking/event-bus.ts";
import { createTrackingSessionRepository } from "../../../packages/infrastructure/tracking/session-repository.ts";
import {
  createActiveTripReader,
  createDriverDutyReader,
  createDriverTripCardReader,
  createTrackingProofReader,
  type TrackingProofReader,
} from "../../../packages/infrastructure/tracking/tracking-queries.ts";
import {
  createActiveOrdersLookup,
  createOrderRepository,
  createOrderWriter,
  createPastOrdersLookup,
} from "../../../packages/infrastructure/transport/order-adapters.ts";
import type { RoutingProvider } from "../../../packages/maps/index.ts";
import { createOsrmProvider } from "../../../packages/maps/index.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { type CityId, systemClock } from "../../../packages/shared/kernel/index.ts";
import type { TrackingSessionStore } from "../../../packages/tracking/session-store.ts";
import {
  createAgentCore,
  createSupportAdvicePublisher,
  createTicketAdvisor,
} from "./agent-advisor.ts";
import { createDriverBot, grammyTelegramSender, type TelegramSender } from "./bots/driver/index.ts";
import { createRiderBot } from "./bots/rider/index.ts";
import { counterpartNotifier } from "./bots/shared/counterpart-notifier.ts";
import {
  createLanguageHydration,
  type LanguageHydration,
} from "./bots/shared/language-middleware.ts";
import { createRedisSessionStore } from "./bots/shared/redis-session.ts";
import { createMemorySessionStore } from "./bots/shared/session.ts";
import type { RawTelegramUpdate } from "./bots/shared/telegram-mapper.ts";
import { createUpstashRedis, type RedisClient } from "./redis/upstash.ts";
import type { BotKind, UpdateHandler } from "./routes/telegram-webhook.ts";

export interface BotWiring {
  readonly driver: {
    readonly deps: DriverBotDependencies;
    readonly sender: TelegramSender;
    readonly language?: LanguageHydration;
  };
  readonly rider: {
    readonly deps: RiderBotDependencies;
    readonly sender: TelegramSender;
    readonly language?: LanguageHydration;
  };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** يبني معالج التحديثات الحقيقي: كل بوت إلى محوّله، وما سواه يُرفض بلا ادّعاء معالجة. */
export function createUpdateHandler(wiring: BotWiring): UpdateHandler {
  const log = wiring.log ?? (() => {});
  const driverBot = createDriverBot(
    wiring.driver.deps,
    wiring.driver.sender,
    log,
    wiring.driver.language,
  );
  const riderBot = createRiderBot(
    wiring.rider.deps,
    wiring.rider.sender,
    log,
    wiring.rider.language,
  );

  const routes: Readonly<Record<BotKind, (raw: RawTelegramUpdate) => Promise<boolean>>> = {
    driver: (raw) => driverBot.handleUpdate(raw),
    rider: (raw) => riderBot.handleUpdate(raw),
  };

  return {
    handle: async (bot, update) => {
      if (typeof update !== "object" || update === null) return false;
      return routes[bot](update as RawTelegramUpdate);
    },
  };
}

/** يجعل مُرسِل البوت صالحاً كمنفذ إخطار عام (يُستخدم لبثّ العروض على السائقين). */
import {
  asIdentifyingSender,
  asOutboundSender,
  asSupportSender,
} from "../../../packages/infrastructure/notification/telegram-api-sender.ts";

export { asIdentifyingSender, asOutboundSender, asSupportSender };

export interface Container {
  readonly handler: UpdateHandler;
  readonly sql: Sql;
  /**
   * مُرسِل بوت السائق مكشوف لأن لوحة الإدارة تسلّم رمز الدخول في محادثة المسؤول
   * الخاصة معه — القناة نفسها لا قناة ثانية بمفتاح ثانٍ يُنسى تدويره.
   */
  readonly driverSender: TelegramSender;
  /**
   * تبعيات دورة غير المشتركين مكشوفة لأن مُشغّل الجوبات واختبارات التكامل
   * تحتاج تشغيل الدورة خارج مسار الـ webhook — وبنفس المحوّلات لا بنسخة موازية.
   */
  readonly negotiation: NegotiationWiring;
  /**
   * عمليات الائتمان والاسترداد والفاتورة والتصحيح مالية إدارية/ويبهوك فقط؛ لا
   * تُوصل لحوار السائق حتى لا يصبح البوت قناة قرار استرداد أو تسوية. لوحة الإدارة
   * ومسار الويبهوك يستعملان هذا المحول الإنتاجي نفسه عند تفعيل واجهتهما.
   */
  readonly financial: SubscriptionWalletRpcPort;
  /**
   * المرحلة ٦ — النقل اللحظي مكشوف لأن مسار SSE يحتاج نفس الناقل الذي ينشر
   * فيه مسار البوت — لا ناقلاً ثانياً يُبنى في `index.ts`. والاختبارات تقرأ منه
   * الجلسات والبراهين بنفس المحوّلات لا بنسخة موازية.
   */
  readonly tracking: TrackingWiring;
  close(): Promise<void>;
}

export interface TrackingWiring {
  readonly bus: TrackingEventBus;
  readonly sessions: TrackingSessionStore;
  readonly proofs: TrackingProofReader;
  readonly live: LiveTrackingPort;
  /**
   * المُرحِّل نفسه — لا نسخةٌ عنه. يُعرَض لأن عدد البثوث المفتوحة حالةٌ في
   * الذاكرة لا أثر لها في القاعدة، فبلا عرضها لا يستطيع اختبارٌ ولا مقياسُ
   * تشغيلٍ أن يشهد على تسريبٍ فيها إلا بالاستدلال من رسائل تلغرام.
   */
  readonly relay: CustomerLiveRelay;
  /**
   * قارئ بطاقة رحلة السائق — يُعرَض لنفس سبب عرض `relay`: بلا عرضه لا يستطيع
   * اختبارٌ أن يشهد على أنّ المفتاحين (معرّف السائق ومعرّف تلغرام) يجيبان بنفس
   * الرحلة، ولا على أنّ سائقاً لا يرى رحلة غيره، إلا بالاستدلال من نصّ رسالة.
   * والاستدلالُ من النصّ يُخفي فرقاً في الاستعلام نفسه.
   */
  readonly tripCards: DriverTripCardReader;
}

export interface NegotiationWiring {
  readonly snapshots: ReturnType<typeof createNegotiationSnapshotReader>;
  readonly rotate: RotateNegotiationDependencies;
  readonly republish: RepublishDependencies;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly publish: PublishToUnsubscribedGroupDependencies;
  readonly clock: typeof systemClock;
}

export interface ContainerOverrides {
  readonly driverSender?: TelegramSender;
  readonly riderSender?: TelegramSender;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * مزوّد ترجمة بديل. يُحقن في الاختبار بمزوّد حتمي بلا شبكة، فيُثبَت مسار
   * الترجمة كاملاً في CI بلا اعتماد على خدمة خارجية ولا على منفذ إنترنت.
   */
  readonly translationProvider?: TranslationProvider | null;
  /**
   * عميل Redis بديل. يُحقن في الاختبار بعميل في الذاكرة، فيُثبَت مسار الجلسات
   * على Redis كاملاً في CI بلا خادم Redis ولا منفذ إنترنت.
   */
  readonly redis?: RedisClient;
  /**
   * المرحلة ٦ — قناة الموقع الحيّ البديلة. تُحقن في الاختبار بقناةٍ تلتقط البثّ،
   * فيُثبَت مسار الدفع إلى العميل كاملاً على قاعدة حقيقية بلا شبكة تلغرام.
   */
  readonly liveLocationChannel?: LiveLocationChannel;
}

/**
 * التركيب الحقيقي من الإعدادات: اتصال قاعدة واحد، ومحوّلات حقيقية لكل منفذ.
 * المُرسِلان قابلان للاستبدال ليُختبر المسار كاملاً بلا شبكة تلغرام.
 */
/**
 * حدُّ المحاولةِ الفوريّة أضيقُ من حدِّ العامل (٥٠) عن قصد: هذه تجري داخل معالجةِ
 * تحديثٍ من تلغرام، ولتلغرام مهلةٌ على الـwebhook. فحصُ خمسين طلباً — كلٌّ منها دورةُ
 * مطابقةٍ كاملةٍ باستعلاماتها — يُخاطر بتجاوز المهلة فيُعيد تلغرام التحديثَ نفسَه،
 * فيُعالَج موقعُ السائق مرّتين. والأقدمُ أوّلاً، والباقي تتولّاه الأرضيّةُ الدوريّة.
 */
const IMMEDIATE_REDISPATCH_LIMIT = 10;

export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const sql = createSql({ connectionString: config.databaseUrl });
  const log = overrides.log ?? (() => {});

  const driverSender = overrides.driverSender ?? grammyTelegramSender(config.driverBotToken);
  const riderSender = overrides.riderSender ?? grammyTelegramSender(config.riderBotToken);

  // مخزنان منفصلان: حالة حوار السائق لا تخصّ العميل، ودمجهما كان سيخلط خطوتين
  // لشخص واحد يستخدم البوتين بمعرّف تلغرام واحد. الفصل في الذاكرة بخريطتين،
  // وفي Redis بفضاء مفتاح لكل بوت — نفس الضمان بآليتين (ADR 0011).
  const redis =
    overrides.redis ??
    (config.sessionStore === "redis"
      ? createUpstashRedis({ url: config.redisUrl, token: config.redisToken })
      : null);

  const onSessionFailure = (failure: {
    readonly kind: string;
    readonly detail: string;
    readonly operation: string;
  }): void => {
    log("session.redis_failed", failure);
  };

  const makeSessions = (namespace: "driver" | "rider"): SessionStore =>
    config.sessionStore === "redis" && redis !== null
      ? createRedisSessionStore(redis, namespace, { onFailure: onSessionFailure })
      : createMemorySessionStore(systemClock);

  const driverSessions = makeSessions("driver");
  const riderSessions = makeSessions("rider");
  log("session.store_selected", { store: config.sessionStore });

  const settings = createSettingsRepository(sql);
  const financial = createSubscriptionWalletRpc(sql);
  const cities = createCityDirectory(sql);
  const drivers = createDriverDirectory(sql);
  const riders = createRiderDirectory(sql);
  const orders = createOrderRepository(sql);
  const orderWriter = createOrderWriter(sql);
  const offers = createOfferRepository(sql);
  const candidates = createDriverCandidateRepository(sql);

  const matching = {
    orders,
    offers,
    candidates,
    settings,
    offerWriter: createOfferWriter(sql),
    notifier: createTelegramDriverNotifier(sql, asOutboundSender(driverSender)),
    clock: systemClock,
    // يوصل `dispatch.no_eligible_driver` وتعداد أسباب الرفض إلى سجلّ الإنتاج.
    // دونه يبقى التشخيص حبيساً في قيمة راجعة يُسقطها منادي بوت العميل.
    log,
  };

  // مسار قروب غير المشتركين: مُرسِل السائق هو من ينشر في القروب، لأن أزراره
  // يضغطها سائقون ويجب أن تصل ردودها لبوت السائق لا بوت العميل.
  const driverOut = asOutboundSender(driverSender);
  const riderOut = asOutboundSender(riderSender);
  const negotiationNotifier = createTelegramNegotiationNotifier(driverOut, riderOut);
  const rotationPort = createNegotiationRotationPort(sql);
  const partiesReader = createNegotiationPartiesReader(sql);

  // الترجمة المتبادلة (المرحلة 2.6). الذاكرة المؤقتة في العملية الآن، وتنتقل إلى
  // Redis في القسم 5 بتبديل سطر واحد: المنفذ نفسه بتنفيذ آخر.
  const translationProvider =
    overrides.translationProvider !== undefined
      ? overrides.translationProvider
      : createTranslationProvider({
          provider: config.translationProvider,
          ...(config.translationApiKey === null ? {} : { apiKey: config.translationApiKey }),
          ...(config.translationContactEmail === null
            ? {}
            : { contactEmail: config.translationContactEmail }),
        });

  const translation = {
    provider: translationProvider,
    cache: createMemoryTranslationCache(systemClock),
    onFailure: (failure: TranslationFailure) => {
      // فشل المزوّد يُسجَّل ولا يُوقف الرسالة: الرسالة تصل بلغتها الأصلية.
      log("translation.failed", {
        kind: failure.kind,
        provider: failure.provider,
        detail: failure.detail,
        retryable: failure.retryable,
      });
    },
  };

  const languagePreferences = createLanguagePreferencePort(sql);

  /**
   * حوار اللغة لكل بوت بمخزن جلسته هو. الجلسة تُحدَّث بعد نجاح الكتابة في القاعدة
   * فقط: لو حدّثناها قبل ذلك لتغيّرت لغة الرسائل مع بقاء القاعدة على القديمة،
   * فيعود المستخدم بعد انتهاء الجلسة إلى لغة لم يخترها.
   */
  const languageDeps = (sessions: SessionStore) => ({
    preferences: languagePreferences,
    rememberLanguage: async (telegramId: string, language: string): Promise<void> => {
      const stored = await sessions.load(telegramId);
      if (!stored.ok || stored.value === null) return;
      await sessions.save(telegramId, { ...stored.value, language });
    },
  });

  const relayDeps = {
    lookup: createActiveNegotiationLookup(sql),
    sender: createTelegramRelaySender(driverOut, riderOut, translation),
  };

  const claimDeps = {
    claims: createClaimRegistrationPort(sql),
    parties: partiesReader,
    notifier: negotiationNotifier,
    timeouts: createNegotiationTimeoutReader(sql),
  };

  const rotationDeps = {
    rotation: rotationPort,
    parties: partiesReader,
    notifier: negotiationNotifier,
    timeouts: createNegotiationTimeoutReader(sql),
  };

  const publishDeps = {
    orders,
    notes: createOrderNotesReader(sql),
    cycles: createUnsubscribedCyclePort(sql),
    publisher: createUnsubscribedGroupPublisher(asIdentifyingSender(driverSender)),
  };

  const escalationDeps = {
    orders,
    escalation: createEscalationPort(sql),
    publisher: createEscalationGroupPublisher(asIdentifyingSender(driverSender)),
  };

  /**
   * مسار الدعم: بطاقة التذكرة تُنشر بمُرسِل بوت السائق لأن أزرارها يضغطها فريق الدعم
   * في قروب مرتبط ببوت السائق، وردّ الضغطة يجب أن يعود إلى البوت الذي نشرها.
   * التبليغ الفردي يذهب بمُرسِل البوت نفسه الذي يخاطبه صاحب التذكرة.
   */
  const supportSender = asSupportSender(driverSender);
  const ticketContext = createSupportTicketContextReader(sql);

  /**
   * طبقة الذكاء الاصطناعي المعزولة — **معطّلة ما لم يُضبط `AGENT_CORE_ENABLED=true`**.
   * حين تُعطّل يُحذف `advice` من الاعتمادات أصلاً، فيعود مسار الدعم إلى ما كان
   * عليه حرفاً بحرف قبل وجود هذه الطبقة — لا فرعٌ مُعطّل بل **غيابٌ تام**.
   */
  const agentCore = createAgentCore({
    log: (message, meta) =>
      console.log(JSON.stringify({ at: new Date().toISOString(), message, ...meta })),
  });
  // مخزن القياس يُبنى مع الطبقة ويُطفأ معها: بلا طبقة لا قرارات تُقاس، وزرٌّ لا
  // يُنشَر أصلاً لا يحتاج مستقبِلاً. وربطهما بشرطٍ واحد يمنع نصفاً مفعَّلاً بلا نصفه.
  const measurement = agentCore.enabled ? createAgentMeasurementPort(sql) : undefined;
  const advice =
    agentCore.enabled && measurement !== undefined
      ? {
          context: ticketContext,
          advisor: createTicketAdvisor(agentCore),
          publisher: createSupportAdvicePublisher(supportSender),
          measurement,
        }
      : undefined;

  const supportCore = {
    open: { tickets: createSupportTicketPort(sql) },
    card: {
      context: ticketContext,
      publisher: createSupportCardPublisher(supportSender),
      recorder: createSupportCardRecorder(sql),
    },
    claims: { claims: createSupportClaimPort(sql) },
    // `exactOptionalPropertyTypes`: الحقل يُنشر عند وجوده ولا يُضاف `undefined` صراحةً.
    ...(advice === undefined ? {} : { advice }),
    ...(measurement === undefined ? {} : { measurement }),
  };
  const resolutionPort = createSupportResolutionPort(sql);

  const driverSupport: SupportDialogDependencies = {
    ...supportCore,
    sessions: driverSessions,
    resolutions: {
      resolutions: resolutionPort,
      notifier: createTicketOwnerNotifier(supportSender),
    },
  };

  const riderSupport: SupportDialogDependencies = {
    ...supportCore,
    sessions: riderSessions,
    resolutions: {
      resolutions: resolutionPort,
      notifier: createTicketOwnerNotifier(asSupportSender(riderSender)),
    },
  };

  /**
   * التقييم المتبادل: منفذا الرحلة والتقييم واحدان للبوتين، فالسلوك واحد في الاتجاهين.
   * بوت العميل لا يحتاج منفذ دورة الرحلة لأن البدء والإنهاء بيد السائق وحده.
   */
  const ratingPort = createRatingPort(sql);
  const lifecyclePort = createRideLifecyclePort(sql);

  /**
   * المرحلة ٦ — النقل اللحظي. التركيب هنا لا داخل الحوار: الناقل **واحد**
   * للعملية كلّها، ومن بناه في موضعين صار له مشتركون لا يرون أحداث بعضهم.
   */
  const trackingBus = createTrackingEventBus(log);
  const trackingSessions = createTrackingSessionRepository(sql);
  const trackingProofs = createTrackingProofReader(sql);

  /**
   * قناة الموقع الحيّ على **بوت العميل**: الخريطة تظهر في محادثة العميل،
   * وإرسالها من بوت السائق يعني محادثةً لا يفتحها العميل أصلاً (وترفضها تلغرام
   * لمن لم يبدأ المحادثة). وهو نفس منطق `counterpartNotifier` القائم.
   */
  const liveLocationChannel =
    overrides.liveLocationChannel ?? grammyLiveLocationChannel(config.riderBotToken);

  const customerRelay = createCustomerLiveRelay({
    channel: liveLocationChannel,
    customers: { resolve: (tripId) => trackingProofs.customerOf(tripId) },
    clock: systemClock,
    /**
     * المرحلة ١١ — مدّةُ البثّ سقفُ الجلسة في المجال لا سقفُ تلغرام.
     *
     * `live_period` ليست إعداد جودة: هي مفتاحُ الرجل الميّت — الشيء الوحيد الذي
     * يُغلق خريطة العميل حين لا يبلغ المرحّلَ حدثٌ آخر أبداً (انهيار البوّابة،
     * موتُ تطبيق السائق، فشلُ كلّ تعديل). وكانت مضبوطةً على
     * `TELEGRAM_MAX_LIVE_PERIOD_SECONDS` = ٢٤ ساعة، وهو خطأٌ تعريفيّ لا مجرّد
     * سخاء: `DEFAULT_SESSION_POLICY.maxSessionSeconds` = ١٢ ساعة تعني أنّ أطول
     * جلسة تتبّعٍ ممكنة نصفُ ذلك — فكان البثُّ يبقى «حيّاً» في هاتف العميل
     * ضعفَ عمر الجلسة التي وُلد منها، ونقطةٌ مجمّدةٌ اثنتي عشرة ساعة أسوأ من
     * خريطةٍ مغلقة: العميل يقرؤها موقعاً راهناً.
     *
     * والاشتقاق من سياسة المجال لا رقمٌ مكتوبٌ بيدٍ هنا: مصدرُ الحقيقة لعمر
     * الجلسة واحد، ورقمٌ ثانٍ كان سينحرف عنه عند أوّل تعديل. وسقفُ تلغرام يبقى
     * مستورداً لأن القناة تحصر القيمة فيه أصلاً — فالاشتقاق آمنٌ ولو رُفعت
     * السياسة فوق اليوم.
     */
    livePeriodSeconds: Math.min(
      DEFAULT_SESSION_POLICY.maxSessionSeconds,
      TELEGRAM_MAX_LIVE_PERIOD_SECONDS,
    ),
    log,
  });

  /**
   * المُرحِّل يُشترك مرّةً واحدة عند التركيب لا لكل رحلة. البديل — اشتراكٌ عند بدء
   * كل رحلة وفصلٌ عند نهايتها — يبدو أدقّ، وهو في الحقيقة تسريبٌ منتظر: رحلةٌ
   * تنتهي بطريقةٍ لا يمرّ بها الفصل (إلغاء، إعادة نشر) تترك مشتركاً معلّقاً.
   * والحصر هنا ليس بالاشتراك بل باشتقاق الوجهة من `orders` في كل حدث.
   */
  trackingBus.subscribe(
    { kind: "operations", scope: { kind: "all_cities" } },
    { deliver: (event) => customerRelay.handle(event) },
  );

  /**
   * المرحلة ١٢ — قارئٌ واحد يُمرَّر إلى حوار السائق وحوار التقييم: نسختان منه
   * لا تُنتجان بيانات مختلفة (كلتاهما تقرأ `orders`)، لكنّهما موضعان لتعديل
   * الاستعلام يُنسى أحدهما. والمصدر واحد فالقارئ واحد.
   */
  const driverTripCards = createDriverTripCardReader(sql);

  /**
   * المرحلة ١٥ — مزوّد التوجيه يُبنى من الضبط هنا، وهذا **أولُ موضعٍ يُبنى
   * فيه في المستودع كلّه خارج الاختبارات**.
   *
   * وقياسُ ما كان قبله: `createOsrmProvider` لا يُستدعى إلاّ في ثلاثة ملفّات
   * اختبار، و`RoutingProvider` لا يُذكر خارج `packages/maps` ألبتّة، و`OSRM_BASE_URL`
   * مُعلَنٌ في `render.yaml` ولا يُقرأ في الضبط (الخطر R-28). فكان المحرّك
   * **غيرَ قابلٍ للبناء في الإنتاج** لا «موجوداً غيرَ مفعّل».
   *
   * و`null` عند `none` لا مزوّدٌ صوريٌّ يُجيب أرقاماً: مزوّدٌ يكذب أخطر من غيابٍ
   * موصوف. والضبط يرفض `osrm` بلا عنوانٍ عند الإقلاع، فالفحص هنا تضييقُ نوعٍ
   * لا منطقٌ ثانٍ للقرار.
   */
  const routing: RoutingProvider | null =
    config.routingProvider === "osrm" && config.osrmBaseUrl !== null
      ? createOsrmProvider({ baseUrl: config.osrmBaseUrl })
      : null;

  const liveTracking = createLiveTracking({
    sessions: trackingSessions,
    publisher: trackingBus,
    trips: createActiveTripReader(sql),
    duty: createDriverDutyReader(sql),
    clock: systemClock,
    log,
  });

  /**
   * المرحلة ١٤ — المحاولةُ الفوريّة لإعادة عرض الطلبات الباحثة عند صيرورة السائق
   * قابلاً للإسناد. تُبنى على **نفس** `matching` التي يستخدمها بوت الراكب عند إنشاء
   * الطلب، فلا يوجد في النظام مسارُ بثٍّ ثانٍ بسلوكٍ ثانٍ.
   *
   * والإخفاقُ يُبتلَع عن قصدٍ ويُسجَّل: السائقُ أرسل موقعَه ونجحت كتابتُه، فإخفاقُ
   * محاولةِ إعادةِ العرض لا يجوز أن يُظهر له «عطلٌ تقنيّ» عن عملٍ نجح — والأرضيّةُ
   * الدوريّة في العامل تُدرك ما فات بعد ثوانٍ.
   */
  const redispatchDeps = {
    onDriverBecameDispatchable: async (cityId: CityId): Promise<void> => {
      const report = await redispatchSearchingOrders(cityId, {
        finder: createSearchingOrderFinder(sql),
        broadcast: matching,
        limit: IMMEDIATE_REDISPATCH_LIMIT,
        log,
      });
      if (!report.ok) log("redispatch.immediate_failed", { cityId, detail: report.error.detail });
    },
  };

  const driverDeps: DriverBotDependencies = {
    sessions: driverSessions,
    drivers,
    cities,
    settings,
    subscriptions: createSubscriptionReader(sql),
    trial: createTrialRpc(sql),
    // تغييرات الاشتراك (أمر المالك 2026-08-12): الإلغاء آخرَ الدورة، والتراجع
    // عنه، وترقية الخطّة. المنفذ نفسه الذي تختبره اختبارات التكامل على قاعدة
    // حقيقية — لا نسخةٌ ثانية بسلوكٍ ثانٍ.
    subscriptionChanges: createSubscriptionChangeRpc(sql),
    dispatch: createDispatchRpc(sql),
    offers: createOfferDecisionPort(sql),
    clock: systemClock,
    negotiation: { claims: claimDeps, relay: relayDeps },
    support: driverSupport,
    tracking: liveTracking,
    tripCards: driverTripCards,
    // المرحلة ١٥ — الحقل يُسقَط عند `null` لا يُمرَّر: `exactOptionalPropertyTypes`.
    ...(routing === null ? {} : { routing }),
    redispatch: redispatchDeps,
    rating: {
      sessions: driverSessions,
      lifecycle: lifecyclePort,
      ratings: ratingPort,
      // المرحلة ١٢ — المقصد يُعرَض لحظةَ بدء الرحلة، لا بعد أن يسأل السائق عنه.
      tripCards: driverTripCards,
      ...(routing === null ? {} : { routing }),
      // الجسر إلى بوت العميل: من أنهى الرحلة سائقٌ، ومن يُبلَّغ بها عميلٌ على بوت آخر
      counterpart: counterpartNotifier(riderSender),
      // إنهاء الرحلة يُغلق الجلسة ويُوقف بثّ الموقع عن العميل — المرحلة ٦.
      tracking: liveTracking,
    },
    language: languageDeps(driverSessions),
    bootstrapAdmin: {
      telegramId: config.bootstrapAdminTelegramId,
      grant: (telegramId) => createBootstrapAdminPort(sql).grant(telegramId),
    },
  };

  const riderDeps: RiderBotDependencies = {
    sessions: riderSessions,
    riders,
    cities,
    orders: orderWriter,
    activeOrdersOf: createActiveOrdersLookup(sql),
    pastOrdersOf: createPastOrdersLookup(sql),
    matching,
    clock: systemClock,
    negotiation: { rotation: rotationDeps, relay: relayDeps },
    support: riderSupport,
    rating: {
      sessions: riderSessions,
      lifecycle: lifecyclePort,
      ratings: ratingPort,
      counterpart: counterpartNotifier(driverSender),
    },
    language: languageDeps(riderSessions),
    // المرحلة ١١: **نفس** المنفذ المُمرّر لبوت السائق لا نسخةٌ ثانية: جلسات التتبّع
    // والبثّات المفتوحة حالةٌ في الذاكرة، ومنفذٌ ثانٍ فوقها يعني مُغلقاً يقرأ خريطة غير
    // التي كتبتها إصلاحات السائق — فلا يُغلق شيئاً.
    tracking: liveTracking,
  };

  return {
    handler: createUpdateHandler({
      // ترطيب اللغة بمخزن جلسة كلّ بوت على حدة: من كتب لغته في بوت السائق يجدها
      // مطبّقة في بوت الراكب أيضاً — فالقاعدة واحدة (`users.language_code`)، والفصل في
      // الجلسة وحدها (ADR 0011) لا في التفضيل.
      driver: {
        deps: driverDeps,
        sender: driverSender,
        language: createLanguageHydration({
          preferences: languagePreferences,
          sessions: driverSessions,
          log,
        }),
      },
      rider: {
        deps: riderDeps,
        sender: riderSender,
        language: createLanguageHydration({
          preferences: languagePreferences,
          sessions: riderSessions,
          log,
        }),
      },
      log,
    }),
    sql,
    driverSender,
    financial,
    tracking: {
      bus: trackingBus,
      sessions: trackingSessions,
      proofs: trackingProofs,
      live: liveTracking,
      relay: customerRelay,
      tripCards: driverTripCards,
    },
    negotiation: {
      snapshots: createNegotiationSnapshotReader(sql),
      rotate: rotationDeps,
      republish: publishDeps,
      escalate: escalationDeps,
      publish: publishDeps,
      clock: systemClock,
    },
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
