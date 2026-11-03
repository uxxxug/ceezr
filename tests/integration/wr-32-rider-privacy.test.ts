/**
 * الغرض: `WR-32` على قاعدةٍ حقيقيّةٍ ومساراتِ HTTP حقيقيّةٍ:
 *   (أ) رسالةُ خصوصيّةِ الراكبِ وسمعتِه في سجلِّ الموافقاتِ — تظهرُ للراكبِ الجديدِ
 *       مرّةً، وللراكبِ المسجَّلِ قبلَها مرّةً بلا إعادةِ تسجيلٍ، وتعودُ مرّةً مع
 *       إصدارٍ جديدٍ، ولا تُطلَبُ من السائقِ — والجمهورُ من `users.role` في القاعدةِ.
 *   (ب) تدقيقُ تسريبِ رقمِ الراكبِ: راكبٌ **مزروعٌ برقمِ جوالٍ واسمِ مستخدمٍ ورقمِ
 *       جهةِ طوارئٍ** (أسوأُ حالٍ — مسارُ تسجيلِ الراكبِ اليومَ لا يجمعُ رقمَه)، وسائقٌ
 *       يمرُّ بكلِّ سطحٍ سائقيٍّ: لوحُ العروضِ، تفاصيلُ العرضِ، قبولُه، المَهمّةُ
 *       النشطةُ، المحادثةُ، الحصيلةُ — ثمَّ صندوقُ الإشعاراتِ الصادرُ. ولا يظهرُ في
 *       أيٍّ منها رقمٌ ولا اسمُ مستخدمٍ ولا معرّفُ تلغرامَ للراكبِ.
 * الحالة: اختبار فعلي — يتطلّبُ TEST_DATABASE_URL وقاعدةً مُهاجَرةً.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفةُ اختباراتِ التكاملِ)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { DriverJobDeps } from "../../packages/application/driver/driver-job.ts";
import type { DriverOfferDeps } from "../../packages/application/driver/driver-offers.ts";
import { findDeclaredDocument } from "../../packages/domain/consent/consent-documents.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../../packages/infrastructure/consent/consent-store.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferDecisionPort } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { PostgresDriverActivityStore } from "../../packages/infrastructure/driver/driver-activity-store.ts";
import { PostgresDriverJobStore } from "../../packages/infrastructure/driver/driver-job-store.ts";
import { PostgresDriverOfferStore } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { createOrderChatStore } from "../../packages/infrastructure/messaging/order-chat-store.ts";
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

const SESSION_SECRET = "wr-32-rider-privacy-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "wr-32-webhook";

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TG = 900_003_201;
const RIDER_TG = 900_003_202; // راكبُ التدقيقِ — مزروعٌ برقمٍ
const NEW_RIDER_TG = 900_003_203; // راكبٌ جديدٌ لم يُقِرَّ بشيءٍ
const EXISTING_RIDER_TG = 900_003_204; // راكبٌ وافقَ على الوثيقتينِ قبلَ الرسالةِ
const CONSENT_DRIVER_TG = 900_003_205; // سائقٌ وافقَ على الوثيقتينِ

/** رقمُ الراكبِ بصيغِه الثلاثِ — أيٌّ منها في ردٍّ سائقيٍّ تسريبٌ. */
const RIDER_PHONE = "+966512300032";
const RIDER_PHONE_FORMS = [RIDER_PHONE, "0512300032", "512300032"];
const RIDER_USERNAME = "wr32_private_rider_handle";
const EMERGENCY_PHONE = "+966512300099";
const RIDER_FIRST_NAME = "سلمى";

const PICKUP = { lat: 21.4858, lng: 39.1925 };

const TERMS = findDeclaredDocument("terms_of_service");
const PRIVACY = findDeclaredDocument("privacy_policy");
const NOTICE = findDeclaredDocument("rider_privacy_notice");
if (TERMS === undefined || PRIVACY === undefined || NOTICE === undefined) {
  throw new Error("سجلُّ الوثائقِ ناقصٌ");
}

