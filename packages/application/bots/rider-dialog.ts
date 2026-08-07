/**
 * الغرض: منطق حوار بوت العميل: التسجيل، اختيار الخدمة (نقل/توصيل)، الطلب بموقع حقيقي،
 *   ثم بدء البحث عن سائق. مسار التوصيل يمرّ بحالة الاستخدام requestDelivery ولا يكرّر منطقها.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ووُسّع للتوصيل في المرحلة 2.2.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/rider/index.ts
 * ملاحظات مستقبلية: التسعير المسبق يُضاف بقراءة تعرفة المدينة من platform_settings.
 */

import { makeCoordinates } from "../../domain/geo/value-objects.ts";
import { parseFullName } from "../../domain/identity/value-objects.ts";
import { t } from "../../shared/i18n/index.ts";
import type { Clock, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { requestDelivery } from "../delivery/request-delivery.ts";
import { type BroadcastDependencies, broadcastOffers } from "../dispatch/broadcast-offers.ts";
import {
  type RelayDependencies,
  relayNegotiationMessage,
} from "../dispatch/relay-negotiation-message.ts";
import {
  advanceNegotiationTurn,
  type RotateNegotiationDependencies,
  settleNegotiation,
} from "../dispatch/rotate-negotiation-turn.ts";
import { handleRatingCallback, type RatingDialogDependencies } from "./rating-dialog.ts";
import {
  handleSupportGroupAction,
  type SupportDialogDependencies,
  startSupportDialog,
  submitSupportMessage,
} from "./support-dialog.ts";
import {
  type BotReply,
  type CityDirectory,
  type CityRef,
  type DialogState,
  INITIAL_STATE,
  type IncomingUpdate,
  type Keyboard,
  type OrderWriter,
  type RiderDirectory,
  type RiderProfile,
  type Sender,
  type SessionStore,
} from "./types.ts";

export interface RiderBotDependencies {
  readonly sessions: SessionStore;
  readonly riders: RiderDirectory;
  readonly cities: CityDirectory;
  readonly orders: OrderWriter;
  /** آخر طلب نشط للعميل — لمعرفة ما يُلغى عند /cancel. */
  readonly activeOrderOf: (riderId: RiderProfile["id"]) => Promise<OrderId | null>;
  /** تبعيات المطابقة والبثّ نفسها المستخدمة في broadcastOffers — لا تكرار للمنطق. */
  readonly matching: BroadcastDependencies;
  readonly clock: Clock;
  /** مسار التفاوض مع غير المشتركين (المرحلة 2.3) — اختياري كما في بوت السائق. */
  readonly negotiation?: {
    readonly rotation: RotateNegotiationDependencies;
    readonly relay: RelayDependencies;
  };
  /** مسار الدعم (المرحلة 2.4) — نزاعات الرحلات فقط: العميل لا اشتراك له. */
  readonly support?: SupportDialogDependencies;
  /** التقييم (المرحلة 2.5) — العميل يقيّم السائق فقط، فلا يحتاج منفذ دورة الرحلة. */
  readonly rating?: RatingDialogDependencies;
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

async function loadState(deps: RiderBotDependencies, sender: Sender): Promise<DialogState> {
  const stored = await deps.sessions.load(sender.telegramUserId);
  if (stored.ok && stored.value !== null) return stored.value;
  return { ...INITIAL_STATE, language: sender.languageHint === "en" ? "en" : "ar" };
}

function technicalFailure(sender: Sender, state: DialogState): readonly BotReply[] {
  return [reply(sender, t(state.language)("common.error_try_again"))];
}

export async function handleRiderUpdate(
  update: IncomingUpdate,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const sender = update.from;
  const state = await loadState(deps, sender);
  const tr = t(state.language);

  if (update.kind === "callback") {
    const [prefix, ...rest] = update.data.split(":");
    if (prefix === "city") return handleCitySelected(rest.join(":"), sender, state, deps);
    if (prefix === "svc") return handleServiceSelected(rest.join(":"), sender, state, deps);
    if (prefix === "unsub") return handleNegotiationDecision(rest, sender, state, deps);
    if (prefix === "rate") {
      return deps.rating === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleRatingCallback(update.data, sender, state.language, deps.rating);
    }
    if (prefix === "sup") {
      return deps.support === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleSupportGroupAction(rest, sender, state, deps.support);
    }
    return [reply(sender, tr("common.unknown_command"))];
  }

  if (update.kind === "location") {
    return handleLocation(update.location, sender, state, deps);
  }

  if (update.kind === "photo") {
    if (state.step !== "awaiting_support_message" || deps.support === undefined) {
      return [reply(sender, tr("common.unknown_command"))];
    }
    return submitSupportMessage(
      {
        message: update.caption ?? tr("support.photo_only_message"),
        attachmentFileId: update.fileId,
      },
      sender,
      state,
      deps.support,
    );
  }

  if (update.kind === "contact" || update.kind === "unsupported") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, deps);

  if (state.step === "awaiting_name") return handleName(text, sender, state, deps);
  if (state.step === "awaiting_support_message") {
    return deps.support === undefined
      ? [reply(sender, tr("common.unknown_command"))]
      : submitSupportMessage(
          { message: text, attachmentFileId: null },
          sender,
          state,
          deps.support,
        );
  }
  if (state.step === "awaiting_parcel") return handleParcel(text, sender, state, deps);
  if (state.step === "awaiting_pickup" || state.step === "awaiting_dropoff") {
    // لا نقبل عنواناً نصياً مكان إحداثيات: الموقع الوهمي أسوأ من لا موقع
    return [reply(sender, tr("rider.location_required"))];
  }
  return handleFreeText(text, sender, state, deps);
}

/** نصّ حرّ من عميل لا يمرّ بخطوة حوار: يُمرّر للسائق صاحب الدور إن وُجِد. */
async function handleFreeText(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const negotiation = deps.negotiation;
  if (negotiation === undefined) return [reply(sender, tr("common.unknown_command"))];

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const rider = found.value;
  if (rider === null) return [reply(sender, tr("common.unknown_command"))];

  const relayed = await relayNegotiationMessage(
    { from: "rider", driverId: null, riderId: rider.id, text },
    negotiation.relay,
  );
  if (!relayed.ok) return technicalFailure(sender, state);

  const report = relayed.value;
  if (report.reason === "NO_ACTIVE_NEGOTIATION" || report.reason === "EMPTY_MESSAGE") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  if (report.reason === "UNREACHABLE") return [reply(sender, tr("negotiation.relay_unreachable"))];
  if (report.redacted > 0) return [reply(sender, tr("negotiation.relay_redacted"))];
  return [];
}

/**
 * قرار العميل في التفاوض: «تم الاتفاق» يثبّت الإسناد، و«السائق التالي» يغلق القناة
 * ويفتحها مع التالي فوراً. الإخطارات من حالة الاستخدام نفسها، فلا تكرار هنا.
 */
async function handleNegotiationDecision(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const negotiation = deps.negotiation;
  const [action, negotiationId] = rest;
  if (negotiation === undefined || negotiationId === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  if (action === "agree") {
    const settled = await settleNegotiation({ negotiationId }, negotiation.rotation);
    if (!settled.ok) return technicalFailure(sender, state);
    if (!settled.value.settled) return [reply(sender, tr("negotiation.rider_turn_closed"))];
    return [];
  }

  if (action === "decline") {
    const moved = await advanceNegotiationTurn(
      { negotiationId, reason: "declined" },
      negotiation.rotation,
    );
    if (!moved.ok) return technicalFailure(sender, state);
    // نفاد الثلاثة يُبلَّغ للعميل هنا؛ إعادة النشر أو التصعيد مسؤولية المهمة الدورية.
    if (moved.value.exhausted) return [reply(sender, tr("negotiation.exhausted_rider"))];
    return [];
  }

  return [reply(sender, tr("common.unknown_command"))];
}

async function handleCommand(
  command: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const name = command.split(/\s+/)[0] ?? command;

  const existing = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const rider = existing.value;

  switch (name) {
    case "/start": {
      if (rider !== null) return askService(sender, state, deps);
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("rider.welcome")), reply(sender, tr("rider.ask_name"))];
    }

    case "/ride": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return startServiceFlow("transport", sender, state, deps);
    }

    case "/delivery": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return startServiceFlow("delivery", sender, state, deps);
    }

    case "/skip": {
      if (state.step !== "awaiting_dropoff" || state.draftPickup === null) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      // الطرد يُسلَّم إلى مكان محدَّد: تخطّي الوجهة مسموح في النقل وحده
      if (state.draftService === "delivery") {
        return [reply(sender, tr("rider.delivery_dropoff_required"))];
      }
      return createOrderAndMatch(sender, state, rider, state.draftPickup, null, deps);
    }

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (rider === null) return [reply(sender, tr("support.not_registered"))];
      // العميل لا يملك اشتراكاً، فسؤاله عن نوع المشكلة يولّد تذاكر مرفوضة حتماً
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: false });
    }

    case "/cancel": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      const orderId = await deps.activeOrderOf(rider.id);
      await deps.sessions.clear(sender.telegramUserId);
      if (orderId === null) return [reply(sender, tr("rider.no_active_order"))];
      const cancelled = await deps.orders.cancelByRider(orderId, rider.id);
      if (!cancelled.ok) return technicalFailure(sender, state);
      if (!cancelled.value) return [reply(sender, tr("rider.no_active_order"))];
      return [reply(sender, tr("rider.order_cancelled"), { kind: "remove" })];
    }

    case "/help":
      return [reply(sender, tr("rider.help"))];

    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/** اختيار نوع الخدمة قبل أي موقع: النقل والتوصيل مساران مختلفان من أول خطوة. */
