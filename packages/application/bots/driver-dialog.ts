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
  parseNationalId,
  parsePlateNumber,
  parseVehicleType,
  VEHICLE_TYPES,
} from "../../domain/kyc/value-objects.ts";
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
  handleLanguageCallback,
  handleLanguageCommand,
  type LanguageDialogDependencies,
} from "./language-dialog.ts";
import { nameErrorKey } from "./name-errors.ts";
import {
  handleCompleteRide,
  handleRatingCallback,
  handleStartRide,
  type RatingDialogDependencies,
  startRideKeyboard,
} from "./rating-dialog.ts";
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
  /**
   * دورة الرحلة والتقييم (المرحلة 2.5). اختياري بنفس منطق ما قبله: غيابه يعني أن
   * زرّ بدء الرحلة لا يظهر، لا أن يظهر ويفشل.
   */
  readonly rating?: RatingDialogDependencies;
  /**
   * اختيار اللغة (المرحلة 2.6). اختياري بنفس منطق ما قبله: غيابه يجعل /language
   * يردّ «أمر غير معروف» بدل أن يعرض قائمة لا تُكتب نتيجتها في القاعدة.
   */
  readonly language?: LanguageDialogDependencies;
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
  if (update.kind === "contact") {
    /**
     * الرقم يُقبل فقط إن أقرّ تلغرام أن البطاقة للمرسِل نفسه. إعادة توجيه بطاقة
     * شخص آخر تصل بنفس شكل زرّ "مشاركة رقمي" — الفرق الوحيد هذا الحقل.
     */
    if (update.ownerTelegramId !== sender.telegramUserId) {
      return [
        reply(sender, t(languageOf(state))("driver.phone_not_yours"), {
          kind: "request_contact",
          label: t(languageOf(state))("driver.share_phone_button"),
        }),
      ];
    }
    return handlePhone(update.phone, sender, state, deps);
  }
  if (update.kind === "location") return handleLocation(update.location, sender, state, deps);
  if (update.kind === "photo") {
    if (state.step === "awaiting_vehicle_photo") {
      return completeRegistration(update.fileId, sender, state, deps);
    }
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
      /**
       * رقم مكتوب بلا زرّ = رقم غير مثبَت لصاحبه. لا نرفضه بعد تخزينه بل قبله:
       * ما يُخزَّن في `driver.phone` يجب أن يكون مضموناً بتلغرام دائماً.
       */
      return [
        reply(sender, t(languageOf(state))("driver.phone_must_use_button"), {
          kind: "request_contact",
          label: t(languageOf(state))("driver.share_phone_button"),
        }),
      ];
    case "awaiting_plate_number":
      return handlePlateNumber(text, sender, state, deps);
    case "awaiting_national_id":
      return handleNationalId(text, sender, state, deps);
    case "awaiting_vehicle_photo":
      // نصٌّ حيث تُنتظر صورة: يُقال له إنه يحتاج صورة فعلية، لا "أمر غير معروف".
      return [reply(sender, t(languageOf(state))("driver.vehicle_photo_required"))];
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

    case "/language":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCommand(sender, languageOf(state));

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

      // لا نقول «أنت الآن متاح» لمن لا موقع له. استعلام المرشّحين يشترط
      // `d.last_location is not null`، فسائقٌ متاحٌ بلا موقع خفيٌّ عن الإسناد
      // تماماً. وقد وقع هذا فعلاً في الإنتاج: سائق موثَّق ومتاح ومشترك، ولم
      // يصله طلب واحد، وهو يظنّ نفسه عاملاً — لأن البوت أخبره بذلك.
      // فالرسالة الآن تقول الحقيقة، والطلب يصير خطوةً ناقصة لا حاشية.
      const replies: BotReply[] = [];

      if (goingAvailable && !driver.hasLocation) {
        replies.push(reply(sender, tr("driver.available_needs_location")));
        replies.push(
          reply(sender, tr("driver.ask_location"), {
            kind: "request_location",
            label: tr("driver.share_location_button"),
          }),
        );
      } else {
        replies.push(
          reply(sender, tr(goingAvailable ? "driver.now_available" : "driver.now_unavailable")),
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
    return [reply(sender, tr(nameErrorKey(parsed.error.reason)))];
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
    case "lang":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCallback(data, sender, languageOf(state), deps.language);
    case "city":
      return handleCitySelected(rest.join(":"), sender, state, deps);
    case "service":
      return handleServiceSelected(rest.join(":"), sender, state, deps);
    case "vehicle":
      return handleVehicleTypeSelected(rest.join(":"), sender, state, deps);
    case "back":
      return handleBack(rest.join(":"), sender, state, deps);
    case "offer":
      return handleOfferDecision(rest, sender, state, deps);
    case "unsub":
      return handleUnsubscribedClaim(rest, sender, state, deps);
    case "ride": {
      if (deps.rating === undefined) return [reply(sender, tr("common.unknown_command"))];
      const [action, orderIdRaw] = rest;
      if (orderIdRaw === undefined || orderIdRaw === "") {
        return [reply(sender, tr("common.unknown_command"))];
      }
      const rideOrderId = orderIdRaw as OrderId;
      if (action === "start") {
        return handleStartRide(rideOrderId, sender, languageOf(state), deps.rating);
      }
      if (action === "complete") {
        return handleCompleteRide(rideOrderId, sender, languageOf(state), deps.rating);
      }
      return [reply(sender, tr("common.unknown_command"))];
    }
    case "rate": {
      if (deps.rating === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleRatingCallback(data, sender, languageOf(state), deps.rating);
    }
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
        // اختيار المدينة كان غير قابل للتراجع: تصحيحه يعني /cancel وإعادة الاسم والرقم
        [{ label: tr("common.back_button"), data: "back:city" }],
      ],
    }),
  ];
}

