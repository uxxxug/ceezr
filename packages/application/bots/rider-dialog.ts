/**
 * الغرض: منطق حوار بوت العميل: التسجيل، طلب رحلة بموقع حقيقي، ثم بدء البحث عن سائق.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/rider/index.ts
 * ملاحظات مستقبلية: التسعير المسبق يُضاف في 2.2 بقراءة تعرفة المدينة من platform_settings.
 */

import { makeCoordinates } from "../../domain/geo/value-objects.ts";
import { parseFullName } from "../../domain/identity/value-objects.ts";
import { t } from "../../shared/i18n/index.ts";
import type { Clock, OrderId } from "../../shared/kernel/index.ts";
import { type BroadcastDependencies, broadcastOffers } from "../dispatch/broadcast-offers.ts";
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
    return [reply(sender, tr("common.unknown_command"))];
  }

  if (update.kind === "location") {
    return handleLocation(update.location, sender, state, deps);
  }

  if (update.kind === "contact" || update.kind === "unsupported") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, deps);

  if (state.step === "awaiting_name") return handleName(text, sender, state, deps);
  if (state.step === "awaiting_pickup" || state.step === "awaiting_dropoff") {
    // لا نقبل عنواناً نصياً مكان إحداثيات: الموقع الوهمي أسوأ من لا موقع
    return [reply(sender, tr("rider.location_required"))];
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
      if (rider !== null) return startRideFlow(sender, state, deps);
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("rider.welcome")), reply(sender, tr("rider.ask_name"))];
    }

    case "/ride": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return startRideFlow(sender, state, deps);
    }

    case "/skip": {
      if (state.step !== "awaiting_dropoff" || state.draftPickup === null) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return createOrderAndMatch(sender, state, rider, state.draftPickup, null, deps);
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

async function startRideFlow(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_pickup",
    draftPickup: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [
    reply(sender, tr("rider.ask_pickup"), {
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

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_pickup",
    draftCityId: city.id,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(sender, tr("rider.registered", { name: registered.value.fullName, city: city.name }), {
      kind: "remove",
    }),
    reply(sender, tr("rider.ask_pickup"), {
      kind: "request_location",
      label: tr("rider.share_location_button"),
    }),
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

  if (state.step === "awaiting_pickup") {
    const saved = await deps.sessions.save(sender.telegramUserId, {
      ...state,
      step: "awaiting_dropoff",
      draftPickup: location,
    });
    if (!saved.ok) return technicalFailure(sender, state);
    return [reply(sender, tr("rider.ask_dropoff"), { kind: "remove" })];
  }

  if (state.step === "awaiting_dropoff" && state.draftPickup !== null) {
    return createOrderAndMatch(sender, state, rider, state.draftPickup, location, deps);
  }

  return [reply(sender, tr("common.unknown_command"))];
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