async function askService(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_service",
    draftPickup: null,
    draftDropoff: null,
    draftService: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [
    reply(sender, tr("rider.ask_service"), {
      kind: "inline",
      rows: [
        [{ label: tr("rider.service_transport"), data: "svc:transport" }],
        [{ label: tr("rider.service_delivery"), data: "svc:delivery" }],
      ],
    }),
  ];
}

function isServiceType(value: string): value is ServiceType {
  return value === "transport" || value === "delivery";
}

async function handleServiceSelected(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  if (!isServiceType(raw)) return [reply(sender, tr("common.unknown_command"))];
  return startServiceFlow(raw, sender, state, deps);
}

async function startServiceFlow(
  service: ServiceType,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_pickup",
    draftService: service,
    draftPickup: null,
    draftDropoff: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [
    reply(sender, tr(service === "delivery" ? "rider.ask_parcel_pickup" : "rider.ask_pickup"), {
      kind: "request_location",
      label: tr("rider.share_location_button"),
    }),
  ];
}

async function handleName(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const parsed = parseFullName(text);
  if (!parsed.ok) return [reply(sender, tr("driver.name_too_short"))];

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftName: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("rider.ask_city"), cityKeyboard(cities.value))];
}

async function handleCitySelected(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  if (state.step !== "awaiting_city" || state.draftName === null) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  const registered = await deps.riders.register({
    telegramUserId: sender.telegramUserId,
    cityId: city.id,
    fullName: state.draftName,
    language: state.language,
  });
  if (!registered.ok) return technicalFailure(sender, state);

  // askService هي من تحفظ الخطوة التالية — لا حفظان متتاليان للجلسة نفسها
  return [
    reply(sender, tr("rider.registered", { name: registered.value.fullName, city: city.name }), {
      kind: "remove",
    }),
    ...(await askService(sender, { ...state, draftCityId: city.id }, deps)),
  ];
}

