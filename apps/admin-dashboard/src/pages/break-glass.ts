/**
 * الغرض: صفحةُ البابِ الموازي للإدارةِ (break-glass): تسجيلُ اعتمادِ الدخولِ
 *   (اسمُ دخولٍ وكلمةُ سرٍّ وسرُّ TOTP) وتدويرُهُ وتعطيلُهُ — من داخلِ جلسةِ
 *   مسؤولٍ مُوثَّقةٍ بتيليجرام (ADR 0176: إثباتُ الهويّةِ الأولُ يبقى القناةَ
 *   الأولى، والبابُ عاملٌ ثانٍ على الهويّةِ لا هويّةٌ موازية).
 * الحالة: منفّذ فعلياً — المرحلة `SEC-21`.
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: يُضاف مُولِّدُ رمزٍ QR لرابطِ otpauth (لا يغيّرُ العقدَ شيئًا)،
 *   وWebAuthn بديلٌ أقوى مسجَّلٌ في ADR 0176 §٧.
 */

import { escapeHtml, section } from "../layout.ts";

export interface BreakGlassPageData {
  readonly csrfToken: string;
  /** هل للمسؤولِ الحاليِّ اعتمادٌ فعّالٌ مسجَّلٌ؟ */
  readonly hasActiveCredential: boolean;
  readonly loginName: string | null;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
  /**
   * رابطُ ضبطِ تطبيقِ المُصادقةِ — يُعرضُ مرّةً واحدةً بعدَ التسجيلِ أو التدويرِ
   * فحسبُ: السرُّ لا يُعادُ إخراجُهُ من القاعدةِ بعدَها (مُشفَّرٌ لقراءتِنا وحدَنا،
   * ولا يُقرأُ إلّا لِلَّتحقّقِ).
   */
  readonly otpauthUri?: string | undefined;
}

/**
 * UI-6 / PR 9: البابُ عملٌ خطِرٌ متعمَّد — فالصفحةُ مقسومةٌ إلى «الحالة» ثم «التسجيل/
 * التدوير» ثم «منطقةُ الخطر» (التعطيل) منفصلةً ببصرِها، ولكلِّ فعلٍ يمسُّ اعتماداً
 * قائماً نيّةٌ صريحةٌ (`data-confirm`). والخادمُ يبقى الحَكَم: CSRF والجلسةُ وحدُّ المعدّل.
 */
export function renderBreakGlassPage(data: BreakGlassPageData): string {
  const alert =
    data.error === undefined
      ? ""
      : `<div role="alert" class="notice notice--error">${escapeHtml(data.error)}</div>`;
  const okNotice =
    data.notice === undefined
      ? ""
      : `<div role="status" class="notice notice--ok">${escapeHtml(data.notice)}</div>`;
  const otpauth =
    data.otpauthUri === undefined
      ? ""
      : `<div role="status" class="notice notice--ok">
<p><strong>خطوة أخيرة — اضبط تطبيق المصادقة الآن.</strong></p>
<p>أضِف الحساس في تطبيق المصادقة (Google Authenticator أو غيره) برابط الضبط هذا، أو أدخِل السرّ يدويًا:</p>
<p class="mono mono--wrap">${escapeHtml(data.otpauthUri)}</p>
<p class="note">هذا الرابط يُعرَض الآن فقط ولن يظهر مرة أخرى. انسخه أو اضبط التطبيق قبل مغادرة الصفحة.</p>
</div>`;

  const status = data.hasActiveCredential
    ? `<p>حالك: اعتمادٌ فعّالٌ باسمِ <span class="mono">${escapeHtml(data.loginName ?? "")}</span>. نداءُ التسجيلِ مرةً أخرى يُدوّرُ الاعتمادَ (يستبدلُ كلمةَ السرِّ والسرِّ معًا) ويُصفّرُ عدّادَ الإقفال.</p>`
    : "<p>حالك: لا اعتمادَ مسجّلًا. البابُ مغلقٌ أمامَك حتّى تُسجّلَ اعتمادًا من ههنا.</p>";

  const rotateConfirm = data.hasActiveCredential
    ? ' data-confirm="التسجيلُ يُدوّرُ اعتمادَك الحاليَّ: كلمةُ السرِّ والسرُّ القديمانِ يبطلانِ فوراً. متابعة؟"'
    : "";

  const disableForm = data.hasActiveCredential
    ? section(
        "منطقة الخطر",
        `<form method="post" data-confirm="تعطيلُ البابِ يُطفئ اعتمادَك الحالي؛ وقتَ تعطّلِ تلغرام لن تدخلَ من هنا حتى تُسجِّلَ من جديد. متابعة؟" action="/admin/break-glass/disable">
  <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
  <button type="submit" class="danger danger--solid">تعطيلُ البابِ (يُطفئ الاعتمادَ الحاليَّ)</button>
</form>`,
        "فعلٌ متعمَّدٌ لا يُسترجَعُ بنقرة: الاعتمادُ المعطَّلُ لا يعودُ إلا بتسجيلٍ جديد.",
      ).replace('<section class="block">', '<section class="block danger-zone">')
    : "";

  return `<h1>بابُ النجاة — دخولٌ بلا تلغرام</h1>
${alert}${okNotice}
<p class="note">تسجيلُ الاعتمادِ هنا ممكنٌ من داخلِ جلسةِ مسؤولٍ قائمةٍ فقط — فإثباتُ الهويّةِ الأولُ هو تلغرام، وهذا البابُ عاملٌ ثانٍ عليه لا بديلٌ عنه (ADR 0176). وقتَ تعطّلِ تلغرام يدخلُ المسجّلونَ من صفحةِ الدخولِ بوصلةِ «تعطّل تلغرام؟».</p>
${otpauth}
${section("الحالة", status)}
${section(
  "تسجيلُ اعتمادٍ جديدٍ أو تدويرُ الحاليِّ",
  `<form method="post"${rotateConfirm} action="/admin/break-glass" class="login-like">
  <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
  <div class="stack"><label for="login_name">اسمُ الدخول (حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطاتٌ، 3 محارفٍ فأكثر)</label>
    <input id="login_name" name="login_name" pattern="[a-z0-9_-]{3,64}" maxlength="64" required
           autocomplete="username"${data.loginName === null ? "" : ` value="${escapeHtml(data.loginName)}"`}></div>
  <div class="stack"><label for="password">كلمةُ السرّ (12 محرفًا فأكثر — لا تُعادُ طباعتُها أبدًا)</label>
    <input id="password" name="password" type="password" minlength="12" maxlength="200" required
           autocomplete="new-password"></div>
  <button type="submit">تسجيلُ الاعتمادِ</button>
</form>`,
  "بعدَ التسجيلِ يُعرضُ رابطُ ضبطِ تطبيقِ المُصادقةِ (رموزُ TOTP كلَّ 30 ثانيةً) مرّةً واحدةً. اضبطِ التطبيقَ فورًا: من دون رموزِهِ لا يكتملُ الدخولُ من البابِ.",
)}
${disableForm}`;
}
