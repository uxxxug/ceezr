/**
 * الغرض: مراجعةُ وثائقِ السائقِ من لوحةِ الإدارةِ (`PD-042`) على قاعدةٍ حقيقيّةٍ —
 *   الصلاحيّةُ، والقرارُ، والسببُ، وحالُ الوثيقةِ، والانتهاءُ، والمراجِعُ والوقتُ،
 *   والتدقيقُ بلا بيانةٍ شخصيّةٍ، ثمَّ المسارُ الرسميُّ حتّى التوثيق.
 *
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * الحاكم: docs/adr/0256-owner-decisions-20261010-driver-onboarding-review.md
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly changed?: boolean;
  readonly status?: string;
  readonly block_reasons?: readonly string[];
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let adminUserId = "";
let blockedAdminId = "";
let driverId = "";
let driverUserId = "";
let requiredTypes: readonly string[] = [];
let ungrantedAdminId = "";
let otherCityId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [types] = await sql<{ types: string[] }[]>`
    select driver_required_document_types(${cityId}::uuid)::text[] as types
  `;
  requiredTypes = types?.types ?? [];
  if (requiredTypes.length < 2) throw new Error("تعذّر الزرعُ: أقلُّ من نوعَين إلزاميَّين");

  const [admin] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_461, 'admin', 'مراجعُ الوثائقِ', '+966500000461')
    returning id
  `;
  const [blocked] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, is_blocked)
    values (${cityId}, 900_000_462, 'admin', 'مسؤولٌ محظورٌ', '+966500000462', true)
    returning id
  `;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_463, 'driver', 'سائقُ المراجعةِ', '+966500000463')
    returning id
  `;
  if (admin === undefined || blocked === undefined || user === undefined) {
    throw new Error("تعذّر زرعُ المستخدمين");
  }
  adminUserId = admin.id;
  blockedAdminId = blocked.id;
  driverUserId = user.id;

  const [ungranted] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_464, 'admin', 'مسؤولٌ بلا منح', '+966500000464')
    returning id
  `;
  if (ungranted === undefined) throw new Error("تعذّر زرعُ المسؤولِ بلا منح");
  ungrantedAdminId = ungranted.id;
  const [other] = await sql<{ id: string }[]>`
    select id from cities where id <> ${cityId}::uuid order by code limit 1
  `;
  if (other === undefined) throw new Error("تعذّر إيجادُ مدينةٍ ثانية");
  otherCityId = other.id;

  // المنحُ الصريحُ لمدينةِ الاختبارِ وحدَها — `adminUserId` يمنحُ نفسَه عبرَ بابِ الخدمة
  // (سكربتُ التشغيل)، فلا مسارَ ويبَ في هذا كلِّه.
  const [granted] = await sql<{ result: Payload }[]>`
    select admin_set_document_reviewer(${admin.id}::uuid, ${admin.id}::uuid, ${cityId}::uuid, true) as result
  `;
  if (granted?.result.ok !== true) throw new Error("تعذّر المنحُ");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${user.id}, 'pending'::verification_status, 'سيدان', 'ر س د 463')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    await sql`delete from audit_log where entity_id = ${driverId}
                 or entity_id in (select id from driver_documents where driver_id = ${driverId})`;
    await sql`delete from driver_documents where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from subscription_wallets where driver_id = ${driverId}`;
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  for (const id of [driverUserId, adminUserId, blockedAdminId, ungrantedAdminId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id} or entity_id = ${id}`;
    await sql`delete from driver_document_reviewers where user_id = ${id} or granted_by = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
});

async function day(offset: number): Promise<string> {
  const [row] = await sql<{ day: string }[]>`
    select to_char(current_date + ${offset}::integer, 'YYYY-MM-DD') as day
  `;
  if (row === undefined) throw new Error("تعذّر قراءةُ اليومِ");
  return row.day;
}

/** وثيقةٌ في حالٍ معلومةٍ — كما تتركُها `submit_driver_documents_for_review`. */
async function seedDocument(
  docType: string,
  status: string,
  expiresAt: string | null,
): Promise<void> {
  const objectPath = `drivers/${driverId}/${docType}/${docType}.png`;
  await sql`
    insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at)
    values (${cityId}, ${driverId}, ${docType}::driver_document_type, ${status}::driver_document_status,
            ${objectPath}, ${expiresAt}::date, now())
    on conflict (driver_id, doc_type) do update
      set status = excluded.status, expires_at = excluded.expires_at, review_note = null,
          reviewed_at = null, reviewed_by = null
  `;
}

