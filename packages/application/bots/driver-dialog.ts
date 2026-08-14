/**
 * الغرض: منطق حوار بوت السائق كاملاً: التسجيل، التوافر، الاشتراك، وقبول/رفض العرض.
 *   دالة خالصة من ناحية الإطار: تأخذ تحديثاً مُجرَّداً وتعيد ردوداً، فتُختبر بلا تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/driver/index.ts
 * ملاحظات مستقبلية: كل قيمة تجارية (السعر، مدة التجربة) تُقرأ من platform_settings عبر منفذ الإعدادات.
 */

import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsPolicy,
  type PreviousFix,
} from "../../domain/geo/gps-fix.ts";
import {
  type Coordinates,
  makeCoordinates,
  parseAreaLabel,
} from "../../domain/geo/value-objects.ts";
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
import {
  isSubscriptionLive,
  type Subscription,
  type SubscriptionPlan,
} from "../../domain/subscription/entity.ts";
import type { RoutingProvider } from "../../maps/core/index.ts";
import { t } from "../../shared/i18n/index.ts";
import type { CityId, Clock, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { ok } from "../../shared/result/index.ts";
import {
  type RegisterUnsubscribedClaimDependencies,
  registerUnsubscribedClaim,
} from "../dispatch/register-unsubscribed-claim.ts";
import {
  type RelayDependencies,
  relayNegotiationMessage,
} from "../dispatch/relay-negotiation-message.ts";
import type { PaymentProvider, PaymentRepository } from "../financial/ports.ts";
import { subscribePlan } from "../financial/subscribe-plan.ts";
import type { DispatchRpcPort, SettingsRepository } from "../ports/index.ts";
import {
  type ResolveSafetyIncidentDeps,
  resolveSafetyIncident,
} from "../safety/resolve-safety-incident.ts";
import { type TriggerSosDeps, triggerSos } from "../safety/trigger-sos.ts";
import { cancelSubscription, resumeSubscription } from "../subscription/cancel-subscription.ts";
import type { SubscriptionChangeRpcPort } from "../subscription/ports.ts";
import { upgradePlan } from "../subscription/upgrade-plan.ts";
import type { DriverTripCardReader, DriverTripKey } from "../tracking/driver-trip-card.ts";
import { driverTripCard } from "../tracking/driver-trip-card.ts";
import type { LiveTrackingPort } from "../tracking/live-tracking.ts";
import { driverTripPin, driverTripText } from "./driver-trip-reply.ts";
import {
  handleLanguageCallback,
  handleLanguageCommand,
  type LanguageDialogDependencies,
} from "./language-dialog.ts";
import {
  commandForMenuText,
  helpKeyboard,
  isMenuCommand,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "./main-menu.ts";
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
import type { LocationQualityHints } from "./types.ts";
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
import { waitingLine } from "./waiting-lines.ts";

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
   * حدود تقييم إصلاحة GPS النافذة. اختياريّ لا لأنّ غيابه مقبولٌ في الإنتاج —
   * الحاوية تُمرّره دائماً واختبارُ ربطٍ يُثبت ذلك — بل لأنّ اختبارات الحوار
   * القائمة لا شأن لها بحدود الأجهزة، وغيابه يعني افتراض المجال لا سلوكاً ثانياً.
   *
   * وكان الموضع هنا يستدعي `DEFAULT_GPS_POLICY` مرمَّزاً، فمتغيّرات
   * `TRACKING_*` المُعلَنة في `render.yaml` لم يكن لها أثرٌ على المسار الحيّ
   * الوحيد للمواقع. هذا الحقل هو الطريق الذي تسلكه فعلاً.
   */
  readonly gpsPolicy?: GpsPolicy;
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
   * المحاولةُ الفوريّة لإعادة عرض الطلبات الباحثة — المرحلة ١٤.
   *
   * القياسُ على قاعدةٍ حقيقية: سائقٌ موثَّقٌ متاحٌ بلا موقع، وراكبٌ يطلب فلا يجد
   * أحداً. ثم يُرسل السائق موقعَه فيصير مؤهّلاً تماماً — ويُقال له «أنت الآن ظاهر
   * للطلبات فعلاً» — والطلبُ الذي ينتظره يبقى بصفر عروضٍ إلى الأبد، لأنّ
   * `broadcastOffers` لم تُنادَ إلّا عند إنشاء الطلب. فالرسالةُ كانت كذباً في حقّ
   * راكبٍ ينتظر بالفعل، والسائقُ يظنّ نفسه عاملاً.
   *
   * ولماذا اختياريّ؟ بنفس منطق `negotiation` و`support`: غيابُه يعني أنّ الأرضيّة
   * الدوريّة في العامل تتولّى الأمر بعد ثوانٍ، لا أنّ شيئاً يُعالَج خطأً. وهو
   * اختياريٌّ كذلك حتى لا تُعاد بناءُ عشرات الاختبارات القائمة لتبعيّةٍ لا تمسّها.
   *
   * ولا يُعاد الوعدُ صادقاً بمجرّد وجود هذا المنفذ: البثُّ الفوريّ يجري **بعد**
   * كتابة الموقع لا قبلها، فإن سقط لا يُفقَد شيءٌ — الأرضيّةُ الدوريّة شبكةُ أمانه.
   */
  readonly redispatch?: {
    /** لا يرمي ولا يُعيد خطأً: إعادةُ العرض تحسينٌ لا شرطٌ لحفظ الموقع. */
    onDriverBecameDispatchable(cityId: CityId): Promise<void>;
  };
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
  /**
   * المرحلة ٦ — النقل اللحظي. اختياري بنفس منطق ما قبله: غيابه يعني أن
   * الموقع يُحفظ ولا يُبَثّ — لا أن حفظه يفشل.
   *
   * ولماذا اختياري والنقل اللحظي مطلوب في الإنتاج؟ لأنّ فرضه يوجب على كل
   * اختبار حوار قائم أن يبني ناقلاً وجلساتٍ ليختبر زرّ تسجيل — فيصير تغيير مسار
   * التتبّع موجباً لتعديل عشرات الاختبارات التي لا تمسّه. ووصله في الحاوية
   * ثابتٌ ويحميه اختبار تكامل صريح على قاعدة حقيقية.
   */
  readonly tracking?: LiveTrackingPort;
  /**
   * المرحلة ١٢ — قارئ بطاقة الرحلة. اختياريٌّ بنفس منطق `rating` و`tracking`:
   * غيابه يجعل `/trip` يردّ «أمر غير معروف» بدل أن يعرض بطاقةً فارغة، ويُبقي
   * الاختبارات التي لا تقيس الرحلة على تهيئةٍ أصغر.
   */
  readonly tripCards?: DriverTripCardReader;
  /**
   * المرحلة ١٥ — مزوّد التوجيه لزمن الوصول. غيابه = لا سطرَ زمنٍ، ولا سطرَ
   * فشلٍ أيضاً (`NOT_CONFIGURED` يُسكت عنه) — فالبطاقة تبقى كما كانت قبل المرحلة.
   */
  readonly routing?: RoutingProvider;
  /**
   * تغييرات الاشتراك — الإلغاء والتراجع عنه وترقية الخطّة (أمر المالك 2026-08-12).
   *
   * اختياريٌّ بنفس منطق `rating` و`tracking`: غيابه يعني أنّ أزرار التغيير لا
   * تظهر في بطاقة `/subscription` أصلاً، لا أنّها تظهر ثمّ تفشل. ووصله في
   * الحاوية ثابتٌ ويحميه اختبار تكامل على قاعدة حقيقية.
   *
   * ولماذا المنفذ الذرّي مباشرةً لا مستودعُ دفعٍ معه؟ لأنّ مسار الترقية
   * المدفوعة في هذه المرحلة تحصيلٌ يدويّ عبر الدعم — لا مزوّد دفع مُعتمَد بعد
   * (§1.3 من التوجيه) — فبطاقةُ الحوار تعرض الفرق المستحقّ من القاعدة نفسها
   * ولا تُنشئ معاملةً لا سبيل لدفعها. والترقية داخل التجربة المجّانية تُطبَّق
   * فوراً لأنّها بلا مقابل فعلاً.
   */
  readonly subscriptionChanges?: SubscriptionChangeRpcPort;
  /**
   * شراء الاشتراك المدفوع من داخل البوت — مسار البيع الذاتي.
   *
   * قبل هذا كانت بطاقة `/subscription` تعرض السعر ولا تعرض زرّاً واحداً للدفع:
   * منصّةٌ كلّ دخلها اشتراكُ سائقٍ لم يكن فيها طريقٌ يسلكه السائق ليشترك، فكان
   * الدخل كلّه معلّقاً على تدخّلٍ يدويّ من الدعم لكل سائقٍ على حدة.
   *
   * اختياريٌّ بنفس منطق `subscriptionChanges`: غيابه (لغياب أسرار المزوّد) يعني
   * أنّ الزرّ لا يظهر أصلاً، لا أنّه يظهر ثمّ يفشل بعد أن يرفع توقّع السائق.
   *
   * ولا يُفعِّل البوت اشتراكاً أبداً: هو ينشئ المعاملة ويعطي رابط الدفع فقط.
   * التفعيل حقُّ الويبهوك وحده بعد إعادة قراءة الدفعة من خادم المزوّد — وإلاّ
   * كان زرٌّ في تلغرام كافياً لتفعيل اشتراكٍ لم يُدفع.
   */
  readonly subscriptionPurchase?: {
    readonly payments: PaymentRepository;
    readonly provider: PaymentProvider;
  };
  /** SOS: فتح من السائق وقرارات قروب الإسناد من بوت السائق الذي نشر البطاقة. */
  readonly safety?: {
    readonly trigger: TriggerSosDeps;
    readonly resolutions: ResolveSafetyIncidentDeps;
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

/** القائمة الدائمة بلغة الحالة الحالية — تُرفَق بكل ردّ يعود بالسائق إلى الجاهزية. */
function menu(state: DialogState): Keyboard {
  return mainMenuKeyboard("driver", languageOf(state));
}

/**
 * طلب الرقم ومعه القائمة تحته — البند 4.3.
 * خطوة الرقم أكثر مواضع تعثّر السائق الجديد (رقم مكتوب، بطاقة غيره، رقم دولي،
 * خصوصية تمنع مشاركة الرقم) — وكانت لوحتها تمحو زرّ الدعم وزرّ اللغة معاً.
 */
function phoneRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_contact", label: t(languageOf(state))("driver.share_phone_button") },
    "driver",
    languageOf(state),
  );
}

/** طلب الموقع ومعه القائمة تحته — لنفس سبب `phoneRequest`. */
function locationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(languageOf(state))("driver.share_location_button") },
    "driver",
    languageOf(state),
  );
}

