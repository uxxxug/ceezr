/**
 * الغرض: LOST-AT · ADR 0253 — الوقتُ التقريبيُّ للفقدِ على PostgreSQL حقيقيّ، من المخزنِ إلى القراءات:
 *   يُكتَبُ حينَ يقدّمُه صاحبُ بلاغِ `lost_item` وحدَه، ولا يُخترَعُ حينَ يغيب، ويُرفَضُ لصنفٍ آخرَ
 *   وفي المستقبلِ وقبلَ إنشاءِ الرحلة، ويُقرأُ في صفحةِ الراكبِ وبطاقةِ الدعمِ وتصديرِ البيانات،
 *   والدالّةُ الأصلُ (`open_support_ticket`) تعملُ كما كانت (توافقٌ رجعيّ).
 * الحالة: منفّذ فعلياً.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresRiderSupportStore } from "../../packages/infrastructure/support/rider-support-store.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارُ وقتِ الفقدِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const RUN_BASE = 3_950_000_000 + (Date.now() % 40_000_000);
const TG = { rider: RUN_BASE + 1 } as const;
const ID = {
  city: "55555555-0000-0000-0000-0000000002a1",
  rider: "66666666-0000-0000-0000-0000000002a1",
  riderRow: "77777777-0000-0000-0000-0000000002a1",
  order: "88888888-0000-0000-0000-0000000002a1",
} as const;
const RIDE_CREATED = "2026-10-01T09:00:00.000Z";

describeIf("LOST-AT — الوقتُ التقريبيُّ للفقد", () => {
  let sql: Sql;
  let store: PostgresRiderSupportStore;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    await sql`begin`;
    await sql`insert into cities (id, code, name_ar, name_en, is_active,
        telegram_support_group_id, telegram_escalation_group_id, telegram_unsubscribed_drivers_group_id)
      values (${ID.city}, 'LA1', 'مدينة LA1', 'City LA1', true, -1001, -1002, -1003)`;
    // المدينةُ تُبذَرُ إعداداتُها عندَ الإنشاء؛ والتهدئةُ صفرٌ ليُفتَحَ أكثرُ من بلاغٍ في الاختبار.
    await sql`update platform_settings set value = '0'::jsonb
      where city_id = ${ID.city} and key = 'support_ticket_cooldown_seconds'`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${ID.rider}, ${ID.city}, ${TG.rider}, 'rider', 'اختبار', 'ar', false)`;
    await sql`insert into riders (id, city_id, user_id) values (${ID.riderRow}, ${ID.city}, ${ID.rider})`;
    await sql`insert into orders (id, city_id, rider_id, service, status, pickup, created_at)
      values (${ID.order}, ${ID.city}, ${ID.riderRow}, 'transport', 'cancelled',
              st_geogfromtext('SRID=4326;POINT(39.2 21.5)'), ${RIDE_CREATED}::timestamptz)`;
    store = new PostgresRiderSupportStore(sql);
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  const lostAtOf = async (ticketId: string) => {
    const rows = await sql<{ lost_at: Date | null }[]>`
      select lost_at from support_tickets where id = ${ticketId}::uuid`;
    return rows[0]?.lost_at ?? null;
  };

  it("١. بلاغُ مفقوداتٍ بوقتٍ ⇒ يُكتَبُ الوقتُ كما قُدِّم", async () => {
    const result = await store.openTicket({
      telegramUserId: String(TG.rider),
      category: "lost_item",
      message: "نسيت حقيبة سوداء",
      orderId: ID.order,
      lostAt: "2026-10-01T10:15:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await lostAtOf(result.value.ticketId))?.toISOString()).toBe("2026-10-01T10:15:00.000Z");
  });

  it("٢. بلاغٌ بلا وقتٍ ⇒ `null` لا وقتٌ مخترَع", async () => {
    const result = await store.openTicket({
      telegramUserId: String(TG.rider),
      category: "lost_item",
      message: "نسيت هاتفاً",
      orderId: ID.order,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await lostAtOf(result.value.ticketId)).toBeNull();
  });

  it("٣. الرفضُ: صنفٌ آخر، ومستقبلٌ، وقبلَ إنشاءِ الرحلة — ولا تذكرةَ تُكتَب", async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from support_tickets where rider_id = ${ID.riderRow}`;
    for (const [category, lostAt, error] of [
      ["ride_dispute", "2026-10-01T10:15:00.000Z", "LOST_AT_NOT_ALLOWED"],
      ["lost_item", new Date(Date.now() + 60 * 60 * 1000).toISOString(), "LOST_AT_IN_FUTURE"],
      ["lost_item", "2026-09-30T23:00:00.000Z", "LOST_AT_BEFORE_RIDE"],
    ] as const) {
      const result = await store.openTicket({
        telegramUserId: String(TG.rider),
        category,
        message: "اختبار",
        orderId: ID.order,
        lostAt,
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && "rejection" in result.error && result.error.rejection).toBe(error);
    }
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from support_tickets where rider_id = ${ID.riderRow}`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("٤. القراءاتُ الثلاث: صفحةُ الراكب، وبطاقةُ الدعم، وتصديرُ البيانات", async () => {
    const page = await store.listTickets({
      telegramUserId: String(TG.rider),
      limit: 10,
      cursor: null,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const withTime = page.value.tickets.find((ticket) => ticket.lostAt !== null);
    const withoutTime = page.value.tickets.find((ticket) => ticket.lostAt === null);
    expect(withTime?.lostAt).toBe("2026-10-01T10:15:00.000Z");
    expect(withoutTime).toBeDefined();

    const context = await sql<{ result: { lost_at: string | null } }[]>`
      select get_support_ticket_context(${withTime?.id as string}::uuid) as result`;
    expect(new Date(context[0]?.result.lost_at as string).toISOString()).toBe(
      "2026-10-01T10:15:00.000Z",
    );

    const exported = await sql<{ result: Record<string, unknown> }[]>`
      select export_my_data(${TG.rider}::bigint) as result`;
    const text = JSON.stringify(exported[0]?.result);
    expect(text).toContain('"lost_at"');
  });

  it("٥. توافقٌ رجعيّ: الدالّةُ الأصلُ بتوقيعِها القديمِ تفتحُ تذكرةً بلا وقت", async () => {
    const rows = await sql<{ result: { ok: boolean; ticket_id?: string } }[]>`
      select open_support_ticket(${TG.rider}::bigint, 'lost_item'::support_ticket_type,
        'عبر الدالّة القديمة', null::text, ${ID.order}::uuid) as result`;
    expect(rows[0]?.result.ok).toBe(true);
    expect(await lostAtOf(rows[0]?.result.ticket_id as string)).toBeNull();
  });
});
