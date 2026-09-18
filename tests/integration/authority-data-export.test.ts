/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيّةٍ لقدرةِ تزويدِ الهيئةِ بالبياناتِ (`F12-09`).
 *   المقصودُ إثباتُ ما لا يُثبتُه mock ولا حاجزٌ ساكنٌ:
 *     ــ أنَّ الطلبَ العاجلَ يُصنِّفُ الموعدَ 6 ساعاتٍ، والآجلَ 48 ساعةً.
 *     ــ أنَّ الحزمةَ تُولَّدُ من ستّةِ أقسامٍ (سائق · سيارة · راكب · سلامة · وثائق · تدقيق).
 *     ــ أنَّ القسمَ الفارغَ يُنشَرُ `DOMAIN_NOT_AVAILABLE` لا يُسكَتُ.
 *     ــ أنَّ الموعدَ المنقضيَ يُكشَفُ.
 *     ــ أنَّ الطلبَ المُسلَّمَ لا يُعادُ توليدُه.
 * الحالة: منفّذ فعلياً — 2026-09-18.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: لا شيءَ — البندُ قدرةُ تزويدٍ لا تكاملَ.
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

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let requesterId: string;

const REQUESTER_TELEGRAM = 959001;

describeIf("F12-09 — قدرةُ تزويدِ الهيئةِ بالبيانات", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL! });

    const cityResult = await ensureActiveCity(sql);
    cityId = cityResult.cityId;
    cityHandle = cityResult;

    // إنشاءُ المستخدمِ الذي يطلبُ التزويدَ
    const users = await sql`
      insert into users (telegram_id, full_name, role, city_id, language_code)
      values (${REQUESTER_TELEGRAM}, 'Authority Requester', 'admin', ${cityId}::uuid, 'ar')
      on conflict (telegram_id) do update set full_name = excluded.full_name
      returning id
    `;
    requesterId = users[0]?.id as string;
  });

  afterAll(async () => {
    if (cityHandle) {
      await restoreCityBaseline(sql, cityHandle);
    }
    await sql.end();
  });

  it("يُصنِّفُ الطلبَ العاجلَ بموعدِ 6 ساعاتٍ", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    const rows = await sql`
      select deadline_at, urgency, status
      from authority_data_requests
      where id = ${requestId}::uuid
    `;
    const row = rows[0]!;

    const deadline = new Date(row.deadline_at as string).getTime();
    const now = Date.now();
    const sixHours = 6 * 60 * 60 * 1000;

    expect(deadline - now).toBeGreaterThan(sixHours - 60000);
    expect(deadline - now).toBeLessThan(sixHours + 60000);
    expect(row.urgency as string).toBe("urgent");
    expect(row.status as string).toBe("requested");
  });

  it("يُصنِّفُ الطلبَ الآجلَ بموعدِ 48 ساعةً", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'non_urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    const rows = await sql`
      select deadline_at, urgency
      from authority_data_requests
      where id = ${requestId}::uuid
    `;
    const row = rows[0]!;

    const deadline = new Date(row.deadline_at as string).getTime();
    const now = Date.now();
    const fortyEightHours = 48 * 60 * 60 * 1000;

    expect(deadline - now).toBeGreaterThan(fortyEightHours - 60000);
    expect(deadline - now).toBeLessThan(fortyEightHours + 60000);
    expect(row.urgency as string).toBe("non_urgent");
  });

  it("يُولِّدُ حزمةً بستّةِ أقسامٍ — كلُّ قسمٍ يَردُّ", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'non_urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    // توليدُ الحزمةِ
    await sql`select generate_authority_data_package(${requestId}::uuid)`;

    // قراءةُ الحزمةِ من الجدولِ
    const rows = await sql`
      select status, generated_at, package
      from authority_data_requests
      where id = ${requestId}::uuid
    `;
    const row = rows[0]!;
    expect(row.status as string).toBe("generated");
    expect(row.generated_at).not.toBeNull();

    const pkg = row.package as Record<string, unknown>;
    expect(pkg.ok).toBe(true);
    const sections = pkg.sections as Record<string, unknown>;
    expect(sections).toBeDefined();
    expect(sections.drivers).toBeDefined();
    expect(sections.riders).toBeDefined();
    expect(sections.orders).toBeDefined();
    expect(sections.safety).toBeDefined();
    expect(sections.documents).toBeDefined();
    expect(sections.audit).toBeDefined();
  });

  it("ينشرُ DOMAIN_NOT_AVAILABLE للقسمِ الفارغِ لا يَسكُتُ", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'non_urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    await sql`select generate_authority_data_package(${requestId}::uuid)`;

    const rows = await sql`
      select package from authority_data_requests where id = ${requestId}::uuid
    `;
    const row = rows[0]!;
    const pkg = row.package as Record<string, unknown>;
    const sections = pkg.sections as Record<string, unknown>;

    // كلُّ قسمٍ يجبُ أن يَردَّ — ببياناتٍ أو بـDOMAIN_NOT_AVAILABLE
    for (const key of Object.keys(sections)) {
      const section = sections[key];
      if (typeof section === "string") {
        expect(section).toBe("DOMAIN_NOT_AVAILABLE");
      } else {
        expect(Array.isArray(section)).toBe(true);
      }
    }
  });

  it("يرفضُ إعادةَ توليدِ الطلبِ المُسلَّمِ", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    // توليدُ الحزمةِ أوّلَ مرّةٍ
    await sql`select generate_authority_data_package(${requestId}::uuid)`;

    // تسليمُ الطلبِ
    await sql`update authority_data_requests set status = 'delivered' where id = ${requestId}::uuid`;

    // محاولةُ إعادةِ التوليدِ — يجبُ أن ترفضَ
    const results = await sql`
      select generate_authority_data_package(${requestId}::uuid) as result
    `;
    const result = results[0]?.result as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ALREADY_DELIVERED");
  });

  it("يَحكُمُ بانقضاءِ الموعدِ للطلبِ غيرِ المُسلَّمِ", async () => {
    const requests = await sql`
      select * from create_authority_data_request(
        ${requesterId}::uuid,
        ${cityId}::uuid,
        'urgent'::authority_request_urgency
      ) as request_id
    `;
    const requestId = requests[0]?.request_id as string;

    // تقديمُ الموعدِ إلى الماضي
    await sql`
      update authority_data_requests
      set deadline_at = now() - interval '1 hour'
      where id = ${requestId}::uuid
    `;

    const overdueResults = await sql`
      select authority_data_request_is_overdue(${requestId}::uuid) as is_overdue
    `;

    expect(overdueResults[0]?.is_overdue as boolean).toBe(true);
  });
});
