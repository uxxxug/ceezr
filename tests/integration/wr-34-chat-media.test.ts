/**
 * الغرض: `WR-34` (ADR 0305) — المسارُ الكاملُ لوسائطِ محادثةِ الطلب على **قاعدةٍ حقيقيّة**:
 *   رفعٌ عبرَ مسارِ البوّابةِ (Hono) ← فحصٌ وتنظيفٌ ← حجزٌ في القاعدة ← كتابةٌ في مخزنِ
 *   الكائناتِ عبرَ HTTP ← رسالةٌ مربوطة ← استرجاعٌ بالسجلِّ ← رابطٌ موقَّعٌ قصيرٌ ← البايتات.
 *   في الاتّجاهَين، للصورةِ والصوت، ومعَ الإعادةِ بلا تكرار، وفشلِ الرفع، ومنعِ الطرفِ
 *   الثالثِ والمحادثةِ الأخرى، والمكنسة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 *
 * ## ما هو حقيقيٌّ وما هو محاكًى (يُذكَرُ في دليلِ التحقّق)
 *   - حقيقيّ: PostgreSQL والهجرات والدوالّ، ومسارُ البوّابةِ وحالاتُ الاستخدام، وعميلُ
 *     المخزنِ `HttpChatMediaObjectStore` بطلباتِ HTTP فعليّة، وعاملُ المكنسة.
 *   - محاكًى: خادمُ `storage-api` نفسُه — خادمٌ محلّيٌّ (`Bun.serve`) بالعقدِ نفسِه
 *     (`POST /object/<bucket>/<path>` · `DELETE /object/<bucket>` · `POST /object/sign/…` ·
 *     `GET /object/sign/…?token=`). لا Supabase Storage حيٌّ في CI.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrderChatRoutes } from "../../apps/gateway/src/routes/order-chat.ts";
import {
  createChatMediaSweepStore,
  sweepChatMedia,
} from "../../apps/workers/src/jobs/sweep-chat-media.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type { OrderChatDeps } from "../../packages/application/messaging/order-chat.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createOrderChatMediaStore,
  createOrderChatStore,
} from "../../packages/infrastructure/messaging/order-chat-store.ts";
import { HttpChatMediaObjectStore } from "../../packages/infrastructure/storage/chat-media-object-store.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const DRIVER_TG = 900_000_481;
const OTHER_DRIVER_TG = 900_000_482;
const RIDER_TG = 900_000_483;
const STRANGER_TG = 900_000_484;
const BUCKET = "order-chat-media";
const SECRET = "test-service-key-wr34";

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/chat-media/${name}`, import.meta.url)));

// ── خادمُ storage-api محاكًى بالعقدِ نفسِه ──────────────────────────────────────
interface StoredObject {
  readonly bytes: Uint8Array;
  readonly type: string;
}
const objects = new Map<string, StoredObject>();
const tokens = new Map<string, { path: string; expiresAt: number }>();
let failPuts = false;
let storageRequests: string[] = [];
let storage: ReturnType<typeof Bun.serve> | undefined;

function startStorage() {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      storageRequests.push(`${request.method} ${url.pathname}`);
      const authorized = request.headers.get("authorization") === `Bearer ${SECRET}`;
      const prefix = `/storage/v1/object/`;
      if (!url.pathname.startsWith(prefix)) return new Response("no", { status: 404 });
      const rest = url.pathname.slice(prefix.length);
      if (rest.startsWith("sign/")) {
        const [bucket, ...pathParts] = rest.slice(5).split("/");
        const path = pathParts.map(decodeURIComponent).join("/");
        if (bucket !== BUCKET) return new Response("bucket", { status: 400 });
        if (request.method === "POST") {
          if (!authorized) return new Response("unauthorized", { status: 403 });
          const { expiresIn } = (await request.json()) as { expiresIn: number };
          const token = crypto.randomUUID();
          tokens.set(token, { path, expiresAt: Date.now() + expiresIn * 1000 });
          return Response.json({ signedURL: `/object/sign/${bucket}/${path}?token=${token}` });
        }
        // GET بالتوقيع — بلا مفتاح.
        const grant = tokens.get(url.searchParams.get("token") ?? "");
        if (grant === undefined || grant.path !== path || grant.expiresAt < Date.now()) {
          return Response.json({ error: "InvalidSignature" }, { status: 400 });
        }
        const stored = objects.get(path);
        if (stored === undefined) return Response.json({ error: "not_found" }, { status: 400 });
        return new Response(stored.bytes, { headers: { "content-type": stored.type } });
      }
      const [bucket, ...pathParts] = rest.split("/");
      if (bucket !== BUCKET) return new Response("bucket", { status: 400 });
      if (!authorized) return new Response("unauthorized", { status: 403 });
      if (request.method === "POST" && pathParts.length > 0) {
        if (failPuts) return new Response("boom", { status: 503 });
        const bytes = new Uint8Array(await request.arrayBuffer());
        objects.set(pathParts.join("/"), {
          bytes,
          type: request.headers.get("content-type") ?? "",
        });
        return Response.json({ Key: `${bucket}/${pathParts.join("/")}` });
      }
      if (request.method === "DELETE" && pathParts.length === 0) {
        const { prefixes } = (await request.json()) as { prefixes: string[] };
        for (const p of prefixes) objects.delete(p);
        return Response.json(prefixes.map((name) => ({ name })));
      }
      // قراءةٌ مباشرةٌ بلا توقيع: الدلوُ خاصّ.
      return new Response("private bucket", { status: 400 });
    },
  });
}

// ── القاعدة ─────────────────────────────────────────────────────────────────────
let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let driverId = "";
let otherDriverId = "";
const userIds: string[] = [];
const driverIds: string[] = [];

const sessions = {
  read: async (token: string) => {
    const tg = token.startsWith("tok-") ? token.slice(4) : null;
    return tg === null
      ? err({ code: "SESSION_REJECTED", reason: "BAD_SIGNATURE" })
      : ok({
          telegramUserId: tg,
          bot: "rider",
          sessionId: `s-${tg}`,
          issuedAtSeconds: 0,
          expiresAtSeconds: 9_999_999_999,
        });
  },
} as unknown as MiniAppSessionReader;

function chatDeps(): OrderChatDeps {
  const baseUrl = `http://127.0.0.1:${String(storage?.port)}`;
  return {
    sessions,
    store: createOrderChatStore(sql),
    media: {
      enabled: true,
      store: createOrderChatMediaStore(sql),
      objects: new HttpChatMediaObjectStore({
        baseUrl,
        secretKey: SECRET,
        bucket: BUCKET,
        fetch: (input, init) => fetch(input, init),
      }),
    },
    now: () => new Date(),
  };
}

let app: ReturnType<typeof createOrderChatRoutes>;

async function upload(
  tg: number,
  orderId: string,
  kind: "image" | "voice",
  bytes: Uint8Array,
  options: { clientId?: string; durationMs?: number; contentType?: string } = {},
) {
  const query = new URLSearchParams({
    kind,
    client_message_id: options.clientId ?? crypto.randomUUID(),
  });
  if (options.durationMs !== undefined) query.set("duration_ms", String(options.durationMs));
  const response = await app.request(`/v1/orders/${orderId}/chat/media?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer tok-${String(tg)}`,
      "content-type": options.contentType ?? "application/octet-stream",
    },
    body: bytes,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(tg: number, path: string) {
  const response = await app.request(path, {
    headers: { authorization: `Bearer tok-${String(tg)}` },
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

interface WireMsg {
  readonly id: string;
  readonly kind: string;
  readonly mine: boolean;
  readonly body: string;
  readonly attachment: {
    readonly id: string;
    readonly kind: string;
    readonly mime_type: string;
    readonly available: boolean;
    readonly width: number | null;
    readonly duration_ms: number | null;
  } | null;
}

async function thread(tg: number, orderId: string, query = "tail=1") {
  const got = await getJson(tg, `/v1/orders/${orderId}/chat?${query}`);
  return { ...got, messages: (got.body.messages ?? []) as WireMsg[] };
}

/** رابطٌ موقَّعٌ ثمَّ البايتاتُ منه — كما يفعلُ العميل. */
async function retrieve(tg: number, orderId: string, attachmentId: string) {
  const link = await getJson(tg, `/v1/orders/${orderId}/chat/attachments/${attachmentId}`);
  if (link.status !== 200) return { link, bytes: null as Uint8Array | null };
  const response = await fetch(String(link.body.url));
  return {
    link,
    bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : null,
    type: response.headers.get("content-type"),
  };
}

