/**
 * الغرض: صفحة سائق واحد: ملفّ التسجيل كاملاً كما وصل من البوت، ورحلاته المكتملة،
 *   ومتوسّط تقييمه، وتذاكر النزاع المرتبطة به — في شاشة واحدة، فلا يُقرَّر في
 *   حسابه من صفٍّ في جدول عريض لا يحمل إلّا اسمه وحالته.
 * الحالة: منفّذ فعلياً — البند 6.4 من التوجيه التنفيذي.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: عند إضافة مدفوعات (البند 8) يُضاف قسم «معاملات» بنفس النمط.
 */

import { EMPTY_CELL, formatAge, formatDateTime, formatNumber, formatStars } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, metricCard, section, table } from "../layout.ts";

/**
 * إحداثيةٌ تُعرض بست منازل: الأربع الأولى تكفي لتمييز حيٍّ عن حيّ، والسادسة
 * تكفي لتمييز مبنى عن مبنى — وأكثر منها ضجيجٌ لا يقرأه أحد.
 */
const COORDINATE_DIGITS = 6;

/** حدّ الانحراف بين المتوسّط المخزَّن والمحسوب الذي يستحق تنبيهاً معروضاً. */
const RATING_DRIFT_EPSILON = 0.01;

export interface DriverDetailSubscription {
  readonly plan: string;
  readonly status: string;
  readonly trialEndsAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly priceAmount: string | null;
  readonly currency: string | null;
}

export interface DriverDetailPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface DriverDetailOrder {
  readonly orderId: string;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly matchedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly riderName: string | null;
  readonly riderStars: number | null;
}

export interface DriverDetailTicket {
  readonly ticketId: string;
  readonly type: string;
  readonly status: string;
  readonly message: string;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
  readonly claimedByName: string | null;
  /** من فتح التذكرة: السائق نفسه، أم راكبٌ في طلبٍ أُسنِد إليه. */
  readonly linkKind: "filed_by_driver" | "about_driver_order";
  readonly counterpartName: string | null;
}

export interface DriverDetailProfile {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string | null;
  readonly telegramId: string;
  readonly telegramUsername: string | null;
  readonly phone: string | null;
  readonly languageCode: string;
  readonly cityCode: string;
  readonly cityNameAr: string;
  readonly verificationStatus: string;
  readonly isBlocked: boolean;
  readonly isAvailable: boolean;
  readonly availabilityChangedAt: string | null;
  readonly nationalId: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly vehiclePhotoFileId: string | null;
  readonly preferredAreaLabel: string | null;
  readonly preferredArea: DriverDetailPoint | null;
  readonly lastLocation: DriverDetailPoint | null;
  readonly lastLocationAt: string | null;
  /** المخزَّن في `drivers` — ما تقرأه المطابقة وتُرتِّب به. */
  readonly storedRatingAverage: number | null;
  readonly storedRatingCount: number;
  /** المحسوب الآن من `ratings` — ما يستحقّه السائق فعلاً. */
  readonly liveRatingAverage: number | null;
  readonly liveRatingCount: number;
  readonly flaggedRatingCount: number;
  readonly services: readonly string[];
  readonly subscription: DriverDetailSubscription | null;
  readonly completedOrders: number;
  readonly cancelledOrders: number;
  readonly registeredAt: string;
}

/** وثيقةُ سائقٍ في صفحة التفاصيل — الحالةُ والتاريخُ والمسارُ لا البايتاتُ. */
export interface DriverDetailDocument {
  readonly docType: string;
  readonly status: string | null;
  readonly objectPath: string;
  readonly expiresAt: string | null;
  readonly reviewNote: string | null;
  readonly submittedAt: string | null;
  readonly reviewedAt: string | null;
  /** PD-042: اسمُ المسؤولِ الذي راجع — `null` إن لم يُراجَع أو حُذِفَ حسابُه. */
  readonly reviewedByName: string | null;
}

/**
 * ما يعيده الاستعلام: هو نفسه ما تعرضه الصفحة، بلا نوعٍ وسيط يُترجم بينهما —
 * الترجمة الوسيطة هي حيث يضيع حقلٌ بلا أن يشتكي المصرِّف.
 */
export interface DriverDetail {
  readonly profile: DriverDetailProfile;
  readonly orders: readonly DriverDetailOrder[];
  readonly tickets: readonly DriverDetailTicket[];
  readonly documents: readonly DriverDetailDocument[];
}

