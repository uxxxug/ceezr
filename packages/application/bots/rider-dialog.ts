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
import type { Clock, ServiceType } from "../../shared/kernel/index.ts";
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
import {
  handleLanguageCallback,
  handleLanguageCommand,
  type LanguageDialogDependencies,
} from "./language-dialog.ts";
import {
  commandForMenuText,
  type MenuContext,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "./main-menu.ts";
import { nameErrorKey } from "./name-errors.ts";
import { handleRatingCallback, type RatingDialogDependencies } from "./rating-dialog.ts";
import {
  handleSupportGroupAction,
  type SupportDialogDependencies,
  startSupportDialog,
  submitSupportMessage,
} from "./support-dialog.ts";
import {
  type ActiveOrderSummary,
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
  /** كل الطلبات النشطة للعميل — لا الأحدث وحده، فقد يملك مشواراً وطرداً معاً. */
  readonly activeOrdersOf: (riderId: RiderProfile["id"]) => Promise<readonly ActiveOrderSummary[]>;
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
  /** اختيار اللغة (المرحلة 2.6) — نفس الحوار المستخدَم في بوت السائق حرفياً. */
  readonly language?: LanguageDialogDependencies;
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/** القائمة الدائمة بلغة الحالة الحالية — لغة الجلسة لا ثابتة، فالقائمة تُبنى عند كل ردّ. */
function menu(state: DialogState, context: MenuContext = {}): Keyboard {
  return mainMenuKeyboard("rider", state.language, context);
}

/** طلب الموقع ومعه القائمة الرئيسية تحته — البند 4.3: لا تُمحى القائمة في منتصف الطلب. */
function locationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(state.language)("rider.share_location_button") },
    "rider",
    state.language,
  );
}

/** قائمةٌ فيها زرّ التتبّع — تُستعمل حيث نعلم يقيناً أنّ للعميل طلباً نشطاً. */
function trackingMenu(state: DialogState): Keyboard {
  return menu(state, { hasActiveOrder: true });
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
    if (prefix === "lang") {
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCallback(update.data, sender, state.language, deps.language);
    }
    if (prefix === "city") return handleCitySelected(rest.join(":"), sender, state, deps);
    if (prefix === "svc") return handleServiceSelected(rest.join(":"), sender, state, deps);
    if (prefix === "back") return handleBack(rest.join(":"), sender, state, deps);
    if (prefix === "unsub") return handleNegotiationDecision(rest, sender, state, deps);
    if (prefix === "cancel") return handleCancelChoice(rest.join(":"), sender, state, deps);
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

  // زرّ القائمة الدائمة يصل نصّاً لا بيانات (Reply Keyboard)، فيُترجَم إلى أمره هنا —
  // **قبل** أي فحص خطوة. الموضع هو المطلوب نفسه في البند 4.3: ضغطة واحدة في كل
  // الحالات. ولو جاء الفحص بعد الخطوات لصار زرّ «الدعم» يُسجَّل اسماً للعميل الجديد.
  const fromMenu = commandForMenuText("rider", text);
  if (fromMenu !== null) return handleCommand(fromMenu, sender, state, deps);

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
/**
 * وصف الطلب في قائمة الاختيار. لا نعرض معرّف UUID على العميل: هو لا يعرفه ولا
 * يميّز به شيئاً. نعرض نوع الخدمة ووجهته ووقته، وهي ما يميّز طلباً عن آخر فعلاً.
 */
function describeActiveOrder(order: ActiveOrderSummary, language: string): string {
  const tr = t(language);
  const service = tr(
    order.service === "delivery" ? "rider.service_delivery" : "rider.service_transport",
  );
  const place = order.dropoffLabel ?? order.pickupLabel;
  const time = order.createdAt.toISOString().slice(11, 16);
  return place === null ? `${service} — ${time}` : `${service} — ${place} — ${time}`;
}

/**
 * من متى يطول الانتظار فيستحقّ أن ندلّ العميل على الدعم من تلقائنا.
 * ربع ساعة بلا سائق في مدينة عاملة ليس تأخّراً طبيعياً، والسكوت عنه يترك العميل
 * ينتظر بلا أداة فعل — وهي الشكوى التي تصل الدعم متأخّرةً دائماً.
 */
const LONG_WAIT_MINUTES = 15;

/** دقائق الانتظار من إنشاء الطلب، غير سالبة أبداً (ساعة قاعدة تسبق ساعتنا ثوانٍ). */
function waitedMinutes(order: ActiveOrderSummary, now: Date): number {
  const elapsed = now.getTime() - order.createdAt.getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / 60_000);
}

