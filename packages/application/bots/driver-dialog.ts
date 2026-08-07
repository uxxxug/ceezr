/**
 * الغرض: منطق حوار بوت السائق كاملاً: التسجيل، التوافر، الاشتراك، وقبول/رفض العرض.
 *   دالة خالصة من ناحية الإطار: تأخذ تحديثاً مُجرَّداً وتعيد ردوداً، فتُختبر بلا تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/driver/index.ts
 * ملاحظات مستقبلية: كل قيمة تجارية (السعر، مدة التجربة) تُقرأ من platform_settings عبر منفذ الإعدادات.
 */

import { type Coordinates, makeCoordinates } from "../../domain/geo/value-objects.ts";
import { parseFullName, parsePhone } from "../../domain/identity/value-objects.ts";
import {
  type CitySettings,
  parseCitySettings,
  subscriptionPriceFor,
} from "../../domain/policy/entity.ts";
import { isSubscriptionLive, type SubscriptionPlan } from "../../domain/subscription/entity.ts";
import { t } from "../../shared/i18n/index.ts";
import type { Clock, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import {
  type RegisterUnsubscribedClaimDependencies,
  registerUnsubscribedClaim,
} from "../dispatch/register-unsubscribed-claim.ts";
import {
  type RelayDependencies,
  relayNegotiationMessage,
} from "../dispatch/relay-negotiation-message.ts";
import type { DispatchRpcPort, SettingsRepository } from "../ports/index.ts";
import {
  handleActivateCommand,
  handleSupportGroupAction,
  handleSupportTypeChoice,
  type SupportDialogDependencies,
  startSupportDialog,
  submitSupportMessage,
} from "./support-dialog.ts";
import {
  type BotReply,
  type CityDirectory,
  type CityRef,
  type DialogState,
  type DriverDirectory,
  type DriverProfile,
  INITIAL_STATE,
  type IncomingUpdate,
  type Keyboard,
  type OfferDecisionPort,
  type Sender,
  type SessionStore,
  type SubscriptionReader,
  type TrialRpcPort,
} from "./types.ts";

export interface DriverBotDependencies {
  readonly sessions: SessionStore;
  readonly drivers: DriverDirectory;
  readonly cities: CityDirectory;
  readonly settings: SettingsRepository;
  readonly subscriptions: SubscriptionReader;
  readonly trial: TrialRpcPort;
  readonly dispatch: DispatchRpcPort;
  readonly offers: OfferDecisionPort;
  readonly clock: Clock;
  /**
   * مسار قروب غير المشتركين (المرحلة 2.3). اختياري لأن الاختبارات القائمة
   * تختبر التسجيل والعروض وحدها؛ غيابه يعني أن أزرار القروب لا تُعالَج، لا أن تُعالَج خطأ.
   */
  readonly negotiation?: {
    readonly claims: RegisterUnsubscribedClaimDependencies;
    readonly relay: RelayDependencies;
  };
  /**
   * مسار الدعم (المرحلة 2.4). اختياري بنفس منطق negotiation: غيابه يعني أن /support
   * يردّ «أمر غير معروف» بدل أن يفتح حواراً لا نهاية له.
   */
  readonly support?: SupportDialogDependencies;
  /**
   * منح المسؤول الأول (§6.2ب من التوجيه). بلا هذا المسار لا توجد طريقة لتعيين
   * أول مسؤول في نظام كل صلاحياته في القاعدة، إلا تعديل صفّ يدوياً في الإنتاج.
   */
  readonly bootstrapAdmin?: {
    readonly telegramId: string;
    grant(telegramId: string): Promise<unknown>;
  };
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/**
 * ردّ إلى محادثة الشخص الخاصة مهما كان مصدر التحديث. في القروبات chatId هو القروب،
 * والردّ عليه يكشف تفاصيل فردية للجميع؛ ومعرّف مستخدم تلغرام هو نفسه معرّف محادثته الخاصة.
 */
function privateReply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.telegramUserId, text, keyboard };
}

