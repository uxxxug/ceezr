/**
 * الغرض: عقود حوار البوت مستقلةً عن تلغرام: ماذا وصل، وماذا نردّ، وبأي منافذ.
 *   هكذا يُختبر منطق البوت كاملاً بلا رمز بوت ولا شبكة، ويبقى grammY محوّلاً رقيقاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، tests/unit/*-dialog.test.ts
 * ملاحظات مستقبلية: أي منصّة أخرى (واتساب مثلاً) تُوصَل بمحوّل جديد بلا لمس منطق الحوار.
 */

import type {
  CityId,
  DriverId,
  OrderId,
  RiderId,
  ServiceType,
} from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { Subscription } from "../../domain/subscription/entity.ts";
import type { PortFailureError } from "../ports/index.ts";

/** ما يصل من المنصّة، مُجرَّداً من شكل تلغرام. */
export type IncomingUpdate =
  | { readonly kind: "text"; readonly from: Sender; readonly text: string }
  | { readonly kind: "callback"; readonly from: Sender; readonly data: string }
  | { readonly kind: "location"; readonly from: Sender; readonly location: Coordinates }
  | { readonly kind: "contact"; readonly from: Sender; readonly phone: string }
  | { readonly kind: "unsupported"; readonly from: Sender };

export interface Sender {
  readonly telegramUserId: string;
  readonly chatId: string;
  /** لغة عميل تلغرام — تُستخدم فقط كافتراض أولي حتى يختار المستخدم لغته. */
  readonly languageHint: string;
}

export type ButtonRow = readonly Button[];

export interface Button {
  readonly label: string;
  /** البيانات المرسلة عند الضغط — لأزرار inline فقط. */
  readonly data: string;
}

export type Keyboard =
  | { readonly kind: "inline"; readonly rows: readonly ButtonRow[] }
  | { readonly kind: "reply"; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: "request_location"; readonly label: string }
  | { readonly kind: "request_contact"; readonly label: string }
  | { readonly kind: "remove" };

export interface BotReply {
  readonly chatId: string;
  readonly text: string;
  readonly keyboard: Keyboard | null;
}

/** حالة الحوار المحفوظة بين رسالتين. لا تحمل قيمة تجارية، فقط تقدّم المستخدم. */
export type DialogStep =
  | "idle"
  | "awaiting_name"
  | "awaiting_phone"
  | "awaiting_city"
  | "awaiting_service"
  | "awaiting_pickup"
  | "awaiting_dropoff";

export interface DialogState {
  readonly step: DialogStep;
  readonly language: string;
  readonly draftName: string | null;
  readonly draftPhone: string | null;
  readonly draftCityId: CityId | null;
  readonly draftService: ServiceType | null;
  readonly draftPickup: Coordinates | null;
}

export const INITIAL_STATE: DialogState = {
  step: "idle",
  language: "ar",
  draftName: null,
  draftPhone: null,
  draftCityId: null,
  draftService: null,
  draftPickup: null,
};

export interface SessionStore {
  load(telegramUserId: string): Promise<Result<DialogState | null, PortFailureError>>;
  save(telegramUserId: string, state: DialogState): Promise<Result<void, PortFailureError>>;
  clear(telegramUserId: string): Promise<Result<void, PortFailureError>>;
}

export interface CityRef {
  readonly id: CityId;
  readonly code: string;
  readonly name: string;
}

export interface CityDirectory {
  /** المدن المفعَّلة فقط. مدينة بلا مجموعات تلغرام لا تظهر للمستخدم إطلاقاً. */
  listActive(): Promise<Result<readonly CityRef[], PortFailureError>>;
}

export interface DriverProfile {
  readonly id: DriverId;
  readonly cityId: CityId;
  readonly telegramUserId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly isVerified: boolean;
  readonly isAvailable: boolean;
}

export interface RegisterDriverInput {
  readonly telegramUserId: string;
  readonly cityId: CityId;
  readonly fullName: string;
  readonly phone: string;
  readonly service: ServiceType;
  readonly language: string;
}

export interface DriverDirectory {
  findByTelegramId(
    telegramUserId: string,
  ): Promise<Result<DriverProfile | null, PortFailureError>>;
  register(input: RegisterDriverInput): Promise<Result<DriverProfile, PortFailureError>>;
  setAvailability(
    driverId: DriverId,
    isAvailable: boolean,
  ): Promise<Result<void, PortFailureError>>;
}

export interface RiderProfile {
  readonly id: RiderId;
  readonly cityId: CityId;
  readonly telegramUserId: string;
  readonly fullName: string;
}

export interface RegisterRiderInput {
  readonly telegramUserId: string;
  readonly cityId: CityId;
  readonly fullName: string;
  readonly language: string;
}

export interface RiderDirectory {
  findByTelegramId(telegramUserId: string): Promise<Result<RiderProfile | null, PortFailureError>>;
  register(input: RegisterRiderInput): Promise<Result<RiderProfile, PortFailureError>>;
}

export interface SubscriptionReader {
  /** الاشتراك السارِي للسائق إن وُجد — تجربة مجانية أو مدفوع. */
  findLive(driverId: DriverId): Promise<Result<Subscription | null, PortFailureError>>;
}

/** بدء التجربة المجانية ذرّياً — يقابل الدالة start_trial. */
export interface TrialRpcPort {
  startTrial(
    driverId: DriverId,
    service: ServiceType,
  ): Promise<Result<{ readonly started: boolean; readonly reason: string | null }, PortFailureError>>;
}

export interface CreateOrderInput {
  readonly cityId: CityId;
  readonly riderId: RiderId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  readonly dropoff: Coordinates | null;
}

export interface OrderWriter {
  create(input: CreateOrderInput): Promise<Result<OrderId, PortFailureError>>;
  cancelByRider(orderId: OrderId, riderId: RiderId): Promise<Result<boolean, PortFailureError>>;
}

/** رفض السائق للعرض — يُسجَّل فوراً ليخرج من دورة البثّ القادمة بلا انتظار المهلة. */
export interface OfferDecisionPort {
  reject(orderId: OrderId, driverId: DriverId): Promise<Result<boolean, PortFailureError>>;
}