/**
 * تقرير حالة طلب واحد: الحالة، والسائق ولوحته إن أُسنِد، ومدّة الانتظار.
 *
 * حالة غير معروفة لا تُسكِت الردّ: استعلام الطلبات النشطة قد يوسّع يوماً، فمن يسأل
 * «أين طلبي؟» يجب أن يرى طلبه ووقته على الأقل، لا رسالة فارغة.
 */
function describeOrderStatus(
  order: ActiveOrderSummary,
  language: string,
  now: Date,
): { readonly text: string; readonly photoFileId?: string } {
  const tr = t(language);
  const lines: string[] = [tr("rider.status_heading"), describeActiveOrder(order, language)];

  if (order.status === "matched") lines.push(tr("rider.status_matched"));
  else if (order.status === "in_progress") lines.push(tr("rider.status_in_progress"));
  else if (order.status === "searching") lines.push(tr("rider.status_searching"));

  const driver = order.assignedDriver ?? null;
  if (driver !== null) {
    lines.push(tr("rider.status_driver", { name: driver.fullName }));
    if (driver.vehicleType !== null && driver.vehicleType.trim() !== "") {
      lines.push(tr("rider.status_vehicle", { vehicle: driver.vehicleType }));
    }
    // لوحة ناقصة تُقال صراحةً لا تُسكت: سطرٌ غائب يُقرأ «لم يُرسل البوت كلّ شيء»
    lines.push(
      driver.plateNumber === null || driver.plateNumber.trim() === ""
        ? tr("rider.status_plate_missing")
        : tr("rider.status_plate", { plate: driver.plateNumber }),
    );
  }

  const minutes = waitedMinutes(order, now);
  lines.push(
    tr(minutes >= LONG_WAIT_MINUTES ? "rider.status_waiting_long" : "rider.status_waiting", {
      minutes,
    }),
  );

  const text = lines.join("\n");
  const photo = driver?.vehiclePhotoFileId ?? null;
  // صورة المركبة تُرسل مع التقرير تعليقاً لا رسالة ثانية: رسالتان قد تفترقان
  // في محادثة مزدحمة، فيرى العميل صورة سيارة لا يعرف لأيّ طلب هي.
  return photo === null || photo.trim() === "" ? { text } : { text, photoFileId: photo };
}

/**
 * البند 2.2 — «أين طلبي؟ / أين سائقي؟» بضغطة واحدة.
 *
 * يُعرض كل طلب نشط لا الأحدث وحده، لنفس السبب الذي فرض ذلك على /cancel:
 * من له مشوار وطرد معاً ورأى حالة أحدهما وحده يحسب الآخر منتهياً.
 */
async function handleStatus(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  const active = await deps.activeOrdersOf(rider.value.id);
  // القائمة تُصحّح نفسها هنا: من انتهى طلبه وبقي الزرّ معروضاً على جهازه
  // يردّ عليه بجواب صحيح وبلوحة بلا زرّ تتبّع، فيستوي المعروض مع الواقع.
  if (active.length === 0) return [reply(sender, tr("rider.status_none"), menu(state))];

  const now = deps.clock.now();
  return active.map((order, index) => {
    const described = describeOrderStatus(order, state.language, now);
    // اللوحة مع الردّ الأخير وحده: تلغرام يُبقي المعروضة أخيراً، وإرسالها مع كل ردّ تكرار بلا أثر
    const keyboard = index === active.length - 1 ? trackingMenu(state) : null;
    return described.photoFileId === undefined
      ? reply(sender, described.text, keyboard)
      : {
          chatId: sender.chatId,
          text: described.text,
          keyboard,
          photoFileId: described.photoFileId,
        };
  });
}