function cityKeyboard(cities: readonly CityRef[]): Keyboard {
  return {
    kind: "inline",
    rows: cities.map((city) => [{ label: city.name, data: `city:${city.id}` }]),
  };
}

/** لا تُستخدم لغة غير مدعومة: نرجع إلى العربية بلا إسقاط الرسالة. */
function languageOf(state: DialogState): string {
  return state.language;
}

async function loadState(deps: DriverBotDependencies, sender: Sender): Promise<DialogState> {
  const stored = await deps.sessions.load(sender.telegramUserId);
  if (stored.ok && stored.value !== null) return stored.value;
  return { ...INITIAL_STATE, language: sender.languageHint === "en" ? "en" : "ar" };
}

/** الردّ الموحّد لأي عطل تقني — لا نكشف تفاصيل داخلية للسائق. */
function technicalFailure(sender: Sender, state: DialogState): readonly BotReply[] {
  return [reply(sender, t(languageOf(state))("common.error_try_again"))];
}

async function citySettingsOf(
  deps: DriverBotDependencies,
  driver: DriverProfile,
): Promise<CitySettings | null> {
  const rows = await deps.settings.findByCity(driver.cityId);
  if (!rows.ok) return null;
  const parsed = parseCitySettings(driver.cityId, rows.value);
  return parsed.ok ? parsed.value : null;
}

