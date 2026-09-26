/**
 * الغرض: مزدوجات منافذ البوت — دلائل مدن وسائقين وعملاء في الذاكرة، وملتقِط رسائل مُرسَلة.
 * الحالة: أداة اختبار فقط. لا تُستورد من apps ولا packages.
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: tests/unit/driver-dialog.test.ts، tests/unit/rider-dialog.test.ts
 * ملاحظات مستقبلية: تُستبدل بمحوّلات Supabase الحقيقية في اختبارات التكامل عند وصول المفتاح.
 */

import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";
import type {
  CityDirectory,
  CityRef,
  DriverDirectory,
  DriverProfile,
  LocationWriteOutcome,
  OfferDecisionPort,
  OrderWriter,
  RiderDirectory,
  RiderProfile,
  SubscriptionReader,
  TrialRpcPort,
} from "../../packages/application/bots/types.ts";
import type {
  OfferWriter,
  OpenRoundInput,
} from "../../packages/application/dispatch/broadcast-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  CancellationOutcome,
  ResumeOutcome,
  SubscriptionChangeRpcPort,
  UpgradeApplied,
  UpgradeQuote,
} from "../../packages/application/subscription/ports.ts";
import type { Coordinates } from "../../packages/domain/geo/value-objects.ts";
import type { Subscription, SubscriptionPlan } from "../../packages/domain/subscription/entity.ts";
import type {
  CityId,
  DriverId,
  OfferId,
  OrderId,
  RiderId,
  ServiceType,
} from "../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

export const JEDDAH: CityRef = {
  id: "11111111-1111-1111-1111-111111111111" as CityId,
  code: "JED",
  name: "جدة",
};

export const MAKKAH: CityRef = {
  id: "22222222-2222-2222-2222-222222222222" as CityId,
  code: "MKK",
  name: "مكة",
};

export function cityDirectory(cities: readonly CityRef[] = [JEDDAH, MAKKAH]): CityDirectory {
  return { listActive: async () => ok(cities) };
}

export function failingCityDirectory(): CityDirectory {
  return { listActive: async () => err(new PortFailureError("CityDirectory", "timeout")) };
}

export interface DriverDirectoryDouble extends DriverDirectory {
  readonly registrations: {
    telegramUserId: string;
    cityId: CityId;
    fullName: string;
    phone: string;
    service: SubscriptionPlan;
  }[];
  readonly availabilityCalls: { driverId: DriverId; isAvailable: boolean }[];
  readonly locationCalls: { driverId: DriverId; location: Coordinates }[];
  /** حكمُ الكتابةِ الذي يُعيدُه المزدوجُ — يُضبَط في النداءِ لاختبارِ مسارِ `stale`. */
  locationOutcome: LocationWriteOutcome;
  readonly preferredAreaCalls: ({ label: string; location: Coordinates } | null)[];
}

export function driverDirectory(existing: DriverProfile | null = null): DriverDirectoryDouble {
  const registrations: DriverDirectoryDouble["registrations"] = [];
  const availabilityCalls: DriverDirectoryDouble["availabilityCalls"] = [];
  const locationCalls: DriverDirectoryDouble["locationCalls"] = [];
  const preferredAreaCalls: DriverDirectoryDouble["preferredAreaCalls"] = [];
  let current = existing;

  const double: DriverDirectoryDouble = {
    registrations,
    availabilityCalls,
    locationCalls,
    preferredAreaCalls,
    locationOutcome: { kind: "accepted" },
    setPreferredArea: async (_driverId, area) => {
      preferredAreaCalls.push(area === null ? null : { ...area });
      return ok(undefined);
    },
    findByTelegramId: async () => ok(current),
    register: async (input) => {
      registrations.push({
        telegramUserId: input.telegramUserId,
        cityId: input.cityId,
        fullName: input.fullName,
        phone: input.phone,
        service: input.service,
      });
      current = {
        id: `driver-${registrations.length}` as DriverId,
        cityId: input.cityId,
        telegramUserId: input.telegramUserId,
        fullName: input.fullName,
        phone: input.phone,
        isVerified: false,
        isAvailable: false,
        hasLocation: false,
        lastFix: null,
      };
      return ok(current);
    },
    /**
     * المزدوجُ **لا يُحاكي** حارسَ `BUG-001`: مقارنةُ الطوابعِ في الذاكرةِ كانت
     * ستُنشئ حَكَماً ثانياً على «الأحدثِ» في الاختباراتِ نفسِها. فالحكمُ ههنا قيمةٌ
     * تُضبَط من الاختبارِ، والحارسُ الحقيقيُّ يُختبَر على قاعدةٍ حقيقيّةٍ وحدَها.
     */
    updateLocation: async (driverId, location) => {
      locationCalls.push({ driverId, location });
      return ok(double.locationOutcome);
    },
    setAvailability: async (driverId, isAvailable) => {
      availabilityCalls.push({ driverId, isAvailable });
      return ok(undefined);
    },
    changeCity: async (_driverId, _newCityId) => ok({ ok: true, error: null }),
  };
  return double;
}

