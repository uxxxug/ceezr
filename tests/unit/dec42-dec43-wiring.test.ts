/**
 * الغرض: إثبات أنّ تبعيّاتِ DEC-42 (تفضيلاتُ الإشعارات) و DEC-43 (محادثةُ التذكرة)
 *   **موصولةٌ فعلًا في `apps/gateway/src/index.ts`** — لا مجرّد مساراتٍ موجودةٍ في
 *   `server.ts` بلا تبعيّات.
 *
 *   وهذا الاختبار كُتب لأنّ فحصَ البيئةِ الفعليّةِ كشفَ ثغرةً حقيقيّة: مساراتُ
 *   `GET/PUT /v1/me/notification-preferences` (DEC-42) و`POST/GET /v1/support/tickets/:id/messages`
 *   (DEC-43) كانت مبنيةً ومُختبَرةً **وغيرَ موصولةٍ** — لا استيرادَ للمخازن في `index.ts`
 *   ولا تمريرَ للتبعيّات إلى `createServer`. فالمساراتُ الموجودةُ بلا توصيلٍ أخطرُ من
 *   الحذف: الحذفُ يُلاحَظ، والوجودُ الصامتُ يُطمئن.
 *
 *   والاختبارُ ساكنٌ يقرأُ المصدر: لا يُقلعُ البوّابة ولا يتصلُ بقاعدة. وهو يفحصُ
 *   وجودَ الاستيرادِ ووجودَ التمريرِ معًا — فالأوّلُ بلا الثاني لا يعني شيئًا.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX_PATH = join(import.meta.dir, "..", "..", "apps", "gateway", "src", "index.ts");
const source = readFileSync(INDEX_PATH, "utf-8");

describe("DEC-42 notification preferences wiring", () => {
  it("يستوردُ المخزنَ من طبقةِ البنية التحتية", () => {
    expect(source).toContain("createNotificationPrefsReader");
    expect(source).toContain("createNotificationPrefsWriter");
    expect(source).toContain("notification-prefs-store");
  });

  it("يُمرِّرُ التبعيّاتِ إلى createServer", () => {
    expect(source).toContain("notificationPrefs === undefined ? {} : { notificationPrefs }");
  });
});

describe("DEC-43 ticket threads wiring", () => {
  it("يستوردُ المخزنَ من طبقةِ البنية التحتية", () => {
    expect(source).toContain("createTicketThreadReader");
    expect(source).toContain("createTicketThreadWriter");
    expect(source).toContain("ticket-threads-store");
  });

  it("يُمرِّرُ التبعيّاتِ داخلَ كائنِ الدعم", () => {
    expect(source).toContain("threads:");
    expect(source).toContain("createTicketThreadReader(container.sql)");
    expect(source).toContain("createTicketThreadWriter(container.sql)");
  });
});