/** نقطة الدخول الوحيدة: تحديث واحد ← ردود. لا ترمي استثناءً أبداً. */
export async function handleDriverUpdate(
  update: IncomingUpdate,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const sender = update.from;
  const state = await loadState(deps, sender);

  if (update.kind === "callback") return handleCallback(update.data, sender, state, deps);
  if (update.kind === "contact") return handlePhone(update.phone, sender, state, deps);
  if (update.kind === "location") return handleLocation(update.location, sender, state, deps);
  if (update.kind === "photo") {
    if (state.step !== "awaiting_support_message" || deps.support === undefined) {
      return [reply(sender, t(languageOf(state))("common.unknown_command"))];
    }
    return submitSupportMessage(
      // صورة بلا تعليق ليست شكوى بلا وصف: الإيصال نفسه هو الوصف، ونصّه ثابت مفهوم للدعم
      {
        message: update.caption ?? t(languageOf(state))("support.photo_only_message"),
        attachmentFileId: update.fileId,
      },
      sender,
      state,
      deps.support,
    );
  }

  if (update.kind === "unsupported") {
    return [reply(sender, t(languageOf(state))("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, deps);

  switch (state.step) {
    case "awaiting_name":
      return handleName(text, sender, state, deps);
    case "awaiting_phone":
      return handlePhone(text, sender, state, deps);
    case "awaiting_support_message":
      return deps.support === undefined
        ? [reply(sender, t(languageOf(state))("common.unknown_command"))]
        : submitSupportMessage(
            { message: text, attachmentFileId: null },
            sender,
            state,
            deps.support,
          );
    default:
      // قبل ردّ "أمر غير معروف": إن كان السائق طرفاً في تفاوض نشط، فهذا نصّ موجّه للعميل
      return handleFreeText(text, sender, state, deps);
  }
}

/**
 * نصّ حرّ من سائق مسجّل وليس في خطوة حوار: يُمرّر للعميل إن كان دوره مفتوحاً.
 * من ليس طرفاً في تفاوض نشط لا تُمرّر رسالته — وهذا ما يمنع مخاطبة العميل خارج الدور.
 */
async function handleFreeText(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const negotiation = deps.negotiation;
  if (negotiation === undefined) return [reply(sender, tr("common.unknown_command"))];

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return [reply(sender, tr("common.unknown_command"))];

  const relayed = await relayNegotiationMessage(
    { from: "driver", driverId: driver.id, riderId: null, text },
    negotiation.relay,
  );
  if (!relayed.ok) return technicalFailure(sender, state);

  const report = relayed.value;
  if (report.reason === "NO_ACTIVE_NEGOTIATION" || report.reason === "EMPTY_MESSAGE") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  if (report.reason === "UNREACHABLE") {
    return [reply(sender, tr("negotiation.relay_unreachable"))];
  }
  // تنبيه الحجب يُرسَل فقط عند الحجب فعلاً؛ الرسالة مُرّرت في الحالتين.
  if (report.redacted > 0) return [reply(sender, tr("negotiation.relay_redacted"))];
  return [];
}

const CLAIM_REASON_KEYS: Readonly<Record<string, string>> = {
  ALREADY_CLAIMED: "negotiation.claim_rejected_already",
  SLOTS_FULL: "negotiation.claim_rejected_full",
  EXCLUDED_PREVIOUS_CYCLE: "negotiation.claim_rejected_excluded",
  COLLECT_WINDOW_CLOSED: "negotiation.claim_rejected_closed",
  NEGOTIATION_CLOSED: "negotiation.claim_rejected_closed",
  NEGOTIATION_NOT_FOUND: "negotiation.claim_rejected_closed",
};

/**
 * زرّ «قبول» داخل قروب غير المشتركين. الردّ يذهب لمحادثة السائق الخاصة لا للقروب:
 * إعلان ترتيب المسجّلين أمام الجميع يفتح باب المزايدة والضغط على من لم يلحق.
 */
async function handleUnsubscribedClaim(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const negotiation = deps.negotiation;
  const [action, negotiationId] = rest;
  if (negotiation === undefined || action !== "claim" || negotiationId === undefined) {
    return [privateReply(sender, tr("common.unknown_command"))];
  }

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return [privateReply(sender, tr("driver.not_registered"))];

  const claimed = await registerUnsubscribedClaim(
    { negotiationId, driverId: driver.id },
    negotiation.claims,
  );
  if (!claimed.ok) return technicalFailure(sender, state);

  const report = claimed.value;
  if (!report.registered) {
    const key = CLAIM_REASON_KEYS[report.reason ?? ""] ?? "negotiation.claim_rejected_closed";
    return [privateReply(sender, tr(key))];
  }

  // صاحب الدور الأول أُخطِر أصلاً من حالة الاستخدام عبر المُخطِر؛ لا نكرّر عليه.
  if (report.isActive) return [];
  return [
    privateReply(
      sender,
      tr("negotiation.claim_registered_waiting", {
        position: report.position ?? 0,
      }),
    ),
  ];
}

async function handleCommand(
  command: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const name = command.split(/\s+/)[0] ?? command;

  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const driver = existing.value;

  // ترقية المسؤول الأول: idempotent، وتُحاول عند كل /start لأن الحساب قد لا يكون
  // مسجَّلاً في أوّل مرة. فشلها لا يمنع الحوار: هي مسار إداري لا شرط استخدام.
  if (
    name === "/start" &&
    deps.bootstrapAdmin !== undefined &&
    deps.bootstrapAdmin.telegramId === sender.telegramUserId
  ) {
    await deps.bootstrapAdmin.grant(sender.telegramUserId);
  }

  switch (name) {
    case "/start": {
      if (driver !== null) {
        return [reply(sender, tr("driver.already_registered", { name: driver.fullName }))];
      }
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("driver.welcome")), reply(sender, tr("driver.ask_name"))];
    }

    case "/help":
      return [reply(sender, tr("driver.help"))];

    case "/cancel": {
      await deps.sessions.clear(sender.telegramUserId);
      return [reply(sender, tr("common.cancelled"), { kind: "remove" })];
    }

    case "/available":
    case "/unavailable": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const goingAvailable = name === "/available";

      if (goingAvailable && !driver.isVerified) {
        return [reply(sender, tr("driver.not_verified"))];
      }

      const applied = await deps.drivers.setAvailability(driver.id, goingAvailable);
      if (!applied.ok) return technicalFailure(sender, state);

      const replies: BotReply[] = [
        reply(sender, tr(goingAvailable ? "driver.now_available" : "driver.now_unavailable")),
      ];

      if (goingAvailable && !driver.hasLocation) {
        replies.push(
          reply(sender, tr("driver.ask_location"), {
            kind: "request_location",
            label: tr("driver.share_location_button"),
          }),
        );
      }

      if (goingAvailable) {
        const live = await liveSubscription(deps, driver.id);
        if (live === null) replies.push(reply(sender, tr("driver.no_live_subscription")));
      }
      return replies;
    }

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (driver === null) return [reply(sender, tr("support.not_registered"))];
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: true });
    }

    case "/activate": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleActivateCommand(command, sender, state, deps.support);
    }

    case "/subscription": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return describeSubscription(sender, state, driver, deps);
    }

    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

