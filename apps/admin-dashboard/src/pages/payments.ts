/**
 * الغرض: صفحة لوحة الإدارة لاشتراكات الدفع — البند 8 (طبقة الدفع).
 *   تعرض معاملات الدفع الأخيرة وحالة الويبهوك، بلا تعديل (قراءة فقط).
 *   اشتراك السائق الشهري هو التدفّق الوحيد المفعّل؛ باقي الأغراض هياكل فقط.
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: إنشاء/استرداد دفعة يدوية يُضاف حين يُدمج مزوّد فعلي.
 */

import { formatDateTime } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface PaymentTransactionRow {
  readonly id: string;
  readonly driverName: string;
  readonly cityName: string;
  readonly purpose: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly provider: string;
  readonly providerTransactionId: string | null;
  readonly status: string;
  readonly createdAt: Date;
}

export interface PaymentPageData {
  readonly cityOptions: readonly CityOption[];
  readonly cityId: string;
  readonly cityName: string;
  readonly transactions: readonly PaymentTransactionRow[];
  readonly providerName: string | null;
  readonly environment: string | null;
  readonly driverSubscriptionEnabled: boolean;
}

function statusBadge(status: string): string {
  const tone: BadgeTone =
    status === "active" ? "ok" : status === "pending" || status === "past_due" ? "warn" : "bad";
  return badge(escapeHtml(status), tone);
}

function formatAmount(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  return `${escapeHtml(currency)} ${escapeHtml(major)}`;
}

export function renderPaymentsPage(data: PaymentPageData): string {
  const rows = data.transactions.map((tx) => [
    escapeHtml(tx.driverName),
    escapeHtml(tx.cityName),
    escapeHtml(tx.purpose),
    formatAmount(tx.amountMinor, tx.currency),
    escapeHtml(tx.provider),
    tx.providerTransactionId === null ? "—" : escapeHtml(tx.providerTransactionId),
    statusBadge(tx.status),
    formatDateTime(tx.createdAt),
  ]);

  const cityPicker =
    data.cityOptions.length > 0
      ? `<div class="city-picker">
        <label>المدينة:</label>
        <select data-nav-param="city" aria-label="اختر المدينة">
          ${data.cityOptions
            .map(
              (city) =>
                `<option value="${escapeHtml(city.id)}"${city.id === data.cityId ? " selected" : ""}>${escapeHtml(city.nameAr)}</option>`,
            )
            .join("")}
        </select>
      </div>`
      : "";

  return section(
    "المدفوعات والاشتراكات",
    `
    <div class="pay-status-bar">
      ${cityPicker}
      ${data.providerName !== null ? badge(`المزوّد: ${escapeHtml(data.providerName)}`, "ok") : ""}
      ${data.environment !== null ? badge(escapeHtml(data.environment), data.environment === "production" ? "bad" : "warn") : ""}
      ${badge(data.driverSubscriptionEnabled ? "اشتراك السائق مفعّل" : "اشتراك السائق معطّل", data.driverSubscriptionEnabled ? "ok" : "muted")}
    </div>
    ${table({
      headers: [
        "السائق",
        "المدينة",
        "الغرض",
        "المبلغ",
        "المزوّد",
        "معرّف المزوّد",
        "الحالة",
        "التاريخ",
      ],
      rows,
      emptyText: "لا معاملات بعد",
    })}
    <p class="help-text">
      اشتراك السائق الشهري هو التدفّق الوحيد المفعّل. باقي الأغراض (دفع العملاء/التجار)
      هياكل فقط حتى أمر تفعيل صريح. لا مزوّد دفع فعلي مدمج — البنية وحدها قائمة.
    </p>
    `,
  );
}
