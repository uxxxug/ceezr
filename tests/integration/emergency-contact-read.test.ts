/**
 * الغرض: قياسُ `read_emergency_contact` على PostgreSQL حقيقيٍّ — «لا جهةَ بعدُ» ليسَ «لا حساب».
 * الحالة: منفّذ فعلياً — 2026-10-07 (UI-10 · ADR 0245).
 * ينتمي إلى: tests/integration
 * الحاكم: `DEC-41` · هجرةُ `20261007120000_ui_10_emergency_contact_read_found.sql`.
 *
 * ## لماذا هذا الاختبار
 *
 * في PL/pgSQL `record is null` صادقٌ متى فرغت كلُّ حقولِه؛ فكانت الدالّةُ تُعيدُ
 * `USER_NOT_FOUND` لكلِّ مستخدمٍ موجودٍ لم يحفظْ جهةً — والخطأُ لا يظهرُ إلّا في قاعدةٍ
 * حقيقيّة (اختبارُ الوحدةِ يحقنُ منفذاً مزيّفاً). قِيسَ في متصفّحٍ حيٍّ في UI-10.
 *
 * ١. مستخدمٌ موجودٌ بلا جهة ⇒ `ok: true` و`name/phone = null`.
 * ٢. بعدَ الحفظِ ⇒ القيمُ المحفوظةُ نفسُها، عبرَ منفذِ البنيةِ الحقيقيّ.
 * ٣. معرّفٌ لا مستخدمَ له ⇒ `USER_NOT_FOUND` (لا يُخلَطُ بالأوّل).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createEmergencyContactReader,
  createEmergencyContactWriter,
} from "../../packages/infrastructure/safety/emergency-contact-store.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ قراءةِ جهةِ الطوارئِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const RUN_BASE = 3_100_000_000 + (Date.now() % 800_000_000);
const TG = { noContact: RUN_BASE + 1, saved: RUN_BASE + 2, missing: RUN_BASE + 3 } as const;
const UUIDS = {
  city: "55555555-0000-0000-0000-0000000000e1",
  noContact: "66666666-0000-0000-0000-0000000000e1",
  saved: "66666666-0000-0000-0000-0000000000e2",
} as const;

describeIf("UI-10 — قراءةُ جهةِ الطوارئِ: «لا جهة» ليسَ «لا حساب»", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    await sql`begin`;
    await sql`insert into cities (id, code, name_ar, name_en, is_active)
      values (${UUIDS.city}, 'EC1', 'مدينة اختبار الطوارئ', 'Emergency Test City', false)`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.noContact}, ${UUIDS.city}, ${TG.noContact}, 'rider', 'بلا جهة', 'ar', false)`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.saved}, ${UUIDS.city}, ${TG.saved}, 'rider', 'بجهة', 'ar', false)`;
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  it("١. مستخدمٌ موجودٌ بلا جهةٍ ⇒ ok وقيمٌ فارغة (لا USER_NOT_FOUND)", async () => {
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select read_emergency_contact(${String(TG.noContact)}) as result`;
    expect(rows[0]?.result).toEqual({ ok: true, status: "found", name: null, phone: null });

    const viaPort = await createEmergencyContactReader(sql).read(String(TG.noContact));
    expect(viaPort).toEqual({ ok: true, value: { name: null, phone: null } });
  });

  it("٢. بعدَ الحفظِ تُقرأُ القيمُ نفسُها", async () => {
    const saved = await createEmergencyContactWriter(sql).upsert({
      telegramUserId: String(TG.saved),
      name: "سارة",
      phone: "966500000001",
    });
    expect(saved.ok).toBe(true);
    const read = await createEmergencyContactReader(sql).read(String(TG.saved));
    expect(read).toEqual({ ok: true, value: { name: "سارة", phone: "966500000001" } });
  });

  it("٣. معرّفٌ بلا مستخدمٍ ⇒ USER_NOT_FOUND", async () => {
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select read_emergency_contact(${String(TG.missing)}) as result`;
    expect(rows[0]?.result).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });
});
