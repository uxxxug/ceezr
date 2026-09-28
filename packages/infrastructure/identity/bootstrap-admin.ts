/**
 * الغرض: منح صفة المسؤول لأول حساب يطابق BOOTSTRAP_ADMIN_TELEGRAM_ID عند /start.
 * الحالة: منفّذ فعلياً — المرحلة 2.4 (سدّ فجوة §6.2ب من التوجيه).
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، لوحة الإدارة (تسجيل الدخول)
 * ملاحظات مستقبلية: بعد وجود أول مسؤول تُدار الأدوار من اللوحة، ويبقى هذا مساراً للتعافي.
 */

import type { Result } from "../../shared/result/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

/** يعيد true إن رُقّي الحساب أو أُنشئ الآن، وfalse إن كان مسؤولاً أصلاً. */
export interface BootstrapAdminPort {
  grant(telegramId: string): Promise<Result<boolean, unknown>>;
}

export function createBootstrapAdminPort(sql: Sql): BootstrapAdminPort {
  return {
    grant: (telegramId: string) =>
      // ADR 0212: `provision_bootstrap_admin` لا `grant_bootstrap_admin` — الأولى تُنشئُ
      // الحسابَ إن غابَ، فلا يتوقّفُ المسؤولُ الأوّلُ على تسجيلٍ يشترطُ مدينةً مفعَّلةً
      // لا يُفعّلُها إلّا مسؤولٌ. وحين يوجدُ الصفُّ تُنادي هي الثانيةَ بعينِها.
      guard("rpc.provision_bootstrap_admin", async (): Promise<boolean> => {
        const rows = await sql<{ result: unknown }[]>`
          select provision_bootstrap_admin(${telegramId}::bigint) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        // idempotent بالتصميم: تكرار /start لا يكرّر صفّ التدقيق ولا يُعدّ فشلاً
        return envelope?.ok === true && envelope.granted === true;
      }),
  };
}