async function handleLocation(
  location: { readonly latitude: number; readonly longitude: number },
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  // إحداثيات تلغرام تُتحقَّق كأي مُدخَل خارجي: خط عرض/طول خارج المدى مرفوض
  const coordinates = makeCoordinates(location.latitude, location.longitude);
  if (!coordinates.ok) {
    return [reply(sender, tr("rider.location_required"))];
  }

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("rider.must_register_first"))];
  const rider = found.value;

  const isDelivery = state.draftService === "delivery";

  if (state.step === "awaiting_pickup") {
    const saved = await deps.sessions.save(sender.telegramUserId, {
      ...state,
      step: "awaiting_dropoff",
      draftPickup: location,
    });
    if (!saved.ok) return technicalFailure(sender, state);
    const key = isDelivery ? "rider.ask_parcel_dropoff" : "rider.ask_dropoff";
    return [reply(sender, tr(key), { kind: "remove" })];
  }

  if (state.step === "awaiting_dropoff" && state.draftPickup !== null) {
    // التوصيل لا ينتهي عند الوجهة: يبقى وصف الطرد، وهو ركن لا خيار
    if (isDelivery) {
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_parcel",
        draftDropoff: location,
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("rider.ask_parcel"), { kind: "remove" })];
    }
    return createOrderAndMatch(sender, state, rider, state.draftPickup, location, deps);
  }

  return [reply(sender, tr("common.unknown_command"))];
}