export interface DriverDetailData extends DriverDetail {
  readonly now: Date;
  readonly ticketsLimit: number;
  readonly csrfToken: string;
}

const VERIFICATION_LABEL: Readonly<Record<string, string>> = {
  pending: "بانتظار التوثيق",
  verified: "موثَّق",
  rejected: "مرفوض",
  suspended: "معلَّق",
};

const VERIFICATION_TONE: Readonly<Record<string, BadgeTone>> = {
  pending: "warn",
  verified: "ok",
  rejected: "bad",
  suspended: "bad",
};

const DOCUMENT_TYPE_LABEL: Readonly<Record<string, string>> = {
  driving_license: "رخصة القيادة",
  medical_exam: "الفحص الطبي",
  criminal_record: "السجل الجنائي",
  vehicle_registration: "استمارة السيارة",
  insurance: "التأمين",
  periodic_inspection: "الفحص الدوري",
};

const DOCUMENT_STATUS_LABEL: Readonly<Record<string, string>> = {
  received: "مُستلَمة",
  under_review: "قيد المراجعة",
  incomplete: "ناقصة",
  accepted: "مقبولة",
  rejected: "مرفوضة",
};

const DOCUMENT_STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  received: "muted",
  under_review: "warn",
  incomplete: "bad",
  accepted: "ok",
  rejected: "bad",
};

const SUBSCRIPTION_LABEL: Readonly<Record<string, string>> = {
  trialing: "شهر مجاني",
  active: "فعّال",
  expired: "منتهٍ",
  cancelled: "ملغى",
};

const SUBSCRIPTION_TONE: Readonly<Record<string, BadgeTone>> = {
  trialing: "warn",
  active: "ok",
  expired: "muted",
  cancelled: "muted",
};

const SERVICE_LABEL: Readonly<Record<string, string>> = {
  transport: "مشاوير",
  delivery: "توصيل",
  both: "الخدمتان",
};

const TICKET_TYPE_LABEL: Readonly<Record<string, string>> = {
  subscription: "اشتراك",
  ride_dispute: "نزاع رحلة",
};

const TICKET_STATUS_LABEL: Readonly<Record<string, string>> = {
  open: "مفتوحة",
  claimed: "مُستلَمة",
  resolved: "مُغلَقة",
  rejected: "مرفوضة",
};

const TICKET_STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  open: "bad",
  claimed: "warn",
  resolved: "ok",
  rejected: "muted",
};

const LANGUAGE_LABEL: Readonly<Record<string, string>> = {
  ar: "العربية",
  en: "الإنجليزية",
  ur: "الأردية",
};

function point(value: DriverDetailPoint | null): string {
  if (value === null) return EMPTY_CELL;
  const lat = value.lat.toFixed(COORDINATE_DIGITS);
  const lng = value.lng.toFixed(COORDINATE_DIGITS);
  // الرابط لا الرقم وحده: مراجعة موقعٍ تحتاج خريطة، ونسخ رقمين بالمؤشّر خطأٌ
  // ينتظر أن يقع — وقد وقع في مراجعة يدوية سابقة.
  return `<a class="mono" href="https://maps.google.com/?q=${escapeHtml(lat)},${escapeHtml(
    lng,
  )}" target="_blank" rel="noreferrer">${escapeHtml(lat)}, ${escapeHtml(lng)}</a>`;
}