/**
 * البند 2.4 — لوحة خطوة المنطقة المفضّلة.
 *
 * الخطوة اختيارية، فيجب أن يكون مخرجها ظاهراً بقدر ظهور مدخلها: زرّ «تخطّي»
 * inline على الرسالة نفسها. بلا زرٍّ صريح يبقى السائق الجديد أمام سؤالٍ يظنّه
 * إلزامياً في آخر خطوة من تسجيله — وهي أسوأ لحظة يُترك فيها حائراً.
 */
function preferredAreaSkipKeyboard(state: DialogState): Keyboard {
  return {
    kind: "inline",
    rows: [
      [{ label: t(languageOf(state))("driver.preferred_area_skip_button"), data: "area:skip" }],
    ],
  };
}

/** طلب نقطة المنطقة ومعه القائمة تحته — لنفس سبب `locationRequest`. */
function preferredAreaLocationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(languageOf(state))("driver.preferred_area_pin_button") },
    "driver",
    languageOf(state),
  );
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
      return [reply(sender, t(languageOf(state))("driver.phone_not_yours"), phoneRequest(state))];
    }
    return handlePhone(update.phone, sender, state, deps);
  }
  if (update.kind === "location")
    return handleLocation(update.location, sender, state, deps, update.quality);
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

  // زرّ القائمة الدائمة يصل نصّاً لا بيانات (Reply Keyboard)، فيُترجَم إلى أمره هنا —
  // **قبل** أي فحص خطوة، وهو ما يطلبه البند 4.3: ضغطة واحدة في كل الحالات.
  // ولو تأخّر لصار زرّ «الدعم» يُسجَّل رقمَ لوحة السائق أو اسمَه في منتصف التسجيل.
  const fromMenu = commandForMenuText("driver", text);
  if (fromMenu !== null) return handleCommand(fromMenu, sender, state, deps);

  switch (state.step) {
    case "awaiting_name":
      return handleName(text, sender, state, deps);
    case "awaiting_phone":
      /**
       * رقم مكتوب بلا زرّ = رقم غير مثبَت لصاحبه. لا نرفضه بعد تخزينه بل قبله:
       * ما يُخزَّن في `driver.phone` يجب أن يكون مضموناً بتلغرام دائماً.
       */
      return [
        reply(sender, t(languageOf(state))("driver.phone_must_use_button"), phoneRequest(state)),
      ];
    case "awaiting_plate_number":
      return handlePlateNumber(text, sender, state, deps);
    case "awaiting_national_id":
      return handleNationalId(text, sender, state, deps);
    case "awaiting_vehicle_photo":
      // نصٌّ حيث تُنتظر صورة: يُقال له إنه يحتاج صورة فعلية، لا "أمر غير معروف".
      return [reply(sender, t(languageOf(state))("driver.vehicle_photo_required"))];
    case "awaiting_preferred_area_label": {
      /**
       * خطوة المنطقة المفضّلة **اختيارية ومفتوحة زمنياً**: التسجيل يتركه فيها
       * ولا شيء يُخرجه منها إلّا تخطٍّ صريح. والتفاوض **إلزامي ومحدود بمهلة**.
       * لو بقيت الأولوية للخطوة الاختيارية لابتلعت كل نصّ حرّ من سائق حديث
       * التسجيل، فلا تصل رسالة تفاوض واحدة إلى العميل حتى تنتهي المهلة.
       * لذلك: إن كان له دور تفاوض مفتوح فالنصّ له، وإلّا فهو اسم الحيّ كما كان.
       */
      const relayed = await relayIfNegotiating(text, sender, state, deps);
      if (relayed !== null) return relayed;
      return handlePreferredAreaLabel(text, sender, state, deps);
    }
    case "awaiting_preferred_area_location":
      // إحداثية مكتوبة يدوياً لا تُقبل: نقطة تلغرام مضمونة الشكل، والنصّ ليس كذلك
      return [
        reply(
          sender,
          t(languageOf(state))("driver.preferred_area_needs_pin"),
          preferredAreaLocationRequest(state),
        ),
      ];
    case "awaiting_support_message":
      return deps.support === undefined
        ? [reply(sender, t(languageOf(state))("common.unknown_command"))]
        : submitSupportMessage(
            { message: text, attachmentFileId: null },
            sender,
            state,
            deps.support,
          );
    default: {
      // قبل ردّ "أمر غير معروف": إن كان السائق طرفاً في تفاوض نشط، فهذا نصّ موجّه للعميل
      const relayed = await relayIfNegotiating(text, sender, state, deps);
      return relayed ?? [reply(sender, t(languageOf(state))("common.unknown_command"))];
    }
  }
}

