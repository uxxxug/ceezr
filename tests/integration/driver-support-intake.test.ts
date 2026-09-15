/**
 * الغرض: قياسُ شكوى السائقِ على قاعدةٍ حقيقيّةٍ (`F3-08` · `SD-10`) — وأهمُّ ما
 *   يُقاسُ ههنا ما **لا يقدرُ حاجزٌ ساكنٌ ولا مخزنٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ **بوّابةَ الدورِ في القاعدةِ لا في الشِفرةِ**: مستخدمٌ بلا صفِّ
 *        سائقٍ يُردُّ `NOT_A_DRIVER` في كلِّ صنفٍ من أصنافِ السائقِ الأربعةِ —
 *        ولو مرَّ صنفٌ منها لمن ليسَ سائقاً لَظهرَت شكواه في لا مكانٍ.
 *     ــ أنَّ صفحةَ السائقِ **تُفرَزُ بصفِّ سياقتِه** لا بصفِّ ركوبِه: حسابٌ
 *        ذو دورَينِ يرى في صفحةِ السائقِ تذاكرَ سياقتِه، ويرى في صفحةِ الراكبِ
 *        تذاكرَه الراكبةَ — **وتذكرةٌ واحدةٌ تظهرُ في الصفحتَينِ** لأنَّ الدالّةَ
 *        تكتبُ المعرِّفَينِ معاً، وهيَ العِلّةُ التي أوجبَت توسيعَ مجالِ القراءةِ.
 *     ــ أنَّ الأصنافَ الثلاثةَ الجديدةَ **قيمٌ في النوعِ فعلاً** لا نصوصٌ
 *        تُقبَلُ: تُكتَبُ وتُقرأُ وتُفرَزُ.
 *     ــ أنَّ «راكباً مسيئاً» بلا رحلةٍ **يُقبَلُ في القاعدةِ** ويُردُّ في
 *        الطبقةِ — فحدُّ كلِّ طبقةٍ مقيسٌ حيثُ هوَ لا حيثُ يُظَنُّ.
 *     ــ أنَّ الترقيمَ والحدَّ والمؤشِّرَ في دالّةِ السائقِ **كنظيرِها** حرفاً.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ منعُ `anon`**: مقيسٌ لكلِّ دالّةٍ في
 *    `tests/integration/database-privilege-surface.test.ts` — ولا يُكرَّرُ سؤالٌ.
 * ــ **لا تُقاسُ التهدئةُ ولا المرجعُ ولا مِلكيّةُ الطلبِ**: دالّةُ الفتحِ واحدةٌ
 *    للدورَينِ، وهذه مقيسةٌ في `rider-support-intake.test.ts` على المصدرِ نفسِه.
 *    والمقيسُ ههنا **ما يفترقُ**: بوّابةُ الدورِ وفرزُ الصفحةِ والأصنافُ.
 * ــ **لا يُقاسُ طلبٌ شبكيٌّ**: مسارُ البوابةِ يُمرِّرُ رموزاً مقيسةً في الوحدةِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه (مدىً لا يتقاطعُ مع ملفِّ الراكبِ). */
const DRIVER_TELEGRAM_ID = 900_000_141;
const DUAL_TELEGRAM_ID = 900_000_142;
const PAGER_TELEGRAM_ID = 900_000_143;
const NON_DRIVER_TELEGRAM_ID = 900_000_144;
const BARE_TELEGRAM_ID = 900_000_145;
const ABSENT_TELEGRAM_ID = 900_000_146;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let previousGroupId: string | null = null;
let driverUserId = "";
let driverId = "";
let dualUserId = "";
let dualDriverId = "";
let dualRiderId = "";
let pagerUserId = "";
let pagerDriverId = "";
let nonDriverUserId = "";
let nonDriverRiderId = "";
let bareUserId = "";

interface OpenPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly ticket_id?: string;
  readonly reference?: string;
  readonly retry_after_seconds?: number;
}

interface TicketRow {
  readonly id: string;
  readonly reference: string;
  readonly type: string;
  readonly status: string;
  readonly message: string;
  readonly resolution: string | null;
  readonly order_id: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

interface PagePayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly expected_response_minutes?: number | null;
  readonly has_more?: boolean;
  readonly next_cursor?: { created_at: string; id: string } | null;
  readonly tickets?: readonly TicketRow[];
}