function fieldRows(profile: DriverDetailProfile, now: Date): readonly (readonly string[])[] {
  const rows: (readonly string[])[] = [
    ["الاسم", escapeHtml(profile.fullName ?? "بلا اسم")],
    [
      "معرّف تلغرام",
      `<span class="mono">${escapeHtml(profile.telegramId)}</span>${
        profile.telegramUsername === null
          ? ""
          : ` <span class="card-hint">@${escapeHtml(profile.telegramUsername)}</span>`
      }`,
    ],
    [
      "الجوال",
      profile.phone === null
        ? EMPTY_CELL
        : `<span class="mono">${escapeHtml(profile.phone)}</span>`,
    ],
    ["لغة الواجهة", escapeHtml(LANGUAGE_LABEL[profile.languageCode] ?? profile.languageCode)],
    [
      "المدينة",
      `${escapeHtml(profile.cityNameAr)} <span class="card-hint mono">${escapeHtml(
        profile.cityCode,
      )}</span>`,
    ],
    [
      "الهوية الوطنية",
      profile.nationalId === null
        ? `${EMPTY_CELL} ${badge("ناقص", "warn")}`
        : `<span class="mono">${escapeHtml(profile.nationalId)}</span>`,
    ],
    [
      "نوع المركبة",
      profile.vehicleType === null
        ? `${EMPTY_CELL} ${badge("ناقص", "warn")}`
        : escapeHtml(profile.vehicleType),
    ],
    [
      "رقم اللوحة",
      profile.plateNumber === null
        ? `${EMPTY_CELL} ${badge("ناقص", "warn")}`
        : `<span class="mono">${escapeHtml(profile.plateNumber)}</span>`,
    ],
    [
      "صورة المركبة",
      profile.vehiclePhotoFileId === null
        ? `${EMPTY_CELL} ${badge("ناقصة", "warn")}`
        : `<span class="mono">${escapeHtml(profile.vehiclePhotoFileId)}</span>`,
    ],
    [
      "الخدمات المفعّلة",
      profile.services.length === 0
        ? `${EMPTY_CELL} ${badge("لا خدمة", "bad")}`
        : profile.services.map((s) => escapeHtml(SERVICE_LABEL[s] ?? s)).join(" · "),
    ],
    [
      "المنطقة المفضّلة",
      profile.preferredAreaLabel === null
        ? `${EMPTY_CELL} <span class="card-hint">يُرتَّب بالقرب اللحظي وحده</span>`
        : `${escapeHtml(profile.preferredAreaLabel)}<div class="card-hint">${point(
            profile.preferredArea,
          )}</div>`,
    ],
    [
      "آخر موقع",
      profile.lastLocation === null
        ? `${EMPTY_CELL} ${badge("لا يظهر في المطابقة بالقُرب", "bad")}`
        : `${point(profile.lastLocation)}<div class="card-hint">${escapeHtml(
            formatDateTime(profile.lastLocationAt),
          )} · ${escapeHtml(formatAge(profile.lastLocationAt, now))}</div>`,
    ],
    [
      "الإتاحة",
      `${profile.isAvailable ? badge("متاح", "ok") : badge("غير متاح", "muted")}${
        profile.availabilityChangedAt === null
          ? ""
          : `<div class="card-hint">تغيّرت ${escapeHtml(
              formatAge(profile.availabilityChangedAt, now),
            )}</div>`
      }`,
    ],
    [
      "التوثيق",
      badge(
        VERIFICATION_LABEL[profile.verificationStatus] ?? profile.verificationStatus,
        VERIFICATION_TONE[profile.verificationStatus] ?? "muted",
      ) + (profile.isBlocked ? ` ${badge("محظور", "bad")}` : ""),
    ],
    ["الاشتراك", subscriptionText(profile.subscription)],
    [
      "مسجَّل منذ",
      `${escapeHtml(formatDateTime(profile.registeredAt))} <span class="card-hint">${escapeHtml(
        formatAge(profile.registeredAt, now),
      )}</span>`,
    ],
    ["معرّف السائق", `<span class="mono">${escapeHtml(profile.driverId)}</span>`],
    ["معرّف المستخدم", `<span class="mono">${escapeHtml(profile.userId)}</span>`],
  ];
  return rows;
}

function subscriptionText(subscription: DriverDetailSubscription | null): string {
  if (subscription === null) return badge("بلا اشتراك", "muted");
  const status = badge(
    SUBSCRIPTION_LABEL[subscription.status] ?? subscription.status,
    SUBSCRIPTION_TONE[subscription.status] ?? "muted",
  );
  const plan = escapeHtml(SERVICE_LABEL[subscription.plan] ?? subscription.plan);
  const until = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
  const price =
    subscription.priceAmount === null
      ? ""
      : ` · ${escapeHtml(subscription.priceAmount)} ${escapeHtml(subscription.currency ?? "")}`;
  return `${status} <span>${plan}</span>${price}${
    until === null ? "" : `<div class="card-hint">حتى ${escapeHtml(formatDateTime(until))}</div>`
  }`;
}

/**
 * الفعلان الكتابيان هما نفس فعلَي القائمة بنفس مساراتهما ونفس دوالّهما الذرّية:
 * زرٌّ ثانٍ لنفس القرار بمسار ثانٍ يفترق يوماً عن الأول، وسجلّ التدقيق حينها
 * يصير نصف قصّة.
 */