export function verifiedDriver(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: "driver-1" as DriverId,
    cityId: JEDDAH.id,
    telegramUserId: "900",
    fullName: "أحمد العمري",
    phone: "+966501234567",
    isVerified: true,
    isAvailable: false,
    hasLocation: true,
    lastFix: null,
    ...overrides,
  };
}

export function riderDirectory(existing: RiderProfile | null = null): RiderDirectory & {
  readonly registrations: RiderProfile[];
} {
  const registrations: RiderProfile[] = [];
  let current = existing;
  return {
    registrations,
    findByTelegramId: async () => ok(current),
    register: async (input) => {
      current = {
        id: `rider-${registrations.length + 1}` as RiderId,
        cityId: input.cityId,
        telegramUserId: input.telegramUserId,
        fullName: input.fullName,
      };
      registrations.push(current);
      return ok(current);
    },
    changeCity: async (_riderId, _newCityId) => ok({ ok: true, error: null }),
  };
}

export function subscriptionReader(subscription: Subscription | null): SubscriptionReader {
  return { findLive: async () => ok(subscription) };
}

/** استدعاءات منفذ تغييرات الاشتراك — تُقرأ في التوكيدات بدل تخمين ما نودي به. */
export interface SubscriptionChangeCalls {
  readonly cancels: { driverId: DriverId; reason: string | null }[];
  readonly resumes: DriverId[];
  readonly quotes: { driverId: DriverId; plan: SubscriptionPlan }[];
  readonly upgrades: { driverId: DriverId; plan: SubscriptionPlan; transactionId: string | null }[];
}

/**
 * مزدوج منفذ تغييرات الاشتراك. لا يحسب سعراً ولا يقرّر ترقية: يعيد ما يُلقَّنه
 * حرفياً — لأنّ الحساب في القاعدة، ومزدوجٌ يحسب يخفي فرقاً بين ما يُعرض وما يُطبَّق.
 */
export function subscriptionChangePort(
  responses: {
    readonly cancel?: Partial<CancellationOutcome>;
    readonly resume?: Partial<ResumeOutcome>;
    readonly quote?: Partial<UpgradeQuote>;
    readonly upgrade?: Partial<UpgradeApplied>;
    readonly failOn?: "cancel" | "resume" | "quote" | "upgrade";
  } = {},
): SubscriptionChangeRpcPort & { readonly calls: SubscriptionChangeCalls } {
  const calls: SubscriptionChangeCalls = { cancels: [], resumes: [], quotes: [], upgrades: [] };
  const failure = (name: string) => err(new PortFailureError(name, "PORT_DOWN"));
  return {
    calls,
    requestCancellation: async (driverId, reason) => {
      calls.cancels.push({ driverId, reason });
      if (responses.failOn === "cancel") return failure("rpc.cancel_subscription");
      return ok({
        ok: true,
        error: null,
        subscriptionId: "sub-1",
        alreadyCancelled: false,
        status: "active",
        serviceUntil: new Date("2026-09-01T00:00:00.000Z"),
        ...responses.cancel,
      });
    },
    resume: async (driverId) => {
      calls.resumes.push(driverId);
      if (responses.failOn === "resume") return failure("rpc.resume_subscription");
      return ok({
        ok: true,
        error: null,
        subscriptionId: "sub-1",
        alreadyActive: false,
        status: "active",
        ...responses.resume,
      });
    },
    quoteUpgrade: async (driverId, plan) => {
      calls.quotes.push({ driverId, plan });
      if (responses.failOn === "quote") return failure("rpc.plan_upgrade_quote");
      return ok({
        ok: true,
        error: null,
        subscriptionId: "sub-1",
        cityId: null,
        currentPlan: "transport",
        newPlan: plan,
        amountDue: 150,
        paymentRequired: true,
        currency: "SAR",
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
        status: "active",
        ...responses.quote,
      });
    },
    applyUpgrade: async (driverId, plan, transactionId) => {
      calls.upgrades.push({ driverId, plan, transactionId });
      if (responses.failOn === "upgrade") return failure("rpc.upgrade_plan");
      return ok({
        ok: true,
        error: null,
        subscriptionId: "sub-1",
        alreadyOnPlan: false,
        plan,
        periodEnd: null,
        ...responses.upgrade,
      });
    },
  };
}

