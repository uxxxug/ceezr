/**
 * الغرض: عقود حوار البوت مستقلةً عن تلغرام: ماذا وصل، وماذا نردّ، وبأي منافذ.
 *   هكذا يُختبر منطق البوت كاملاً بلا رمز بوت ولا شبكة، ويبقى grammY محوّلاً رقيقاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، tests/unit/*-dialog.test.ts
 * ملاحظات مستقبلية: أي منصّة أخرى (واتساب مثلاً) تُوصَل بمحوّل جديد بلا لمس منطق الحوار.
 */

import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { Subscription } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId, OrderId, RiderId, ServiceType } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** ما يصل من المنصّة، مُجرَّداً من شكل تلغرام. */
export type IncomingUpdate =
  | { readonly kind: "text"; readonly from: Sender; readonly text: string }
  | { readonly kind: "callback"; readonly from: Sender; readonly data: string }
  | { readonly kind: "location"; readonly from: Sender; readonly location: Coordinates }
  /**
   * `ownerTelegramId`: صاحب البطاقة كما يُقرّه تلغرام، لا كما يدّعي المرسِل.
   * يساوي `from.telegramUserId` حين يضغط المستخدم زرّ مشاركة رقمه،
   * ويختلف عنه حين يُعيد توجيه بطاقة شخص آخر. `null` = بطاقة بلا حساب.
   */
  | {
      readonly kind: "contact";
      readonly from: Sender;
      readonly phone: string;
      readonly ownerTelegramId: string | null;
    }
  /**
   * صورة: نحمل معرّف الملف عند تلغرام ولا نُنزّل الصورة ولا نخزّنها عندنا.
   * إعادة إرسالها للدعم تتم بالمعرّف نفسه، فلا تكلفة تخزين ولا تسريب لملفات المستخدمين.
   */
  | {
      readonly kind: "photo";
      readonly from: Sender;
      readonly fileId: string;
      readonly caption: string | null;
    }
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
  /**
   * إن وُجد، تُرسَل صورة بهذا المعرّف والنصّ تعليقاً عليها بدل رسالة نصّية.
   * يحتاجه الدعم: إيصال التحويل يجب أن يظهر صورةً في القروب لا رابطاً لا يفتحه أحد.
   */
  readonly photoFileId?: string;
}

/** حالة الحوار المحفوظة بين رسالتين. لا تحمل قيمة تجارية، فقط تقدّم المستخدم. */
export type DialogStep =
  | "idle"
  | "awaiting_name"
  | "awaiting_phone"
  | "awaiting_city"
  | "awaiting_service"
  | "awaiting_pickup"
  | "awaiting_dropoff"
  /** خاصّ بالتوصيل: وصف الطرد بعد تثبيت نقطتي الانطلاق والوصول. */
  | "awaiting_parcel"
  /** اختيار نوع الشكوى بعد /support: اشتراك أم نزاع رحلة. */
  | "awaiting_support_type"
  /** انتظار نصّ الشكوى أو صورتها بعد اختيار النوع. */
  | "awaiting_support_message"
  /** ملفّ السائق التوثيقي: نوع المركبة ثم لوحتها ثم الهوية ثم صورة المركبة. */
  | "awaiting_vehicle_type"
  | "awaiting_plate_number"
  | "awaiting_national_id"
  | "awaiting_vehicle_photo";

/**
 * القائمة نفسها كقيمة، ليتحقّق منها مخزن Redis عند القراءة.
 * كانت مكرّرة يدوياً هناك، فأُضيفت خطواتٌ جديدة إلى النوع ولم تُضَف إلى القائمة:
 * فصار المخزن يرفض كل جلسة تصلها خطوةٌ جديدة ويعيدها إلى الصفر بصمت — والاختبار
 * في الذاكرة لا يراه لأنه لا يمرّ بالترجمة أصلاً. التكرار هو العطب، فأُزيل.
 * `satisfies` يجعل أي انحراف بين النوع والقائمة خطأ ترجمة لا مفاجأة إنتاج.
 */
export const DIALOG_STEPS = [
  "idle",
  "awaiting_name",
  "awaiting_phone",
  "awaiting_city",
  "awaiting_service",
  "awaiting_pickup",
  "awaiting_dropoff",
  "awaiting_parcel",
  "awaiting_support_type",
  "awaiting_support_message",
  "awaiting_vehicle_type",
  "awaiting_plate_number",
  "awaiting_national_id",
  "awaiting_vehicle_photo",
] as const satisfies readonly DialogStep[];