function cancelChoiceKeyboard(orders: readonly ActiveOrderSummary[], language: string): Keyboard {
  return {
    kind: "inline",
    rows: orders.map((order) => [
      { label: describeActiveOrder(order, language), data: `cancel:${order.orderId}` },
    ]),
  };
}

/**
 * الإلغاء الفعلي لطلب بعينه، ومعه إخطار كل من يعنيه الأمر.
 *
 * الإخطار يجري بعد نجاح الإلغاء لا قبله، وفشله لا يُبطل الإلغاء: العميل وافق
 * وقُيّد قراره في القاعدة، فلا يصحّ أن يُلغى قراره لأن تيليجرام تعثّر.
 */
async function cancelOne(
  order: ActiveOrderSummary,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  const cancelled = await deps.orders.cancelByRider(order.orderId, rider.value.id);
  if (!cancelled.ok) return technicalFailure(sender, state);

  // «بدأت رحلتك فلا تُلغى بزرّ» ليست «لا يوجد طلب». الخلط بينهما يُخرج العميل
  // معتقداً أن طلبه اختفى، وهو ماضٍ.
  if (cancelled.value.kind === "not_cancellable") {
    return [reply(sender, tr("rider.order_not_cancellable"))];
  }
  if (cancelled.value.kind === "not_found") {
    return [reply(sender, tr("rider.no_active_order"))];
  }

  for (const target of cancelled.value.notify) {
    await deps.matching.notifier.notifyCancelled({
      orderId: cancelled.value.orderId,
      driverId: target.driverId,
      wasAssigned: target.wasAssigned,
    });
  }

  // البند 2.2: من ألغى أحد طلبيه لا يجوز أن يُسلَب زرّ متابعة الطلب الباقي.
  // قراءة بعد الإلغاء لا خصمٌ من القائمة القديمة: طلب قد يكتمل أو يُسنَد بينهما.
  const remaining = await deps.activeOrdersOf(rider.value.id);

  // التأكيد يسمّي الطلب. «تم إلغاء طلبك» وحدها هي التي أوقعت العميل في الوهم.
  return [
    reply(
      sender,
      tr("rider.order_cancelled_named", { order: describeActiveOrder(order, state.language) }),
      menu(state, { hasActiveOrder: remaining.length > 0 }),
    ),
  ];
}

async function handleCancelChoice(
  orderIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  // نُعيد القراءة بدل الوثوق بمعرّف قادم من زرّ قديم: الطلب قد يكون قُبل أو
  // انتهى بين عرض القائمة والضغط عليها.
  const active = await deps.activeOrdersOf(rider.value.id);
  const chosen = active.find((order) => String(order.orderId) === orderIdRaw);
  if (chosen === undefined) return [reply(sender, tr("rider.no_active_order"))];
  return cancelOne(chosen, sender, state, deps);
}

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
      // القائمة مع الترحيب لا مع طلب الاسم: تلغرام يُبقي لوحة الردّ معروضة ما لم
      // تُستبدل، فترافق العميل من أوّل رسالة — وزرّ اللغة أول ما يحتاجه من لا يقرأ
      // العربية، وهو أقلّ الناس قدرةً على معرفة أمر /language من نصّ عربيّ.
      return [reply(sender, tr("rider.welcome"), menu(state)), reply(sender, tr("rider.ask_name"))];
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

    // البند 2.2: لا يُشترط له منفذ اختياري، فمنفذ الطلبات النشطة أساسي في الحوار أصلاً
    case "/status":
      return handleStatus(sender, state, deps);

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (rider === null) return [reply(sender, tr("support.not_registered"), menu(state))];
      // العميل لا يملك اشتراكاً، فسؤاله عن نوع المشكلة يولّد تذاكر مرفوضة حتماً
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: false });
    }

    case "/cancel": {
      // الإلغاء يخرج من أي خطوة حوار، حتى قبل اكتمال التسجيل. كان العميل الجديد
      // يبقى في awaiting_name رغم ظهور «سجّل أولاً»، بخلاف بوت السائق.
      // إزالة اللوحة هنا (`remove` سابقاً) كانت تخلي أسفل الشاشة في أكثر لحظة
      // يحتاج فيها العميل إلى طريق عودة أو إلى الدعم. الإلغاء رجوع للقائمة لا خروج.
      if (rider === null) {
        await deps.sessions.clear(sender.telegramUserId);
        return [reply(sender, tr("common.cancelled"), menu(state))];
      }
      const active = await deps.activeOrdersOf(rider.id);
      await deps.sessions.clear(sender.telegramUserId);
      // لا نسمّي إلغاء مسودة رحلة أو تذكرة دعم «لا يوجد طلب»: المسودة أُلغيت فعلاً.
      if (active.length === 0) {
        return [
          reply(
            sender,
            tr(state.step === "idle" ? "rider.no_active_order" : "common.cancelled"),
            menu(state),
          ),
        ];
      }
      // أكثر من طلب نشط: لا نختار عنه. كان النظام يُلغي الأحدث صامتاً ويقول
      // «تم إلغاء طلبك»، فيخرج العميل ظانّاً أن طلبه الآخر انتهى وهو باقٍ.
      if (active.length > 1) {
        return [
          reply(
            sender,
            tr("rider.cancel_which_order"),
            cancelChoiceKeyboard(active, state.language),
          ),
        ];
      }
      const only = active[0] as ActiveOrderSummary;
      return cancelOne(only, sender, state, deps);
    }

    case "/language":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCommand(sender, state.language);

    case "/help": {
      // قراءة واحدة لتخرج القائمة مطابقةً للواقع: /help أوّل ما يلجأ إليه من ضاعت لوحته،
      // فلو أعادناها بلا زرّ تتبّع وله طلبٌ يبحث لسلبناه الزرّ في موطن طلب المساعدة.
      const active = rider === null ? [] : await deps.activeOrdersOf(rider.id);
      return [
        reply(sender, tr("rider.help"), menu(state, { hasActiveOrder: active.length > 0 })),
        reply(sender, tr("menu.hint")),
      ];
    }

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
        [{ label: tr("common.back_button"), data: "back:city" }],
      ],
    }),
  ];
}

