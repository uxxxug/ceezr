/**
 * الغرض: **عرّافٌ مستقلٌّ** لرمزِ الاستجابةِ المبسَّطِ (`TLV`) — يُفكِّكُ ما تُركِّبُه
 *   القاعدةُ ولا يُركِّبُه معَها. فالفحصُ الذي يُعيدُ بناءَ السلسلةِ بنفسِ خطواتِ
 *   المُنتِجِ **يقيسُ ذاتَه**: لو أخطأَ كِلاهما الخطأَ نفسَه (طولٌ بالمحارفِ لا
 *   بالبايتاتِ مثلاً) لمَرَّ الفحصُ أخضرَ. فالمُفكِّكُ لا يَعلمُ كيفَ رُكِّبَ، بل
 *   **يشترطُ أن يكونَ البِناءُ سليماً ليُقرأَ**.
 * الحالة: مِلفُّ سَنَدٍ اختباريٌّ — لا يُستورَدُ من كودِ الإنتاجِ ألبتّةَ.
 * ينتمي إلى: tests/support
 * يُستخدم من: tests/integration/subscription-tax-invoice.test.ts
 * يُتوقع أن يستخدمه لاحقاً: أيُّ فحصٍ يقرأُ رمزَ فاتورةٍ مُصدَرةٍ.
 * يحرسُه: tests/integration/subscription-tax-invoice.test.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## ولِمَ تكرارٌ مقصودٌ لا نقضٌ للقاعدةِ 0.6
 *
 * القاعدةُ 0.6 تمنعُ **مصدرَي حقيقةٍ في الإنتاجِ**؛ وههنا مصدرٌ واحدٌ للإنتاجِ
 * (`zatca_simplified_invoice_qr` في القاعدةِ) ومُفكِّكٌ اختباريٌّ يقيسُه من الخارجِ.
 * والفكُّ ليسَ تكراراً للتركيبِ: هوَ اتّجاهٌ معاكسٌ يفشلُ إن كانَ الطولُ كاذباً أو
 * الوسمُ مُبدَّلاً أو الترتيبُ مُختَلَّاً.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يُركِّبُ رمزاً** ولا يُصدِّرُ مُرمِّزاً: لو صدَّرَ لصارَ مُرشَّحاً لأن
 *   يُستوردَ في الإنتاجِ فيصيرَ المصدرَ الثانيَ الذي مُنِعَ.
 * - **لا يتحقّقُ من ختمٍ رقميٍّ ولا من `CSID`**: المرحلةُ الثانيةُ من الفوترةِ
 *   الإلكترونيّةِ خارجُ النطاقِ (`ح-5`).
 * - **لا يقرأُ صورةَ رمزٍ**: المقروءُ نصُّ `base64` لا صورةٌ.
 */

/** حقلٌ واحدٌ كما وُجِدَ في السلسلةِ — بوسمِه وقيمتِه وطولِ بايتاتِه. */
export interface TlvField {
  readonly tag: number;
  readonly value: string;
  readonly byteLength: number;
}

export type TlvDecodeFailure =
  | { readonly reason: "NOT_BASE64" }
  | { readonly reason: "TRUNCATED_HEADER"; readonly offset: number }
  | {
      readonly reason: "LENGTH_OVERRUNS_BUFFER";
      readonly offset: number;
      readonly declared: number;
    }
  | { readonly reason: "TAG_IS_ZERO"; readonly offset: number };

export type TlvDecodeResult =
  | { readonly ok: true; readonly fields: readonly TlvField[] }
  | { readonly ok: false; readonly failure: TlvDecodeFailure };

/** الوسومُ الخمسةُ التي تُوجِبُها الهيئةُ للفاتورةِ المبسَّطةِ، بترتيبِها. */
export const SIMPLIFIED_INVOICE_TAGS = [1, 2, 3, 4, 5] as const;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const UTF8 = new TextDecoder("utf-8", { fatal: false });

/**
 * يُفكِّكُ سلسلةَ `TLV` من نصِّ `base64`.
 *
 * والفكُّ **يمشي بالطولِ المُعلَنِ** ولا يُخمِّنُ حدوداً: فإن كانَ الطولُ محسوباً
 * بالمحارفِ لا بالبايتاتِ — وهوَ العطبُ الذي تُنتِجُه العربيّةُ — انزلقَ الحدُّ
 * فقُرِئَ الوسمُ التاليَ من وسطِ قيمةٍ، فيسقُطُ الفكُّ. وذاكَ هوَ القياسُ.
 */
export function decodeTlv(base64: string): TlvDecodeResult {
  if (!BASE64.test(base64)) return { ok: false, failure: { reason: "NOT_BASE64" } };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  } catch {
    return { ok: false, failure: { reason: "NOT_BASE64" } };
  }

  const fields: TlvField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) {
      return { ok: false, failure: { reason: "TRUNCATED_HEADER", offset } };
    }
    const tag = bytes[offset] as number;
    const declared = bytes[offset + 1] as number;
    if (tag === 0) return { ok: false, failure: { reason: "TAG_IS_ZERO", offset } };
    const start = offset + 2;
    if (start + declared > bytes.length) {
      return { ok: false, failure: { reason: "LENGTH_OVERRUNS_BUFFER", offset, declared } };
    }
    fields.push({
      tag,
      value: UTF8.decode(bytes.subarray(start, start + declared)),
      byteLength: declared,
    });
    offset = start + declared;
  }
  return { ok: true, fields };
}

/** قيمةُ وسمٍ بعينِه، أو `undefined` إن لم يوجدْ — ولا يُخترَعُ فراغٌ مكانَه. */
export function tlvValue(fields: readonly TlvField[], tag: number): string | undefined {
  return fields.find((field) => field.tag === tag)?.value;
}

/**
 * تُبدَّلُ قيمةُ طولٍ في بايتاتِ السلسلةِ لإنتاجِ **سالبةٍ مزروعةٍ**: بها يُقاسُ أنَّ
 * المُفكِّكَ يسقُطُ حينَ يكذبُ الطولُ، فلا يُقرأُ نجاحُه نجاحاً بلا معنىً (`ح-7`).
 */
export function corruptDeclaredLength(base64: string, fieldIndex: number, delta: number): string {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  let offset = 0;
  for (let index = 0; offset + 2 <= bytes.length; index += 1) {
    const declared = bytes[offset + 1] as number;
    if (index === fieldIndex) {
      bytes[offset + 1] = Math.max(0, Math.min(255, declared + delta));
      break;
    }
    offset += 2 + declared;
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
