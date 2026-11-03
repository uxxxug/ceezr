/**
 * الغرض: `WR-40` (عنصرُ «هـ» من أمرِ الاستلام) — اختبارٌ مُركَّزٌ لمعنى «أيُّهما
 *   أسبق» في استبقاءِ وسائطِ محادثةِ الطلب، على **قاعدةٍ حقيقيّة** بدالّةِ المطالبةِ
 *   نفسِها (`claim_order_chat_media_sweep`): 7 أيّامٍ من انتهاءِ الطلبِ أو 30 يوماً من
 *   الرفعِ — فالأقربُ هو الذي يحكم، لا مجموعَهما ولا أكبرَهما. ومعَ الحدَّينِ دليلٌ
 *   عمليٌّ أنَّ المكنسةَ تُتِمُّ السجلَّ وتحذفُ الملفَّ (الترتيبُ: ملفٌّ ثمَّ سجلٌّ).
 * الحالة: مُنفَّذ فعليّاً (CI على PostgreSQL حقيقي؛ محليًا يُتخطّى إن غاب
 *   `TEST_DATABASE_URL` — تسجيلُ التخطّي في skip-registry).
 * ينتمي إلى: tests/integration
 * يُستخدم من: لا شيءَ — اختبارُ تحقّقٍ نهائيّ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createChatMediaSweepStore,
  sweepChatMedia,
} from "../../apps/workers/src/jobs/sweep-chat-media.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_000_401;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
const userIds: string[] = [];

/** مخزنُ كائناتٍ زائفٌ بالعقدِ نفسِه: الحذفُ المتكرّرُ نجاح. */
function fakeStore() {
  const objects = new Set<string>();
  return {
    put: (p: string) => objects.add(p),
    has: (p: string) => objects.has(p),
    remove: (paths: readonly string[]) => {
      for (const p of paths) objects.delete(p);
      return { ok: true as const };
    },
  };
}

/** طلبٌ منتهٍ منذُ `days` يومًا معَ مرفقٍ رُفعَ منذُ `age` يومًا. */
async function seedCompletedOrderWithAttachment(days: number, age: number) {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
      completed_at)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'completed'::order_status,
      st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography,
      st_setsrid(st_makepoint(39.1728, 21.5433), 4326)::geography,
      'نقطةُ الانطلاق', 'الحرم', now() - (${days} || ' days')::interval
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  const [message] = await sql<{ id: string }[]>`
    insert into order_messages (order_id, city_id, sender_user_id, sender_role, client_message_id, body)
    values (${order.id}, ${cityId}, ${riderId}, 'rider', gen_random_uuid(), 'صورةُ البوابة')
    returning id
  `;
  if (message === undefined) throw new Error("تعذّر زرعُ الرسالة");
  const [attachment] = await sql<{ id: string; object_path: string }[]>`
    insert into order_chat_attachments
      (order_id, city_id, uploader_user_id, client_message_id, kind, mime_type, byte_size,
       width, height, object_path, status, message_id, created_at, ready_at)
    values (${order.id}, ${cityId}, ${riderId}, gen_random_uuid(), 'image', 'image/jpeg', 2048,
       100, 100, 'orders/' || ${order.id}::text || '/' || gen_random_uuid()::text,
       'ready', ${message.id}, now() - (${age} || ' days')::interval, now() - (${age} || ' days')::interval)
    returning id, object_path
  `;
  if (attachment === undefined) throw new Error("تعذّر زرعُ المرفق");
  return { orderId: order.id, attachment };
}

async function clearOrders(): Promise<void> {
  const orders = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from order_chat_attachments where order_id in (${orders})`;
  await sql`delete from order_messages where order_id in (${orders})`;
  await sql`delete from order_message_reads where order_id in (${orders})`;
  await sql`delete from notification_outbox where order_id in (${orders})`;
  await sql`delete from order_offers where order_id in (${orders})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبةُ الاستبقاء', '+966500000401') returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبة");
  userIds.push(riderUser.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبة");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-40 — استبقاءُ الوسائط: أيُّ النافذتَينِ أسبقُ هو الحاكم", () => {
  it("نافذةُ القراءةِ أسبقُ: مرفقٌ حديثٌ (يومان) في طلبٍ انتهى منذُ 8 أيّام ⇒ مكنسةُ الاستبقاء", async () => {
    await clearOrders();
    const store = fakeStore();
    const { orderId, attachment } = await seedCompletedOrderWithAttachment(8, 2);
    store.put(attachment.object_path);
    const sweep = () =>
      sweepChatMedia({
        ...createChatMediaSweepStore(sql),
        remove: (paths) => store.remove(paths),
      });
    const first = await sweep();
    expect(first.ok).toBe(true);
    expect(first.ok && first.value.byReason.retention).toBe(1);
    expect(store.has(attachment.object_path)).toBe(false);
    const [row] = await sql<{ status: string; deleted_at: string | null }[]>`
      select status, deleted_at from order_chat_attachments where id = ${attachment.id}
    `;
    expect(row?.status).toBe("deleted");
    expect(row?.deleted_at).not.toBeNull();
    // والطلبُ نفسُه لا يُمسُّ: الاستبقاءُ يحكمُ الوسائطَ لا الطلب.
    const [orderRow] = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(orderRow?.status).toBe("completed");
  });

  it("سقفُ الثلاثينَ أسبقُ: مرفقٌ عمرُه 31 يومًا في طلبٍ انتهى بالأمس ⇒ مكنسةُ الاستبقاء", async () => {
    await clearOrders();
    const store = fakeStore();
    const { attachment } = await seedCompletedOrderWithAttachment(1, 31);
    store.put(attachment.object_path);
    const first = await sweepChatMedia({
      ...createChatMediaSweepStore(sql),
      remove: (paths) => store.remove(paths),
    });
    expect(first.ok && first.value.byReason.retention).toBe(1);
    expect(store.has(attachment.object_path)).toBe(false);
  });

  it("لا استبقاءَ قبلَ الأقربِ: مرفقٌ عمرُه يومانِ في طلبٍ انتهى بالأمس ⇒ لا مكنسة", async () => {
    await clearOrders();
    const store = fakeStore();
    const { attachment } = await seedCompletedOrderWithAttachment(1, 2);
    store.put(attachment.object_path);
    const first = await sweepChatMedia({
      ...createChatMediaSweepStore(sql),
      remove: (paths) => store.remove(paths),
    });
    expect(first.ok).toBe(true);
    expect(first.ok && first.value.claimed).toBe(0);
    expect(store.has(attachment.object_path)).toBe(true);
    const [row] = await sql<{ status: string }[]>`
      select status from order_chat_attachments where id = ${attachment.id}
    `;
    expect(row?.status).toBe("ready");
  });
});