/**
 * نصّ حرّ من سائق: يُمرّر للعميل إن كان دوره في التفاوض مفتوحاً.
 *
 * القيمة `null` تعني "لا تفاوض نشط لهذا السائق" — وهي إشارة للمنادي بأن يتصرّف
 * في النصّ بمنطقه هو (اسم حيّ، أو ردّ "أمر غير معروف"). التمييز مقصود: الدالة
 * لم تعد تفترض أن غياب التفاوض يساوي أمراً مجهولاً، لأنها صارت تُنادى من خطوة
 * حوار قائمة أيضاً لا من الحالة الافتراضية وحدها.
 * من ليس طرفاً في تفاوض نشط لا تُمرّر رسالته — وهذا ما يمنع مخاطبة العميل خارج الدور.
 */
async function relayIfNegotiating(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[] | null> {
  const tr = t(languageOf(state));
  const negotiation = deps.negotiation;
  if (negotiation === undefined) return null;

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return null;

  const relayed = await relayNegotiationMessage(
    { from: "driver", driverId: driver.id, riderId: null, text },
    negotiation.relay,
  );
  if (!relayed.ok) return technicalFailure(sender, state);

  const report = relayed.value;
  if (report.reason === "NO_ACTIVE_NEGOTIATION" || report.reason === "EMPTY_MESSAGE") {
    return null;
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
    /**
     * البند 2.4 — `/area` لمن سجّل قبل وجود هذه الخطوة، ولمن غيّر حيّه.
     *
     * بلا هذا الأمر تكون المنطقة المفضّلة حكراً على من يسجّل بعد اليوم، ويبقى
     * كل سائق قائم في القاعدة بلا سبيل إليها إلّا حذف حسابه وإعادة إنشائه.
     */
    case "/area": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const started = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_preferred_area_label",
        draftPreferredAreaLabel: null,
      });
      if (!started.ok) return technicalFailure(sender, state);
      return [
        reply(sender, tr("driver.preferred_area_ask_label"), preferredAreaSkipKeyboard(state)),
      ];
    }

    case "/city": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const cities = await deps.cities.listActive();
      if (!cities.ok) return technicalFailure(sender, state);
      if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_city_change",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("city.change.prompt"), cityKeyboard(cities.value))];
    }

    case "/start": {
      if (driver !== null) {
        return [
          reply(sender, tr("driver.already_registered", { name: driver.fullName }), menu(state)),
        ];
      }
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      // القائمة تُرفق بالترحيب لا بطلب الاسم: تلغرام يُبقي لوحة الردّ معروضة ما لم
      // تُستبدل أو تُحذف، فتبقى معه من أول رسالة — وزرّ اللغة أول ما يحتاجه من لا
      // يقرأ العربية، وهو أحوج الناس إليه وأقلّهم قدرةً على معرفة أمر /language.
      return [
        reply(sender, tr("driver.welcome"), menu(state)),
        reply(sender, tr("driver.ask_name")),
      ];
    }

    /**
     * البند 6.3: الأوامر أزراراً لا نصّاً. اللوحة الأولى inline على الرسالة نفسها،
     * ولا تمسح الدائمة لأن تلغرام يفصل بين لوحة الرسالة ولوحة أسفل الشاشة —
     * والثانية تُعيد تأكيد الدائمة، إذ `/help` أوّل ما يلجأ إليه من ضاعت لوحته.
     */
    case "/help":
      return [
        // الشرحُ قبل قائمةِ الأوامر: من يطلب المساعدة لا يعرف ماذا يفعل أصلاً، وقائمةُ
        // أزرارٍ بلا شرحٍ تُخبره بما يستطيع الضغطَ عليه لا بما هو مطلوبٌ منه — وأكثرُ
        // ما يُسقط سائقاً جديداً أنّه لا يعلم أنّ «متاح» شرطٌ لوصول الطلبات إليه.
        reply(sender, tr("driver.guide")),
        reply(sender, tr("driver.help"), helpKeyboard("driver", languageOf(state))),
        reply(sender, tr("menu.hint"), menu(state)),
      ];

    case "/language":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCommand(sender, languageOf(state));

    case "/cancel": {
      await deps.sessions.clear(sender.telegramUserId);
      // كان يرسل `remove` فيُخلي أسفل الشاشة تماماً. وإلغاء خطوة ليس خروجاً من
      // البوت: إزالة القائمة هنا تجعل أكثر لحظة يحتاج فيها المستخدم زرّاً أخلى لحظة
      // منها، وتنقض مطلب البند 4.3 صراحةً: زرّ الدعم في كل الحالات.
      return [reply(sender, tr("common.cancelled"), menu(state))];
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

      /**
       * المرحلة ١٢ — الخروج من الخدمة يُغلق جلسة التتبّع.
       *
       * وقبله كان السائق يضغط «أوقف استقبال الطلبات» فيُجاب «أوقفت»، وتبقى
       * جلسته مفتوحةً في `tracking_sessions` فيُرى على خريطة العمليات حيّاً — والاستعلام
       * يقرأ `ended_at is null` لا الإتاحة. والنداء **بعد** نجاح الكتابة لا قبلها:
       * إغلاق جلسةٍ لخروجٍ لم يُكتب يُنزل السائق من الخريطة وهو في الخدمة فعلاً.
       */
      if (!goingAvailable) await deps.tracking?.onDutyEnded(driver.id);

      // لا نقول «أنت الآن متاح» لمن لا موقع له. استعلام المرشّحين يشترط
      // سبب رفض `NO_LOCATION` في الدومين، فسائقٌ متاحٌ بلا موقع لا تُحسَب له مسافة
      // فلا يُسنَد إليه شيء. وقد وقع هذا فعلاً في الإنتاج: سائق موثَّق ومتاح ومشترك،
      // ولم يصله طلب واحد، وهو يظنّ نفسه عاملاً — لأن البوت أخبره بذلك.
      // فالرسالة الآن تقول الحقيقة، والطلب يصير خطوةً ناقصة لا حاشية.
      // (شرط SQL القديم `last_location is not null` رُفع في البند 2.3 ليظهر السبب
      // للمشغّل بدل أن يختفي السائق صامتاً؛ والحجب عن الإسناد باقٍ كما هو.)
      const replies: BotReply[] = [];

      if (goingAvailable && !driver.hasLocation) {
        replies.push(reply(sender, tr("driver.available_needs_location")));
        replies.push(reply(sender, tr("driver.ask_location"), locationRequest(state)));
      } else {
        replies.push(
          reply(
            sender,
            // الدخولُ إلى الخدمة لحظةُ انتظارٍ أيضاً: السائقُ ينتظر أوّل طلب. والبذرةُ
            // معرّفُه مع الدقيقة فيختلف السطرُ بين نوبةٍ وأخرى ولا يثبت على جملةٍ واحدة.
            goingAvailable
              ? waitingLine(
                  "driverAvailable",
                  `${driver.id}:${Math.floor(Date.now() / 60000)}`,
                  languageOf(state),
                )
              : tr("driver.now_unavailable"),
            menu(state),
          ),
        );
      }

      if (goingAvailable) {
        const live = await liveSubscription(deps, driver.id);
        if (live === null) {
          // اسم الزرّ يُقرأ من مفتاحه لا يُكتب في النصّ: نصٌّ يسمّي زرّاً ثم يتغيّر الزرّ يكذب
          replies.push(
            reply(
              sender,
              tr("driver.no_live_subscription", {
                subscription_button: tr("menu.driver.subscription"),
              }),
            ),
          );
        }
      }
      return replies;
    }

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (driver === null) return [reply(sender, tr("support.not_registered"), menu(state))];
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: true });
    }
    case "/sos": {
      if (deps.safety === undefined || deps.tripCards === undefined) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const trip = await deps.tripCards.cardOf({ driverId: driver.id });
      if (trip === null) return [reply(sender, tr("safety.no_active_order"), menu(state))];
      const raised = await triggerSos(
        {
          orderId: trip.trip.tripId,
          actorTelegramId: sender.telegramUserId,
          reporterRole: "driver",
        },
        deps.safety.trigger,
      );
      if (!raised.ok) return [reply(sender, tr("common.error_try_again"))];
      return [
        reply(
          sender,
          tr(raised.value.created ? "safety.sent" : "safety.already_sent"),
          menu(state),
        ),
      ];
    }

    case "/activate": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleActivateCommand(command, sender, state, deps.support);
    }

    case "/subscription": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return describeSubscription(sender, state, driver, deps);
    }

    /**
     * المرحلة ١٢ — `/trip`: أين أنا، وإلى أين، وكم بقي.
     *
     * قبله كان `/trip` و`/mytrip` و`/route` و`/map` كلّها تردّ «لم أفهم هذه
     * الرسالة» — قياساً بمسبار تنفيذٍ لا استنتاجاً. فالسائق الذي نسي وسم
     * الانطلاق لم يكن له سبيلٌ إلى استرجاعه إلا بالعودة إلى رسالةٍ قديمة في
     * محادثةٍ تتحرّك، أو بمكالمة الراكب.
     *
     * ولا يُقرأ `driver.id` من رسالةٍ ولا من زرّ: القارئ يسأل «ما رحلة هذا
     * السائق؟» فالعلاقة تُثبَت في الخادم (المرحلة ١).
     */
    case "/trip": {
      if (deps.tripCards === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return tripCardReplies(
        sender,
        state,
        { driverId: driver.id },
        deps.tripCards,
        deps.routing ?? null,
        menu(state),
      );
    }

    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/** أزرار قروب الإسناد: تسجل قرار إنسان فقط، ولا تتخذ أي قرار من محتوى الحادث. */
async function handleSafetyGroupAction(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [action, incidentId] = parts;
  if (deps.safety === undefined || incidentId === undefined || incidentId === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const mapped =
    action === "claim"
      ? "claim"
      : action === "close"
        ? "close"
        : action === "block"
          ? "block_reporter"
          : null;
  if (mapped === null) return [reply(sender, tr("common.unknown_command"))];
  const resolved = await resolveSafetyIncident(
    { incidentId, actorTelegramId: sender.telegramUserId, action: mapped },
    deps.safety.resolutions,
  );
  if (!resolved.ok) {
    const key =
      resolved.error.detail === "ACTOR_NOT_AUTHORIZED"
        ? "safety.not_authorized"
        : "safety.already_handled";
    return [{ chatId: sender.telegramUserId, text: tr(key), keyboard: null }];
  }
  if (mapped === "claim")
    return [reply(sender, tr("safety.claimed", { actor: sender.telegramUserId }))];
  return [reply(sender, tr(mapped === "block_reporter" ? "safety.blocked" : "safety.closed"))];
}

async function liveSubscription(deps: DriverBotDependencies, driverId: DriverId) {
  const found = await deps.subscriptions.findLive(driverId);
  if (!found.ok || found.value === null) return null;
  return isSubscriptionLive(found.value, deps.clock.now()) ? found.value : null;
}

/**
 * تاريخٌ لم تُعِده القاعدة لا يُخترع ولا يُترك فارغاً في نصٍّ يقرأه السائق:
 * الشرطة تقول «غير معروف» بلا إيهامٍ بيومٍ بعينه.
 */
const UNKNOWN_DATE = "—";

/** التاريخ يوماً واحداً بلا ساعة — الساعة تُوهم السائق بدقّةٍ لا تخدمه في قرارٍ يوميّ. */
function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * أزرار بطاقة الاشتراك. تُبنى من حالة الصفّ لا من ذاكرة الحوار: ما يُعرض على
 * السائق هو ما في القاعدة لحظةَ العرض، فلا يظهر «إلغاء» لمن ألغى، ولا
 * «ترقية» لمن هو على الخطّة الشاملة أصلاً.
 */
function subscriptionActionsKeyboard(
  subscription: Subscription,
  state: DialogState,
  deps: DriverBotDependencies,
): Keyboard | null {
  if (deps.subscriptionChanges === undefined) return null;
  const tr = t(languageOf(state));
  const rows: { readonly label: string; readonly data: string }[][] = [];
  // من طلب الإلغاء لا يُعرض عليه أن يزيد ما يدفع: يُقدَّم له التراجع أولاً،
  // ثم تظهر الترقية في بطاقةٍ تالية. وعرضُ الاثنين معاً يبيع لمن يودّع.
  if (subscription.plan !== "both" && !subscription.cancelAtPeriodEnd) {
    rows.push([{ label: tr("driver.subscription_upgrade_button"), data: "sub:upgrade:both" }]);
  }
  rows.push(
    subscription.cancelAtPeriodEnd
      ? [{ label: tr("driver.subscription_resume_button"), data: "sub:resume" }]
      : [{ label: tr("driver.subscription_cancel_button"), data: "sub:cancel" }],
  );
  return { kind: "inline", rows };
}

/**
 * أزرار تغييرات الاشتراك — البادئة `sub`.
 *
 * ولا يُقرأ معرّف السائق من الزرّ ولا من نصّ الرسالة: العلاقة تُثبَت في الخادم
 * من معرّف تلغرام، وإلا كان زرّاً منسوخاً كافياً لإلغاء اشتراك غيره.
 */
async function handleSubscriptionChange(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const changes = deps.subscriptionChanges;
  const [action, ...tail] = rest;
  // الشراء مستقلٌّ عن `subscriptionChanges`: منصّةٌ مركّبٌ فيها الدفع دون منفذ
  // تغييرات الاشتراك كانت ستفقد البيع كلَّه لأجل تبعيّةٍ لا يحتاجها الشراء.
  if (action !== "buy" && changes === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  if (action === "buy") {
    return handleSubscriptionPurchase(tail[0], sender, state, driver, deps);
  }
  if (changes === undefined) return [reply(sender, tr("common.unknown_command"))];

  switch (action) {
    case "cancel":
      return tail[0] === "yes"
        ? confirmCancellation(sender, state, driver, changes, deps)
        : askCancellationConfirmation(sender, state, driver, deps);
    case "resume":
      return applyResume(sender, state, driver, changes);
    case "upgrade":
      return handleUpgradeButton(tail, sender, state, driver, changes, deps);
    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/**
 * الإلغاء لا يقع بضغطةٍ واحدة: زرٌّ واحد بين السائق وبين توقّف رزقه خطرٌ لا
 * يُبرّره اختصارُ خطوة، والخطوة الثانية تقول له بالنصّ ما يخسره ومتى.
 */
async function askCancellationConfirmation(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const live = await liveSubscription(deps, driver.id);
  const until = live === null ? null : (live.currentPeriodEnd ?? live.trialEndsAt);
  if (until === null) {
    return [reply(sender, tr("driver.subscription_change_no_live"), menu(state))];
  }
  return [
    reply(sender, tr("driver.subscription_cancel_confirm", { until: dayOf(until) }), {
      kind: "inline",
      rows: [[{ label: tr("driver.subscription_cancel_confirm_button"), data: "sub:cancel:yes" }]],
    }),
  ];
}

async function confirmCancellation(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const outcome = await cancelSubscription({ driverId: driver.id }, { changes });
  if (!outcome.ok) {
    return outcome.error.detail === "NO_LIVE_SUBSCRIPTION"
      ? [reply(sender, tr("driver.subscription_change_no_live"), menu(state))]
      : technicalFailure(sender, state);
  }
  const value = outcome.value;
  // `serviceUntil` يكون فارغاً داخل التجربة المجّانية بلا دورة مدفوعة: يُقرأ
  // حينها من نهاية التجربة، ولا يُخترع تاريخٌ لم تُعِده القاعدة.
  const live = value.serviceUntil === null ? await liveSubscription(deps, driver.id) : null;
  const until = value.serviceUntil ?? live?.trialEndsAt ?? null;
  const params = { until: until === null ? UNKNOWN_DATE : dayOf(until) };
  return [
    reply(
      sender,
      value.alreadyCancelled
        ? tr("driver.subscription_cancel_already", params)
        : tr("driver.subscription_cancelled", params),
      menu(state),
    ),
  ];
}

async function applyResume(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const outcome = await resumeSubscription({ driverId: driver.id }, { changes });
  if (!outcome.ok) {
    return outcome.error.detail === "NO_LIVE_SUBSCRIPTION"
      ? [reply(sender, tr("driver.subscription_change_no_live"), menu(state))]
      : technicalFailure(sender, state);
  }
  return [
    reply(
      sender,
      outcome.value.alreadyActive
        ? tr("driver.subscription_resume_already")
        : tr("driver.subscription_resumed"),
      menu(state),
    ),
  ];
}

/**
 * الترقية خطوتان: عرضُ سعرٍ يُقرأ من القاعدة، ثمّ تأكيد.
 *
 * والفرقُ المعروض لا يُحسب في هذه الطبقة أبداً: `plan_upgrade_quote` تقرأ
 * `platform_settings`، فلا يختلف الرقمُ الذي يراه السائق عن الرقم الذي
 * تتحقّق منه الترقية في القاعدة.
 */
async function handleUpgradeButton(
  tail: readonly string[],
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const confirmed = tail[0] === "confirm";
  const planRaw = confirmed ? tail[1] : tail[0];
  if (planRaw !== "both" && planRaw !== "transport" && planRaw !== "delivery") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const newPlan: SubscriptionPlan = planRaw;

  const quoted = await changes.quoteUpgrade(driver.id, newPlan);
  if (!quoted.ok) return technicalFailure(sender, state);
  const quote = quoted.value;
  if (!quote.ok) {
    switch (quote.error) {
      case "NO_LIVE_SUBSCRIPTION":
        return [reply(sender, tr("driver.subscription_change_no_live"), menu(state))];
      case "ALREADY_ON_PLAN":
        return [
          reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state)),
        ];
      case "PLAN_NOT_AN_UPGRADE":
      case "UPGRADE_PRICE_NOT_HIGHER":
        return [reply(sender, tr("driver.subscription_upgrade_not_available"), menu(state))];
      default:
        return technicalFailure(sender, state);
    }
  }

  const until = quote.periodEnd === null ? UNKNOWN_DATE : dayOf(quote.periodEnd);

  // المسار المدفوع. مزوّد الدفع مُركَّبٌ أو لا، وهذا هو الفرق:
  //
  //   • مُركَّب: يُنشأ طلب دفعٍ حقيقيّ عبر حالة الاستخدام `upgradePlan`، فيصل
  //     السائق إلى رابط دفعٍ ويُطبَّق فرقُ الخطّة داخل `confirm_payment` نفسها.
  //     وحالةُ الاستخدام هي المكان الوحيد الذي يُنشئ معاملةً ويستدعي المزوّد:
  //     تكرارُ ذلك هنا كان سيصير مسارَ ترقيةٍ ثانياً بمفتاح إيدمبوتنسي مختلف،
  //     وهو تحديداً ما يُنتج فاتورتين للترقية الواحدة.
  //   • غير مُركَّب: يبقى النصّ صادقاً — تحصيلٌ يدويّ عبر الدعم. ولا تُنشأ
  //     معاملةٌ معلّقة لا سبيل إلى دفعها فتبقى في القاعدة سجلّاً لا يُغلق.
  if (quote.paymentRequired) {
    const money = { amount: quote.amountDue, currency: quote.currency ?? "" };
    const purchase = deps.subscriptionPurchase;
    if (purchase === undefined) {
      return [
        reply(
          sender,
          tr("driver.subscription_upgrade_quote_paid", { plan: newPlan, ...money, until }),
        ),
        reply(sender, tr("driver.subscription_upgrade_manual_payment", money), menu(state)),
      ];
    }
    // لا يُنشأ طلب دفعٍ بضغطةٍ واحدة: الفرق يُعرض أولاً ثم يُؤكَّد، كما في الإلغاء.
    if (!confirmed) {
      return [
        reply(
          sender,
          tr("driver.subscription_upgrade_quote_paid", { plan: newPlan, ...money, until }),
          {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("driver.subscription_upgrade_confirm_button"),
                  data: `sub:upgrade:confirm:${newPlan}`,
                },
              ],
            ],
          },
        ),
      ];
    }
    const day = deps.clock.now().toISOString().slice(0, 10);
    const outcome = await upgradePlan(
      {
        driverId: driver.id,
        cityId: driver.cityId,
        newPlan,
        // مفتاحٌ على (السائق + الخطّة + اليوم) لا على وقتٍ لحظيّ: تلغرام يعيد
        // إرسال التحديث نفسه عند تعثّر الشبكة، وضغطتان تُنتجان فرقين مستحقّين
        // لترقيةٍ واحدة لو تغيّر المفتاح بينهما.
        idempotencyKey: `driver_subscription_upgrade:${driver.id}:${newPlan}:${day}`,
      },
      { changes, payments: purchase.payments, provider: purchase.provider },
    );
    if (!outcome.ok) {
      return outcome.error.detail === "ALREADY_ON_PLAN"
        ? [reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state))]
        : technicalFailure(sender, state);
    }
    // التجربة المجّانية قد تُطبَّق مباشرةً حتى في هذا الفرع لو تغيّرت الدورة بين
    // العرض والتأكيد: تُقرأ النتيجة الفعليّة ولا يُفترض أنّها ما عُرض.
    if (outcome.value.kind === "applied") {
      const appliedUntil =
        outcome.value.periodEnd === null ? until : dayOf(outcome.value.periodEnd);
      return [
        reply(
          sender,
          tr("driver.subscription_upgraded", { plan: outcome.value.plan, until: appliedUntil }),
          menu(state),
        ),
      ];
    }
    if (outcome.value.checkoutUrl === null) {
      return [reply(sender, tr("driver.subscription_checkout_pending"), menu(state))];
    }
    return [
      reply(
        sender,
        tr("driver.subscription_upgrade_checkout", {
          plan: newPlan,
          amount: outcome.value.amountDue,
          currency: outcome.value.currency,
          url: outcome.value.checkoutUrl,
        }),
        menu(state),
      ),
    ];
  }

  // المسار المجّاني (التجربة): بلا مقابل فعلاً، فيُطبَّق ذرّياً بعد تأكيدٍ صريح.
  if (!confirmed) {
    return [
      reply(sender, tr("driver.subscription_upgrade_quote_free", { plan: newPlan }), {
        kind: "inline",
        rows: [
          [
            {
              label: tr("driver.subscription_upgrade_confirm_button"),
              data: `sub:upgrade:confirm:${newPlan}`,
            },
          ],
        ],
      }),
    ];
  }

  const applied = await changes.applyUpgrade(driver.id, newPlan, null);
  if (!applied.ok) return technicalFailure(sender, state);
  const value = applied.value;
  if (!value.ok) {
    return value.error === "ALREADY_ON_PLAN"
      ? [reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state))]
      : technicalFailure(sender, state);
  }
  // داخل التجربة لا `current_period_end`، فتاريخ الانتهاء المعروض هو نهاية
  // التجربة كما أعادها عرض السعر — لا تاريخٌ يُخترع هنا.
  const appliedUntil = value.periodEnd === null ? until : dayOf(value.periodEnd);
  return [
    reply(
      sender,
      tr("driver.subscription_upgraded", { plan: value.plan ?? newPlan, until: appliedUntil }),
      menu(state),
    ),
  ];
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
    const until = dayOf(subscription.currentPeriodEnd);
    return [
      reply(
        sender,
        subscription.cancelAtPeriodEnd
          ? tr("driver.subscription_cancel_pending", { plan: subscription.plan, until })
          : tr("driver.subscription_live", { plan: subscription.plan, until }),
        subscriptionActionsKeyboard(subscription, state, deps),
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
      // الزرّ يظهر فقط عند تركيب مزوّد دفع: عرضُ «اشترك الآن» بلا مزوّد يحوّل
      // بطاقةً صادقة إلى وعدٍ يفشل عند الضغط.
      deps.subscriptionPurchase === undefined
        ? null
        : {
            kind: "inline",
            rows: [[{ label: tr("driver.subscription_buy_button"), data: `sub:buy:${plan}` }]],
          },
    ),
  ];
}

