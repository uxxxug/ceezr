/**
 * الغرض: منطق حوار بوت السائق كاملاً: التسجيل، التوافر، الاشتراك، وقبول/رفض العرض.
 *   دالة خالصة من ناحية الإطار: تأخذ تحديثاً مُجرَّداً وتعيد ردوداً، فتُختبر بلا تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/driver/index.ts
 * ملاحظات مستقبلية: كل قيمة تجارية (السعر، مدة التجربة) تُقرأ من platform_settings عبر منفذ الإعدادات.
 */

import type { Clock, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { t } from "../../shared/i18n/index.ts";
import { parseFullName, parsePhone } from "../../domain/identity/value-objects.ts";
import {
  isSubscriptionLive,
  type SubscriptionPlan,
} from "../../domain/subscription/entity.ts";
import {
  parseCitySettings,
  subscriptionPriceFor,
  type CitySettings,
} from "../../domain/policy/entity.ts";
import type { DispatchRpcPort, SettingsRepository } from "../ports/index.ts";
import {
  INITIAL_STATE,
  type BotReply,
  type CityDirectory,
  type CityRef,
  type DialogState,
  type DriverDirectory,
  type DriverProfile,
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
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
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

async function loadState(
  deps: DriverBotDependencies,
  sender: Sender,
): Promise<DialogState> {
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
  if (update.kind === "location" || update.kind === "unsupported") {
    return [reply(sender, t(languageOf(state))("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, deps);

  switch (state.step) {
    case "awaiting_name":
      return handleName(text, sender, state, deps);
    case "awaiting_phone":
      return handlePhone(text, sender, state, deps);
    default:
      return [reply(sender, t(languageOf(state))("common.unknown_command"))];
  }
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

      if (goingAvailable) {
        const live = await liveSubscription(deps, driver.id);
        if (live === null) replies.push(reply(sender, tr("driver.no_live_subscription")));
      }
      return replies;
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

  await deps.sessions.clear(sender.telegramUserId);

  const cities = await deps.cities.listActive();
  const cityName = cities.ok
    ? (cities.value.find((c) => c.id === state.draftCityId)?.name ?? "")
    : "";

  const replies: BotReply[] = [
    reply(
      sender,
      tr("driver.registered", { name: registered.value.fullName, city: cityName }),
      { kind: "remove" },
    ),
  ];

  const trialResult = await deps.trial.startTrial(registered.value.id, serviceRaw);
  if (trialResult.ok && trialResult.value.started) {
    const settings = await citySettingsOf(deps, registered.value);
    if (settings !== null) {
      replies.push(reply(sender, tr("driver.trial_started", { days: settings.trialDays })));
    }
  } else if (trialResult.ok && trialResult.value.reason !== null) {
    replies.push(reply(sender, tr("driver.trial_not_started", { reason: trialResult.value.reason })));
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

  const key = claim.value.reason === "offer_expired" ? "driver.offer_expired" : "driver.offer_taken";
  return [reply(sender, tr(key))];
}
