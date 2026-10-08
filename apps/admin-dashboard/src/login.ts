/**
 * الغرض: صفحة الدخول بخطوتين: معرّف تلغرام ثم رمز يصل على تلغرام نفسه،
 *   وخطوةٌ ثالثةٌ هي بابُ النجاةِ (break-glass) للمسؤولين وقتَ عطبِ تيليجرام.
 *   لا كلمة سرّ عامّةً في النظام: القناةُ الأولى هي تيليجرام وحدَه، وبابُ
 *   النجاةِ **عاملٌ ثانٍ على هويّةٍ قائمةٍ** يُسجَّلُ من داخلِ جلسةِ مسؤولٍ
 *   (ADR 0176) — لا هويّةً موازيةً تُنشأ بلا إثباتِ ملكيّةٍ.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1)، والبابُ الموازي في `SEC-21`.
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: عند وجود أكثر من مسؤول تُضاف صفحة إدارة الأدوار، ويبقى الدخول هو هو.
 */

import { escapeHtml, STYLE } from "./layout.ts";

export interface LoginPageData {
  /**
   * الخطوة الأولى تطلب المعرّف، والثانية تطلب الرمز الواصل، والثالثةُ بابُ
   * النجاةِ للمسؤولينَ المسجَّلينَ فيهِ قبلَ العطبِ (`SEC-21`).
   */
  readonly step: "identify" | "verify" | "break-glass";
  readonly telegramId?: string;
  readonly error?: string;
  readonly notice?: string;
  /** nonce سياسة أمن المحتوى — صفحة الدخول تحمل وسمَ أنماطٍ داخلياً فتحتاجه. */
  readonly cspNonce: string;
}

export function renderLoginPage(data: LoginPageData): string {
  const body =
    data.step === "identify"
      ? `<form method="post" action="/admin/login/code">
  <label for="telegram_id">معرّف تلغرام الخاص بك</label>
  <input id="telegram_id" name="telegram_id" inputmode="numeric" pattern="[0-9]+" required
         autocomplete="off" value="${escapeHtml(data.telegramId ?? "")}">
  <button type="submit">أرسِل رمز الدخول</button>
</form>
<p class="note">يصلك الرمز على محادثتك مع بوت السائق. لا يُرسَل رمز إلا لحساب صفته «مسؤول».</p>
<p class="note"><a href="/admin/login?break=1">تعطّل تلغرام؟ دخول المسؤولين بباب النجاة</a></p>`
      : data.step === "break-glass"
        ? `<form method="post" action="/admin/login/break-glass">
  <label for="login_name">اسم الدخول</label>
  <input id="login_name" name="login_name" pattern="[a-z0-9_-]{3,}" maxlength="64" required
         autocomplete="username" autofocus>
  <label for="password">كلمة السرّ</label>
  <input id="password" name="password" type="password" minlength="12" maxlength="200" required
         autocomplete="current-password">
  <label for="totp_code">رمز المُصادقة (ستّ خانات)</label>
  <input id="totp_code" name="totp_code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required
         autocomplete="one-time-code">
  <button type="submit">دخول</button>
</form>
<p class="note">هذا الباب لمن سجّل اعتماده من اللوحة قبل تعطّل تلغرام. خمسُ محاولاتٍ فاشلةٍ تُقفِلُهُ ربعَ ساعةٍ.</p>
<p class="note"><a href="/admin/login">العودة إلى الدخول بتلغرام</a></p>`
        : `<form method="post" action="/admin/login/verify">
  <input type="hidden" name="telegram_id" value="${escapeHtml(data.telegramId ?? "")}">
  <label for="code">الرمز الواصل على تلغرام</label>
  <input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required
         autocomplete="one-time-code" autofocus>
  <button type="submit">دخول</button>
</form>
<p class="note"><a href="/admin/login">طلب رمز جديد</a></p>`;

  const alert =
    data.error === undefined
      ? ""
      : `<div role="alert" class="notice notice--error">${escapeHtml(data.error)}</div>`;
  const notice =
    data.notice === undefined
      ? ""
      : `<div role="status" class="notice notice--ok">${escapeHtml(data.notice)}</div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>دخول لوحة وَصْلة</title>
<meta name="color-scheme" content="dark">
<style nonce="${escapeHtml(data.cspNonce)}">${STYLE}</style>
</head>
<body>
<main class="login" id="main">
<h1>لوحة وَصْلة — دخول</h1>
${alert}${notice}${body}
</main>
</body>
</html>`;
}
