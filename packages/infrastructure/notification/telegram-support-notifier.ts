/**
 * الغرض: بطاقة تذكرة الدعم على تلغرام: هوية صاحبها كاملةً، وحالة اشتراكه كما قُرئت الآن،
 *   وصورة الإيصال مُعاد إرسالها بمعرّفها، وأزرار القرار — ثم تبليغ صاحبها بالنتيجة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: تعديل البطاقة بعد الحسم (editMessageText) يُضاف مع لوحة الإدارة؛
 *   معرّف الرسالة محفوظ في support_tickets.group_message_id منذ الآن لهذا الغرض.
 */

import type {
  SupportCard,
  SupportCardPublisher,
  TicketOwnerNotifier,
} from "../../application/dispute/index.ts";
import type { SubscriptionSnapshot, SupportResolution } from "../../domain/dispute/index.ts";
import { DEFAULT_LANGUAGE, t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";

/**
 * مُرسِل يدعم الصورة. لا نُنزّل الصورة ولا نُعيد رفعها: تلغرام يقبل معرّف الملف نفسه،
 * فالإيصال يظهر صورةً في القروب بلا تخزين أي ملف عندنا.
 */
export interface SupportSender {
  sendReturningId(chatId: string, text: string, keyboard: unknown): Promise<string | null>;
  sendPhotoReturningId(
    chatId: string,
    fileId: string,
    caption: string,
    keyboard: unknown,
  ): Promise<string | null>;
}

/** قروب المدينة لا لغة له، فالبطاقة بلغة النظام الافتراضية. */
function groupLanguage(): string {
  return DEFAULT_LANGUAGE;
}

function formatDate(value: Date | null): string {
  if (value === null) return "—";
  // تاريخ فقط: الساعة والدقيقة لا تغيّران قرار الدعم وتزيدان ضجيج البطاقة
  return value.toISOString().slice(0, 10);
}

/**
 * سطر الاشتراك يُبنى من لقطة قُرئت لحظة النشر لا من ذاكرة مؤقتة: موظّف الدعم
 * الذي يقرأ «فعّال» عن اشتراك منتهٍ سيفعّل اشتراكاً مفعّلاً أو يرفض طلباً محقّاً.
 */
function subscriptionLine(
  snapshot: SubscriptionSnapshot | null,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (snapshot === null) return tr("support.card_no_subscription");
  const params = {
    plan: snapshot.plan,
    status: snapshot.status,
    until: formatDate(snapshot.currentPeriodEnd ?? snapshot.trialEndsAt),
  };
  return snapshot.isLive
    ? tr("support.card_subscription", params)
    : tr("support.card_subscription_expired", params);
}

/**
 * سطر الهوية: المعرّف الرقمي دائماً لأنه المفتاح المضمون للوصول للشخص،
 * والمعرّف النصّي معه إن وُجد لأنه أسهل على البشر.
 */
function identityLine(telegramId: string, username: string | null): string {
  return username === null ? telegramId : `@${username} (${telegramId})`;
}

function keyboardFor(card: SupportCard, tr: (key: string) => string): unknown {
  const rows = card.actions.map((action) => {
    const label =
      action === "claim"
        ? tr("support.claim_button")
        : action === "activate"
          ? tr("support.activate_button")
          : action === "terminate"
            ? tr("support.terminate_button")
            : tr("support.reject_button");
    return [{ text: label, callback_data: `sup:${action}:${card.ticket.id}` }];
  });
  return { inline_keyboard: rows };
}

export function createSupportCardPublisher(sender: SupportSender): SupportCardPublisher {
  return {
    publish: (card: SupportCard) =>
      guard("publisher.supportCard", async (): Promise<string | null> => {
        const tr = t(groupLanguage());
        const ticket = card.ticket;
        const text = tr("support.card", {
          ticket_short: ticket.id.slice(0, 8),
          type:
            ticket.type === "subscription"
              ? tr("support.card_type_subscription")
              : tr("support.card_type_ride"),
          name: ticket.owner.fullName,
          phone: ticket.owner.phone === "" ? "—" : ticket.owner.phone,
          telegram: identityLine(ticket.owner.telegramId, ticket.owner.telegramUsername),
          city: ticket.cityName,
          subscription: subscriptionLine(ticket.subscription, tr),
          message: ticket.message,
        });
        const keyboard = keyboardFor(card, tr);

        if (ticket.attachmentFileId === null) {
          return sender.sendReturningId(card.groupId, text, keyboard);
        }
        return sender.sendPhotoReturningId(card.groupId, ticket.attachmentFileId, text, keyboard);
      }),
  };
}

function resolutionKey(action: SupportResolution): string {
  if (action === "activate") return "support.resolved_activated";
  if (action === "terminate") return "support.resolved_terminated";
  return "support.resolved_rejected";
}

/**
 * التبليغ يذهب إلى المحادثة الخاصة بمعرّف تلغرام مباشرة: معرّف المستخدم هو نفسه
 * معرّف محادثته الخاصة، فلا حاجة لتخزين معرّف محادثة منفصل.
 */
export function createTicketOwnerNotifier(sender: SupportSender): TicketOwnerNotifier {
  return {
    notifyResolution: (input) =>
      guard("notifier.ticketOwner", async (): Promise<string | null> => {
        // لغة صاحب التذكرة تأتي من القاعدة مع القرار: قرار مصيري كإنهاء اشتراك
        // يجب أن يصل بلغة يقرؤها صاحبه لا بلغة النظام.
        const tr = t(input.language);
        // معرّفُ الرسالةِ يُرجَعُ لا يُهمَلُ: صندوقُ الصادرِ لا يُعلنُ «سُلّمت» إلّا به.
        return await sender.sendReturningId(
          input.telegramId,
          tr(resolutionKey(input.action)),
          undefined,
        );
      }),
  };
}
