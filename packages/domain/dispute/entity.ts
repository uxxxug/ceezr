/**
 * الغرض: تذكرة الدعم ككيان: هويّة صاحبها، ولقطة اشتراكه، وما يُسمح فعله بها.
 *   القرارات هنا نقيّة: لا قاعدة بيانات ولا تلغرام، فتُختبر بلا بيئة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute، apps/admin-dashboard (صفحة النزاعات)
 * ملاحظات مستقبلية: مدّة التفعيل وأسعار الخطط ليست هنا — مصدرها platform_settings حصراً.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "../subscription/entity.ts";
import type { SupportResolution, SupportTicketStatus, SupportTicketType } from "./value-objects.ts";

/**
 * لقطة اشتراك تُقرأ لحظة بناء البطاقة لا وقت فتح التذكرة.
 * `isLive` يأتي محسوباً من القاعدة لأن المقارنة بـ now() يجب أن تكون بساعة واحدة
 * هي ساعة القاعدة؛ حسابها هنا بساعة العملية كان سيختلف عنها بثوانٍ في اللحظات الحرجة.
 */
export interface SubscriptionSnapshot {
  readonly plan: SubscriptionPlan;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly trialEndsAt: Date | null;
  readonly isLive: boolean;
}

/**
 * هوية صاحب التذكرة كما تُعرض للدعم. `telegramId` إلزامي دائماً لأنه المفتاح
 * المضمون للوصول إلى الشخص؛ `telegramUsername` اختياري لأن كثيراً من الحسابات بلا معرّف نصّي.
 */
export interface TicketOwner {
  readonly fullName: string;
  readonly phone: string;
  readonly telegramId: string;
  readonly telegramUsername: string | null;
  readonly languageCode: string;
}

export interface SupportTicket {
  readonly id: string;
  readonly type: SupportTicketType;
  readonly status: SupportTicketStatus;
  readonly cityName: string;
  readonly message: string;
  readonly attachmentFileId: string | null;
  readonly orderId: string | null;
  readonly createdAt: Date;
  readonly owner: TicketOwner;
  /** null لعميل بلا اشتراك، أو لسائق لم يُنشأ له اشتراك قط. */
  readonly subscription: SubscriptionSnapshot | null;
}

export function isSettled(status: SupportTicketStatus): boolean {
  return status === "resolved" || status === "rejected";
}

/** الاستلام ممكن ما لم تُحسَم التذكرة أو يستلمها أحد قبلك. */
export function canClaim(status: SupportTicketStatus): boolean {
  return status === "open";
}

/**
 * التفعيل والإنهاء يقتضيان اشتراكاً، فلا معنى لهما في تذكرة عميل.
 * الرفض ممكن في كل تذكرة غير محسومة: هو إقفال إداري لا تصرّف في اشتراك.
 */
export function canResolve(ticket: SupportTicket, resolution: SupportResolution): boolean {
  if (isSettled(ticket.status)) return false;
  if (resolution === "reject") return true;
  return ticket.subscription !== null || ticket.type === "subscription";
}

/**
 * الأزرار المعروضة على البطاقة تتبع حالتها: لا نعرض «تفعيل» لتذكرة نزاع بلا اشتراك،
 * ولا «استلام» لمن استُلمت. عرض زرّ لا يعمل أسوأ من عدم عرضه.
 */
export function availableActions(ticket: SupportTicket): readonly (SupportResolution | "claim")[] {
  if (isSettled(ticket.status)) return [];
  const actions: (SupportResolution | "claim")[] = [];
  if (canClaim(ticket.status)) actions.push("claim");
  if (ticket.type === "subscription") {
    actions.push("activate");
    if (ticket.subscription?.isLive === true) actions.push("terminate");
  } else if (ticket.subscription?.isLive === true) {
    actions.push("terminate");
  }
  actions.push("reject");
  return actions;
}

/**
 * التذكرة الأحقّ بالاهتمام أولاً: المفتوحة قبل المستلَمة، والأقدم قبل الأحدث.
 * ترتيب قروب تلغرام زمنيّ لا يمكن تغييره، لكن لوحة الإدارة تستفيد من هذا.
 */
export function comparePriority(left: SupportTicket, right: SupportTicket): number {
  const rank = (status: SupportTicketStatus): number =>
    status === "open" ? 0 : status === "claimed" ? 1 : 2;
  const byStatus = rank(left.status) - rank(right.status);
  if (byStatus !== 0) return byStatus;
  return left.createdAt.getTime() - right.createdAt.getTime();
}