async function openTicket(options: {
  readonly telegramId: number;
  readonly type: string;
  readonly message?: string;
  readonly orderId?: string | null;
}): Promise<OpenPayload> {
  const [row] = await sql<{ result: OpenPayload }[]>`
    select open_support_ticket(
      ${options.telegramId}::bigint,
      ${options.type}::support_ticket_type,
      ${options.message ?? "خُصِمَ منّي مبلغٌ لا أعرفُ سببَه"}::text,
      null::text,
      ${options.orderId ?? null}::uuid
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function driverPage(options: {
  readonly telegramId: number;
  readonly limit?: number | null;
  readonly beforeCreatedAt?: string | null;
  readonly beforeId?: string | null;
}): Promise<PagePayload> {
  const [row] = await sql<{ result: PagePayload }[]>`
    select driver_support_tickets(
      ${options.telegramId}::bigint,
      ${options.limit === undefined ? 20 : options.limit}::integer,
      ${options.beforeCreatedAt ?? null}::timestamptz,
      ${options.beforeId ?? null}::uuid
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function riderPage(telegramId: number): Promise<PagePayload> {
  const [row] = await sql<{ result: PagePayload }[]>`
    select rider_support_tickets(${telegramId}::bigint, 20::integer, null::timestamptz, null::uuid)
      as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * تذكرةُ سائقٍ مزروعةٌ مباشرةً — **لأنَّ التهدئةَ تمنعُ تذكرتَينِ في مُدَّتِها،
 * ولا تُخفَّفُ لأجلِ اختبارٍ**؛ وبها يُبنى تاريخٌ متباعدُ الأختامِ يُقاسُ عليه
 * الترقيمُ. والمرجعُ **لا يُذكَرُ** فيُقاسُ افتراضُ القاعدةِ على مسارٍ ثانٍ.
 */
async function seedDriverTicket(options: {
  readonly driverId: string;
  readonly minutesAgo: number;
  readonly type?: string;
  readonly status?: string;
  readonly resolvedByUserId?: string;
}): Promise<{ readonly id: string; readonly reference: string }> {
  // **قيدُ القاعدةِ `support_tickets_settled_requires_actor` لا يُلتَفُّ عليه**:
  // تذكرةٌ مُغلَقةٌ يجبُ أن تحملَ ختمَ إغلاقٍ وفاعلَه — والزرعُ يستوفيه كما
  // يستوفيه مسارُ الإنسانِ، ولا يُخفَّفُ قيدٌ لأجلِ اختبارٍ.
  const settled = options.status === "resolved" || options.status === "rejected";
  const [row] = await sql<{ id: string; reference: string }[]>`
    insert into support_tickets (
      city_id, type, driver_id, message, status, created_at, resolution,
      resolved_at, resolved_by_user_id
    )
    values (
      ${cityId}, ${options.type ?? "deduction"}::support_ticket_type, ${options.driverId},
      ${`تذكرةُ سائقٍ مزروعةٌ قبلَ ${options.minutesAgo} دقيقةً`},
      ${options.status ?? "open"}::support_ticket_status,
      now() - make_interval(mins => ${options.minutesAgo}),
      ${settled ? "رُوجِعَ الخصمُ وأُعيدَ المبلغُ" : null},
      ${settled ? new Date().toISOString() : null}::timestamptz,
      ${settled ? (options.resolvedByUserId ?? null) : null}::uuid
    ) returning id, reference
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ تذكرةِ السائقِ");
  return row;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ — لا يُستعارُ من ملفٍّ سبقَ في الجولةِ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [group] = await sql<{ support: string | null }[]>`
    select telegram_support_group_id::text as support from cities where id = ${cityId}
  `;
  previousGroupId = group?.support ?? null;
  // قروبُ الدعمِ شرطُ فتحِ التذكرةِ، ويُعادُ كما كانَ في `afterAll`.
  await sql`
    update cities
       set telegram_support_group_id = coalesce(telegram_support_group_id, -1006013)
     where id = ${cityId}
  `;

  const seedUser = async (
    telegramId: number,
    role: string,
    name: string,
    phone: string,
  ): Promise<string> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, ${role}::user_role, ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error(`تعذّر زرعُ المستخدمِ ${name}`);
    return user.id;
  };

  const seedDriverRow = async (userId: string, plate: string): Promise<string> => {
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}, 'verified'::verification_status, 'سيدان', ${plate})
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ صفِّ السائقِ");
    return driver.id;
  };

  driverUserId = await seedUser(DRIVER_TELEGRAM_ID, "driver", "سائقُ الدعمِ", "+966500000141");
  driverId = await seedDriverRow(driverUserId, "ح د م 141");

  // **حسابٌ ذو دورَينِ**: به تُقاسُ العِلّةُ التي أوجبَت توسيعَ مجالِ القراءةِ.
  dualUserId = await seedUser(DUAL_TELEGRAM_ID, "driver", "سائقٌ وراكبٌ", "+966500000142");
  dualDriverId = await seedDriverRow(dualUserId, "ح د م 142");
  const [dualRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${dualUserId}) returning id
  `;
  if (dualRider === undefined) throw new Error("تعذّر زرعُ صفِّ الراكبِ للحسابِ ذي الدورَينِ");
  dualRiderId = dualRider.id;

  pagerUserId = await seedUser(PAGER_TELEGRAM_ID, "driver", "سائقُ الترقيمِ", "+966500000143");
  pagerDriverId = await seedDriverRow(pagerUserId, "ح د م 143");

  // **راكبٌ بلا صفِّ سائقٍ**: به يُقاسُ `NOT_A_DRIVER` — ولا بدَّ من صفِّ راكبٍ
  // له، فالدالّةُ تُقدِّمُ `NOT_REGISTERED` على حكمِ الدورِ لمن لا صفَّ له
  // أصلاً؛ وقياسُ الدورِ بحسابٍ بلا صفٍّ **يقيسُ الرمزَ الخطأَ**.
  nonDriverUserId = await seedUser(
    NON_DRIVER_TELEGRAM_ID,
    "rider",
    "راكبٌ بلا صفِّ سائقٍ",
    "+966500000144",
  );
  const [nonDriverRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${nonDriverUserId}) returning id
  `;
  if (nonDriverRider === undefined) throw new Error("تعذّر زرعُ صفِّ الراكبِ لغيرِ السائقِ");
  nonDriverRiderId = nonDriverRider.id;

  // **حسابٌ بلا صفِّ دورٍ**: به يُقاسُ `NOT_REGISTERED` — وهوَ غيرُ
  // `USER_NOT_FOUND` وغيرُ `NOT_A_DRIVER`، وثلاثتُها نصوصُ شاشةٍ مختلفةٌ.
  bareUserId = await seedUser(BARE_TELEGRAM_ID, "rider", "حسابٌ بلا صفِّ دورٍ", "+966500000145");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  const driverIds = [driverId, dualDriverId, pagerDriverId].filter((id) => id !== "");
  const riderIds = [dualRiderId, nonDriverRiderId].filter((id) => id !== "");
  const userIds = [driverUserId, dualUserId, pagerUserId, nonDriverUserId, bareUserId].filter(
    (id) => id !== "",
  );
  if (driverIds.length > 0) {
    await sql`delete from support_tickets where driver_id = any(${driverIds}::uuid[])`;
    await sql`delete from drivers where id = any(${driverIds}::uuid[])`;
  }
  if (riderIds.length > 0) {
    await sql`delete from support_tickets where rider_id = any(${riderIds}::uuid[])`;
    await sql`delete from riders where id = any(${riderIds}::uuid[])`;
  }
  if (userIds.length > 0) {
    await sql`delete from audit_log where actor_user_id = any(${userIds}::uuid[])`;
    await sql`delete from users where id = any(${userIds}::uuid[])`;
  }
  if (cityId !== "" && previousGroupId === null) {
    await sql`update cities set telegram_support_group_id = null where id = ${cityId}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("بوّابةُ الدورِ — في القاعدةِ لا في الشِفرةِ", () => {
  it("أصنافُ السائقِ الأربعةُ قيمٌ في النوعِ فعلاً — لا نصوصٌ تُقبَلُ", async () => {
    const [row] = await sql<{ labels: readonly string[] }[]>`
      select array_agg(e.enumlabel::text order by e.enumsortorder) as labels
        from pg_type t join pg_enum e on e.enumtypid = t.oid
       where t.typname = 'support_ticket_type'
    `;
    expect(row?.labels).toContain("deduction");
    expect(row?.labels).toContain("rider_conduct");
    expect(row?.labels).toContain("vehicle");
    expect(row?.labels).toContain("subscription");
  });

  it("راكبٌ بلا صفِّ سائقٍ يُردُّ `NOT_A_DRIVER` في **كلِّ** صنفٍ من أصنافِ السائقِ", async () => {
    for (const type of ["subscription", "deduction", "rider_conduct", "vehicle"]) {
      const result = await openTicket({ telegramId: NON_DRIVER_TELEGRAM_ID, type });
      expect(result.ok).not.toBe(true);
      expect(result.error).toBe("NOT_A_DRIVER");
    }
  });

  it("والراكبُ نفسُه يفتحُ صنفَ دورِه — فالتوسيعُ **لم يُضيِّقْ** سلوكاً قائماً", async () => {
    const opened = await openTicket({
      telegramId: NON_DRIVER_TELEGRAM_ID,
      type: "lost_item",
      message: "نسيتُ حقيبتي في المركبةِ",
    });
    expect(opened.ok).toBe(true);
  });

  it("حسابٌ بلا صفِّ دورٍ يُردُّ `NOT_REGISTERED` — ثلاثةُ رموزٍ لا تُخلَطُ", async () => {
    const result = await openTicket({ telegramId: BARE_TELEGRAM_ID, type: "deduction" });
    expect(result.error).toBe("NOT_REGISTERED");
  });

  it("حسابٌ لا وجودَ له يُردُّ `USER_NOT_FOUND` — لا يُخلَطُ بمن حسابُه قائمٌ", async () => {
    const result = await openTicket({ telegramId: ABSENT_TELEGRAM_ID, type: "deduction" });
    expect(result.error).toBe("USER_NOT_FOUND");
  });

  it("سائقٌ يفتحُ شكوى خصمٍ فتُكتَبُ بمرجعٍ منطوقٍ وصفٍّ في `driver_id`", async () => {
    const opened = await openTicket({ telegramId: DRIVER_TELEGRAM_ID, type: "deduction" });
    expect(opened.ok).toBe(true);
    expect(opened.reference).toMatch(/^WSL-[0-9]{6,}$/);

    const [row] = await sql<{ driver_id: string | null; type: string }[]>`
      select driver_id, type::text as type from support_tickets where id = ${opened.ticket_id ?? ""}
    `;
    expect(row?.driver_id).toBe(driverId);
    expect(row?.type).toBe("deduction");
  });

  it("«راكبٌ مسيءٌ» بلا رحلةٍ **تُقبَلُ في القاعدةِ** — والإلزامُ حكمُ الطبقةِ لا حكمُها", async () => {
    // حدُّ كلِّ طبقةٍ يُقاسُ حيثُ هوَ: الطبقةُ تردُّ `ORDER_REQUIRED` (مقيسٌ في
    // الوحدةِ)، والقاعدةُ لا تعرفُ هذا الشرطَ — وتوثيقُ ذلكَ يمنعُ حاجزاً
    // مزدوجاً يُظَنُّ قائماً في موضعٍ وهوَ في الآخرِ.
    const opened = await openTicket({ telegramId: PAGER_TELEGRAM_ID, type: "rider_conduct" });
    expect(opened.ok).toBe(true);
  });
});

describeIf("صفحةُ تذاكرِ السائقِ — تُفرَزُ بصفِّ سياقتِه", () => {
  it("صفحةُ السائقِ تُعطي تذاكرَه وحدَها بحالتِها ومرجعِها", async () => {
    const seeded = await seedDriverTicket({
      driverId,
      minutesAgo: 120,
      status: "resolved",
      resolvedByUserId: driverUserId,
    });
    const result = await driverPage({ telegramId: DRIVER_TELEGRAM_ID });
    expect(result.ok).toBe(true);
    const ids = (result.tickets ?? []).map((ticket) => ticket.id);
    expect(ids).toContain(seeded.id);
    for (const ticket of result.tickets ?? []) {
      expect(ticket.reference).toMatch(/^WSL-[0-9]{6,}$/);
    }
  });

  it("مستخدمٌ بلا صفِّ سائقٍ يُردُّ `NOT_A_DRIVER` ولا يُعطى صفحةً فارغةً", async () => {
    const result = await driverPage({ telegramId: NON_DRIVER_TELEGRAM_ID });
    expect(result.ok).not.toBe(true);
    expect(result.error).toBe("NOT_A_DRIVER");
    expect(result.tickets).toBeUndefined();
  });

  it("حسابٌ ذو دورَينِ: تذكرةُ سياقتِه تظهرُ في صفحتَيهِ — **وهيَ عِلّةُ توسيعِ مجالِ القراءةِ**", async () => {
    const opened = await openTicket({ telegramId: DUAL_TELEGRAM_ID, type: "vehicle" });
    expect(opened.ok).toBe(true);

    const ticketId = opened.ticket_id;
    if (ticketId === undefined) throw new Error("الفتحُ نجحَ بلا معرِّفِ تذكرةٍ — وذاكَ عطبُ عقدٍ");
    const asDriver = await driverPage({ telegramId: DUAL_TELEGRAM_ID });
    expect((asDriver.tickets ?? []).map((ticket) => ticket.id)).toContain(ticketId);

    const asRider = await riderPage(DUAL_TELEGRAM_ID);
    expect(asRider.ok).toBe(true);
    const riderTypes = (asRider.tickets ?? []).map((ticket) => ticket.type);
    // **صنفُ سائقٍ في صفحةِ راكبٍ**: محوّلٌ يرفضُ ما لا يعرفُ يُسقِطُ الصفحةَ
    // كلَّها `503` — ولذا صارَ مجالُ القراءةِ النوعَ كلَّه (`ticket-types.ts`).
    expect(riderTypes).toContain("vehicle");
  });

  it("الترقيمُ بمفتاحٍ: صفحتانِ متتابعتانِ تُعطيانِ كلَّ تذكرةٍ مرّةً واحدةً", async () => {
    for (const minutesAgo of [200, 190, 180, 170]) {
      await seedDriverTicket({ driverId: pagerDriverId, minutesAgo });
    }
    const first = await driverPage({ telegramId: PAGER_TELEGRAM_ID, limit: 2 });
    expect(first.ok).toBe(true);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).not.toBeNull();

    const second = await driverPage({
      telegramId: PAGER_TELEGRAM_ID,
      limit: 2,
      beforeCreatedAt: first.next_cursor?.created_at ?? null,
      beforeId: first.next_cursor?.id ?? null,
    });
    expect(second.ok).toBe(true);

    const firstIds = (first.tickets ?? []).map((ticket) => ticket.id);
    const secondIds = (second.tickets ?? []).map((ticket) => ticket.id);
    expect(firstIds).toHaveLength(2);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    // **والأحدثُ أوّلاً**: صفحةٌ مقلوبةُ الترتيبِ تُقرأُ تاريخاً مقلوباً.
    const times = (first.tickets ?? []).map((ticket) => new Date(ticket.created_at).getTime());
    expect(times[0] ?? 0).toBeGreaterThanOrEqual(times[1] ?? 0);
  });

  it("حدٌّ خارجَ المدى ومؤشِّرٌ ناقصٌ **يُرَدّانِ** لا يُقصَرانِ", async () => {
    expect((await driverPage({ telegramId: DRIVER_TELEGRAM_ID, limit: 0 })).error).toBe(
      "LIMIT_OUT_OF_RANGE",
    );
    expect((await driverPage({ telegramId: DRIVER_TELEGRAM_ID, limit: 51 })).error).toBe(
      "LIMIT_OUT_OF_RANGE",
    );
    const half = await driverPage({
      telegramId: DRIVER_TELEGRAM_ID,
      beforeCreatedAt: new Date().toISOString(),
      beforeId: null,
    });
    expect(half.error).toBe("CURSOR_INCOMPLETE");
  });

  it("زمنُ الاستجابةِ المتوقَّعُ **إعدادٌ** يُقرأُ لا رقمٌ في شِفرةٍ", async () => {
    const result = await driverPage({ telegramId: DRIVER_TELEGRAM_ID });
    const expected = result.expected_response_minutes;
    // إمّا رقمٌ من `platform_settings` وإمّا `null` لمدينةٍ بلا وعدٍ — **ولا
    // ثالثَ**، ولا رقمَ مكتوبٌ في محوّلٍ.
    expect(expected === null || typeof expected === "number").toBe(true);
  });
});
