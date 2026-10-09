/**
 * الغرض: تسجيلُ السائقِ من التطبيقِ المصغَّرِ حتّى المراجعة (`PRD-105` · `ADR 0257`) على قاعدةٍ
 *   حقيقيّة — الإثباتُ، ولا توثيقَ آليّ، وإعادةُ المحاولةِ بلا تكرار، والهويّةُ المكرَّرة، ثمَّ
 *   الوثائقُ (مسارُ غيري · منتهية · ناقصة · رفض · طلبُ استكمال) والمراجعةُ وسدُّ تجاوزِها.
 *
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type DialogState, INITIAL_STATE } from "../../packages/application/bots/types.ts";
import {
  createDriverPhoneProofs,
  type DriverOnboardingDeps,
  onboardDriver,
} from "../../packages/application/identity/onboard-driver.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createCityDirectory } from "../../packages/infrastructure/geo/city-directory.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const DRIVER_TG = "900000471";
const SECOND_TG = "900000472";
const ADMIN_TG = 900_000_473;
const UNGRANTED_TG = 900_000_474;
const NATIONAL_ID = "1099900471";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly status?: string;
  readonly [key: string]: unknown;
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let adminId = "";
let ungrantedId = "";
let requiredTypes: readonly string[] = [];
const sessions = new Map<string, DialogState>();

const sessionStore = {
  load: async (id: string) => ok(sessions.get(id) ?? null),
  save: async (id: string, state: DialogState) => {
    sessions.set(id, state);
    return ok(undefined);
  },
  clear: async (id: string) => {
    sessions.delete(id);
    return ok(undefined);
  },
};

function depsFor(telegramUserId: string): DriverOnboardingDeps {
  return {
    viewer: {
      now: () => new Date(),
      sessions: {
        read: async () =>
          ok({
            telegramUserId,
            bot: "driver",
            sessionId: `s-${telegramUserId}`,
            issuedAtSeconds: 1,
            expiresAtSeconds: 2,
          }),
      } as never,
      accounts: createViewerAccountReader(sql),
    },
    drivers: createDriverDirectory(sql),
    cities: createCityDirectory(sql),
    phoneProofs: createDriverPhoneProofs(sessionStore),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "tok",
    fullName: "سائق التطبيق",
    cityId,
    service: "transport",
    vehicleType: "sedan",
    plateNumber: "ABC 4710",
    nationalId: NATIONAL_ID,
    language: "ar",
    ...overrides,
  };
}

async function one(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردّ");
  return row.result;
}

async function driverIdOf(tg: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint
  `;
  if (row === undefined) throw new Error("لا سائق");
  return row.id;
}

async function day(offset: number): Promise<string> {
  const [row] = await sql<{ d: string }[]>`select (current_date + ${offset}::int)::text as d`;
  return row?.d ?? "";
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [types] = await sql<{ t: string[] }[]>`
    select driver_required_document_types(${cityId}::uuid)::text[] as t
  `;
  requiredTypes = types?.t ?? [];
  const [admin] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${ADMIN_TG}, 'admin', 'مراجعٌ', '+966500000473') returning id
  `;
  const [ungranted] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${UNGRANTED_TG}, 'admin', 'مسؤولٌ بلا منح', '+966500000474') returning id
  `;
  if (admin === undefined || ungranted === undefined) throw new Error("تعذّر الزرع");
  adminId = admin.id;
  ungrantedId = ungranted.id;
  await sql`select admin_set_document_reviewer(${adminId}::uuid, ${adminId}::uuid, ${cityId}::uuid, true)`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  const tgs = [DRIVER_TG, SECOND_TG, String(ADMIN_TG), String(UNGRANTED_TG)];
  await sql`delete from audit_log where actor_user_id in
              (select id from users where telegram_id = any(${tgs}::bigint[]))
              or entity_id in (select d.id from drivers d join users u on u.id = d.user_id
                               where u.telegram_id = any(${tgs}::bigint[]))
              or entity_id in (select dd.id from driver_documents dd join drivers d on d.id = dd.driver_id
                               join users u on u.id = d.user_id where u.telegram_id = any(${tgs}::bigint[]))`;
  await sql`delete from driver_document_reviewers where user_id in
              (select id from users where telegram_id = any(${tgs}::bigint[]))`;
  await sql`delete from users where telegram_id = any(${tgs}::bigint[])`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("PRD-105 · تسجيلُ السائقِ من التطبيقِ حتّى المراجعة", () => {
  it("بلا إثباتِ رقم ⇒ PHONE_NOT_VERIFIED ولا صفَّ في القاعدة", async () => {
    const result = await onboardDriver(input(), depsFor(DRIVER_TG));
    expect(result.ok ? null : result.error.code).toBe("PHONE_NOT_VERIFIED");
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from users where telegram_id = ${DRIVER_TG}::bigint
    `;
    expect(row?.n).toBe(0);
  });

  it("بالإثبات ⇒ سائقٌ pending بلا توثيقٍ آليّ؛ وثلاثُ محاولاتٍ متزامنةٍ لا تُكرِّر", async () => {
    sessions.set(DRIVER_TG, { ...INITIAL_STATE, draftPhone: "+966500000471" });
    const deps = depsFor(DRIVER_TG);
    const results = await Promise.all([
      onboardDriver(input(), deps),
      onboardDriver(input(), deps),
      onboardDriver(input(), deps),
    ]);
    expect(results.some((r) => r.ok)).toBe(true);
    for (const r of results) {
      if (!r.ok) expect(["ALREADY_REGISTERED", "PHONE_NOT_VERIFIED"]).toContain(r.error.code);
    }
    const [counts] = await sql<{ users: number; drivers: number; caps: number }[]>`
      select (select count(*)::int from users where telegram_id = ${DRIVER_TG}::bigint) as users,
             (select count(*)::int from drivers d join users u on u.id = d.user_id
               where u.telegram_id = ${DRIVER_TG}::bigint) as drivers,
             (select count(*)::int from driver_capabilities c join drivers d on d.id = c.driver_id
               join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_TG}::bigint) as caps
    `;
    expect(counts).toEqual({ users: 1, drivers: 1, caps: 1 });
    const [driver] = await sql<
      { status: string; phone: string; role: string; photo: string | null; available: boolean }[]
    >`
      select d.verification_status::text as status, u.phone, u.role::text as role,
             d.vehicle_photo_file_id as photo, a.is_available as available
        from drivers d join users u on u.id = d.user_id
        join driver_availability a on a.driver_id = d.id
       where u.telegram_id = ${DRIVER_TG}::bigint
    `;
    expect(driver).toEqual({
      status: "pending",
      phone: "+966500000471",
      role: "driver",
      photo: null,
      available: false,
    });
    expect(sessions.get(DRIVER_TG)?.draftPhone ?? null).toBeNull();

    const again = await onboardDriver(input(), deps);
    expect(again.ok ? null : again.error.code).toBe("ALREADY_REGISTERED");
  });

  it("هويّةٌ مسجَّلةٌ لسائقٍ آخرَ في المدينة ⇒ NATIONAL_ID_TAKEN ولا مستخدمَ نصفيّ", async () => {
    sessions.set(SECOND_TG, { ...INITIAL_STATE, draftPhone: "+966500000472" });
    const result = await onboardDriver(input({ plateNumber: "XYZ 4720" }), depsFor(SECOND_TG));
    expect(result.ok ? null : result.error.code).toBe("NATIONAL_ID_TAKEN");
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from users where telegram_id = ${SECOND_TG}::bigint
    `;
    expect(row?.n).toBe(0);
    expect(sessions.get(SECOND_TG)?.draftPhone).toBe("+966500000472");
  });

  it("الوثائق: مسارُ غيري مرفوض، والمنتهيةُ مرفوضة، والناقصُ لا يُرسَل", async () => {
    const driverId = await driverIdOf(DRIVER_TG);
    const docType = requiredTypes[0] ?? "driving_license";
    const future = await day(365);

    const foreign = await one(sql<{ result: Payload }[]>`
      select record_driver_document(${DRIVER_TG}::bigint, ${docType}::driver_document_type,
        ${`drivers/00000000-0000-0000-0000-000000000000/${docType}/x.png`}, ${future}::date) as result
    `);
    expect(foreign.error).toBe("OBJECT_PATH_NOT_MINE");

    const expired = await one(sql<{ result: Payload }[]>`
      select record_driver_document(${DRIVER_TG}::bigint, ${docType}::driver_document_type,
        ${`drivers/${driverId}/${docType}/a.png`}, ${await day(-1)}::date) as result
    `);
    expect(expired.error).toBe("EXPIRY_IN_PAST");

    const partial = await one(sql<{ result: Payload }[]>`
      select submit_driver_documents_for_review(${DRIVER_TG}::bigint) as result
    `);
    expect(partial.error).toBe("DOCUMENTS_INCOMPLETE");
  });

  it("الإرسالُ ثمَّ المراجعة: نقصٌ ورفضٌ بسببٍ ثمَّ قبول — ولا توثيقَ قبلَ قبولِ الكلّ ولا بلا منح", async () => {
    const driverId = await driverIdOf(DRIVER_TG);
    const future = await day(365);
    for (const docType of requiredTypes) {
      const recorded = await one(sql<{ result: Payload }[]>`
        select record_driver_document(${DRIVER_TG}::bigint, ${docType}::driver_document_type,
          ${`drivers/${driverId}/${docType}/doc.png`}, ${future}::date) as result
      `);
      expect(recorded.ok).toBe(true);
    }
    const submitted = await one(sql<{ result: Payload }[]>`
      select submit_driver_documents_for_review(${DRIVER_TG}::bigint) as result
    `);
    expect(submitted.ok).toBe(true);

    const review = (actor: string, docType: string, decision: string, note: string | null) =>
      one(sql<{ result: Payload }[]>`
        select admin_review_driver_document(${actor}::uuid, ${driverId}::uuid, ${docType}::text,
          ${decision}::text, ${note}::text) as result
      `);
    const verify = (actor: string) =>
      one(sql<{ result: Payload }[]>`
        select admin_set_driver_verification(${actor}::uuid, ${driverId}::uuid, 'verified') as result
      `);

    const [first, second] = requiredTypes;
    if (first === undefined || second === undefined) throw new Error("نوعانِ إلزاميّانِ على الأقلّ");

    expect((await review(ungrantedId, first, "accepted", null)).error).toBe(
      "NOT_DOCUMENT_REVIEWER",
    );
    expect((await verify(adminId)).error).toBe("INCOMPLETE_DOCUMENTS");

    expect(await review(adminId, first, "incomplete", "الصورة غير واضحة")).toMatchObject({
      ok: true,
      status: "incomplete",
    });
    expect(await review(adminId, second, "rejected", "الوثيقة لا تخص السائق")).toMatchObject({
      ok: true,
      status: "rejected",
    });
    expect((await verify(adminId)).error).toBe("INCOMPLETE_DOCUMENTS");

    // الاستكمالُ: يُعيدُ السائقُ الرفعَ والإرسالَ فتعودُ الوثيقتانِ إلى المراجعة.
    const resubmitted = await one(sql<{ result: Payload }[]>`
      select submit_driver_documents_for_review(${DRIVER_TG}::bigint) as result
    `);
    expect(resubmitted.ok).toBe(true);
    for (const docType of requiredTypes) {
      expect(await review(adminId, docType, "accepted", null)).toMatchObject({
        ok: true,
        status: "accepted",
      });
    }
    const [before] = await sql<{ s: string }[]>`
      select verification_status::text as s from drivers where id = ${driverId}
    `;
    expect(before?.s).toBe("pending");
    expect(await verify(adminId)).toMatchObject({ ok: true, status: "verified" });
  });
});
