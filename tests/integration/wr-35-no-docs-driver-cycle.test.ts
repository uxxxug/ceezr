/**
 * الغرض: WR-35 (التكليفُ الثاني) — تحقّقٌ مستقلٌّ أنْ لا شرطَ مخفيًّا يمنعُ سائقًا
 *   **بلا أيِّ وثيقةٍ** من التوثيقِ أو بدءِ التجربةِ أو دخولِ السباقِ تحتَ سياسةِ
 *   `driver_required_document_types = []` (قرارُ المالكِ، ADR 0302). والسياسةُ
 *   تُثبَّتُ هنا **صريحةً** ثمّ تُردُّ — لا تُورَثُ من ملفٍّ آخر.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على حارسِ F12-21 أو على
 *   `driver_document_dispatch_block_reasons` أو `start_trial`.
 * ملاحظات مستقبلية: السلسلةُ حتى إسنادِ طلبٍ فعليٍّ مقيسةٌ في
 *   `trial-lifecycle.test.ts` («السائقُ في تجربته يستقبل الطلبَ فعلاً») بلا
 *   وثائقَ مزروعةٍ؛ وهذا الملفُّ يقيسُ الحُرّاسَ التي يمرُّ بها ذلك المسارُ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import {
  pinRequiredDocumentTypes,
  type RequiredDocumentTypesSnapshot,
  restoreRequiredDocumentTypes,
} from "../support/required-documents-policy.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

type Payload = Record<string, unknown>;

let sql: Sql;
let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let policy: RequiredDocumentTypesSnapshot | undefined;
let adminId = "";
let driverId = "";
const DRIVER_TG = 935_900_001;

async function truncate(): Promise<void> {
  await sql`truncate table subscription_notices, notification_outbox, audit_log, subscriptions,
                           driver_documents, driver_capabilities, driver_availability, drivers, users
                     restart identity cascade`;
}

describeIf("WR-35 — دورةُ السائقِ بلا وثائقَ: لا حارسَ مخفيٌّ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    await truncate();
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
    });
    cityId = cityHandle.cityId;
    policy = await pinRequiredDocumentTypes(sql, cityId, []);

    const [admin] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, role)
      values (${cityId}::uuid, 935900000, 'مسؤول WR-35', 'admin') returning id
    `;
    adminId = admin?.id ?? "";
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}::uuid, ${DRIVER_TG}, 'سائق بلا وثائق', '+966500935900', 'driver')
      returning id
    `;
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}::uuid, ${user?.id ?? ""}::uuid, 'pending', 'sedan', 'WR35-ND')
      returning id
    `;
    driverId = driver?.id ?? "";
  });

  afterAll(async () => {
    await truncate();
    await restoreRequiredDocumentTypes(sql, policy);
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  it("السياسةُ المقروءةُ `[]` وحارسا التوثيقِ والسباقِ فارغانِ لسائقٍ بلا صفِّ وثيقةٍ", async () => {
    const [row] = await sql<
      { types: string[]; block: string[]; dispatch: string[]; docs: number }[]
    >`
      select driver_required_document_types(${cityId}::uuid)::text[] as types,
             driver_document_block_reasons(${driverId}::uuid, current_date) as block,
             driver_document_dispatch_block_reasons(${driverId}::uuid, current_date) as dispatch,
             (select count(*)::int from driver_documents where driver_id = ${driverId}::uuid) as docs
    `;
    expect(row?.types).toEqual([]);
    expect(row?.docs).toBe(0);
    expect(row?.block).toEqual([]);
    expect(row?.dispatch).toEqual([]);
  });

  it("توثيقُ الإدارةِ يمرُّ بلا وثيقةٍ ويبدأُ التجربةَ بمدّةِ الإعداداتِ لا بمدّةٍ مفترضة", async () => {
    const [res] = await sql<{ result: Payload }[]>`
      select admin_set_driver_verification(${adminId}::uuid, ${driverId}::uuid, 'verified', null) as result
    `;
    expect(res?.result.ok).toBe(true);
    expect(res?.result.status).toBe("verified");

    const [sub] = await sql<{ status: string; days: number; setting: number }[]>`
      select s.status::text as status,
             round(extract(epoch from (s.trial_ends_at - s.created_at)) / 86400)::int as days,
             get_setting_number(${cityId}::uuid, 'trial_days')::int as setting
        from subscriptions s where s.driver_id = ${driverId}::uuid
    `;
    expect(sub?.status).toBe("trialing");
    expect(sub?.days).toBe(sub?.setting ?? -1);
  });

  it("لوحُ العروضِ يقرأُ السائقَ موثَّقًا بلا سببِ حجبٍ وثائقيٍّ", async () => {
    const [offers] = await sql<{ result: Payload }[]>`
      select driver_offer_board(${DRIVER_TG}::bigint) as result
    `;
    expect(offers?.result.ok).toBe(true);
    expect(offers?.result.verification_status).toBe("verified");
    expect(offers?.result.block_reasons).toEqual([]);
    const [docs] = await sql<{ result: Payload }[]>`
      select driver_document_dashboard(${DRIVER_TG}::bigint) as result
    `;
    expect(docs?.result.required_document_types).toEqual([]);
    expect(docs?.result.is_blocked).toBe(false);
  });

  it("وثيقةٌ تاريخيّةٌ منتهيةٌ أو مرفوضةٌ لا تحجبُ تحتَ `[]` — الحارسُ لا يقرأُ غيرَ المطلوب", async () => {
    await sql`
      insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at, reviewed_at, review_note)
      values (${cityId}::uuid, ${driverId}::uuid, 'driving_license', 'accepted',
              ${`drivers/${driverId}/driving_license/x.png`}, current_date - 10, now(), now(), null),
             (${cityId}::uuid, ${driverId}::uuid, 'insurance', 'rejected',
              ${`drivers/${driverId}/insurance/x.png`}, current_date + 100, now(), now(), 'صورة غير واضحة')
    `;
    const [row] = await sql<{ block: string[]; dispatch: string[] }[]>`
      select driver_document_block_reasons(${driverId}::uuid, current_date) as block,
             driver_document_dispatch_block_reasons(${driverId}::uuid, current_date) as dispatch
    `;
    expect(row?.block).toEqual([]);
    expect(row?.dispatch).toEqual([]);
  });

  it("والحارسُ لم يُعطَّل: إلزامٌ غيرُ فارغٍ يعودُ فيحجبُ التوثيقَ (انحدارُ F12-21)", async () => {
    await pinRequiredDocumentTypes(sql, cityId, ["vehicle_registration"]);
    try {
      const [row] = await sql<{ block: string[] }[]>`
        select driver_document_block_reasons(${driverId}::uuid, current_date) as block
      `;
      expect(row?.block).toEqual(["MISSING:vehicle_registration"]);
    } finally {
      await pinRequiredDocumentTypes(sql, cityId, []);
    }
  });
});