async function liveSubscription(deps: DriverBotDependencies, driverId: DriverId) {
  const found = await deps.subscriptions.findLive(driverId);
  if (!found.ok || found.value === null) return null;
  return isSubscriptionLive(found.value, deps.clock.now()) ? found.value : null;
}

async function describeSubscription(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const found = await deps.subscriptions.findLive(driver.id);
  if (!found.ok) return technicalFailure(sender, state);

  const subscription = found.value;
  if (
    subscription !== null &&
    subscription.currentPeriodEnd !== null &&
    isSubscriptionLive(subscription, deps.clock.now())
  ) {
    return [
      reply(
        sender,
        tr("driver.subscription_live", {
          plan: subscription.plan,
          until: subscription.currentPeriodEnd.toISOString().slice(0, 10),
        }),
      ),
    ];
  }

  const settings = await citySettingsOf(deps, driver);
  if (settings === null) return technicalFailure(sender, state);

  const plan: SubscriptionPlan = subscription?.plan ?? "transport";
  return [
    reply(
      sender,
      tr("driver.subscription_none", {
        plan,
        price: subscriptionPriceFor(settings, plan),
        currency: settings.currency,
      }),
    ),
  ];
}

async function handleName(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseFullName(text);
  if (!parsed.ok) {
    const key =
      parsed.error.reason === "too_short"
        ? "driver.name_too_short"
        : parsed.error.reason === "too_long"
          ? "driver.name_too_long"
          : "driver.name_is_command";
    return [reply(sender, tr(key))];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_phone",
    draftName: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(sender, tr("driver.ask_phone"), {
      kind: "request_contact",
      label: tr("driver.share_phone_button"),
    }),
  ];
}

async function handlePhone(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_phone") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const parsed = parsePhone(raw);
  if (!parsed.ok) return [reply(sender, tr("driver.phone_invalid"))];

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) {
    return [reply(sender, tr("common.no_active_city"), { kind: "remove" })];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftPhone: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_city"), cityKeyboard(cities.value))];
}

async function handleCallback(
  data: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [prefix, ...rest] = data.split(":");

  switch (prefix) {
    case "city":
      return handleCitySelected(rest.join(":"), sender, state, deps);
    case "service":
      return handleServiceSelected(rest.join(":"), sender, state, deps);
    case "offer":
      return handleOfferDecision(rest, sender, state, deps);
    case "unsub":
      return handleUnsubscribedClaim(rest, sender, state, deps);
    case "sup": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      const [action, ...tail] = rest;
      if (action === "type") {
        return handleSupportTypeChoice(tail.join(":"), sender, state, deps.support);
      }
      return handleSupportGroupAction(rest, sender, state, deps.support);
    }
    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

async function handleCitySelected(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_city") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);

  // لا نقبل معرّف مدينة من الزرّ على أنه صحيح: نتحقّق أنها ضمن المدن المفعَّلة فعلاً
  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_service",
    draftCityId: city.id,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(sender, tr("driver.ask_service"), {
      kind: "inline",
      rows: [
        [{ label: tr("driver.service_transport"), data: "service:transport" }],
        [{ label: tr("driver.service_delivery"), data: "service:delivery" }],
      ],
    }),
  ];
}