function actions(profile: DriverDetailProfile, csrfToken: string): string {
  const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`;
  const back = `<input type="hidden" name="back" value="/admin/drivers/${escapeHtml(
    profile.driverId,
  )}">`;
  const nextVerification = profile.verificationStatus === "verified" ? "suspended" : "verified";
  const verificationLabel = profile.verificationStatus === "verified" ? "تعليق" : "توثيق";
  const suspends = nextVerification === "suspended";
  const name = profile.fullName ?? profile.telegramId;
  return `<form class="inline" method="post"${
    suspends ? ` data-confirm="${escapeHtml(`تعليقُ توثيقِ «${name}»؟`)}"` : ""
  } action="/admin/drivers/${escapeHtml(profile.driverId)}/verification">
  ${csrf}
  ${back}
  <input type="hidden" name="status" value="${escapeHtml(nextVerification)}">
  <button type="submit"${suspends ? ' class="danger"' : ""}>${escapeHtml(verificationLabel)}</button>
</form>
<form class="inline" method="post"${
    profile.isBlocked ? "" : ` data-confirm="${escapeHtml(`حظرُ حسابِ «${name}»؟`)}"`
  } action="/admin/users/${escapeHtml(profile.userId)}/blocked">
  ${csrf}
  ${back}
  <input type="hidden" name="blocked" value="${profile.isBlocked ? "0" : "1"}">
  <button class="${profile.isBlocked ? "ghost" : "danger"}" type="submit">${profile.isBlocked ? "رفع الحظر" : "حظر"}</button>
</form>`;
}

/**
 * PD-042 · نموذجُ مراجعةِ وثيقةٍ (ADR 0256) — يظهرُ للوثيقةِ المُرسَلةِ وحدَها، لأنَّ
 * الدالّةَ لا تحكمُ إلّا على `under_review`. السببُ إلزاميٌّ للرفضِ والنقصِ وتفرضُه
 * القاعدةُ لا هذا النموذجُ، والقبولُ يعتمدُ تاريخَ الانتهاءِ الذي أدخلَه السائق.
 */
function reviewForm(driverId: string, doc: DriverDetailDocument, csrfToken: string): string {
  const action = `/admin/drivers/${escapeHtml(driverId)}/documents/${escapeHtml(doc.docType)}/review`;
  const label = DOCUMENT_TYPE_LABEL[doc.docType] ?? doc.docType;
  return `<form method="post" action="${action}" class="doc-review">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <label>القرار
    <select name="decision" required>
      <option value="accepted">قبول</option>
      <option value="incomplete">ناقصة</option>
      <option value="rejected">رفض</option>
    </select>
  </label>
  <label>السبب (إلزاميٌّ للرفض والنقص)
    <input type="text" name="note" maxlength="500" aria-label="${escapeHtml(`سبب قرار ${label}`)}">
  </label>
  <button type="submit">حفظ القرار</button>
</form>`;
}

const DOCUMENT_REVIEW_NOTICE: Readonly<Record<string, string>> = {
  ok: "حُفِظ قرارُ الوثيقة وسُجِّل في سجلّ التدقيق.",
  NOT_ADMIN: "هذا الحساب لا يملك صلاحية مراجعة الوثائق.",
  INVALID_DECISION: "القرار غير صالح.",
  NOTE_REQUIRED: "الرفض أو النقص يحتاج سبباً يراه السائق.",
  NOTE_TOO_LONG: "السبب أطول من 500 حرف.",
  DOCUMENT_NOT_FOUND: "لا وثيقة بهذا النوع لهذا السائق.",
  NOT_UNDER_REVIEW: "الوثيقة ليست قيد المراجعة — ربما رُوجعت أو لم تُرسَل بعد.",
  EXPIRY_REQUIRED: "لا يُقبَل مستندٌ بلا تاريخ انتهاء.",
  DOCUMENT_EXPIRED: "الوثيقة منتهية — لا تُقبَل.",
};

