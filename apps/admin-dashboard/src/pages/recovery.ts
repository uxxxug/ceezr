/**
 * الغرض: صفحة استرداد الحسابات: قائمة الطلبات المعلّقة ومراجعتها — لأن «فلان فقد
 *   حساب تيليجرام فلا يصل إلى رحلاته ولا اعتماده» فجوة لا باب لها، وهذا الباب.
 * الحالة: منفّذ فعلياً — `SEC-20`.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: أي تعديل على نموذج المراجعة يُضاف هنا وفي admin-ui.ts معاً.
 */

import { formatDateTime } from "../format.ts";
import { badge, escapeHtml, section, stateBlock } from "../layout.ts";

export interface RecoveryRequestRow {
  readonly id: string;
  readonly targetUserId: string;
  readonly claimantTelegramId: string | null;
  readonly evidenceSummary: string;
  readonly submittedAt: string;
  readonly targetFullName: string | null;
  readonly targetTelegramId: string | null;
  readonly targetIsBlocked: boolean;
}

const DECISION_REASONS: readonly { value: string; label: string }[] = [
  { value: "identity_verified", label: "تم التحقق من الهوية" },
  { value: "identity_not_confirmed", label: "لم تُؤكَّد الهوية" },
  { value: "insufficient_evidence", label: "أدلة غير كافية" },
  { value: "telegram_account_lost", label: "فُقد حساب تيليجرام" },
  { value: "duplicate_account", label: "حساب مكرر" },
  { value: "policy_violation", label: "مخالفة السياسة" },
  { value: "user_request", label: "طلب المستخدم" },
];

function recoveryCard(req: RecoveryRequestRow, csrfToken: string): string {
  const claimant = req.claimantTelegramId ? escapeHtml(req.claimantTelegramId) : "—";
  const name = req.targetFullName ? escapeHtml(req.targetFullName) : "بلا اسم";
  const telegramId = req.targetTelegramId ? escapeHtml(req.targetTelegramId) : "—";
  const headingId = `recovery-${escapeHtml(req.id)}`;

  return `<article class="card recovery-card" aria-labelledby="${headingId}">
    <header class="card-header">
      <h2 class="card-title" id="${headingId}">${name}</h2>
      ${req.targetIsBlocked ? badge("محظور", "bad") : badge("نشط", "ok")}
    </header>
    <dl class="recovery-meta">
      <dt>المعرّف الداخلي</dt><dd class="mono">${escapeHtml(req.targetUserId)}</dd>
      <dt>تيليجرام الحالي</dt><dd class="mono">${telegramId}</dd>
      <dt>تيليجرام المطالب</dt><dd class="mono">${claimant}</dd>
      <dt>قُدّم في</dt><dd>${formatDateTime(req.submittedAt)}</dd>
    </dl>
    <div class="recovery-evidence">
      <strong>ملخّص الأدلة:</strong>
      <p>${escapeHtml(req.evidenceSummary)}</p>
    </div>
    <form method="post" data-confirm="قرارُ الاسترداد يمسُّ حسابَ مستخدمٍ آخر. تأكيدُ القرار؟" action="/admin/recovery/${escapeHtml(req.id)}/review" class="recovery-form">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <label>
        القرار
        <select name="decision" required>
          <option value="" selected disabled>اختر القرار…</option>
          <option value="approved">قبول</option>
          <option value="rejected">رفض</option>
        </select>
      </label>
      <label>
        السبب
        <select name="reason" required>
          <option value="" selected disabled>اختر السبب…</option>
          ${DECISION_REASONS.map((r) => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`).join("")}
        </select>
      </label>
      <button type="submit" class="danger">تأكيد القرار</button>
    </form>
  </article>`;
}

/**
 * UI-6 / PR 9: العنوانُ الأعلى ورمزُ CSRF في كلِّ نموذج. القرارُ والسببُ بلا قيمةٍ
 * مبدئية — كانت «قبول» مختارةً سلفاً، فنقرةٌ عجلى تُقبَلُ بها مطالبةٌ بحسابِ غيرِ صاحبِها.
 */
export function renderRecoveryPage(
  requests: readonly RecoveryRequestRow[],
  csrfToken: string,
): string {
  const intro = `<h1>استرداد الحسابات</h1>
<p class="note">كلُّ طلبٍ هنا مطالبةٌ بحسابٍ فقدَ صاحبُه وصولَه إليه. القرارُ يُسجَّلُ في سجلِّ التدقيقِ باسمِك، والخادمُ يتحقّقُ من الصلاحيةِ والرمزِ قبل أيِّ تنفيذ.</p>`;
  if (requests.length === 0) {
    return `${intro}${section("طلبات الاسترداد", stateBlock("empty", "لا توجد طلبات استرداد معلّقة."))}`;
  }

  return `${intro}${section(
    `طلبات الاسترداد (${requests.length})`,
    `<div class="recovery-list">${requests.map((req) => recoveryCard(req, csrfToken)).join("")}</div>`,
  )}`;
}
