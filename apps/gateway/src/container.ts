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
import type { EscalateUnmatchedOrderDependencies } from "../../../packages/application/dispatch/escalate-unmatched-order.ts";
import type { PublishToUnsubscribedGroupDependencies } from "../../../packages/application/dispatch/publish-to-unsubscribed-group.ts";
import type { RepublishDependencies } from "../../../packages/application/dispatch/republish-order-card.ts";
import type { RotateNegotiationDependencies } from "../../../packages/application/dispatch/rotate-negotiation-turn.ts";
import type { TranslationProvider } from "../../../packages/application/i18n-translation/index.ts";
import type { TranslationFailure } from "../../../packages/domain/i18n-translation/index.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDispatchRpc,
  createDriverCandidateRepository,
  createOfferDecisionPort,
  createOfferRepository,
  createOfferWriter,
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
import {
  createSupportCardRecorder,
  createSupportClaimPort,
  createSupportResolutionPort,
  createSupportTicketContextReader,
  createSupportTicketPort,
} from "../../../packages/infrastructure/dispute/support-adapters.ts";
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
import {
  createActiveOrderLookup,
  createOrderRepository,
  createOrderWriter,
} from "../../../packages/infrastructure/transport/order-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { systemClock } from "../../../packages/shared/kernel/index.ts";
import { createDriverBot, grammyTelegramSender, type TelegramSender } from "./bots/driver/index.ts";
import { createRiderBot } from "./bots/rider/index.ts";
import { counterpartNotifier } from "./bots/shared/counterpart-notifier.ts";
import { createMemorySessionStore } from "./bots/shared/session.ts";
import type { RawTelegramUpdate } from "./bots/shared/telegram-mapper.ts";
import type { BotKind, UpdateHandler } from "./routes/telegram-webhook.ts";

export interface BotWiring {
  readonly driver: { readonly deps: DriverBotDependencies; readonly sender: TelegramSender };
  readonly rider: { readonly deps: RiderBotDependencies; readonly sender: TelegramSender };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** يبني معالج التحديثات الحقيقي: كل بوت إلى محوّله، وما سواه يُرفض بلا ادّعاء معالجة. */
export function createUpdateHandler(wiring: BotWiring): UpdateHandler {
  const log = wiring.log ?? (() => {});
  const driverBot = createDriverBot(wiring.driver.deps, wiring.driver.sender, log);
  const riderBot = createRiderBot(wiring.rider.deps, wiring.rider.sender, log);

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
  close(): Promise<void>;
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
}

/**
 * التركيب الحقيقي من الإعدادات: اتصال قاعدة واحد، ومحوّلات حقيقية لكل منفذ.
 * المُرسِلان قابلان للاستبدال ليُختبر المسار كاملاً بلا شبكة تلغرام.
 */
export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const sql = createSql({ connectionString: config.databaseUrl });
  const log = overrides.log ?? (() => {});

  const driverSender = overrides.driverSender ?? grammyTelegramSender(config.driverBotToken);
  const riderSender = overrides.riderSender ?? grammyTelegramSender(config.riderBotToken);

  // مخزنان منفصلان: حالة حوار السائق لا تخصّ العميل، ودمجهما كان سيخلط خطوتين
  // لشخص واحد يستخدم البوتين بمعرّف تلغرام واحد.
  const driverSessions = createMemorySessionStore(systemClock);
  const riderSessions = createMemorySessionStore(systemClock);

  const settings = createSettingsRepository(sql);
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
  const languageDeps = (sessions: ReturnType<typeof createMemorySessionStore>) => ({
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
  const supportCore = {
    open: { tickets: createSupportTicketPort(sql) },
    card: {
      context: createSupportTicketContextReader(sql),
      publisher: createSupportCardPublisher(supportSender),
      recorder: createSupportCardRecorder(sql),
    },
    claims: { claims: createSupportClaimPort(sql) },
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

  const driverDeps: DriverBotDependencies = {
    sessions: driverSessions,
    drivers,
    cities,
    settings,
    subscriptions: createSubscriptionReader(sql),
    trial: createTrialRpc(sql),
    dispatch: createDispatchRpc(sql),
    offers: createOfferDecisionPort(sql),
    clock: systemClock,
    negotiation: { claims: claimDeps, relay: relayDeps },
    support: driverSupport,
    rating: {
      sessions: driverSessions,
      lifecycle: lifecyclePort,
      ratings: ratingPort,
      // الجسر إلى بوت العميل: من أنهى الرحلة سائقٌ، ومن يُبلَّغ بها عميلٌ على بوت آخر
      counterpart: counterpartNotifier(riderSender),
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
    activeOrderOf: createActiveOrderLookup(sql),
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
  };

  return {
    handler: createUpdateHandler({
      driver: { deps: driverDeps, sender: driverSender },
      rider: { deps: riderDeps, sender: riderSender },
      log,
    }),
    sql,
    driverSender,
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