export interface DialogState {
  readonly step: DialogStep;
  readonly language: string;
  readonly draftName: string | null;
  readonly draftPhone: string | null;
  readonly draftCityId: CityId | null;
  readonly draftService: ServiceType | null;
  readonly draftPickup: Coordinates | null;
  /** وجهة محفوظة بين خطوتين — يحتاجها التوصيل لأن وصف الطرد يأتي بعدها. */
  readonly draftDropoff: Coordinates | null;
  /** نوع تذكرة الدعم المختار، محفوظاً حتى تصل رسالة الشكوى. */
  readonly draftSupportType: "subscription" | "ride_dispute" | null;
  /**
   * مسوّدة الملفّ التوثيقي. تُجمَع في الجلسة ولا تُكتب في القاعدة إلا مكتملة:
   * سائقٌ يتوقّف في منتصف التسجيل لا يجوز أن يترك صفّاً نصف موثَّق يظنّه
   * موظّف التوثيق ملفّاً حقيقياً.
   */
  readonly draftVehicleType: string | null;
  readonly draftPlateNumber: string | null;
  readonly draftNationalId: string | null;
  readonly draftVehiclePhotoFileId: string | null;
}

export const INITIAL_STATE: DialogState = {
  step: "idle",
  language: "ar",
  draftName: null,
  draftPhone: null,
  draftCityId: null,
  draftService: null,
  draftPickup: null,
  draftDropoff: null,
  draftSupportType: null,
  draftVehicleType: null,
  draftPlateNumber: null,
  draftNationalId: null,
  draftVehiclePhotoFileId: null,
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
  /** بلا موقع محفوظ لا يدخل السائق المطابقة إطلاقاً — المسافة ركن في المعادلة. */
  readonly hasLocation: boolean;
}

export interface RegisterDriverInput {
  readonly telegramUserId: string;
  readonly cityId: CityId;
  readonly fullName: string;
  readonly phone: string;
  readonly service: ServiceType;
  readonly language: string;
  /** الملفّ التوثيقي يُكتب مع التسجيل في عملية واحدة لا في تحديث لاحق. */
  readonly vehicleType: string;
  readonly plateNumber: string;
  readonly nationalId: string;
  readonly vehiclePhotoFileId: string;
}

export interface DriverDirectory {
  findByTelegramId(telegramUserId: string): Promise<Result<DriverProfile | null, PortFailureError>>;
  register(input: RegisterDriverInput): Promise<Result<DriverProfile, PortFailureError>>;
  setAvailability(
    driverId: DriverId,
    isAvailable: boolean,
  ): Promise<Result<void, PortFailureError>>;
  /** يحفظ آخر موقع للسائق — يغذّي المطابقة مباشرة. */
  updateLocation(
    driverId: DriverId,
    location: Coordinates,
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
  ): Promise<
    Result<{ readonly started: boolean; readonly reason: string | null }, PortFailureError>
  >;
}

export interface CreateOrderInput {
  readonly cityId: CityId;
  readonly riderId: RiderId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  readonly dropoff: Coordinates | null;
  /** ملاحظة العميل على الطلب — وصف الطرد في التوصيل. تُكتب في orders.notes. */
  readonly notes?: string | null;
}

/** سائق يجب إخطاره بالإلغاء — تُعيدهم دالّة cancel_order_by_rider الذرّية. */
export interface CancelNotifyTarget {
  readonly driverId: DriverId;
  readonly wasAssigned: boolean;
}

/**
 * نتيجة الإلغاء مفصَّلة، لا مجرّد صواب أو خطأ. كان الإلغاء يعيد boolean، فكان
 * «لم يُلغَ» يعني في آن واحد: لا طلب لك، وطلبك بدأ فلا يُلغى. فيُقال للعميل
 * «لا يوجد طلب نشط» عن طلب قائم يراه أمامه.
 */
export type CancelOutcome =
  | {
      readonly kind: "cancelled";
      readonly orderId: OrderId;
      readonly service: ServiceType;
      readonly previousStatus: string;
      readonly notify: readonly CancelNotifyTarget[];
      readonly groupMessageIds: readonly string[];
    }
  | { readonly kind: "not_cancellable" }
  | { readonly kind: "not_found" };

export interface OrderWriter {
  create(input: CreateOrderInput): Promise<Result<OrderId, PortFailureError>>;
  cancelByRider(
    orderId: OrderId,
    riderId: RiderId,
  ): Promise<Result<CancelOutcome, PortFailureError>>;
}

/**
 * ملخّص طلب نشط. كان النظام يقرأ «آخر طلب» فقط بـ limit 1، والعميل قد يملك أكثر
 * من طلب في وقت واحد — مشوار وطرد مثلاً. فكان /cancel يُلغي الأحدث ويقول «أُلغي
 * طلبك» بلا تسمية، فيظنّ العميل أن الأقدم أُلغي وهو باقٍ يبحث عن سائق. هذا ما
 * حدث فعلاً في الإنتاج يوم 2026-08-11.
 */
export interface ActiveOrderSummary {
  readonly orderId: OrderId;
  readonly service: ServiceType;
  readonly status: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAt: Date;
}

/** رفض السائق للعرض — يُسجَّل فوراً ليخرج من دورة البثّ القادمة بلا انتظار المهلة. */
export interface OfferDecisionPort {
  reject(orderId: OrderId, driverId: DriverId): Promise<Result<boolean, PortFailureError>>;
}
