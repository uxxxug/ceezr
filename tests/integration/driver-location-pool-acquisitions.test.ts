/**
 * الغرض: LOAD-01 (الدفعةُ 30) — شاهدٌ على PostgreSQL حقيقيّ لحجوزاتِ تجمُّعِ الطلبِ في مسارِ
 *   `POST /v1/driver/location` (قراءةُ السائقِ + `updateDriverLocation` بمنافذِ الحاويةِ نفسِها).
 *   يَعُدُّ الحجوزاتِ من داخلِ بوّابةِ المجمّع (`observeQueryTimings`: كلُّ حدثِ `query`/`tx` = حجزُ
 *   مقعد)، لا بعدِّ نصوصِ الاستعلامات، ويقارنُ المسارَ المرجعيَّ (القراءتان: `activeTripOf` ثمّ `open`)
 *   بالمرشّح (`openOnActiveTrip`: الرحلةُ داخلَ جملةِ الفتح) على السائقِ الجديدِ ذاتِه في الحمل.
 *   ويحرسُ العقدَ (`live-tracking-open-race.test.ts`) على القاعدةِ لا على مزدوجٍ في الذاكرة: إسنادٌ
 *   قائمٌ لحظةَ الفتحِ يُفتَحُ عليه، وإسنادٌ منتهٍ لا يُفتَحُ عليه، والفتحُ المتزامنُ لسائقٍ واحدٍ يُنتجُ
 *   جلسةً مفتوحةً واحدة، وسائقٌ مجهولٌ يُرفَضُ كما في `open`، ومسارُ انتهاءِ الجلسةِ يقرأُ طازجًا.
 *   لا اتصالاتٍ جديدةً ولا تغييرَ في سعةِ المجمّع (`max: 5` كـ `gatewayRequest`).
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. `B30_WITNESS_OUT` (اختياريّ) = ملفُّ JSON للنتائجِ الخام.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { updateDriverLocation } from "../../packages/application/geo/update-driver-location.ts";
import { createLiveTracking } from "../../packages/application/tracking/live-tracking.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  observeQueryTimings,
  type QueryTiming,
} from "../../packages/infrastructure/db/query-deadline.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import { createTrackingSessionRepository } from "../../packages/infrastructure/tracking/session-repository.ts";
import {
  createActiveTripReader,
  createDriverDutyAndTripReader,
  createDriverDutyReader,
} from "../../packages/infrastructure/tracking/tracking-queries.ts";
import type { TrackingSessionStore } from "../../packages/tracking/session-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
const APP = "b30-witness";
const POOL_MAX = 5; // = gatewayRequest؛ لا يُغيَّر
const BASE_TG = 7_300_000_000 + (Date.now() % 100_000) * 100;
const ORIGIN = { lat: 21.5433, lng: 39.1728 };

let admin: Sql;
let pool: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let seq = 0;
const events: QueryTiming[] = [];
const results: Record<string, unknown> = {};

function acquisitions(since: number) {
  const list = events.slice(since).filter((e) => e.label === APP && e.kind !== "txQuery");
  const bySig: Record<string, number> = {};
  for (const e of list) {
    const key = (e.sig ?? "?").slice(0, 48);
    bySig[key] = (bySig[key] ?? 0) + 1;
  }
  return {
    total: list.length,
    bySig,
    holdMs: list.reduce((a, e) => a + e.runMs, 0),
    waitMs: list.reduce((a, e) => a + e.waitMs, 0),
  };
}

async function newDriver(): Promise<{ id: string; tg: number }> {
  const tg = BASE_TG + seq++;
  const id = await seedCapableDriver({ sql: admin, cityId, service: "transport", telegramId: tg });
  await admin`insert into driver_availability (city_id, driver_id, is_available)
              values (${cityId}, ${id}, true)
              on conflict (driver_id) do update set is_available = true`;
  return { id, tg };
}

/** رحلةٌ مسنَدةٌ بحالةٍ معيّنة — صفٌّ حقيقيٌّ في `orders` بأدنى الأعمدةِ الإلزاميّة. */
async function assignTrip(driverId: string, status: "matched" | "in_progress" | "completed") {
  const [o] = await admin<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, assigned_driver_id, pickup,
                        idempotency_key)
    select ${cityId}, r.id, 'transport', ${status}::order_status, ${driverId}::uuid,
           st_setsrid(st_makepoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
           ${`b30:${crypto.randomUUID()}`}
      from riders r where r.city_id = ${cityId} limit 1
    returning id`;
  if (o === undefined) throw new Error("لا راكبَ في المدينة لبذرِ رحلة");
  return o.id;
}

function deps(withFreshOpen: boolean) {
  const repo = createTrackingSessionRepository(pool);
  const sessions: TrackingSessionStore = withFreshOpen
    ? repo
    : (({ openOnActiveTrip: _drop, ...rest }) => rest)(repo);
  const published: string[] = [];
  const tracking = createLiveTracking({
    sessions,
    publisher: { publish: async (e) => void published.push(`${e.type}:${e.tripId ?? "null"}`) },
    trips: createActiveTripReader(pool),
    duty: createDriverDutyReader(pool),
    dutyAndTrip: createDriverDutyAndTripReader(pool),
    clock: { now: () => new Date() },
    log: () => {},
  });
  return { tracking, published, drivers: createDriverDirectory(pool) };
}

/** المسارُ كما في `routes/driver-location.ts` بعدَ الإثبات: قراءةُ السائقِ ثمّ الإدخال. */
async function fix(tg: number, withFreshOpen: boolean) {
  const dep = deps(withFreshOpen);
  const found = await dep.drivers.findByTelegramId(String(tg));
  if (!found.ok || found.value === null) throw new Error("لم يُقرأ السائق");
  const result = await updateDriverLocation(
    {
      driver: found.value,
      latitude: ORIGIN.lat + Math.random() * 1e-3,
      longitude: ORIGIN.lng + Math.random() * 1e-3,
      quality: { accuracyMeters: 8, recordedAtMs: Date.now() },
    },
    { drivers: dep.drivers, clock: { now: () => new Date() }, tracking: dep.tracking },
  );
  return { result, published: dep.published };
}

async function openSessions(driverId: string) {
  const rows = await admin<{ trip_id: string | null }[]>`
    select trip_id::text from tracking_sessions where driver_id = ${driverId}::uuid and ended_at is null`;
  return rows.map((r) => ({ trip_id: r.trip_id }));
}

d("الدفعة 30: حجوزاتُ تجمُّعِ الطلبِ في مسارِ موقعِ السائق (PostgreSQL حقيقي)", () => {
  beforeAll(async () => {
    admin = createSql({ connectionString: URL ?? "" });
    pool = createSql({
      connectionString: URL ?? "",
      max: POOL_MAX,
      queryDeadlineMs: 15_000,
      applicationName: APP,
      idleTimeoutSeconds: null,
    });
    cityHandle = await ensureActiveCity(admin, {});
    cityId = cityHandle.cityId;
    const [r] = await admin<
      { n: number }[]
    >`select count(*)::int n from riders where city_id = ${cityId}`;
    if ((r?.n ?? 0) === 0) {
      const [u] = await admin<{ id: string }[]>`
        insert into users (city_id, telegram_id, role, full_name)
        values (${cityId}, ${BASE_TG + 99}, 'rider', 'b30') returning id`;
      await admin`insert into riders (city_id, user_id) values (${cityId}, ${u?.id ?? ""})`;
    }
    observeQueryTimings((t) => void events.push(t));
  });

  afterAll(async () => {
    observeQueryTimings(null);
    try {
      if (process.env.B30_WITNESS_OUT) {
        writeFileSync(process.env.B30_WITNESS_OUT, JSON.stringify(results, null, 1));
      }
    } finally {
      try {
        if (admin !== undefined) await restoreCityBaseline(admin, cityHandle);
      } finally {
        await Promise.allSettled([pool?.end({ timeout: 5 }), admin?.end({ timeout: 5 })]);
      }
    }
  });

  it("السائقُ الجديد (مسارُ الحمل): المرشّحُ يحجزُ مقعدًا أقلَّ بواحدٍ بالعدِّ الحقيقيّ، والأثرُ نفسُه", async () => {
    const runs: Record<string, unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      for (const fresh of [false, true]) {
        const drv = await newDriver();
        const since = events.length;
        const { result, published } = await fix(drv.tg, fresh);
        const acq = acquisitions(since);
        expect(result.ok).toBe(true);
        expect(published).toEqual(["session_started:null", "location_updated:null"]);
        expect(await openSessions(drv.id)).toEqual([{ trip_id: null }]);
        runs.push({ side: fresh ? "candidate" : "reference", ...acq });
      }
    }
    const ref = runs.filter((r) => r.side === "reference").map((r) => r.total as number);
    const cand = runs.filter((r) => r.side === "candidate").map((r) => r.total as number);
    results.newDriver = { runs, ref, cand };
    // قراءةُ السائق 1 + كتابةُ الموقع 1 + الخدمةُ/الرحلة 1 + الجلسةُ المفتوحة 1 + (الرحلة) + الفتح 1 + التقدّم 1
    expect(new Set(ref)).toEqual(new Set([7]));
    expect(new Set(cand)).toEqual(new Set([6]));
  });

  it("رحلةٌ مسنَدةٌ قائمةٌ لحظةَ الفتح: تُفتحُ الجلسةُ عليها ويحملُها الحدثان (المرجعُ والمرشّحُ سواء)", async () => {
    for (const fresh of [false, true]) {
      const drv = await newDriver();
      const trip = await assignTrip(drv.id, fresh ? "in_progress" : "matched");
      const { result, published } = await fix(drv.tg, fresh);
      expect(result.ok).toBe(true);
      expect(await openSessions(drv.id)).toEqual([{ trip_id: trip }]);
      expect(published).toEqual([`session_started:${trip}`, `location_updated:${trip}`]);
    }
  });

  it("رحلةٌ منتهيةٌ (completed) لا تُفتحُ عليها جلسة", async () => {
    const drv = await newDriver();
    await assignTrip(drv.id, "completed");
    const { result } = await fix(drv.tg, true);
    expect(result.ok).toBe(true);
    expect(await openSessions(drv.id)).toEqual([{ trip_id: null }]);
  });

  it("الإسنادُ بعدَ لقطةِ الخدمةِ وقبلَ الفتح يُرى في جملةِ الفتح (القاعدةُ تحكم)", async () => {
    const drv = await newDriver();
    const repo = createTrackingSessionRepository(pool);
    // اللقطةُ أوّلًا بلا رحلة، ثمّ الإسنادُ، ثمّ الفتحُ — ترتيبُ النافذةِ التي يحرسُها العقد.
    const before = await createDriverDutyAndTripReader(pool).dutyAndActiveTrip(drv.id);
    expect(before.activeTripId).toBeNull();
    const trip = await assignTrip(drv.id, "matched");
    const opened = await repo.openOnActiveTrip?.(drv.id, Date.now());
    expect(opened?.facts.tripId).toBe(trip);
  });

  it("فتحٌ متزامنٌ لسائقٍ واحد (8 نداءات): جلسةٌ مفتوحةٌ واحدة، والكلُّ يعيدُ الجلسةَ نفسَها", async () => {
    const drv = await newDriver();
    const repo = createTrackingSessionRepository(pool);
    const out = await Promise.all(
      Array.from({ length: 8 }, () => repo.openOnActiveTrip?.(drv.id, Date.now())),
    );
    const ids = new Set(out.map((r) => r?.sessionId));
    expect(ids.size).toBe(1);
    expect((await openSessions(drv.id)).length).toBe(1);
    results.concurrentOpen = { calls: 8, distinctSessions: ids.size };
  });

  it("سائقٌ غيرُ موجود: يُرفَضُ كما يُرفَضُ `open`، ولا صفَّ يُكتَب", async () => {
    const repo = createTrackingSessionRepository(pool);
    const ghost = crypto.randomUUID();
    await expect(repo.open(ghost, null, Date.now())).rejects.toThrow();
    await expect(repo.openOnActiveTrip?.(ghost, Date.now())).rejects.toThrow();
    expect((await openSessions(ghost)).length).toBe(0);
  });

  it("انتهاءُ الجلسة (تجاوزُ السقف): الاستبدالُ يُفتحُ على الرحلةِ الطازجة", async () => {
    const drv = await newDriver();
    await fix(drv.tg, true);
    await admin`update tracking_sessions set started_at = now() - interval '13 hours',
                       last_fix_at = now() - interval '13 hours'
                 where driver_id = ${drv.id}::uuid and ended_at is null`;
    const trip = await assignTrip(drv.id, "matched");
    const { result, published } = await fix(drv.tg, true);
    expect(result.ok).toBe(true);
    expect(await openSessions(drv.id)).toEqual([{ trip_id: trip }]);
    expect(published).toContain(`session_started:${trip}`);
  });
});
