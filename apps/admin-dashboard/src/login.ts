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

import { escapeHtml } from "./layout.ts";

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
      : `<div class="notice notice--error">${escapeHtml(data.error)}</div>`;
  const notice =
    data.notice === undefined
      ? ""
      : `<div class="notice notice--ok">${escapeHtml(data.notice)}</div>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>دخول لوحة وَصْلة</title>
<style nonce="${escapeHtml(data.cspNonce)}">
body{margin:0;background:#0f1115;color:#e7e9ee;font-family:"Segoe UI",Tahoma,sans-serif}
.login{max-width:380px;margin:12vh auto;background:#171a21;border:1px solid #262b36;
border-radius:12px;padding:22px}
h1{font-size:19px;margin:0 0 14px}
label{display:block;color:#9aa3b2;font-size:13px}
input{width:100%;padding:9px 11px;margin:6px 0 14px;border-radius:6px;border:1px solid #262b36;
background:#0d0f14;color:#e7e9ee;font-family:inherit;font-size:15px}
button{width:100%;padding:9px;border-radius:6px;border:0;background:#3f7cc4;color:#fff;
cursor:pointer;font-size:15px;font-family:inherit}
.note{color:#9aa3b2;font-size:13px;line-height:1.7}
a{color:#3f7cc4}
.notice{padding:9px 12px;border-radius:8px;margin-bottom:12px;font-size:14px}
.notice--error{background:rgba(192,74,74,.15);border:1px solid rgba(192,74,74,.4)}
.notice--ok{background:rgba(47,158,99,.15);border:1px solid rgba(47,158,99,.4)}
</style>
</head>
<body>
<div class="login">
<h1>لوحة وَصْلة — دخول</h1>
${alert}${notice}${body}
</div>
</body>
</html>`;
}