let sql: Sql;
let cityHandle: ActiveCityHandle;
let cityId = "";
let app: ReturnType<typeof createServer>;
const userIds: string[] = [];
let driverId = "";
let riderId = "";
let orderId = "";
let offerId = "";

function tokenFor(telegramUserId: number, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId: String(telegramUserId), bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
}

async function call(
  telegramUserId: number,
  bot: "rider" | "driver",
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${tokenFor(telegramUserId, bot)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

async function seedUser(
  telegramId: number,
  role: "rider" | "driver",
  fullName: string,
  phone: string | null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${telegramId}, ${role}::user_role, ${fullName}, ${phone})
    returning id`;
  if (row === undefined) throw new Error(`تعذّر زرعُ ${telegramId}`);
  userIds.push(row.id);
  return row.id;
}

/** ما لا يجوزُ أن يقرأَه السائقُ عن الراكبِ — بكلِّ صيغِه. */
function riderSecrets(): readonly string[] {
  return [...RIDER_PHONE_FORMS, RIDER_USERNAME, EMERGENCY_PHONE, "512300099", String(RIDER_TG)];
}

function expectNoRiderSecret(surface: string, payload: string): void {
  for (const secret of riderSecrets()) {
    expect(payload.includes(secret), `${surface} يحملُ «${secret}»`).toBe(false);
  }
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql);
  cityId = cityHandle.cityId;

  const driverUserId = await seedUser(DRIVER_TG, "driver", "سائقُ تدقيقِ الخصوصيّةِ", "+966500003201");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ص ن ع 3201')
    returning id`;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  // أسوأُ حالٍ عن قصدٍ: راكبٌ برقمٍ واسمِ مستخدمٍ وجهةِ طوارئٍ — لو تسرّبَ شيءٌ لظهرَ.
  const riderUserId = await seedUser(RIDER_TG, "rider", `${RIDER_FIRST_NAME} الخاصّة`, RIDER_PHONE);
  await sql`
    update users
       set telegram_username = ${RIDER_USERNAME},
           emergency_contact_name = 'أخت سلمى',
           emergency_contact_phone = ${EMERGENCY_PHONE}
     where id = ${riderUserId}`;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  await seedUser(NEW_RIDER_TG, "rider", "راكبٌ جديدٌ", null);
  await seedUser(EXISTING_RIDER_TG, "rider", "راكبٌ قديمٌ", null);
  await seedUser(CONSENT_DRIVER_TG, "driver", "سائقٌ موافقٌ", "+966500003205");

  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label, notes)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      'بوابةُ الحيِّ الشماليّة', 'عند البوابة'
    ) returning id`;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  orderId = order.id;
  const [offer] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, distance_km, status, expires_at)
    values (
      ${cityId}, ${orderId}, ${driverId}, 1, 2.5, 'pending'::offer_status,
      now() + make_interval(secs => 120)
    ) returning id`;
  if (offer === undefined) throw new Error("تعذّر زرعُ العرضِ");
  offerId = offer.id;

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const now = () => new Date();
  app = createServer({
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    consents: {
      consent: {
        sessions,
        reader: createConsentRecordReader(sql),
        writer: createConsentRecordWriter(sql),
        accounts: createViewerAccountReader(sql),
        now,
      },
    },
    driverOffers: {
      offers: {
        sessions,
        store: new PostgresDriverOfferStore(sql),
        drivers: createDriverDirectory(sql),
        offers: createOfferDecisionPort(sql),
        now,
      } satisfies DriverOfferDeps,
      log: () => {},
    },
    driverJob: {
      job: { sessions, store: new PostgresDriverJobStore(sql), now } satisfies DriverJobDeps,
      log: () => {},
    },
    orderChat: { chat: { sessions, store: createOrderChatStore(sql), now } },
    driverActivity: {
      activity: { sessions, store: new PostgresDriverActivityStore(sql), now },
      log: () => {},
    },
  });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (orderId !== "") {
    await sql`delete from order_chat_messages where order_id = ${orderId}`.catch(() => {});
    await sql`delete from order_offers where order_id = ${orderId}`;
    await sql`delete from notification_outbox where order_id = ${orderId}`;
    await sql`delete from order_status_history where order_id = ${orderId}`.catch(() => {});
    await sql`delete from orders where id = ${orderId}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  if (userIds.length > 0) {
    await sql`delete from user_consents where user_id in ${sql(userIds)}`;
    await sql`delete from audit_log where actor_user_id in ${sql(userIds)}`;
    await sql`delete from users where id in ${sql(userIds)}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

interface ConsentWire {
  readonly documents: readonly { kind: string; version: string; presentation: string }[];
  readonly onboarding: {
    readonly satisfied: boolean;
    readonly documents: readonly { kind: string; state: string }[];
  };
}

const consentsOf = async (telegramUserId: number, bot: "rider" | "driver" = "rider") => {
  const response = await call(telegramUserId, bot, "GET", "/v1/consents");
  expect(response.status).toBe(200);
  return response.json as unknown as ConsentWire;
};
const noticeState = (wire: ConsentWire) =>
  wire.onboarding.documents.find((d) => d.kind === NOTICE.kind)?.state;
const accept = (telegramUserId: number, kind: string, version: string) =>
  call(telegramUserId, "rider", "POST", "/v1/consents", { kind, version, accepted: true });

describeIf("WR-32 (أ) — رسالةُ الراكبِ في سجلِّ الموافقاتِ الحقيقيِّ", () => {
  it("١) قيدُ القاعدةِ يقبلُ الصنفَ الجديدَ ويرفضُ المجهولَ", async () => {
    const [row] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'user_consents_kind_check'`;
    expect(row?.def).toContain("rider_privacy_notice");
    expect(row?.def).toContain("terms_of_service");
    expect(row?.def).toContain("privacy_policy");
  });

  it("٢) راكبٌ جديدٌ: يرى الرسالةَ معلّقةً، يُقِرُّ مرّةً بإصدارِها ووقتِها، فلا تعودُ", async () => {
    const first = await consentsOf(NEW_RIDER_TG);
    expect(first.documents.map((d) => d.kind)).toContain(NOTICE.kind);
    expect(first.documents.find((d) => d.kind === NOTICE.kind)?.presentation).toBe("notice");
    expect(noticeState(first)).toBe("missing");

    for (const document of [TERMS, PRIVACY, NOTICE]) {
      const posted = await accept(NEW_RIDER_TG, document.kind, document.version);
      expect(posted.status).toBe(200);
    }
    const rows = await sql<{ version: string; accepted_at: Date }[]>`
      select c.version, c.accepted_at from user_consents c
        join users u on u.id = c.user_id
       where u.telegram_id = ${NEW_RIDER_TG} and c.kind = ${NOTICE.kind}`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.version).toBe(NOTICE.version);
    expect(Math.abs(Date.now() - (rows[0]?.accepted_at.getTime() ?? 0))).toBeLessThan(60_000);

    const after = await consentsOf(NEW_RIDER_TG);
    expect(after.onboarding.satisfied).toBe(true);
    expect(noticeState(after)).toBe("satisfied");
    // إقرارٌ ثانٍ بالإصدارِ نفسِه لا يُضيفُ صفّاً.
    const repeat = await accept(NEW_RIDER_TG, NOTICE.kind, NOTICE.version);
    expect(repeat.status).toBe(200);
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from user_consents c join users u on u.id = c.user_id
       where u.telegram_id = ${NEW_RIDER_TG} and c.kind = ${NOTICE.kind}`;
    expect(count?.n).toBe(1);
  });

  it("٣) راكبٌ مسجَّلٌ قبلَ الرسالةِ: الرسالةُ وحدَها معلّقةٌ، وموافقاتُه السابقةُ كما هي", async () => {
    for (const document of [TERMS, PRIVACY]) {
      expect((await accept(EXISTING_RIDER_TG, document.kind, document.version)).status).toBe(200);
    }
    const before = await sql<{ kind: string; accepted_at: Date }[]>`
      select c.kind, c.accepted_at from user_consents c join users u on u.id = c.user_id
       where u.telegram_id = ${EXISTING_RIDER_TG} order by c.kind`;

    const wire = await consentsOf(EXISTING_RIDER_TG);
    expect(wire.onboarding.satisfied).toBe(false);
    const pending = wire.onboarding.documents.filter((d) => d.state !== "satisfied");
    expect(pending.map((d) => d.kind)).toEqual([NOTICE.kind]);

    await accept(EXISTING_RIDER_TG, NOTICE.kind, NOTICE.version);
    expect((await consentsOf(EXISTING_RIDER_TG)).onboarding.satisfied).toBe(true);
    const after = await sql<{ kind: string; accepted_at: Date }[]>`
      select c.kind, c.accepted_at from user_consents c join users u on u.id = c.user_id
       where u.telegram_id = ${EXISTING_RIDER_TG} and c.kind <> ${NOTICE.kind} order by c.kind`;
    expect(after).toEqual(before);
  });

  it("٤) إصدارٌ جديدٌ للرسالةِ يُعيدُها مرّةً: إقرارٌ بإصدارٍ أقدمَ `superseded`", async () => {
    // محاكاةُ «الإصدارِ الجديدِ» بلا تغييرِ الشيفرةِ: إقرارُ هذا الراكبِ بالإصدارِ
    // الحاليِّ يُستبدَلُ بإقرارٍ بإصدارٍ أقدمَ — فالحاليُّ عندَه «جديدٌ» لم يُقِرَّ به.
    await sql`
      update user_consents c set version = '2026-01-01'
        from users u
       where u.id = c.user_id and u.telegram_id = ${EXISTING_RIDER_TG} and c.kind = ${NOTICE.kind}`;
    const stale = await consentsOf(EXISTING_RIDER_TG);
    expect(noticeState(stale)).toBe("superseded");
    expect(stale.onboarding.satisfied).toBe(false);

    await accept(EXISTING_RIDER_TG, NOTICE.kind, NOTICE.version);
    const fresh = await consentsOf(EXISTING_RIDER_TG);
    expect(noticeState(fresh)).toBe("satisfied");
    expect(fresh.onboarding.satisfied).toBe(true);
    // والإقرارانِ محفوظانِ معاً: السجلُّ يُضافُ إليه ولا يُستبدَلُ.
    const versions = await sql<{ version: string }[]>`
      select c.version from user_consents c join users u on u.id = c.user_id
       where u.telegram_id = ${EXISTING_RIDER_TG} and c.kind = ${NOTICE.kind} order by c.version`;
    expect(versions.map((v) => v.version)).toEqual(["2026-01-01", NOTICE.version]);
  });

  it("٥) السائقُ (دورُه في القاعدةِ) لا تُطلَبُ منه رسالةُ الراكبِ", async () => {
    for (const document of [TERMS, PRIVACY]) {
      const posted = await call(CONSENT_DRIVER_TG, "driver", "POST", "/v1/consents", {
        kind: document.kind,
        version: document.version,
        accepted: true,
      });
      expect(posted.status).toBe(200);
    }
    const wire = await consentsOf(CONSENT_DRIVER_TG, "driver");
    expect(wire.documents.map((d) => d.kind).sort()).toEqual([PRIVACY.kind, TERMS.kind].sort());
    expect(wire.onboarding.satisfied).toBe(true);
  });
});

describeIf("WR-32 (ب) — رقمُ الراكبِ لا يصلُ السائقَ في أيِّ سطحٍ سائقيٍّ", () => {
  it("٦) لوحُ العروضِ وتفاصيلُ العرضِ: لا رقمَ ولا اسمَ مستخدمٍ ولا معرّفَ تلغرامَ", async () => {
    const board = await call(DRIVER_TG, "driver", "GET", "/v1/driver/offers");
    expect(board.status).toBe(200);
    expect(board.text).toContain(orderId);
    expectNoRiderSecret("/v1/driver/offers", board.text);

    const detail = await call(DRIVER_TG, "driver", "GET", `/v1/driver/offers/${offerId}`);
    expect(detail.status).toBe(200);
    expectNoRiderSecret("/v1/driver/offers/:id", detail.text);
  });

  it("٧) قبولُ العرضِ ثمَّ المَهمّةُ النشطةُ: الاسمُ الأوّلُ وحدَه من هويّةِ الراكبِ", async () => {
    const accepted = await call(DRIVER_TG, "driver", "POST", `/v1/driver/offers/${offerId}/accept`);
    expect(accepted.status).toBe(200);
    expectNoRiderSecret("/v1/driver/offers/:id/accept", accepted.text);

    const job = await call(DRIVER_TG, "driver", "GET", "/v1/driver/job");
    expect(job.status).toBe(200);
    expect(job.text).toContain(orderId);
    expectNoRiderSecret("/v1/driver/job", job.text);
    // ما يُعرَضُ من هويّةِ الراكبِ: اسمُه الأوّلُ ولغتُه — لا اسمُه الكاملُ.
    expect(job.text).toContain(RIDER_FIRST_NAME);
    expect(job.text.includes("الخاصّة")).toBe(false);
  });

  it("٨) المحادثةُ داخلَ المنصّةِ: الطرفُ الآخرُ اسمٌ أوّلُ بلا رقمٍ", async () => {
    const posted = await call(RIDER_TG, "rider", "POST", `/v1/orders/${orderId}/chat/messages`, {
      clientMessageId: crypto.randomUUID(),
      text: "أنا عند البوابة",
    });
    expect([200, 201]).toContain(posted.status);

    const thread = await call(DRIVER_TG, "driver", "GET", `/v1/orders/${orderId}/chat`);
    expect(thread.status).toBe(200);
    expect(thread.text).toContain("أنا عند البوابة");
    expectNoRiderSecret("/v1/orders/:id/chat (driver)", thread.text);
  });

  it("٩) حصيلةُ السائقِ وسجلُّ رحلاتِه: لا رقمَ للراكبِ", async () => {
    // الرحلةُ تُختَمُ لتدخلَ الحصيلةَ — فالفحصُ على صفٍّ حقيقيٍّ لا على قائمةٍ فارغةٍ.
    await sql`
      update orders set status = 'in_progress'::order_status, started_at = now()
       where id = ${orderId}`;
    await sql`
      update orders set status = 'completed'::order_status, completed_at = now()
       where id = ${orderId}`;
    const entries = await call(
      DRIVER_TG,
      "driver",
      "GET",
      "/v1/driver/activity/entries?period=day",
    );
    expect(entries.status).toBe(200);
    expect(entries.text).toContain(orderId);
    expectNoRiderSecret("/v1/driver/activity/entries", entries.text);
    const summary = await call(DRIVER_TG, "driver", "GET", "/v1/driver/activity?period=day");
    expect(summary.status).toBe(200);
    expectNoRiderSecret("/v1/driver/activity", summary.text);
  });

  it("١٠) صندوقُ الإشعاراتِ الصادرُ لهذا الطلبِ: لا رقمَ للراكبِ في حمولةٍ", async () => {
    const rows = await sql<{ payload: string }[]>`
      select row_to_json(o)::text as payload from notification_outbox o where order_id = ${orderId}`;
    for (const row of rows) expectNoRiderSecret("notification_outbox", row.payload);
  });

  it("١١) غيرُ المخوَّلِ: سائقٌ لا صلةَ له بالطلبِ لا يقرأُ تفاصيلَه ولا محادثتَه", async () => {
    const detail = await call(CONSENT_DRIVER_TG, "driver", "GET", `/v1/driver/offers/${offerId}`);
    expect(detail.status).not.toBe(200);
    expectNoRiderSecret("offer detail (stranger)", detail.text);
    const thread = await call(CONSENT_DRIVER_TG, "driver", "GET", `/v1/orders/${orderId}/chat`);
    expect(thread.status).not.toBe(200);
    expectNoRiderSecret("chat (stranger)", thread.text);
  });

  it("١٢) والرقمُ مزروعٌ فعلاً: التدقيقُ ليسَ نجاحاً لأنَّ القاعدةَ فارغةٌ", async () => {
    const [row] = await sql<{ phone: string | null; telegram_username: string | null }[]>`
      select phone, telegram_username from users where telegram_id = ${RIDER_TG}`;
    expect(row?.phone).toBe(RIDER_PHONE);
    expect(row?.telegram_username).toBe(RIDER_USERNAME);
  });
});