/** رجوع خطوة واحدة: يعيد سؤال المدينة بلا مسح الاسم. */
async function handleBack(
  target: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
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
  return [reply(sender, tr("rider.ask_city"), cityKeyboard(cities.value))];
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
  // أزرار تلغرام القديمة تبقى قابلة للضغط في السجل. قبولها خارج شاشة اختيار
  // الخدمة قد يبدّل نوع طلبٍ جارٍ من نقل إلى توصيل بلا قصد المستخدم.
  if (state.step !== "awaiting_service" || !isServiceType(raw)) {
    return [reply(sender, tr("common.unknown_command"))];
  }
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
    // البند 4.3: زرّ الموقع ومعه القائمة، فلا يُمحى زرّ الدعم في منتصف الطلب
    reply(
      sender,
      tr(service === "delivery" ? "rider.ask_parcel_pickup" : "rider.ask_pickup"),
      locationRequest(state),
    ),
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
  if (!parsed.ok) return [reply(sender, tr(nameErrorKey(parsed.error.reason)))];

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
    // كان `remove`. ولوحة المدن التي قبلها inline لا reply، فلا شيء يستدعي الحذف؛
    // وإنما كان يُفقد العميل قائمته لحظةً يكمل فيها تسجيله.
    reply(
      sender,
      tr("rider.registered", { name: registered.value.fullName, city: city.name }),
      menu(state),
    ),
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
    // القائمة بدل `remove`: المقصود إنهاء لوحة طلب الموقع لا ترك العميل عارياً.
    return [reply(sender, tr(key), menu(state))];
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
      return [reply(sender, tr("rider.ask_parcel"), menu(state))];
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

  // البند 2.2: الطلب صار في searching قبل هذا السطر، فزرّ التتبّع يظهر مع أوّل ردّ
  // يراه العميل بعد الطلب لا بعد رسالة تالية — ولحظة الطلب هي لحظة القلق.
  const replies: BotReply[] = [reply(sender, tr("rider.delivery_searching"), trackingMenu(state))];
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

  // البند 2.2: كما في التوصيل — الزرّ يرافق إعلان بدء البحث نفسه
  const replies: BotReply[] = [reply(sender, tr("rider.searching"), trackingMenu(state))];

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