async function seedOrder(assignedDriverId = driverId): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'نقطةُ الانطلاق', 'الحرم'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${assignedDriverId}, 1, 'pending'::offer_status, now() + interval '2 minutes')
  `;
  const [claimed] = await sql<{ result: { ok: boolean; error?: string } }[]>`
    select claim_ride(${order.id}::uuid, ${assignedDriverId}::uuid) as result
  `;
  if (claimed?.result.ok !== true)
    throw new Error(`تعذّر الإسناد: ${String(claimed?.result.error)}`);
  return order.id;
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

async function attachmentRows(orderId: string) {
  return sql<{ id: string; status: string; message_id: string | null; object_path: string }[]>`
    select id, status, message_id, object_path from order_chat_attachments where order_id = ${orderId}
  `;
}

function objectsOf(orderId: string): string[] {
  return [...objects.keys()].filter((key) => key.startsWith(`orders/${orderId}/`));
}

const has = (bytes: Uint8Array, needle: string) =>
  Buffer.from(bytes).includes(Buffer.from(needle, "latin1"));

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  storage = startStorage();
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedDriver = async (tg: number, name: string) => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${tg}, 'driver', ${name}, ${`+9665000${tg % 100_000}`}) returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ السائق");
    userIds.push(user.id);
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ح ب ${tg % 10_000}`})
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائق");
    driverIds.push(driver.id);
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${driver.id}, ${cityId}, true)
      on conflict (driver_id) do update set is_available = true
    `;
    return driver.id;
  };
  driverId = await seedDriver(DRIVER_TG, "خالد السائق");
  otherDriverId = await seedDriver(OTHER_DRIVER_TG, "سائق آخر");

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'مريم الأنصارية', '+966500000483') returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبة");
  userIds.push(riderUser.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبة");
  riderId = rider.id;
  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TG}, 'rider', 'غريب', '+966500000484') returning id
  `;
  if (stranger !== undefined) userIds.push(stranger.id);
});

