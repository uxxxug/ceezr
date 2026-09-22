/**
 * الغرض: صفحة استرداد الحسابات: قائمة الطلبات المعلّقة ومراجعتها — لأن «فلان فقد
 *   حساب تيليجرام فلا يصل إلى رحلاته ولا اعتماده» فجوة لا باب لها، وهذا الباب.
 * الحالة: منفّذ فعلياً — `SEC-20`.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: أي تعديل على نموذج المراجعة يُضاف هنا وفي admin-ui.ts معاً.
 */

import { formatDateTime } from "../format.ts";
import { escapeHtml, section } from "../layout.ts";

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

function recoveryCard(req: RecoveryRequestRow): string {
  const claimant = req.claimantTelegramId ? escapeHtml(req.claimantTelegramId) : "—";
  const name = req.targetFullName ? escapeHtml(req.targetFullName) : "—";
  const telegramId = req.targetTelegramId ? escapeHtml(req.targetTelegramId) : "—";
  const blocked = req.targetIsBlocked ? "محظور" : "نشط";

  return `<div class="card recovery-card">
    <div class="card-header">
      <span class="card-title">${name}</span>
      <span class="badge">${escapeHtml(blocked)}</span>
    </div>
    <dl class="recovery-meta">
      <dt>المعرّف الداخلي</dt><dd>${escapeHtml(req.targetUserId)}</dd>
      <dt>تيليجرام الحالي</dt><dd>${telegramId}</dd>
      <dt>تيليجرام المطالب</dt><dd>${claimant}</dd>
      <dt>قُدّم في</dt><dd>${formatDateTime(req.submittedAt)}</dd>
    </dl>
    <div class="recovery-evidence">
      <strong>ملخّص الأدلة:</strong>
      <p>${escapeHtml(req.evidenceSummary)}</p>
    </div>
    <form method="post" action="/admin/recovery/${escapeHtml(req.id)}/review" class="recovery-form">
      <label>
        القرار
        <select name="decision" required>
          <option value="approved">قبول</option>
          <option value="rejected">رفض</option>
        </select>
      </label>
      <label>
        السبب
        <select name="reason" required>
          ${DECISION_REASONS.map((r) => `<option value="${r.value}">${r.label}</option>`).join("")}
        </select>
      </label>
      <button type="submit">تأكيد القرار</button>
    </form>
  </div>`;
}

export function renderRecoveryPage(requests: readonly RecoveryRequestRow[]): string {
  if (requests.length === 0) {
    return section("طلبات الاسترداد", `<p>لا توجد طلبات استرداد معلّقة.</p>`);
  }

  return section(
    "طلبات الاسترداد",
    `<div class="recovery-list">${requests.map(recoveryCard).join("")}</div>`,
  );
}
