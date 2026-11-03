/**
 * الغرض: `WR-39` — المحوُ الفوريُّ لملفّاتِ محادثةِ الحسابِ عندَ حذفِهِ، على
 *   قاعدةٍ حقيقيّةٍ: الإيصالُ يقولُ «طابورٌ يُلتقطُ» لا «حُذفَ»، والالتقاطُ
 *   محصورٌ بملفّاتِ المحوِّ وحدَهُ، والإتمامُ لا يمسُّ بمعرّفِ إنسانٍ آخرَ،
 *   والجاهزُ يصيرُ `deleted` والمعلَّقُ يُحذفُ صفُّهُ، والتكرارُ آمنٌ، وقبلَ
 *   الإتمامِ كانتِ الصفوفُ في قبضةِ المكنسةِ الدوريّةِ (`message_gone`) —
 *   شبكةُ الأمانِ لا مسارًا وحيدًا.
 * الحالة: اختبار تكامل فعلي — يتطلّب TEST_DATABASE_URL بها الهجرات مطبَّقة
 *   (ومنها 20261104100000).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسُّ محوَ الحسابِ أو وسائطَ
 *   المحادثةِ.
 * ملاحظات مستقبلية: حذفُ الملفِّ من المخزنِ نفسِهِ مُغطّى في وحداتِ `WR-39`
 *   بمخزنٍ مُصنَّعٍ — ههنا تُقاسُ معاملةُ القاعدةِ والعزلُ والإيصالُ.
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

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه — بعيدةٌ عن أيِّ حسابٍ أو قروبٍ حقيقيٍّ. */
const A_TG = 900_003_390; // الراكبُ الذي يُمحى حسابُهُ
const B_TG = 900_003_391; // راكبٌ آخرُ — ملفّاتُهُ لا تُمسُّ

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
const seededUserIds: string[] = [];
let aUserId = "";
let bUserId = "";

/** مرفقاتُ الاختبارِ: معرّفاتٌ تُجمعُ للتنظيفِ. */
const seededAttachmentIds: string[] = [];
let bAttachmentId = "";

async function seedRider(telegramId: number, fullName: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${telegramId}, 'rider'::user_role, ${fullName}, null)
    returning id`;
  if (row === undefined) throw new Error(`تعذّر زرعُ ${telegramId}`);
  seededUserIds.push(row.id);
  await sql`insert into riders (city_id, user_id) values (${cityId}, ${row.id})`;
  return row.id;
}

async function seedOrder(riderUserId: string): Promise<string> {
  const [rider] = await sql<{ id: string }[]>`
    select id from riders where user_id = ${riderUserId}`;
  if (rider === undefined) throw new Error("الراكبُ غيرُ مزروعٍ");
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff)
    values (${cityId}, ${rider.id}, 'transport'::service_type, 'completed'::order_status,
            st_setsrid(st_makepoint(39.8, 21.4), 4326)::geography,
            st_setsrid(st_makepoint(39.9, 21.5), 4326)::geography)
    returning id`;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return order.id;
}