/** رجوع خطوة واحدة داخل التسجيل. لا يمسح الاسم ولا الرقم — يعيد السؤال فقط. */
async function handleBack(
  target: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (target !== "city" || state.step !== "awaiting_service") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftCityId: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [reply(sender, tr("driver.ask_city"), cityKeyboard(cities.value))];
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

  /**
   * التسجيل لم يعد ينتهي هنا. كان ينتهي، فيُنشأ سائقٌ لا يُعرف ما يقود ولا رقم
   * لوحته ولا من هو — ويُوثَّق على هذا الفراغ. الآن تُجمَع بقية الملفّ في الجلسة
   * ولا يُكتب صفٌّ في القاعدة إلا بعد اكتماله، حتى لا يرى موظّف التوثيق ملفّاً
   * نصف مكتمل فيحسبه ملفّاً حقيقياً.
   */
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_vehicle_type",
    draftService: serviceRaw,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_vehicle_type"), vehicleTypeKeyboard(tr))];
}

/** لوحة أنواع المركبات — تُبنى من قائمة الدومين فلا تتفرّق النسختان. */
function vehicleTypeKeyboard(tr: (key: string) => string): Keyboard {
  return {
    kind: "inline",
    rows: VEHICLE_TYPES.map((type) => [
      { label: tr(`driver.vehicle_${type}`), data: `vehicle:${type}` },
    ]),
  };
}

async function handleVehicleTypeSelected(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_vehicle_type") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const parsed = parseVehicleType(raw);
  if (!parsed.ok) return [reply(sender, tr("common.unknown_command"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_plate_number",
    draftVehicleType: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_plate_number"))];
}

async function handlePlateNumber(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parsePlateNumber(raw);
  // سبب الرفض يُقال بعينه: "غير صالح" وحدها تترك السائق يخمّن ما الخطأ.
  if (!parsed.ok) return [reply(sender, tr(`driver.plate_invalid_${parsed.error.reason}`))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_national_id",
    draftPlateNumber: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_national_id"))];
}

async function handleNationalId(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseNationalId(raw);
  if (!parsed.ok) return [reply(sender, tr(`driver.national_id_invalid_${parsed.error.reason}`))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_vehicle_photo",
    draftNationalId: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_vehicle_photo"))];
}

/** آخر خطوة: تصل الصورة فيُكتب الصفّ كاملاً دفعة واحدة. */
async function completeRegistration(
  fileId: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (
    state.draftName === null ||
    state.draftPhone === null ||
    state.draftCityId === null ||
    state.draftService === null ||
    state.draftVehicleType === null ||
    state.draftPlateNumber === null ||
    state.draftNationalId === null
  ) {
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.must_register_first"))];
  }

  const serviceRaw = state.draftService;
  const registered = await deps.drivers.register({
    telegramUserId: sender.telegramUserId,
    cityId: state.draftCityId,
    fullName: state.draftName,
    phone: state.draftPhone,
    service: serviceRaw,
    language: languageOf(state),
    vehicleType: state.draftVehicleType,
    plateNumber: state.draftPlateNumber,
    nationalId: state.draftNationalId,
    vehiclePhotoFileId: fileId,
  });
  if (!registered.ok) {
    /**
     * ازدواج الهوية ليس عطلاً تقنياً بل رفضٌ مفهوم: شخصٌ يحاول حساباً ثانياً
     * بنفس هويته. يُقال له السبب صراحةً بدل "حدث خطأ تقني" التي تدفعه للإعادة
     * إلى ما لا نهاية. والجلسة تُمسح لأن إعادة المحاولة بنفس الرقم لن تنجح.
     */
    if (isDuplicateNationalId(registered.error)) {
      await deps.sessions.clear(sender.telegramUserId);
      return [reply(sender, tr("driver.national_id_taken"), { kind: "remove" })];
    }
    return technicalFailure(sender, state);
  }

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

  if (claim.value.claimed) {
    // زرّ البدء يخرج مع تأكيد القبول: السائق لا يحفظ معرّف الطلب ولا يُطلب منه كتابته
    const keyboard =
      deps.rating === undefined ? null : startRideKeyboard(String(orderId), languageOf(state));
    return [reply(sender, tr("driver.offer_accepted"), keyboard)];
  }

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

  // من كان متاحاً وينقصه الموقع فقد اكتملت شروطه الآن، فيُخبَر أنه صار ظاهراً
  // فعلاً — لا «حُفظ موقعك» وحدها، فهي لا تُعلمه أن الحجب عنه ارتفع.
  const becameLive = !driver.hasLocation && driver.isAvailable;
  return [
    reply(sender, tr(becameLive ? "driver.location_saved_now_live" : "driver.location_saved"), {
      kind: "remove",
    }),
  ];
}

/**
 * ازدواج الهوية يصل من القاعدة كخرق قيد فريد. نميّزه بالفهرس لا بنصّ عام:
 * "duplicate key" وحدها كانت ستبتلع أي ازدواج آخر فتقول للسائق سبباً خاطئاً.
 */
function isDuplicateNationalId(error: { readonly detail?: string } | unknown): boolean {
  const detail = (error as { readonly detail?: string }).detail ?? "";
  return detail.includes("drivers_city_national_id_uniq");
}