/**
 * شراء الاشتراك: ينشئ معاملة دفعٍ ويعيد رابط الدفع المستضاف. لا يُفعِّل شيئاً.
 *
 * ومفتاح الإيدمبوتنسي مبنيّ على (السائق + الخطّة + اليوم) لا على وقتٍ لحظيّ:
 * ضغطتان متتاليتان — وتلغرام يعيد إرسال التحديث نفسه عند تعثّر الشبكة — كانتا
 * ستُنشئان فاتورتين، ومن دفعهما يخسر شهراً كاملاً لأنّ `activate_subscription`
 * يستبدل المدّة ولا يجمعها. ورابط الفاتورة الأولى محفوظٌ في المعاملة، فالضغطة
 * الثانية تستعيده بدل أن تُصطدم بمعاملةٍ معلّقة لا سبيل إلى دفعها.
 */
async function handleSubscriptionPurchase(
  requestedPlan: string | undefined,
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const purchase = deps.subscriptionPurchase;
  if (purchase === undefined) return [reply(sender, tr("common.unknown_command"))];

  // الخطّة لا تُقرأ من الزرّ إلا بعد التحقق منها: نصُّ الزرّ مُدخَلٌ من المستخدم.
  const plan: SubscriptionPlan =
    requestedPlan === "transport" || requestedPlan === "delivery" || requestedPlan === "both"
      ? requestedPlan
      : "transport";

  // من له اشتراكٌ سارٍ لا يُبَع له اشتراكٌ ثانٍ: التفعيل يستبدل المدّة، فبيعُه
  // اشتراكاً وهو مشترك يمحو ما بقي له من شهرٍ دفع ثمنه.
  const live = await deps.subscriptions.findLive(driver.id);
  if (!live.ok) return technicalFailure(sender, state);
  if (live.value !== null && isSubscriptionLive(live.value, deps.clock.now())) {
    return describeSubscription(sender, state, driver, deps);
  }

  const settings = await citySettingsOf(deps, driver);
  if (settings === null) return technicalFailure(sender, state);

  const day = deps.clock.now().toISOString().slice(0, 10);
  const outcome = await subscribePlan(
    {
      driverId: driver.id,
      cityId: driver.cityId,
      plan,
      idempotencyKey: `driver_subscription:${driver.id}:${plan}:${day}`,
    },
    {
      payments: purchase.payments,
      provider: purchase.provider,
      // السعر من `platform_settings` عبر المدينة لا من الكود، ويُحوَّل إلى الوحدة
      // الصغرى: `Money.amount` بالهلّات، وتمرير 400 مباشرةً كان سيبيع اشتراكاً
      // بأربعة ريالات.
      priceReader: async () =>
        ok({
          amount: Math.round(subscriptionPriceFor(settings, plan) * 100),
          currency: settings.currency,
        }),
    },
  );

  if (!outcome.ok) return technicalFailure(sender, state);
  if (outcome.value.checkoutUrl === null) {
    return [reply(sender, tr("driver.subscription_checkout_pending"), menu(state))];
  }

  return [
    reply(
      sender,
      tr("driver.subscription_checkout", {
        plan,
        price: subscriptionPriceFor(settings, plan),
        currency: settings.currency,
        url: outcome.value.checkoutUrl,
      }),
      menu(state),
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

  return [reply(sender, tr("driver.ask_phone"), phoneRequest(state))];
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
    // البند 4.3: إزالة اللوحة هنا كانت تسلب السائق زرّ الدعم في عطلٍ ليس من فعله
    // («لا مدينة عاملة» خلل تشغيلي عندنا)، وهي بالضبط الحالة التي يجب أن يشتكي فيها.
    return [reply(sender, tr("common.no_active_city"), menu(state))];
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
    // البند 6.3: زرّ أمرٍ من لوحة `/help` — يمرّ بنفس موجّه الأوامر لا بمسار ثانٍ
    case "cmd": {
      const command = rest.join(":");
      if (!isMenuCommand("driver", command)) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      return handleCommand(command, sender, state, deps);
    }
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
    // البند 2.4: تخطّي المنطقة المفضّلة — خطوة اختيارية يجب أن يكون لها مخرج ظاهر
    case "area":
      return rest[0] === "skip"
        ? skipPreferredArea(sender, state, deps)
        : [reply(sender, tr("common.unknown_command"))];
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
    // تغييرات الاشتراك: الإلغاء والتراجع عنه والترقية — أمر المالك 2026-08-12.
    case "sub":
      return handleSubscriptionChange(rest, sender, state, deps);
    case "sup": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      const [action, ...tail] = rest;
      if (action === "type") {
        return handleSupportTypeChoice(tail.join(":"), sender, state, deps.support);
      }
      return handleSupportGroupAction(rest, sender, state, deps.support);
    }
    case "sos":
      return handleSafetyGroupAction(rest, sender, state, deps);
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

  // فرع تغيير المدينة بعد التسجيل — للانتقال والسفر
  if (state.step === "awaiting_city_change") {
    return handleCityChange(cityIdRaw, sender, state, deps);
  }

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

/**
 * تغيير مدينة السائق بعد التسجيل — للانتقال والسفر.
 * يستدعي RPC ذرّياً ويعيد السائق إلى الجاهزية.
 */
async function handleCityChange(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);

  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  // نحتاج معرّف السائق — نقرأه من الملف
  const driver = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!driver.ok) return technicalFailure(sender, state);
  if (driver.value === null) return [reply(sender, tr("driver.must_register_first"))];

  const result = await deps.drivers.changeCity(driver.value.id, city.id);
  if (!result.ok) return technicalFailure(sender, state);

  // العودة إلى الجاهزية
  await deps.sessions.clear(sender.telegramUserId);

  if (!result.value.ok) {
    if (result.value.error === "ACTIVE_ORDER_IN_PROGRESS") {
      return [reply(sender, tr("city.change.active_order"), menu(state))];
    }
    return [reply(sender, tr("city.change.failed"), menu(state))];
  }

  // same=true يعني أنّ المدينة لم تتغير
  return [reply(sender, tr("city.change.success", { city: city.name }), menu(state))];
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
      // البند 4.3: رفضٌ مفهوم لا خروج من البوت — ومن رُفض لازدواج هويّة هو أوّل
      // من يحتاج زرّ الدعم، فإزالة اللوحة كانت تسدّ عليه الطريق الوحيد للاعتراض.
      return [reply(sender, tr("driver.national_id_taken"), menu(state))];
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

  /**
   * البند 2.4: الجلسة **لا** تُمسح هنا كما كانت، بل تُحوَّل إلى الخطوة الاختيارية.
   * الصفّ كُتب فعلاً قبل هذا السطر، فسقوط الخطوة الاختيارية أو تخطّيها لا يكلّف
   * السائق شيئاً — وهذا هو سبب وضعها بعد الكتابة لا قبلها.
   */
  const areaStep = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_preferred_area_label",
    draftPreferredAreaLabel: null,
  });

  const cities = await deps.cities.listActive();
  const cityName = cities.ok
    ? (cities.value.find((c) => c.id === state.draftCityId)?.name ?? "")
    : "";

  const replies: BotReply[] = [
    // كان `remove`: فينتهي التسجيل بإخلاء أسفل الشاشة تماماً، فيبقى السائق الجديد
    // ولا يعرف ما يفعل بعدها — وهي أحرج لحظة في رحلته كلّها. ومن أجلها القائمة.
    reply(
      sender,
      tr("driver.registered", { name: registered.value.fullName, city: cityName }),
      mainMenuKeyboard("driver", languageOf(state)),
    ),
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

  /**
   * سؤال المنطقة **آخر** الردود لا وسطها: خبر بدء التجربة المجانية هو ما ينتظره
   * السائق، ووضعُ سؤالٍ اختياري قبله يدفنه. ويُطرح فقط إن نجح حفظ الجلسة —
   * طرحُه مع جلسةٍ لم تُحفَظ يجعل جواب السائق يسقط في الفراغ ثم يُردّ عليه
   * بـ«أمر غير معروف». ومن لم يُسأل يبقى بلا منطقة، وهي الحال الافتراضية أصلاً.
   */
  if (areaStep.ok) {
    replies.push(
      reply(sender, tr("driver.preferred_area_ask_label"), preferredAreaSkipKeyboard(state)),
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
    const confirmation = reply(sender, tr("driver.offer_accepted"), keyboard);
    /**
     * المرحلة ١٢ — التأكيد يبقى، وتُلحق به البطاقة. ولماذا لا يُدمجان في رسالة؟
     * لأن زرّ «بدء الرحلة» مُعلَّقٌ على التأكيد، والدبّوس رسالةٌ منفصلة في تلغرام
     * أصلاً — فدمجُهما كان سيُنتج رسالةً واحدة طويلة يختفي زرّها تحت الدبّوس.
     *
     * وإن غاب القارئ (تهيئةٌ لا تعرض الرحلات) بقي السلوك كما كان بحرفه: تأكيدٌ
     * وزرّ. لا مسار جديد يُفرض على تركيبٍ لم يطلبه.
     */
    if (deps.tripCards === undefined) return [confirmation];
    const card = await tripCardReplies(
      sender,
      state,
      { driverId: driver.id },
      deps.tripCards,
      deps.routing ?? null,
    );
    return [confirmation, ...card];
  }

  const key =
    claim.value.reason === "offer_expired" ? "driver.offer_expired" : "driver.offer_taken";
  return [reply(sender, tr(key))];
}

/**
 * المرحلة ١٢ — بطاقة الرحلة كردودٍ جاهزة للإرسال. تُستخدم في ثلاثة مواضع:
 * `/trip`، وردّ قبول العرض، وردّ بدء الرحلة — بصيغةٍ واحدة لا ثلاث.
 *
 * وتُعيد مصفوفةً لأن «لا رحلة لك» ردٌّ واحد، والبطاقة ردٌّ واحد بدبّوس. ولا
 * تُلقي عند غياب الرحلة: السائق الذي أنهى رحلته وضغط `/trip` ليس في حالة عطل.
 */
export async function tripCardReplies(
  sender: Sender,
  state: DialogState,
  key: DriverTripKey,
  cards: DriverTripCardReader,
  routing: RoutingProvider | null,
  keyboard: Keyboard | null = null,
): Promise<BotReply[]> {
  const tr = t(languageOf(state));
  const card = await driverTripCard(key, { cards, routing });
  if (card === null) return [reply(sender, tr("driver.trip_none"), keyboard)];
  const { view, eta } = card;
  const base = reply(sender, driverTripText(view, eta, tr), keyboard);
  /**
   * الحقل يُسقَط ولا يُمرَّر `undefined`: التركيب يعمل بـ`exactOptionalPropertyTypes`،
   * فـ`mapPin: undefined` ليس كغياب `mapPin` — والمترجم أوقف هذا فعلاً.
   */
  const pin = driverTripPin(view, tr);
  return [pin === undefined ? base : { ...base, mapPin: pin }];
}

/**
 * موقع السائق يُحفظ فوراً: بلا موقع لا مطابقة، ومع موقع قديم تكون المطابقة كاذبة.
 * السائق غير المسجَّل لا يُحفظ له موقع إطلاقاً.
 */
/**
 * المرحلة ٥ — الإصلاحة السابقة للمُقيِّم. كانت `null` ثابتةً في المرحلة ٤، وهو
 * ما كان يُعطّل نصف المُقيِّم في المسار الحيّ: الإحداثيات والدقّة والزمن كانت
 * تُفحص، أمّا الإزاحة والانتقال اللحظي والسرعة المحسوبة فلا — لأنّها كلّها
 * تُقاس بين نقطتين، والثانية لم تكن تصل.
 *
 * وأثرُه العملي أن جهازاً مُزوَّراً يقفز مئتي كيلومتر بين رسالتين كان يمرّ
 * بلا أثر، فتراه المطابقة سائقاً قريباً من الراكب وهو في مدينة أخرى.
 */
function previousFixOf(driver: DriverProfile): PreviousFix | null {
  if (driver.lastFix === null) return null;
  const coordinates = makeCoordinates(driver.lastFix.latitude, driver.lastFix.longitude);
  // إحداثيةٌ محفوظةٌ فاسدة لا تُوقف الحاضر: تُهمَل كسابقةٍ فيُفحص الجديد وحده.
  if (!coordinates.ok) return null;
  return { coordinates: coordinates.value, recordedAtMs: driver.lastFix.recordedAtMs };
}

async function handleLocation(
  location: Coordinates,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
  hints?: LocationQualityHints,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const driver = existing.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  /**
   * المرحلة ٤ — المسار الحيّ صار يمرّ بمُقيِّم المجال لا بفحص الإحداثيات وحده.
   *
   * `makeCoordinates` تفحص الموضع ولا تفحص شيئاً سواه، فكانت إصلاحة بدقّة ثلاثة
   * كيلومترات وأخرى بدقّة خمسة أمتار تُكتبان في القاعدة سواءً بسواء، ثم تقرؤهما
   * المطابقة على أنهما نقطتان متساويتان في اليقين. والفصل هنا لا في المُقيِّم:
   * المُقيِّم يحكم، وهذه الطبقة تُقرّر ماذا يُفعل بالحكم.
   */
  const assessment = assessGpsFix(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: hints?.accuracyMeters,
      headingDegrees: hints?.headingDegrees,
      recordedAtMs: hints?.recordedAtMs ?? deps.clock.now().getTime(),
    },
    previousFixOf(driver),
    deps.clock.now().getTime(),
    deps.gpsPolicy ?? DEFAULT_GPS_POLICY,
  );
  if (assessment.fix === null) return [reply(sender, tr("driver.location_invalid"))];
  const coordinates = { ok: true as const, value: assessment.fix.coordinates };

  /**
   * البند 2.4: موقعٌ يصل في خطوة المنطقة المفضّلة هو مركز المنطقة لا موقع العمل
   * الحالي. الفصل هنا لا في `updateLocation`: خلطهما كان سيجعل كل تحديث موقع
   * يوميّ يُعيد رسم منطقة السائق المفضّلة، فتصير نيّتُه المعلنة ظلّاً لتحرّكه.
   */
  if (state.step === "awaiting_preferred_area_location") {
    return savePreferredArea(driver, coordinates.value, sender, state, deps);
  }

  /**
   * الحكم يُخزَّن مع الموضع لا يُطرح: WARNING تعني موقعاً صحيحاً متدهوّراً، ورفضُه
   * كان سيترك العمليات بلا شيء بدل أن يتركها بشيءٍ موسوم — وهو الاختيار الأسوأ
   * حين يكون البديل أن يختفي السائق من الخريطة.
   */
  const saved = await deps.drivers.updateLocation(driver.id, coordinates.value, {
    recordedAtMs: assessment.fix.recordedAtMs,
    accuracyMeters: assessment.fix.accuracyMeters,
    verdict: assessment.verdict === "REJECT" ? "ALERT" : assessment.verdict,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  /**
   * المرحلة ٦ — الجلسة والبثّ **بعد** استقرار الكتابة القانونية.
   *
   * وهذا هو ما كان ناقصاً فعلاً في المرحلة ٥ (الخطر R-15): الموقع كان يُكتب ولا
   * جلسة تُفتح، فلا شيء يفصل سائقاً يبثّ الآن عن سائقٍ آخر موقعٍ له قبل يومين —
   * وكلاهما صفٌّ في `drivers` له `last_location`.
   *
   * ولا `await` بلا حاجة؟ بل `await`: البثّ لا يرمي أصلاً (حاجزه داخله)، وتركُه
   * بلا انتظار كان يعني وعداً معلّقاً بعد انتهاء الطلب — وفي بيئات الحوسبة
   * الطرفية يُقتل ما لم يُنتظر، فيصير البثّ يعمل محلياً ويسقط في الإنتاج بلا أثر.
   */
  await deps.tracking?.onFix({
    driverId: driver.id,
    cityId: driver.cityId,
    latitude: assessment.fix.coordinates.latitude,
    longitude: assessment.fix.coordinates.longitude,
    recordedAtMs: assessment.fix.recordedAtMs,
    accuracyMeters: assessment.fix.accuracyMeters ?? null,
    verdict: assessment.verdict === "REJECT" ? "ALERT" : assessment.verdict,
    findings: assessment.findings.map((finding) => finding.code),
  });

  // من كان متاحاً وينقصه الموقع فقد اكتملت شروطه الآن، فيُخبَر أنه صار ظاهراً
  // فعلاً — لا «حُفظ موقعك» وحدها، فهي لا تُعلمه أن الحجب عنه ارتفع.
  const becameLive = !driver.hasLocation && driver.isAvailable;

  /**
   * البثُّ الفوريّ هنا لا في العامل وحده، لأنّ الراكب ينتظر الآن: أرضيّةٌ دوريّةٌ كلّ
   * عشرين ثانية تُصلح الإخفاق ولا تُصلح التجربة. والنداءُ **بعد** نجاح كتابة الموقع
   * لا قبلها: بثٌّ لموقعٍ لم يُكتب يعرض الطلبَ على سائقٍ لا تُحسَب له مسافة.
   *
   * وهو معلّقٌ على الانتقال `becameLive` لا على كلّ تحديثِ موقع: السائقُ الحيُّ يُرسل
   * موقعَه كلّ ثوانٍ، ومسحُ طلبات المدينة كلَّها عند كلّ نبضةٍ من كلّ سائقٍ حملٌ
   * لا مقابلَ له — أمّا الانتقالُ فيقع مرّةً في الوردية.
   */
  if (becameLive) await deps.redispatch?.onDriverBecameDispatchable(driver.cityId);
  // كان `remove` هنا. ولوحة طلب الموقع تحلّ محلّ القائمة الدائمة مأموراً — تلغرام
  // لا يعرف لوحتي ردّ في وقت واحد. فحذفها بعدها يترك السائق بلا قائمة إلى أن يكتب
  // أمراً يدوياً — وهذا هو موضع الاسترداد الوحيد: أول رسالة بعد انتهاء الحاجة.
  return [
    reply(
      sender,
      tr(becameLive ? "driver.location_saved_now_live" : "driver.location_saved"),
      menu(state),
    ),
  ];
}

/**
 * البند 2.4 — الخطوة الاختيارية الأولى: اسم المنطقة.
 *
 * لماذا الاسم قبل النقطة لا العكس؟ لأن النقطة بلا اسم لا تُراجَع: موظّف التوثيق
 * يرى إحداثية عشرية لا يعرف أصحيحة هي أم أرسلها السائق وهو في مطار. والاسم
 * أوّلاً يجعل السائق يقرّر منطقته بوعي قبل أن يضغط زرّ الموقع.
 */
async function handlePreferredAreaLabel(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseAreaLabel(raw);
  if (!parsed.ok) {
    return [
      reply(
        sender,
        tr(`driver.preferred_area_label_invalid_${parsed.error.reason}`),
        preferredAreaSkipKeyboard(state),
      ),
    ];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_preferred_area_location",
    draftPreferredAreaLabel: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(
      sender,
      tr("driver.preferred_area_ask_pin", { area: parsed.value }),
      preferredAreaLocationRequest(state),
    ),
  ];
}

/**
 * البند 2.4 — النقطة وصلت: تُكتب المنطقة كاملة وتُغلق الجلسة.
 *
 * فشل الكتابة لا يُعيد السائق إلى الخطوة: تسجيله مكتمل وحسابه يعمل، وحبسُه في
 * خطوة اختيارية بسبب عطلٍ لا يدَ له فيه عقوبةٌ على لا شيء. يُقال له إن المنطقة
 * لم تُحفَظ، وتُغلق الجلسة، وله أن يعيدها بـ/area متى شاء.
 */
async function savePreferredArea(
  driver: DriverProfile,
  location: Coordinates,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const label = state.draftPreferredAreaLabel;
  if (label === null) {
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.preferred_area_skipped"), menu(state))];
  }

  const written = await deps.drivers.setPreferredArea(driver.id, { label, location });
  await deps.sessions.clear(sender.telegramUserId);
  if (!written.ok) return [reply(sender, tr("driver.preferred_area_failed"), menu(state))];

  return [reply(sender, tr("driver.preferred_area_saved", { area: label }), menu(state))];
}

/** البند 2.4 — تخطّي صريح: لا منطقة، والترتيب بالقرب وحده كما كان. */
async function skipPreferredArea(
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  await deps.sessions.clear(sender.telegramUserId);
  return [reply(sender, t(languageOf(state))("driver.preferred_area_skipped"), menu(state))];
}

/**
 * ازدواج الهوية يصل من القاعدة كخرق قيد فريد. نميّزه بالفهرس لا بنصّ عام:
 * "duplicate key" وحدها كانت ستبتلع أي ازدواج آخر فتقول للسائق سبباً خاطئاً.
 */
function isDuplicateNationalId(error: { readonly detail?: string } | unknown): boolean {
  const detail = (error as { readonly detail?: string }).detail ?? "";
  return detail.includes("drivers_city_national_id_uniq");
}