/** مرفقٌ بصورةِ ما يزرعُهُ مسارُ `WR-34` نفسُهُ: مسارٌ مُشتقٌّ وقيودُ الشكلِ كلُّها. */
async function seedAttachment(input: {
  readonly orderId: string;
  readonly uploaderUserId: string;
  readonly clientMessageId: string;
  readonly status: "pending" | "ready";
  readonly messageId?: string | null;
}): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    with new_id as (select gen_random_uuid() as id)
    insert into order_chat_attachments
      (id, order_id, city_id, uploader_user_id, client_message_id, kind, mime_type,
       byte_size, width, height, object_path, status, message_id, ready_at)
    select id, ${input.orderId}, ${cityId}, ${input.uploaderUserId},
           ${input.clientMessageId}, 'image', 'image/jpeg', 1000, 10, 10,
           'orders/' || ${input.orderId} || '/' || id,
           ${input.status}::text, ${input.messageId ?? null},
           case when ${input.status} = 'ready' then now() else null end
      from new_id
    returning id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر زرعُ المرفقِ");
  seededAttachmentIds.push(id);
  return id;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql);
  cityId = cityHandle.cityId;

  aUserId = await seedRider(A_TG, "راكبُ يُمحى");
  bUserId = await seedRider(B_TG, "راكبٌ آخرُ");

  const orderA = await seedOrder(aUserId);
  const orderB = await seedOrder(bUserId);

  // رسالةٌ منَ المحوِّ على طلبِهِ — يربطُ بها مرفقُهُ الجاهزُ.
  const [messageA] = await sql<{ id: string }[]>`
    insert into order_messages (order_id, city_id, sender_user_id, sender_role, client_message_id, body)
    values (${orderA}, ${cityId}, ${aUserId}, 'rider', gen_random_uuid(), 'صورةٌ قبلَ المحوِ')
    returning id`;
  if (messageA === undefined) throw new Error("تعذّر زرعُ الرسالةِ");
  const [messageB] = await sql<{ id: string }[]>`
    insert into order_messages (order_id, city_id, sender_user_id, sender_role, client_message_id, body)
    values (${orderB}, ${cityId}, ${bUserId}, 'rider', gen_random_uuid(), 'ملفُّ الآخرِ')
    returning id`;
  if (messageB === undefined) throw new Error("تعذّر زرعُ رسالةِ الآخرِ");

  // جاهزٌ في رسالةٍ (يُرثُ زوالُ الرسالةِ) — وجاهزٌ بلا رسالةٍ — ومعلَّقٌ (حجزٌ).
  await seedAttachment({
    orderId: orderA,
    uploaderUserId: aUserId,
    clientMessageId: crypto.randomUUID(),
    status: "ready",
    messageId: messageA.id,
  });
  await seedAttachment({
    orderId: orderA,
    uploaderUserId: aUserId,
    clientMessageId: crypto.randomUUID(),
    status: "ready",
    messageId: null,
  });
  await seedAttachment({
    orderId: orderA,
    uploaderUserId: aUserId,
    clientMessageId: crypto.randomUUID(),
    status: "pending",
  });
  // ملفُّ إنسانٍ آخرَ — لا يُمسُّ أبدًا.
  bAttachmentId = await seedAttachment({
    orderId: orderB,
    uploaderUserId: bUserId,
    clientMessageId: crypto.randomUUID(),
    status: "ready",
    messageId: messageB.id,
  });

  void seededAttachmentIds; // تُجمعُ للتنظيفِ
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from order_chat_attachments where id = any(${seededAttachmentIds}::uuid[])`.catch(
    () => {},
  );
  await sql`delete from order_messages where sender_user_id = any(${seededUserIds}::uuid[])`;
  await sql`delete from orders where rider_id in (
              select id from riders where user_id = any(${seededUserIds}::uuid[]))`;
  await sql`delete from riders where user_id = any(${seededUserIds}::uuid[])`;
  await sql`delete from audit_log where actor_user_id = any(${seededUserIds}::uuid[])`;
  await sql`delete from users where id = any(${seededUserIds}::uuid[])`;
  await restoreCityBaseline(sql, cityHandle);
  await sql.end?.();
});

describeIf("WR-39 — المحوُ الفوريُّ لملفّاتِ محادثةِ الحسابِ", () => {
  it("المحوُّ يُقيّدُ طابورَ الوسائطِ في الإيصالِ (لا حذفًا وقعَ) ويعيدُ المعرّفَ الداخليَّ الثابتَ", async () => {
    const [erased] = await sql<{ result: Record<string, unknown> }[]>`
      select erase_my_account(${A_TG}::bigint) as result`;
    if (erased === undefined) throw new Error("تعذّر المحوُ");
    expect(erased.result.ok).toBe(true);
    expect(erased.result.reason).toBe("ERASED");
    expect(erased.result.user_id).toBe(aUserId);
    const receipt = erased.result.receipt as Record<string, unknown> | undefined;
    expect(receipt?.mediaPurge).toEqual({
      pendingAttachments: 3,
      mode: "worker-after-commit",
    });

    // الإيصالُ مُقيَّدٌ في سجلِّ التدقيقِ — لا يضيعُ بفشلِ الوسائطِ ولا بغيرِهِ.
    const [audit] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log
       where entity_type = 'user' and entity_id = ${aUserId} and action = 'account.erased'`;
    expect((audit?.payload?.mediaPurge as Record<string, unknown>)?.pendingAttachments).toBe(3);

    // رسائلُ المحوِّ زالت (WR-04) — والسجلُّ يبقى حتى يحذفَ العاملُ الملفَّ.
    const [gone] = await sql<{ n: string }[]>`
      select count(*)::text as n from order_messages where sender_user_id = ${aUserId}`;
    expect(gone?.n).toBe("0");
  });

  it("الالتقاطُ محصورٌ بملفّاتِ المحوِّ وحدَهُ — لا ملفَّ إنسانٍ آخرَ", async () => {
    const [claimed] = await sql<{ result: unknown }[]>`
      select claim_order_chat_media_purge(${aUserId}::uuid, 500) as result`;
    const items = Array.isArray(claimed?.result)
      ? (claimed?.result as Array<Record<string, unknown>>)
      : [];
    expect(items.length).toBe(3);
    // لا ملفَّ إنسانٍ آخرَ في الالتقاطِ — وملفُّ الآخرِ باقٍ لم يُمسَّ.
    expect(items.some((entry) => String(entry.id) === bAttachmentId)).toBe(false);
    for (const entry of items) {
      expect(String(entry.object_path)).toMatch(/^orders\//);
    }
  });

  it("شبكةُ الأمانِ: قبلَ الإتمامِ كانتِ الصفوفُ في قبضةِ المكنسةِ الدوريّةِ (`message_gone`)", async () => {
    const [sweep] = await sql<{ result: unknown }[]>`
      select claim_order_chat_media_sweep(500) as result`;
    const items = Array.isArray(sweep?.result)
      ? (sweep?.result as Array<Record<string, unknown>>)
      : [];
    const swept = new Set(items.map((entry) => String(entry.id)));
    // الجاهزُ الذي انقطعتْ رسالتُهُ بالمحوِ تلتقطُهُ المكنسةُ — لا يفلتُ شيءٌ.
    const [readyGone] = await sql<{ id: string }[]>`
      select id from order_chat_attachments
       where uploader_user_id = ${aUserId} and status = 'ready' limit 1`;
    expect(readyGone).toBeDefined();
    expect(swept.has(String(readyGone?.id))).toBe(true);
  });

  it("العزلُ: إتمامٌ بمعرّفِ إنسانٍ آخرَ لا يمسُّ صفوفَ المحوِّ", async () => {
    const [claimed] = await sql<{ result: unknown }[]>`
      select claim_order_chat_media_purge(${aUserId}::uuid, 500) as result`;
    const items = (Array.isArray(claimed?.result) ? claimed?.result : []) as Array<
      Record<string, unknown>
    >;
    const ids = items.map((entry) => String(entry.id));

    const [wrongOwner] = await sql<{ result: Record<string, unknown> }[]>`
      select complete_order_chat_media_purge(${ids}::uuid[], ${bUserId}::uuid) as result`;
    expect(wrongOwner?.result).toEqual({ ok: true, removed: 0, expired: 0 });

    const [untouched] = await sql<{ n: string }[]>`
      select count(*)::text as n from order_chat_attachments
       where uploader_user_id = ${aUserId} and status in ('pending', 'ready')`;
    expect(untouched?.n).toBe("3");
  });

  it("الإتمامُ بمعرّفِ صاحبِها: الجاهزُ يصيرُ `deleted` دليلًا، والمعلَّقُ يُحذفُ صفُّهُ — وملفُّ الآخرِ لم يُمسَّ", async () => {
    const [claimed] = await sql<{ result: unknown }[]>`
      select claim_order_chat_media_purge(${aUserId}::uuid, 500) as result`;
    const items = (Array.isArray(claimed?.result) ? claimed?.result : []) as Array<
      Record<string, unknown>
    >;
    const ids = items.map((entry) => String(entry.id));

    const [done] = await sql<{ result: Record<string, unknown> }[]>`
      select complete_order_chat_media_purge(${ids}::uuid[], ${aUserId}::uuid) as result`;
    expect(done?.result).toEqual({ ok: true, removed: 1, expired: 2 });

    const [readyRows] = await sql<{ n: string }[]>`
      select count(*)::text as n from order_chat_attachments
       where uploader_user_id = ${aUserId} and status = 'deleted' and deleted_at is not null`;
    expect(readyRows?.n).toBe("2");
    const [pendingRows] = await sql<{ n: string }[]>`
      select count(*)::text as n from order_chat_attachments
       where uploader_user_id = ${aUserId} and status = 'pending'`;
    expect(pendingRows?.n).toBe("0");

    const [bRows] = await sql<{ n: string }[]>`
      select count(*)::text as n from order_chat_attachments
       where uploader_user_id = ${bUserId} and status = 'ready'`;
    expect(bRows?.n).toBe("1");
  });

  it("التكرارُ آمنٌ: التقاطٌ ثانٍ فارغٌ، وإتمامٌ ثانٍ بلا أثرٍ، ومحوٌّ ثانٍ يُقرأُ نجاحًا", async () => {
    const [claimed] = await sql<{ result: unknown }[]>`
      select claim_order_chat_media_purge(${aUserId}::uuid, 500) as result`;
    const empty = Array.isArray(claimed?.result) ? (claimed.result as unknown[]).length : -1;
    expect(empty).toBe(0);

    const [again] = await sql<{ result: Record<string, unknown> }[]>`
      select complete_order_chat_media_purge(${seededAttachmentIds.slice(0, 2)}::uuid[], ${aUserId}::uuid) as result`;
    expect(again?.result).toEqual({ ok: true, removed: 0, expired: 0 });

    const [reErased] = await sql<{ result: Record<string, unknown> }[]>`
      select erase_my_account(${A_TG}::bigint) as result`;
    expect(reErased?.result.ok).toBe(true);
    expect(reErased?.result.reason).toBe("ALREADY_ERASED");
    expect(reErased?.result.user_id).toBe(aUserId);
  });
});