/** نتيجةُ المراجعةِ كما تُعرَضُ للمسؤولِ بعدَ التحويل. الرمزُ المجهولُ «تعذّر» لا صدى. */
export function documentReviewNotice(code: string): {
  readonly kind: "ok" | "error";
  readonly text: string;
} {
  const text = DOCUMENT_REVIEW_NOTICE[code];
  if (text === undefined) return { kind: "error", text: "تعذّر حفظ القرار. أعد المحاولة." };
  return { kind: code === "ok" ? "ok" : "error", text };
}

function ratingNote(profile: DriverDetailProfile): string {
  const stored = profile.storedRatingAverage;
  const live = profile.liveRatingAverage;
  if (stored === null && live === null) return "لا تقييم بعد.";
  if (stored === null || live === null || Math.abs(stored - live) > RATING_DRIFT_EPSILON) {
    // الانحراف يُعرض لا يُخفى: المخزَّن هو ما تُرتِّب به المطابقة، والمحسوب هو
    // ما يستحقّه السائق. واختلافهما يعني أن مهمة إعادة الحساب لم تدرك تعليم
    // تقييمٍ مُسيء بعد — وهو خبرٌ للمشغّل لا تفصيلٌ داخلي.
    return "المخزَّن (وهو ما تُرتِّب به المطابقة) يخالف المحسوب الآن — تُصحِّحه مهمة إعادة الحساب الدورية.";
  }
  return "المخزَّن يطابق المحسوب.";
}