export function trialPort(
  started: boolean,
  reason: string | null = null,
): TrialRpcPort & { readonly calls: { driverId: DriverId; plan: SubscriptionPlan }[] } {
  const calls: { driverId: DriverId; plan: SubscriptionPlan }[] = [];
  return {
    calls,
    startTrial: async (driverId, plan) => {
      calls.push({ driverId, plan });
      return ok({ started, reason });
    },
  };
}

export function offerDecisionPort(): OfferDecisionPort & {
  readonly rejections: { offerId: OfferId; driverId: DriverId }[];
} {
  const rejections: { offerId: OfferId; driverId: DriverId }[] = [];
  return {
    rejections,
    reject: async (offerId, driverId) => {
      rejections.push({ offerId, driverId });
      return ok(true);
    },
  };
}

export interface OrderWriterDouble extends OrderWriter {
  readonly created: {
    cityId: CityId;
    riderId: RiderId;
    pickup: { latitude: number; longitude: number };
    dropoff: { latitude: number; longitude: number } | null;
  }[];
  /** ما أُرسِل كاملاً — يشمل نوع الخدمة ووصف الطرد، ليُتحقّق منهما في اختبار التوصيل. */
  readonly createdFull: {
    cityId: CityId;
    riderId: RiderId;
    service: ServiceType;
    pickup: { latitude: number; longitude: number };
    dropoff: { latitude: number; longitude: number } | null;
    notes: string | null;
  }[];
  readonly cancellations: OrderId[];
}

export function orderWriter(orderId = "order-1" as OrderId): OrderWriterDouble {
  const created: OrderWriterDouble["created"] = [];
  const createdFull: OrderWriterDouble["createdFull"] = [];
  const cancellations: OrderId[] = [];
  return {
    created,
    createdFull,
    cancellations,
    create: async (input) => {
      created.push({
        cityId: input.cityId,
        riderId: input.riderId,
        pickup: input.pickup,
        dropoff: input.dropoff,
      });
      createdFull.push({
        cityId: input.cityId,
        riderId: input.riderId,
        service: input.service,
        pickup: input.pickup,
        dropoff: input.dropoff,
        notes: input.notes ?? null,
      });
      return ok(orderId);
    },
    cancelByRider: async (id) => {
      cancellations.push(id);
      return ok({
        kind: "cancelled" as const,
        orderId: id,
        service: "transport" as const,
        previousStatus: "searching",
        notify: [],
        groupMessageIds: [],
      });
    },
  };
}

/**
 * ما أُرسل إلى تلغرام. `location` موجودة للدبّوس (المرحلة ١٢): الاختبار يتحقّق
 * من إحداثيةٍ أُرسلت فعلاً لا من نصٍّ يذكرها — والفرق أنّ نصّاً قد يُترجَم أو
 * يُعاد صوغه، والدبّوس إمّا أُرسل بإحداثيته أو لم يُرسل.
 */
