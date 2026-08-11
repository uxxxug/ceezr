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
  OfferDecisionPort,
  OrderWriter,
  RiderDirectory,
  RiderProfile,
  SubscriptionReader,
  TrialRpcPort,
} from "../../packages/application/bots/types.ts";
import type {
  CancellationNotice,
  DriverNotifier,
  OfferNotification,
  OfferWriter,
  OpenRoundInput,
} from "../../packages/application/dispatch/broadcast-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { Coordinates } from "../../packages/domain/geo/value-objects.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type {
  CityId,
  DriverId,
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
    service: ServiceType;
  }[];
  readonly availabilityCalls: { driverId: DriverId; isAvailable: boolean }[];
  readonly locationCalls: { driverId: DriverId; location: Coordinates }[];
  readonly preferredAreaCalls: ({ label: string; location: Coordinates } | null)[];
}

export function driverDirectory(existing: DriverProfile | null = null): DriverDirectoryDouble {
  const registrations: DriverDirectoryDouble["registrations"] = [];
  const availabilityCalls: DriverDirectoryDouble["availabilityCalls"] = [];
  const locationCalls: DriverDirectoryDouble["locationCalls"] = [];
  const preferredAreaCalls: DriverDirectoryDouble["preferredAreaCalls"] = [];
  let current = existing;

  return {
    registrations,
    availabilityCalls,
    locationCalls,
    preferredAreaCalls,
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
    updateLocation: async (driverId, location) => {
      locationCalls.push({ driverId, location });
      return ok(undefined);
    },
    setAvailability: async (driverId, isAvailable) => {
      availabilityCalls.push({ driverId, isAvailable });
      return ok(undefined);
    },
    changeCity: async (_driverId, _newCityId) => ok({ ok: true, error: null }),
  };
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

export function trialPort(
  started: boolean,
  reason: string | null = null,
): TrialRpcPort & { readonly calls: { driverId: DriverId; service: ServiceType }[] } {
  const calls: { driverId: DriverId; service: ServiceType }[] = [];
  return {
    calls,
    startTrial: async (driverId, service) => {
      calls.push({ driverId, service });
      return ok({ started, reason });
    },
  };
}

export function offerDecisionPort(): OfferDecisionPort & {
  readonly rejections: { orderId: OrderId; driverId: DriverId }[];
} {
  const rejections: { orderId: OrderId; driverId: DriverId }[] = [];
  return {
    rejections,
    reject: async (orderId, driverId) => {
      rejections.push({ orderId, driverId });
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

/** يلتقط كل ما كان سيُرسَل إلى تلغرام بدل إرساله. */
export function capturingSender(): TelegramSender & {
  readonly sent: { chatId: string; text: string; markup: unknown; photoFileId?: string }[];
} {
  const sent: { chatId: string; text: string; markup: unknown; photoFileId?: string }[] = [];
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
  };
}

export type { Result };

/** كاتب عروض في الذاكرة — يسجّل كل دورة بثّ كما تُكتب في order_offers. */
export interface OfferWriterDouble extends OfferWriter {
  readonly rounds: OpenRoundInput[];
}

export function offerWriterDouble(): OfferWriterDouble {
  const rounds: OpenRoundInput[] = [];
  return {
    rounds,
    openRound: async (input) => {
      rounds.push(input);
      return ok(undefined);
    },
  };
}

/** مُخطِر سائقين في الذاكرة؛ unreachable تُحاكي سائقاً حجب البوت. */
export interface NotifierDouble extends DriverNotifier {
  readonly sent: OfferNotification[];
  /** إخطارات الإلغاء — تُفحص للتأكد من أن السائق عَلِم فعلاً، لا من أن دالّة نُودِيت. */
  readonly cancelled: CancellationNotice[];
}

export function notifierDouble(unreachable: readonly string[] = []): NotifierDouble {
  const sent: OfferNotification[] = [];
  const cancelled: CancellationNotice[] = [];
  return {
    sent,
    cancelled,
    notifyOffer: async (notification) => {
      sent.push(notification);
      return ok(!unreachable.includes(notification.driverId));
    },
    notifyCancelled: async (notice) => {
      cancelled.push(notice);
      return ok(!unreachable.includes(notice.driverId));
    },
  };
}
