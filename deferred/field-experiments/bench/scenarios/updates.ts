/**
 * الغرض: بناةُ تحديثاتِ تيليجرام كما تصل من الويبهوك فعلاً — مدخلاتُ المستخدم في القياس.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: كلُّ سيناريو، وأيُّ مولّدِ حملٍ على مسار البوت.
 * ملاحظات مستقبلية: أيُّ نوعِ تحديثٍ جديد (مستند، استفتاء) يُضاف هنا وحده.
 *
 * والشكلُ منسوخٌ عن شكلِ تلغرام لا عن شكلٍ داخليّ: السيناريو الذي يبني كائناً
 * داخلياً يتجاوز المُوجِّهَ وتحويلَ التحديث، فيقيس ما بعدهما ويُسمّيه «المسار الكامل».
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const message = (chatId: number, body: Record<string, unknown>): unknown => ({
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});

export const textUpdate = (chatId: number, value: string): unknown =>
  message(chatId, { text: value });

export const photoUpdate = (chatId: number, fileId: string): unknown =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });

export const locationUpdate = (chatId: number, at: Coordinates): unknown =>
  message(chatId, { location: at });

export const contactUpdate = (chatId: number, phone: string): unknown =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });

/**
 * يُلحِق `update_id` بتحديثٍ مبنيّ.
 *
 * وباقي البُناةِ لا تُصدره عن قصد: سيناريوهاتُ وحدة 2-5 لا تختبر منعَ التكرار، وتحديثٌ
 * بلا رقمٍ يمرّ بالمانعِ بلا حكم (`updateIdOf` تُعيد `null`) فيبقى المقيسُ هو منطقُ
 * العملِ وحده. أمّا وحدة 2-6 فتختبر المانعَ صريحاً بين عمليتين، فتحتاج الرقمَ فعلاً.
 */
export const withUpdateId = (update: unknown, updateId: number): unknown => ({
  ...(update as Record<string, unknown>),
  update_id: updateId,
});

export const callbackUpdate = (chatId: number, data: string): unknown => ({
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});