function review(
  actor: string,
  docType: string,
  decision: string,
  note: string | null,
): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select admin_review_driver_document(
      ${actor}::uuid, ${driverId}::uuid, ${docType}::text, ${decision}::text, ${note}::text
    ) as result
  `);
}

async function readDocument(docType: string) {
  const [row] = await sql<
    {
      status: string;
      review_note: string | null;
      reviewed_by: string | null;
      reviewed_at: Date | null;
    }[]
  >`
    select status::text as status, review_note, reviewed_by, reviewed_at
      from driver_documents
     where driver_id = ${driverId} and doc_type = ${docType}::driver_document_type
  `;
  if (row === undefined) throw new Error("لا وثيقة");
  return row;
}

describeIf("PD-042 · admin_review_driver_document على قاعدةٍ حقيقيّة", () => {
  it("يرفضُ غيرَ المسؤولِ والمسؤولَ المحظورَ ولا يمسُّ الوثيقة", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(365));
    expect((await review(driverUserId, docType, "accepted", null)).error).toBe("NOT_ADMIN");
    expect((await review(blockedAdminId, docType, "accepted", null)).error).toBe("NOT_ADMIN");
    expect((await readDocument(docType)).status).toBe("under_review");
  });

  it("يرفضُ القرارَ المجهولَ والنوعَ المجهولَ", async () => {
    const docType = requiredTypes[0] as string;
    expect((await review(adminUserId, docType, "verified", null)).error).toBe("INVALID_DECISION");
    expect((await review(adminUserId, "passport", "accepted", null)).error).toBe(
      "DOCUMENT_NOT_FOUND",
    );
  });

  it("لا يحكمُ على وثيقةٍ لم يُرسِلْها صاحبُها", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "received", await day(365));
    expect((await review(adminUserId, docType, "accepted", null)).error).toBe("NOT_UNDER_REVIEW");
  });

  it("الرفضُ والنقصُ يحتاجانِ سبباً لا يتجاوزُ 500 حرف", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(365));
    expect((await review(adminUserId, docType, "rejected", "  ")).error).toBe("NOTE_REQUIRED");
    expect((await review(adminUserId, docType, "incomplete", null)).error).toBe("NOTE_REQUIRED");
    expect((await review(adminUserId, docType, "rejected", "س".repeat(501))).error).toBe(
      "NOTE_TOO_LONG",
    );
  });

  it("لا قبولَ لمنتهيةٍ ولا لبلا تاريخِ انتهاء", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(-1));
    expect((await review(adminUserId, docType, "accepted", null)).error).toBe("DOCUMENT_EXPIRED");
    await seedDocument(docType, "under_review", null);
    expect((await review(adminUserId, docType, "accepted", null)).error).toBe("EXPIRY_REQUIRED");
  });

  it("الرفضُ يحفظُ السببَ والمراجِعَ والوقتَ، والتدقيقُ بلا نصِّ السبب، والحجبُ يظهر", async () => {
    const docType = requiredTypes[1] as string;
    await seedDocument(docType, "under_review", await day(365));
    const result = await review(adminUserId, docType, "rejected", "الصورة غير واضحة");
    expect(result).toMatchObject({ ok: true, status: "rejected" });

    const row = await readDocument(docType);
    expect(row.status).toBe("rejected");
    expect(row.review_note).toBe("الصورة غير واضحة");
    expect(row.reviewed_by).toBe(adminUserId);
    expect(row.reviewed_at).not.toBeNull();

    const audit = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log
       where action = 'admin.driver_document_reviewed' and actor_user_id = ${adminUserId}
         and payload ->> 'doc_type' = ${docType}
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({ from: "under_review", to: "rejected" });
    expect(JSON.stringify(audit[0]?.payload)).not.toContain("الصورة غير واضحة");
    expect(JSON.stringify(audit[0]?.payload)).not.toContain(".png");

    const [reasons] = await sql<{ reasons: string[] }[]>`
      select driver_document_block_reasons(${driverId}::uuid) as reasons
    `;
    expect(reasons?.reasons).toContain(`REJECTED:${docType}`);

    // الحكمُ لا يُعادُ صامتاً
    expect((await review(adminUserId, docType, "accepted", null)).error).toBe("NOT_UNDER_REVIEW");
  });

  it("المسارُ الرسميُّ كاملاً: قبولُ كلِّ الإلزاميِّ ثمَّ التوثيقُ — وقبلَه يُرفَضُ التوثيق", async () => {
    const expiry = await day(365);
    for (const docType of requiredTypes) await seedDocument(docType, "under_review", expiry);

    const early = await callJson(sql<{ result: Payload }[]>`
      select admin_set_driver_verification(${adminUserId}::uuid, ${driverId}::uuid, 'verified') as result
    `);
    expect(early.error).toBe("INCOMPLETE_DOCUMENTS");

    for (const docType of requiredTypes) {
      const result = await review(adminUserId, docType, "accepted", "ملاحظة تُهمَل عند القبول");
      expect(result).toMatchObject({ ok: true, status: "accepted" });
      const row = await readDocument(docType);
      expect(row.review_note).toBeNull();
      expect(row.reviewed_by).toBe(adminUserId);
    }

    const [statusBefore] = await sql<{ s: string }[]>`
      select verification_status::text as s from drivers where id = ${driverId}
    `;
    // القبولُ لا يوثّقُ السائقَ — التوثيقُ قرارٌ ثانٍ صريح
    expect(statusBefore?.s).toBe("pending");

    const verified = await callJson(sql<{ result: Payload }[]>`
      select admin_set_driver_verification(${adminUserId}::uuid, ${driverId}::uuid, 'verified') as result
    `);
    expect(verified).toMatchObject({ ok: true, status: "verified" });
  });

  it("صفةُ admin بلا منحٍ لا تحكمُ ولا تكشفُ حالَ الوثيقة", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(365));
    expect((await review(ungrantedAdminId, docType, "accepted", null)).error).toBe(
      "NOT_DOCUMENT_REVIEWER",
    );
    expect((await readDocument(docType)).status).toBe("under_review");
  });

  it("المنحُ محصورٌ بمدينتِه: منحُ مدينةٍ أخرى لا يفتحُ وثيقةَ هذه", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(365));
    const granted = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${ungrantedAdminId}::uuid, ${otherCityId}::uuid, true) as result
    `);
    expect(granted).toMatchObject({ ok: true, changed: true });
    expect((await review(ungrantedAdminId, docType, "accepted", null)).error).toBe(
      "NOT_DOCUMENT_REVIEWER",
    );
    const opened = await callJson(sql<{ result: Payload }[]>`
      select admin_open_driver_document(${ungrantedAdminId}::uuid, ${driverId}::uuid, ${docType}::text) as result
    `);
    expect(opened.error).toBe("NOT_DOCUMENT_REVIEWER");
    expect(opened.object_path).toBeUndefined();
  });

  it("المنحُ يقبلُ مسؤولاً غيرَ محظورٍ وحدَه، ويُسحَبُ بختمٍ مدقَّقٍ لا بحذف", async () => {
    const toDriver = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${driverUserId}::uuid, ${cityId}::uuid, true) as result
    `);
    expect(toDriver.error).toBe("TARGET_NOT_ADMIN");
    const toBlocked = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${blockedAdminId}::uuid, ${cityId}::uuid, true) as result
    `);
    expect(toBlocked.error).toBe("TARGET_NOT_ADMIN");
    const byDriver = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${driverUserId}::uuid, ${adminUserId}::uuid, ${cityId}::uuid, true) as result
    `);
    expect(byDriver.error).toBe("NOT_ADMIN");

    const again = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${ungrantedAdminId}::uuid, ${otherCityId}::uuid, true) as result
    `);
    expect(again).toMatchObject({ ok: true, changed: false });
    const revoked = await callJson(sql<{ result: Payload }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${ungrantedAdminId}::uuid, ${otherCityId}::uuid, false) as result
    `);
    expect(revoked).toMatchObject({ ok: true, changed: true });
    const rows = await sql<{ revoked: boolean }[]>`
      select revoked_at is not null as revoked from driver_document_reviewers
       where user_id = ${ungrantedAdminId}::uuid and city_id = ${otherCityId}::uuid
    `;
    expect(rows.map((r) => r.revoked)).toEqual([true]);
    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${ungrantedAdminId}::uuid order by created_at
    `;
    expect(audit.map((a) => a.action)).toEqual([
      "admin.document_reviewer_granted",
      "admin.document_reviewer_revoked",
    ]);
  });

  it("فتحُ الوثيقةِ يمرُّ بالبابِ المدقَّقِ: سطرُ تدقيقٍ بلا مسارٍ ولا رابط، ولا وثيقةَ سائقٍ آخر", async () => {
    const docType = requiredTypes[0] as string;
    await seedDocument(docType, "under_review", await day(365));
    const opened = await callJson(sql<{ result: Payload }[]>`
      select admin_open_driver_document(${adminUserId}::uuid, ${driverId}::uuid, ${docType}::text) as result
    `);
    expect(opened.ok).toBe(true);
    expect(opened.object_path).toBe(`drivers/${driverId}/${docType}/${docType}.png`);

    const audit = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log
       where action = 'admin.driver_document_viewed' and actor_user_id = ${adminUserId}
    `;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]?.payload).toMatchObject({ driver_id: driverId, doc_type: docType });
    expect(JSON.stringify(audit)).not.toContain(".png");
    expect(JSON.stringify(audit)).not.toContain("drivers/");

    const stranger = await callJson(sql<{ result: Payload }[]>`
      select admin_open_driver_document(${adminUserId}::uuid, gen_random_uuid(), ${docType}::text) as result
    `);
    expect(stranger.error).toBe("DOCUMENT_NOT_FOUND");
    const notAdmin = await callJson(sql<{ result: Payload }[]>`
      select admin_open_driver_document(${driverUserId}::uuid, ${driverId}::uuid, ${docType}::text) as result
    `);
    expect(notAdmin.error).toBe("NOT_ADMIN");
  });
});
