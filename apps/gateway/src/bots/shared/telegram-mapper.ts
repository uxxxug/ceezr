/**
 * الغرض: تحويل تحديث تلغرام الخام إلى تحديث مُجرَّد يفهمه منطق الحوار — وتجاهل ما لا يخصّنا.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}/index.ts
 * ملاحظات مستقبلية: أنواع التحديثات الأخرى (صور المستندات، الاستفتاءات) تُضاف هنا وحدها.
 */

import type { IncomingUpdate, Sender } from "../../../../../packages/application/bots/types.ts";

/** الشكل الجزئي الذي نعتمد عليه فعلاً من تحديث تلغرام — لا نثق ببقية الحقول. */
export interface RawTelegramUpdate {
  readonly message?: {
    readonly chat?: { readonly id?: number | string };
    readonly from?: { readonly id?: number | string; readonly language_code?: string };
    readonly text?: string;
    /** ثانية Unix. تلغرام يُرسله في كل رسالة، وهو زمن الإصلاحة لا زمن وصولها إلينا. */
    readonly date?: number;
    /**
     * `horizontal_accuracy` و`heading` يرسلهما تلغرام مع الموقع ولم نكن نقرأهما،
     * فكانت كل إصلاحة تصل إلى المجال بلا ما يُقيَّم به — وكان مُقيِّم المرحلة ٣
     * مضطرّاً أن يفترض الأفضل في كل مرة. قراءتهما هنا شرط أن يكون التقييم حقيقياً.
     */
    readonly location?: {
      readonly latitude?: number;
      readonly longitude?: number;
      readonly horizontal_accuracy?: number;
      readonly heading?: number;
    };
    /**
     * `user_id` حاسم لا تكميلي: بطاقة جهة اتصال *شخص آخر* تصل بنفس شكل
     * زرّ "مشاركة رقمي" تماماً. بلا هذا الحقل لا سبيل للتفريق بينهما.
     */
    readonly contact?: { readonly phone_number?: string; readonly user_id?: number | string };
    /** تلغرام يرسل الصورة بعدّة مقاسات مرتّبة تصاعدياً. */
    readonly photo?: readonly { readonly file_id?: string }[];
    readonly caption?: string;
  };
  readonly callback_query?: {
    readonly data?: string;
    readonly from?: { readonly id?: number | string; readonly language_code?: string };
    readonly message?: { readonly chat?: { readonly id?: number | string } };
  };
}

function senderFrom(
  userId: number | string | undefined,
  chatId: number | string | undefined,
  languageCode: string | undefined,
): Sender | null {
  if (userId === undefined || chatId === undefined) return null;
  return {
    telegramUserId: String(userId),
    chatId: String(chatId),
    languageHint: languageCode ?? "ar",
  };
}

/**
 * يعيد null لكل تحديث لا نتعامل معه (انضمام عضو، تعديل رسالة، …) بلا خطأ ولا ردّ.
 * تجاهل صريح أفضل من معالجة نصف مفهومة.
 */
export function toIncomingUpdate(raw: RawTelegramUpdate): IncomingUpdate | null {
  if (raw.callback_query !== undefined) {
    const query = raw.callback_query;
    const sender = senderFrom(query.from?.id, query.message?.chat?.id, query.from?.language_code);
    if (sender === null || query.data === undefined || query.data === "") return null;
    return { kind: "callback", from: sender, data: query.data };
  }

  const message = raw.message;
  if (message === undefined) return null;

  const sender = senderFrom(message.from?.id, message.chat?.id, message.from?.language_code);
  if (sender === null) return null;

  const location = message.location;
  if (location?.latitude !== undefined && location.longitude !== undefined) {
    return {
      kind: "location",
      from: sender,
      location: { latitude: location.latitude, longitude: location.longitude },
      /**
       * تُمرَّر كما وصلت بلا تنقية: التحقّق قرار مجال، ووظيفة هذه الطبقة النقل لا
       * الحكم. وتصفيتها هنا كانت ستُنشئ حاجزاً ثانياً يتفرّع عن الأول بمرور الوقت.
       */
      quality: {
        accuracyMeters: location.horizontal_accuracy,
        headingDegrees: location.heading,
        recordedAtMs: message.date === undefined ? undefined : message.date * 1000,
      },
    };
  }

  const phone = message.contact?.phone_number;
  if (phone !== undefined && phone !== "") {
    const ownerId = message.contact?.user_id;
    return {
      kind: "contact",
      from: sender,
      phone,
      // غيابه يعني بطاقة يدوية بلا حساب تلغرام — تُعامَل كغير مملوكة
      ownerTelegramId: ownerId === undefined ? null : String(ownerId),
    };
  }

  /**
   * نأخذ آخر عنصر: هو أعلى مقاس رفعه تلغرام. إيصال التحويل بمقاس مصغّر
   * غير مقروء غالباً، وطلب إعادة إرساله يُضيّع دورة دعم كاملة.
   */
  const photos = message.photo;
  if (photos !== undefined && photos.length > 0) {
    const fileId = photos[photos.length - 1]?.file_id;
    if (fileId !== undefined && fileId !== "") {
      const caption = message.caption?.trim();
      return {
        kind: "photo",
        from: sender,
        fileId,
        caption: caption === undefined || caption === "" ? null : caption,
      };
    }
  }

  if (message.text !== undefined && message.text.trim() !== "") {
    return { kind: "text", from: sender, text: message.text };
  }

  return { kind: "unsupported", from: sender };
}