export function renderDriverDetailPage(data: DriverDetailData): string {
  const profile = data.profile;
  const name = profile.fullName ?? "سائق بلا اسم";

  const orderRows = data.orders.map((order) => [
    `<span class="mono">${escapeHtml(order.orderId)}</span>`,
    escapeHtml(SERVICE_LABEL[order.service] ?? order.service),
    order.riderName === null ? EMPTY_CELL : escapeHtml(order.riderName),
    order.pickupLabel === null ? EMPTY_CELL : escapeHtml(order.pickupLabel),
    order.dropoffLabel === null ? EMPTY_CELL : escapeHtml(order.dropoffLabel),
    order.completedAt === null
      ? EMPTY_CELL
      : `${escapeHtml(formatDateTime(order.completedAt))}<div class="card-hint">${escapeHtml(
          formatAge(order.completedAt, data.now),
        )}</div>`,
    order.riderStars === null
      ? `${EMPTY_CELL} <span class="card-hint">لم يُقيَّم</span>`
      : `${formatStars(order.riderStars)} <span class="card-hint">${formatNumber(
          order.riderStars,
        )}</span>`,
  ]);

  const documentRows = data.documents.map((doc) => [
    escapeHtml(DOCUMENT_TYPE_LABEL[doc.docType] ?? doc.docType),
    doc.status === null
      ? EMPTY_CELL
      : badge(
          DOCUMENT_STATUS_LABEL[doc.status] ?? doc.status,
          DOCUMENT_STATUS_TONE[doc.status] ?? "muted",
        ),
    doc.expiresAt === null
      ? EMPTY_CELL
      : `${escapeHtml(doc.expiresAt)}<div class="card-hint">${
          doc.reviewNote === null ? "" : escapeHtml(doc.reviewNote)
        }</div>`,
    doc.submittedAt === null
      ? EMPTY_CELL
      : `${escapeHtml(formatDateTime(doc.submittedAt))}<div class="card-hint">${escapeHtml(
          formatAge(doc.submittedAt, data.now),
        )}</div>`,
    doc.reviewedAt === null
      ? EMPTY_CELL
      : `${escapeHtml(formatDateTime(doc.reviewedAt))}<div class="card-hint">${
          doc.reviewedByName === null ? "" : escapeHtml(doc.reviewedByName)
        }</div>`,
    `<a href="/admin/drivers/${escapeHtml(data.profile.driverId)}/documents/${escapeHtml(doc.docType)}">عرض</a>${
      doc.status === "under_review" ? reviewForm(data.profile.driverId, doc, data.csrfToken) : ""
    }`,
  ]);

  const ticketRows = data.tickets.map((ticket) => [
    `<span class="mono">${escapeHtml(ticket.ticketId)}</span>`,
    escapeHtml(TICKET_TYPE_LABEL[ticket.type] ?? ticket.type),
    ticket.linkKind === "filed_by_driver"
      ? badge("فتحها السائق", "muted")
      : `${badge("عن طلبٍ أُسنِد إليه", "warn")}${
          ticket.counterpartName === null
            ? ""
            : `<div class="card-hint">${escapeHtml(ticket.counterpartName)}</div>`
        }`,
    badge(
      TICKET_STATUS_LABEL[ticket.status] ?? ticket.status,
      TICKET_STATUS_TONE[ticket.status] ?? "muted",
    ),
    escapeHtml(ticket.message),
    ticket.orderId === null
      ? EMPTY_CELL
      : `<span class="mono">${escapeHtml(ticket.orderId)}</span>`,
    ticket.claimedByName === null ? EMPTY_CELL : escapeHtml(ticket.claimedByName),
    `${escapeHtml(formatDateTime(ticket.createdAt))}<div class="card-hint">${escapeHtml(
      formatAge(ticket.createdAt, data.now),
    )}</div>`,
    ticket.resolution === null ? EMPTY_CELL : escapeHtml(ticket.resolution),
  ]);

  const ordersNote =
    profile.completedOrders > data.orders.length
      ? `يُعرض ${formatNumber(data.orders.length)} من ${formatNumber(
          profile.completedOrders,
        )} رحلة مكتملة — الأحدث أولاً.`
      : `${formatNumber(profile.completedOrders)} رحلة مكتملة.`;

  const ticketsNote =
    data.tickets.length === data.ticketsLimit
      ? `يُعرض أحدث ${formatNumber(data.ticketsLimit)} تذكرة — قد يكون هناك أقدم منها.`
      : `${formatNumber(data.tickets.length)} تذكرة مرتبطة بهذا السائق.`;

  return `<h1>${escapeHtml(name)}</h1>
<p class="note"><a href="/admin/drivers">← عودة إلى قائمة السائقين</a></p>
${section("إجراءات", actions(profile, data.csrfToken))}
${section(
  "التقييم والحصيلة",
  `<div class="cards">
${metricCard(
  "متوسّط التقييم (محسوب الآن)",
  profile.liveRatingAverage === null ? "—" : formatNumber(profile.liveRatingAverage),
  `${formatNumber(profile.liveRatingCount)} تقييماً غير مُعلَّم`,
)}
${metricCard(
  "المتوسّط المخزَّن",
  profile.storedRatingAverage === null ? "—" : formatNumber(profile.storedRatingAverage),
  `${formatNumber(profile.storedRatingCount)} تقييماً`,
)}
${metricCard("تقييمات مُعلَّمة كمُسيئة", formatNumber(profile.flaggedRatingCount), "مستثناة من المتوسّط")}
${metricCard("رحلات مكتملة", formatNumber(profile.completedOrders))}
${metricCard("طلبات ملغاة", formatNumber(profile.cancelledOrders))}
</div>`,
  ratingNote(profile),
)}
${section(
  "بيانات التسجيل",
  table({
    headers: ["الحقل", "القيمة"],
    rows: fieldRows(profile, data.now),
    emptyText: "لا بيانات.",
  }),
  "«ناقص» يعني حقلاً لم يصل من البوت — لا حقلاً فارغاً بقرار.",
)}
${section(
  "الوثائق",
  table({
    headers: ["النوع", "الحالة", "الانتهاء", "رُفعت", "رُوجعت", ""],
    rows: documentRows,
    emptyText: "لا وثائق مرفوعة لهذا السائق.",
  }),
  "الرابطُ موقَّعٌ لمدّةٍ قصيرةٍ ويُفتَحُ في صفحةٍ مستقلّةٍ. افتح الوثيقة وتحقّق منها قبل القرار؛ القبولُ وحدَه لا يوثّق السائق — التوثيقُ قرارٌ مستقلّ بعد قبول كل الوثائق الإلزامية.",
)}
${section(
  "الرحلات المكتملة",
  table({
    headers: ["الطلب", "الخدمة", "الراكب", "من", "إلى", "أُكملت", "تقييم الراكب"],
    rows: orderRows,
    emptyText: "لا رحلة مكتملة لهذا السائق.",
  }),
  ordersNote,
)}
${section(
  "تذاكر النزاع المرتبطة",
  table({
    headers: [
      "التذكرة",
      "النوع",
      "الارتباط",
      "الحالة",
      "الرسالة",
      "الطلب",
      "استلمها",
      "فُتحت",
      "الإغلاق",
    ],
    rows: ticketRows,
    emptyText: "لا تذكرة مرتبطة بهذا السائق.",
  }),
  ticketsNote,
)}`;
}