export interface SentToTelegram {
  readonly chatId: string;
  readonly text: string;
  readonly markup: unknown;
  readonly photoFileId?: string;
  readonly location?: { readonly latitude: number; readonly longitude: number };
}

/** يلتقط كل ما كان سيُرسَل إلى تلغرام بدل إرساله. */
export function capturingSender(): TelegramSender & {
  readonly sent: SentToTelegram[];
} {
  const sent: SentToTelegram[] = [];
  return {
    sent,
    sendMessage: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup });
      // المعرّف المتزايد يحاكي معرّفات تلغرام: تصاعدية وفريدة داخل المحادثة
      return String(sent.length);
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      sent.push({ chatId, text: caption, markup, photoFileId: fileId });
      return String(sent.length);
    },
    sendLocation: async (chatId, latitude, longitude) => {
      sent.push({ chatId, text: "", markup: undefined, location: { latitude, longitude } });
      return String(sent.length);
    },
  };
}

export function failingSender(detail: string): TelegramSender {
  return {
    sendMessage: async () => {
      throw new Error(detail);
    },
    sendPhoto: async () => {
      throw new Error(detail);
    },
    sendLocation: async () => {
      throw new Error(detail);
    },
  };
}

export type { Result };

/** كاتب عروض في الذاكرة — يسجّل كل دورة بثّ كما تُكتب في order_offers. */
export interface OfferWriterDouble extends OfferWriter {
  readonly rounds: OpenRoundInput[];
}

export function offerWriterDouble(): OfferWriterDouble {
  const rounds: OpenRoundInput[] = [];
  /**
   * عدّادٌ يُولّدُ معرّفَ عرضٍ فريدًا لكلِّ إدخالٍ في الذاكرةِ — فالبثّ يربطُ كلَّ
   * سائقٍ بمعرّفِ عرضٍ، والمنفذُ الحقيقيُّ يأخذُه من القاعدةِ. وهنا يُخترَعُ
   * لتُجرّى الحلقةُ بلا قاعدة (`BUG-003`).
   */
  let sequence = 0;
  return {
    rounds,
    openRound: async (input) => {
      rounds.push(input);
      const offers = input.entries.map((entry) => ({
        offerId: `offer-${sequence++}` as OfferId,
        driverId: entry.driverId,
      }));
      return ok({ opened: true as const, offersInserted: offers.length, offers });
    },
  };
}

// D-01: مزدوجُ أمرِ الرحلةِ — يحاكي `RideRequestCommand.create` بلا قاعدةِ بيانات.
export interface RideRequestCommandDouble {
  readonly createCalls: {
    telegramUserId: string;
    idempotencyKey: string;
    service: string;
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number } | null;
    notes: string | null;
  }[];
  /** إن رُفِعَ، يُعيدُ رفضَ `ACTIVE_RIDE_EXISTS` بالطلَبِ المُعطى. */
  activeRideBlocker: { orderId: string; status: string } | null;
}

export function rideRequestCommand(
  orderId = "order-1" as OrderId,
): RideRequestCommandDouble &
  import("../../packages/application/transport/ride-request-ports.ts").RideRequestCommand {
  const createCalls: RideRequestCommandDouble["createCalls"] = [];
  const activeRideBlocker: RideRequestCommandDouble["activeRideBlocker"] = {
    orderId: "existing-order" as OrderId,
    status: "searching",
  };
  return {
    createCalls,
    activeRideBlocker,
    create: async (input) => {
      createCalls.push({
        telegramUserId: input.telegramUserId,
        idempotencyKey: input.idempotencyKey,
        service: input.service,
        origin: input.origin,
        destination: input.destination,
        notes: input.notes,
      });
      // إن وُجدَ مفتاحٌ مُستهلَكٌ، فالإعادةُ.
      const reused =
        createCalls.filter((c) => c.idempotencyKey === input.idempotencyKey).length > 1;
      if (reused) {
        return ok({ accepted: true, ride: { orderId, createdAtMs: Date.now(), reused: true } });
      }
      return ok({ accepted: true, ride: { orderId, createdAtMs: Date.now(), reused: false } });
    },
  };
}