/**
 * آخر خطوة في التوصيل: وصف الطرد. التحقّق كله في الدومين، وهنا ترجمة الخطأ إلى رسالة.
 * الطلب يُكتب ويُبثّ عبر requestDelivery — لا نسخة ثانية من المنطق هنا.
 */
async function handleParcel(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("rider.must_register_first"))];
  const rider = found.value;

  if (state.draftPickup === null || state.draftDropoff === null) {
    // جلسة ناقصة: نعيد المسار من أوله بدل إنشاء طلب نصف مكتمل
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("rider.delivery_dropoff_required"))];
  }

  const requested = await requestDelivery(
    {
      cityId: rider.cityId,
      riderId: rider.id,
      pickup: state.draftPickup,
      dropoff: state.draftDropoff,
      parcelDescription: raw,
    },
    { orders: deps.orders, matching: deps.matching },
  );

  if (!requested.ok) {
    if (requested.error.code === "DELIVERY_DROPOFF_REQUIRED") {
      return [reply(sender, tr("rider.delivery_dropoff_required"))];
    }
    if (requested.error.code === "INVALID_PARCEL_DESCRIPTION") {
      const key =
        requested.error.reason === "too_long" ? "rider.parcel_too_long" : "rider.parcel_invalid";
      return [reply(sender, tr(key))];
    }
    return technicalFailure(sender, state);
  }

  await deps.sessions.clear(sender.telegramUserId);

  const replies: BotReply[] = [reply(sender, tr("rider.delivery_searching"), { kind: "remove" })];
  if (requested.value.notified.length === 0) return replies;
  return [
    ...replies,
    reply(sender, tr("rider.drivers_notified", { count: requested.value.notified.length })),
  ];
}

async function createOrderAndMatch(
  sender: Sender,
  state: DialogState,
  rider: RiderProfile,
  pickup: { readonly latitude: number; readonly longitude: number },
  dropoff: { readonly latitude: number; readonly longitude: number } | null,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  // مسار النقل حصراً: التوصيل يُنشَأ في handleParcel عبر requestDelivery
  const created = await deps.orders.create({
    cityId: rider.cityId,
    riderId: rider.id,
    service: "transport",
    pickup,
    dropoff,
  });
  if (!created.ok) return technicalFailure(sender, state);

  await deps.sessions.clear(sender.telegramUserId);

  const replies: BotReply[] = [reply(sender, tr("rider.searching"), { kind: "remove" })];

  // البثّ الحقيقي يبدأ فوراً: تُكتب العروض في order_offers ويُخطَر السائقون.
  // لا سائق الآن؟ الطلب يبقى في حالة البحث وتتولّاه دورات البثّ التالية — والعميل يُخبَر بصدق.
  const broadcast = await broadcastOffers({ orderId: created.value }, deps.matching);
  if (!broadcast.ok) return replies;
  if (broadcast.value.notified.length === 0) return replies;

  return [
    ...replies,
    reply(sender, tr("rider.drivers_notified", { count: broadcast.value.notified.length })),
  ];
}
