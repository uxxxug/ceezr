/**
 * الغرض: مزدوجات منافذ البوت — دلائل مدن وسائقين وعملاء في الذاكرة، وملتقِط رسائل مُرسَلة.
 * الحالة: أداة اختبار فقط. لا تُستورد من apps ولا packages.
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: tests/unit/driver-dialog.test.ts، tests/unit/rider-dialog.test.ts
 * ملاحظات مستقبلية: تُستبدل بمحوّلات Supabase الحقيقية في اختبارات التكامل عند وصول المفتاح.
 */

import type {
  CityId,
  DriverId,
  OrderId,
  RiderId,
  ServiceType,
} from "../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
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
import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";

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
}

export function driverDirectory(existing: DriverProfile | null = null): DriverDirectoryDouble {
  const registrations: DriverDirectoryDouble["registrations"] = [];
  const availabilityCalls: DriverDirectoryDouble["availabilityCalls"] = [];
  let current = existing;

  return {
    registrations,
    availabilityCalls,
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
      };
      return ok(current);
    },
    setAvailability: async (driverId, isAvailable) => {
      availabilityCalls.push({ driverId, isAvailable });
      return ok(undefined);
    },
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
  readonly cancellations: OrderId[];
}

export function orderWriter(orderId = "order-1" as OrderId): OrderWriterDouble {
  const created: OrderWriterDouble["created"] = [];
  const cancellations: OrderId[] = [];
  return {
    created,
    cancellations,
    create: async (input) => {
      created.push({
        cityId: input.cityId,
        riderId: input.riderId,
        pickup: input.pickup,
        dropoff: input.dropoff,
      });
      return ok(orderId);
    },
    cancelByRider: async (id) => {
      cancellations.push(id);
      return ok(true);
    },
  };
}

/** يلتقط كل ما كان سيُرسَل إلى تلغرام بدل إرساله. */
export function capturingSender(): TelegramSender & {
  readonly sent: { chatId: string; text: string; markup: unknown }[];
} {
  const sent: { chatId: string; text: string; markup: unknown }[] = [];
  return {
    sent,
    sendMessage: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup });
    },
  };
}

export function failingSender(detail: string): TelegramSender {
  return {
    sendMessage: async () => {
      throw new Error(detail);
    },
  };
}

export type { Result };