function isServiceType(value: string): value is ServiceType {
  return value === "transport" || value === "delivery";
}

async function handleServiceSelected(
  serviceRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_service" || !isServiceType(serviceRaw)) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  if (state.draftName === null || state.draftPhone === null || state.draftCityId === null) {
    // جلسة ناقصة: نبدأ من جديد بدل تسجيل بيانات نصف مكتملة
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.must_register_first"))];
  }

  const registered = await deps.drivers.register({
    telegramUserId: sender.telegramUserId,
    cityId: state.draftCityId,
    fullName: state.draftName,
    phone: state.draftPhone,
    service: serviceRaw,
    language: languageOf(state),
  });
  if (!registered.ok) return technicalFailure(sender, state);

  // بعد اكتمال التسجيل مباشرة: أوّل /start لم يجد حساباً ليرقّيه، وهذه أوّل لحظة يوجد فيها
  if (
    deps.bootstrapAdmin !== undefined &&
    deps.bootstrapAdmin.telegramId === sender.telegramUserId
  ) {
    await deps.bootstrapAdmin.grant(sender.telegramUserId);
  }

  await deps.sessions.clear(sender.telegramUserId);

  const cities = await deps.cities.listActive();
  const cityName = cities.ok
    ? (cities.value.find((c) => c.id === state.draftCityId)?.name ?? "")
    : "";

  const replies: BotReply[] = [
    reply(sender, tr("driver.registered", { name: registered.value.fullName, city: cityName }), {
      kind: "remove",
    }),
  ];

  const trialResult = await deps.trial.startTrial(registered.value.id, serviceRaw);
  if (trialResult.ok && trialResult.value.started) {
    const settings = await citySettingsOf(deps, registered.value);
    if (settings !== null) {
      replies.push(reply(sender, tr("driver.trial_started", { days: settings.trialDays })));
    }
  } else if (trialResult.ok && trialResult.value.reason !== null) {
    replies.push(
      reply(sender, tr("driver.trial_not_started", { reason: trialResult.value.reason })),
    );
  }

  return replies;
}

async function handleOfferDecision(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [action, orderIdRaw] = parts;
  if (orderIdRaw === undefined || orderIdRaw === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const orderId = orderIdRaw as OrderId;

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("driver.must_register_first"))];
  const driver = found.value;

  if (action === "reject") {
    const rejected = await deps.offers.reject(orderId, driver.id);
    if (!rejected.ok) return technicalFailure(sender, state);
    return [reply(sender, tr("driver.offer_rejected"))];
  }

  if (action !== "accept") return [reply(sender, tr("common.unknown_command"))];

  // القبول يمرّ عبر الدالة الذرّية claim_ride: هي الحكم الوحيد في التنافس
  const claim = await deps.dispatch.claimRide(orderId, driver.id);
  if (!claim.ok) return technicalFailure(sender, state);

  if (claim.value.claimed) return [reply(sender, tr("driver.offer_accepted"))];

  const key =
    claim.value.reason === "offer_expired" ? "driver.offer_expired" : "driver.offer_taken";
  return [reply(sender, tr(key))];
}

/**
 * موقع السائق يُحفظ فوراً: بلا موقع لا مطابقة، ومع موقع قديم تكون المطابقة كاذبة.
 * السائق غير المسجَّل لا يُحفظ له موقع إطلاقاً.
 */
async function handleLocation(
  location: Coordinates,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const driver = existing.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  const coordinates = makeCoordinates(location.latitude, location.longitude);
  if (!coordinates.ok) return [reply(sender, tr("driver.location_invalid"))];

  const saved = await deps.drivers.updateLocation(driver.id, coordinates.value);
  if (!saved.ok) return technicalFailure(sender, state);
  return [reply(sender, tr("driver.location_saved"), { kind: "remove" })];
}