beforeEach(() => {
  if (DATABASE_URL === undefined) return;
  app = createOrderChatRoutes({ chat: chatDeps() });
  failPuts = false;
  storageRequests = [];
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  for (const id of driverIds) {
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
    await sql`delete from driver_availability where driver_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of driverIds) await sql`delete from drivers where id = ${id}`;
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
  storage?.stop(true);
});

describeIf("WR-34 — وسائطُ المحادثةِ: المسارُ الكاملُ على قاعدةٍ حقيقيّة", () => {
  it("النصُّ في الاتّجاهَين باقٍ كما هو، وقدرةُ الوسائطِ معلنةٌ في السجلّ", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    for (const [tg, text] of [
      [RIDER_TG, "أنا عند البوابة"],
      [DRIVER_TG, "وصلت"],
    ] as const) {
      const response = await app.request(`/v1/orders/${orderId}/chat/messages`, {
        method: "POST",
        headers: { authorization: `Bearer tok-${String(tg)}`, "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId: crypto.randomUUID(), text }),
      });
      expect(response.status).toBe(201);
    }
    const view = await thread(DRIVER_TG, orderId);
    expect(view.messages.map((m) => [m.kind, m.body, m.mine])).toEqual([
      ["text", "أنا عند البوابة", false],
      ["text", "وصلت", true],
    ]);
    expect(view.body.media).toEqual({
      enabled: true,
      image_max_bytes: 5 * 1024 * 1024,
      voice_max_bytes: 5 * 1024 * 1024,
      voice_max_ms: 120_000,
    });
    expect(view.body.has_older).toBe(false);
  });

  it("صورةٌ من الراكبةِ إلى السائق: تُنظَّفُ من GPS/EXIF، وتُخزَّنُ خاصّةً، وتُسترجَعُ بالرابطِ الموقَّع", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const original = fixture("photo-gps.jpg");
    // الأصلُ فيه مقطعُ EXIF (APP1، ومنه وسمُ GPS) وXMP ونصوصٌ معروفة.
    expect(has(original, "Exif")).toBe(true);
    expect(has(original, "Secret-Model-X")).toBe(true);

    const sent = await upload(RIDER_TG, orderId, "image", original, { contentType: "image/jpeg" });
    expect(sent.status).toBe(201);
    const message = sent.body.message as WireMsg;
    expect(message.kind).toBe("image");
    expect(message.attachment?.mime_type).toBe("image/jpeg");
    expect(message.attachment?.available).toBe(true);
    expect(message.attachment?.width).toBeGreaterThan(0);

    // في المخزن: كائنٌ واحدٌ بمسارٍ من معرّفَين، بلا وصفٍ ولا موقع.
    const stored = objectsOf(orderId);
    expect(stored).toHaveLength(1);
    const storedBytes = objects.get(stored[0] ?? "")?.bytes ?? new Uint8Array();
    expect(stored[0]).toBe(`orders/${orderId}/${message.attachment?.id}`);
    // لا مقطعَ APP1 (EXIF/XMP، ومنه GPS) يبقى.
    expect(Buffer.from(storedBytes).includes(Buffer.from([0xff, 0xe1]))).toBe(false);
    for (const secret of [
      "Exif",
      "http://ns.adobe.com/xap",
      "Secret-Model-X",
      "SecretPerson",
      "SecretComment",
      "TRAILING-SECRET-DATA",
      "WaslaTestPhone",
    ]) {
      expect(has(storedBytes, secret)).toBe(false);
    }
    expect([storedBytes[0], storedBytes[1]]).toEqual([0xff, 0xd8]);

    // السائقُ يراها في السجلِّ ويقرؤها.
    const view = await thread(DRIVER_TG, orderId);
    const seen = view.messages.find((m) => m.id === message.id);
    expect(seen?.mine).toBe(false);
    expect(seen?.attachment?.id).toBe(message.attachment?.id ?? "");
    const got = await retrieve(DRIVER_TG, orderId, message.attachment?.id ?? "");
    expect(got.link.status).toBe(200);
    expect(got.link.headers.get("cache-control")).toBe("no-store");
    expect(got.link.body.mime_type).toBe("image/jpeg");
    const expiresIn = Date.parse(String(got.link.body.expires_at)) - Date.now();
    expect(expiresIn).toBeLessThanOrEqual(300_000);
    expect(expiresIn).toBeGreaterThan(240_000);
    expect(got.bytes).toEqual(storedBytes);
    expect(got.type).toBe("image/jpeg");
  });

  it("صورةٌ من السائقِ إلى الراكبة (PNG) وتُرى عندَها", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const sent = await upload(DRIVER_TG, orderId, "image", fixture("photo-meta.png"));
    expect(sent.status).toBe(201);
    const message = sent.body.message as WireMsg;
    expect(message.attachment?.mime_type).toBe("image/png");
    const got = await retrieve(RIDER_TG, orderId, message.attachment?.id ?? "");
    expect(got.bytes).not.toBeNull();
    expect(has(got.bytes ?? new Uint8Array(), "Secret")).toBe(false);
    expect([...(got.bytes ?? new Uint8Array()).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it("رسالةٌ صوتيّةٌ في الاتّجاهَين (WebM/Opus من الراكبة، MP4/AAC من السائق) تُخزَّنُ وتُسترجَعُ بايتاً ببايت", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const webm = fixture("voice.webm");
    const m4a = fixture("voice.m4a");
    const fromRider = await upload(RIDER_TG, orderId, "voice", webm, {
      durationMs: 2000,
      contentType: "audio/webm;codecs=opus",
    });
    expect(fromRider.status).toBe(201);
    const fromDriver = await upload(DRIVER_TG, orderId, "voice", m4a, {
      durationMs: 2000,
      contentType: "audio/mp4",
    });
    expect(fromDriver.status).toBe(201);
    const riderVoice = fromRider.body.message as WireMsg;
    const driverVoice = fromDriver.body.message as WireMsg;
    expect(riderVoice.attachment?.mime_type).toBe("audio/webm");
    expect(driverVoice.attachment?.mime_type).toBe("audio/mp4");
    expect(riderVoice.attachment?.duration_ms).toBeGreaterThan(1000);

    const atDriver = await retrieve(DRIVER_TG, orderId, riderVoice.attachment?.id ?? "");
    expect(atDriver.bytes).toEqual(webm);
    expect(atDriver.type).toBe("audio/webm");
    const atRider = await retrieve(RIDER_TG, orderId, driverVoice.attachment?.id ?? "");
    expect(atRider.bytes).toEqual(m4a);
  });

  it("بعدَ إعادةِ فتحِ المحادثة (بوّابةٌ جديدةٌ بلا ذاكرة) تُسترجَعُ الوسائطُ وتُشغَّلُ من جديد", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const image = await upload(RIDER_TG, orderId, "image", fixture("photo-exif.webp"));
    const voice = await upload(DRIVER_TG, orderId, "voice", fixture("voice.ogg"), {
      durationMs: 2000,
    });
    expect(image.status).toBe(201);
    expect(voice.status).toBe(201);

    app = createOrderChatRoutes({ chat: chatDeps() });
    for (const tg of [RIDER_TG, DRIVER_TG]) {
      const view = await thread(tg, orderId);
      const media = view.messages.filter((m) => m.kind === "image" || m.kind === "voice");
      expect(media.map((m) => m.kind)).toEqual(["image", "voice"]);
      for (const m of media) {
        const got = await retrieve(tg, orderId, m.attachment?.id ?? "");
        expect(got.bytes?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("الإعادةُ بالمعرّفِ نفسِه لا تُكرِّرُ رسالةً ولا ملفّاً", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const clientId = crypto.randomUUID();
    const first = await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"), { clientId });
    const again = await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"), { clientId });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("duplicate");
    expect((again.body.message as WireMsg).id).toBe((first.body.message as WireMsg).id);
    expect(objectsOf(orderId)).toHaveLength(1);
    expect(await attachmentRows(orderId)).toHaveLength(1);
    expect((await thread(RIDER_TG, orderId)).messages).toHaveLength(1);
    // الإعادةُ بعدَ النجاحِ لا تلمسُ المخزنَ أصلاً.
    expect(
      storageRequests.filter((r) => r.startsWith("POST /storage/v1/object/order")),
    ).toHaveLength(1);
  });

  it("فشلُ الرفعِ: لا رسالةَ ولا سجلَّ معلَّقاً ولا كائنَ يتيماً — ثمَّ الإعادةُ بالمعرّفِ نفسِه تنجحُ مرّةً واحدة", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const clientId = crypto.randomUUID();
    failPuts = true;
    const failed = await upload(DRIVER_TG, orderId, "voice", fixture("voice.webm"), {
      clientId,
      durationMs: 2000,
    });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toBe("MEDIA_STORE_UNAVAILABLE");
    expect(await attachmentRows(orderId)).toHaveLength(0);
    expect(objectsOf(orderId)).toHaveLength(0);
    expect((await thread(DRIVER_TG, orderId)).messages).toHaveLength(0);
    // التنظيفُ طلبَ الحذفَ فعلاً.
    expect(storageRequests).toContain(`DELETE /storage/v1/object/${BUCKET}`);

    failPuts = false;
    const retried = await upload(DRIVER_TG, orderId, "voice", fixture("voice.webm"), {
      clientId,
      durationMs: 2000,
    });
    expect(retried.status).toBe(201);
    const retriedAgain = await upload(DRIVER_TG, orderId, "voice", fixture("voice.webm"), {
      clientId,
      durationMs: 2000,
    });
    expect(retriedAgain.body.status).toBe("duplicate");
    expect(await attachmentRows(orderId)).toHaveLength(1);
    expect(objectsOf(orderId)).toHaveLength(1);
  });

  it("الطرفُ الثالثُ لا يرى الملفَّ ولا يرفعُ؛ ومعرّفُ ملفٍّ من محادثةٍ أخرى لا يُفتَحُ عبرَ هذه", async () => {
    await clearOrders();
    const orderA = await seedOrder();
    // الطلبُ (ب) للراكبةِ نفسِها معَ سائقٍ آخر — فالسائقُ الآخرُ غريبٌ عن (أ).
    const orderB = await seedOrder(otherDriverId);
    const sent = await upload(RIDER_TG, orderA, "image", fixture("photo-gps.jpg"));
    const attachmentId = (sent.body.message as WireMsg).attachment?.id ?? "";
    {
      const before = storageRequests.filter((r) =>
        r.startsWith("POST /storage/v1/object/sign"),
      ).length;
      for (const tg of [STRANGER_TG, OTHER_DRIVER_TG]) {
        const denied = await getJson(tg, `/v1/orders/${orderA}/chat/attachments/${attachmentId}`);
        expect(denied.status).toBe(404);
        expect(denied.body.url).toBeUndefined();
        expect((await upload(tg, orderA, "image", fixture("photo-gps.jpg"))).status).toBe(404);
      }
      // طرفُ المحادثةِ (ب) نفسُه لا يفتحُ ملفَّ (أ) بمعرّفِه عبرَ طلبِ (ب).
      const crossed = await getJson(
        RIDER_TG,
        `/v1/orders/${orderB}/chat/attachments/${attachmentId}`,
      );
      expect(crossed.status).toBe(404);
      // ولا توقيعَ صدرَ لأيٍّ من هذه المحاولات.
      const after = storageRequests.filter((r) =>
        r.startsWith("POST /storage/v1/object/sign"),
      ).length;
      expect(after).toBe(before);
    }
    // بلا جلسة: 401.
    const anonymous = await app.request(`/v1/orders/${orderA}/chat/attachments/${attachmentId}`);
    expect(anonymous.status).toBe(401);
    // والدلوُ لا يُقرأُ بلا توقيع.
    const direct = await fetch(
      `http://127.0.0.1:${String(storage?.port)}/storage/v1/object/${BUCKET}/orders/${orderA}/${attachmentId}`,
    );
    expect(direct.ok).toBe(false);
  });

  it("الخادمُ يحكمُ بالبايتاتِ لا بالنوعِ المصرَّح: انتحالٌ ونوعٌ خاطئٌ وفيديو وحجمٌ زائد ⇒ رفضٌ بلا أثر", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const text = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(
      (await upload(RIDER_TG, orderId, "image", text, { contentType: "image/jpeg" })).status,
    ).toBe(415);
    expect(
      (
        await upload(RIDER_TG, orderId, "voice", fixture("photo-gps.jpg"), {
          contentType: "audio/webm",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(RIDER_TG, orderId, "image", fixture("voice.webm"), {
          contentType: "image/png",
        })
      ).status,
    ).toBe(415);
    expect(
      (await upload(RIDER_TG, orderId, "voice", fixture("video.mp4"), { durationMs: 2000 })).status,
    ).toBe(415);
    expect(
      (await upload(RIDER_TG, orderId, "voice", fixture("video.webm"), { durationMs: 2000 }))
        .status,
    ).toBe(415);
    const long = await upload(RIDER_TG, orderId, "voice", fixture("voice-long.webm"), {
      durationMs: 2000,
    });
    expect(long.status).toBe(422);
    expect(long.body.error).toBe("MEDIA_DURATION_INVALID");
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(fixture("photo-gps.jpg").slice(0, 64));
    expect((await upload(RIDER_TG, orderId, "image", big)).status).toBe(413);
    expect(
      (await upload(RIDER_TG, orderId, "video" as "image", fixture("photo-gps.jpg"))).status,
    ).toBe(422);
    expect(await attachmentRows(orderId)).toHaveLength(0);
    expect(objectsOf(orderId)).toHaveLength(0);
  });

  it("الحصّة: 30 وسيطاً لكلِّ مرسِلٍ في الطلب ثمَّ 429", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    for (let i = 0; i < 30; i += 1) {
      const [row] = await sql<{ result: { ok: boolean } }[]>`
        select reserve_order_chat_attachment(${RIDER_TG}::bigint, ${orderId}::uuid, gen_random_uuid(),
          'image', 'image/jpeg', 100, 10, 10, null) as result
      `;
      expect(row?.result.ok).toBe(true);
    }
    const over = await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"));
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("MEDIA_QUOTA");
    // والطرفُ الآخرُ حصّتُه مستقلّة.
    expect((await upload(DRIVER_TG, orderId, "image", fixture("photo-gps.jpg"))).status).toBe(201);
  });

  it("المكنسة: المعلَّقُ اليتيمُ يُحذَفُ ملفُّه وسجلُّه، والمنتهي يصيرُ «غيرَ متاح» ولا يُوقَّعُ له رابط", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const objectStore = new HttpChatMediaObjectStore({
      baseUrl: `http://127.0.0.1:${String(storage?.port)}`,
      secretKey: SECRET,
      bucket: BUCKET,
      fetch: (input, init) => fetch(input, init),
    });
    // ١. حجزٌ ثمَّ «سقوطُ البوّابة» بعدَ كتابةِ الملفِّ وقبلَ الرسالة.
    const [reserved] = await sql<{ result: { attachment_id: string; object_path: string } }[]>`
      select reserve_order_chat_attachment(${RIDER_TG}::bigint, ${orderId}::uuid, gen_random_uuid(),
        'image', 'image/jpeg', 100, 10, 10, null) as result
    `;
    const orphanPath = reserved?.result.object_path ?? "";
    await objectStore.put({
      objectPath: orphanPath,
      bytes: fixture("photo-gps.jpg"),
      mimeType: "image/jpeg",
    });
    // ٢. ملفٌّ جاهزٌ في رسالة.
    const sent = await upload(DRIVER_TG, orderId, "image", fixture("photo-meta.png"));
    const readyId = (sent.body.message as WireMsg).attachment?.id ?? "";
    expect(objectsOf(orderId)).toHaveLength(2);

    const sweepStore = createChatMediaSweepStore(sql);
    const sweep = () =>
      sweepChatMedia({ ...sweepStore, remove: (paths) => objectStore.remove(paths) });
    // حديثُ العهدِ لا يُمَسّ.
    expect((await sweep()).ok).toBe(true);
    expect(objectsOf(orderId)).toHaveLength(2);

    await sql`update order_chat_attachments set created_at = now() - interval '16 minutes' where object_path = ${orphanPath}`;
    const first = await sweep();
    expect(first.ok && first.value.byReason.orphan_pending).toBe(1);
    expect(objects.has(orphanPath)).toBe(false);
    expect((await attachmentRows(orderId)).map((r) => r.status)).toEqual(["ready"]);

    // انتهاءُ الاحتفاظ: الطلبُ انتهى منذ أكثرَ من نافذةِ القراءة.
    await sql`update order_chat_attachments set created_at = now() - interval '31 days' where id = ${readyId}`;
    const second = await sweep();
    expect(second.ok && second.value.byReason.retention).toBe(1);
    expect(objectsOf(orderId)).toHaveLength(0);
    const view = await thread(RIDER_TG, orderId);
    expect(view.messages[0]?.attachment?.available).toBe(false);
    expect(
      (await getJson(RIDER_TG, `/v1/orders/${orderId}/chat/attachments/${readyId}`)).status,
    ).toBe(404);
  });

  it("حذفُ الرسالةِ (محوُ الحساب) يُبقي سجلَّ الملفِّ حتّى تحذفَه المكنسةُ من المخزن", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const sent = await upload(RIDER_TG, orderId, "voice", fixture("voice.webm"), {
      durationMs: 2000,
    });
    const messageId = (sent.body.message as WireMsg).id;
    await sql`delete from order_messages where id = ${messageId}`;
    const rows = await attachmentRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message_id).toBeNull();
    const objectStore = new HttpChatMediaObjectStore({
      baseUrl: `http://127.0.0.1:${String(storage?.port)}`,
      secretKey: SECRET,
      bucket: BUCKET,
      fetch: (input, init) => fetch(input, init),
    });
    const report = await sweepChatMedia({
      ...createChatMediaSweepStore(sql),
      remove: (paths) => objectStore.remove(paths),
    });
    expect(report.ok && report.value.byReason.message_gone).toBe(1);
    expect(objectsOf(orderId)).toHaveLength(0);
  });

  it("صفحاتُ الأقدم: الذيلُ آخرُ 60، و`before` يُكمِلُ بلا تداخل، والقارئُ القديمُ يرى الوسيطَ نصّاً رمزيّاً", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    for (let i = 1; i <= 70; i += 1) {
      await sql`
        select post_order_message(${i % 2 === 0 ? RIDER_TG : DRIVER_TG}::bigint, ${orderId}::uuid,
          gen_random_uuid(), ${`رسالة ${String(i)}`})
      `;
    }
    await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"));
    const tail = await thread(RIDER_TG, orderId);
    expect(tail.messages).toHaveLength(60);
    expect(tail.body.has_older).toBe(true);
    expect(tail.messages.at(-1)?.kind).toBe("image");
    const firstSeq = (tail.messages[0] as unknown as { seq: number }).seq;
    const older = await thread(RIDER_TG, orderId, `before=${String(firstSeq)}`);
    expect(older.messages).toHaveLength(11);
    expect(older.body.has_older).toBe(false);
    const all = [...older.messages, ...tail.messages].map((m) => m.id);
    expect(new Set(all).size).toBe(71);

    // التراجعُ: الدالّةُ القديمةُ تُعيدُ الوسيطَ نصّاً رمزيّاً بلا حمولة.
    const [legacy] = await sql<
      { result: { messages: { kind: string; body: string; payload: unknown }[] } }[]
    >`
      select list_order_messages(${RIDER_TG}::bigint, ${orderId}::uuid, 70::bigint, 200) as result
    `;
    const last = legacy?.result.messages.at(-1);
    expect(last?.kind).toBe("text");
    expect(last?.body).toBe("📷");
    expect(last?.payload ?? null).toBeNull();
  });

  it("الوسائطُ الموقوفةُ (`ORDER_CHAT_MEDIA` غيرُ مفعّل): الرفعُ 503 والقراءةُ لما رُفِعَ باقية", async () => {
    await clearOrders();
    const orderId = await seedOrder();
    const sent = await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"));
    const attachmentId = (sent.body.message as WireMsg).attachment?.id ?? "";
    const paused = chatDeps();
    app = createOrderChatRoutes({
      chat: {
        ...paused,
        media: { ...(paused.media as NonNullable<OrderChatDeps["media"]>), enabled: false },
      },
    });
    const blocked = await upload(RIDER_TG, orderId, "image", fixture("photo-gps.jpg"));
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe("MEDIA_DISABLED");
    expect((await thread(RIDER_TG, orderId)).body.media).toMatchObject({ enabled: false });
    expect((await retrieve(DRIVER_TG, orderId, attachmentId)).bytes).not.toBeNull();
  });
});
