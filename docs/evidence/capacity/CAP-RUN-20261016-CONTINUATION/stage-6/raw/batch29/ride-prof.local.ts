// تشخيصٌ محليٌّ (خارجَ المستودع): كلفةُ مسارِ طلبِ الرحلةِ الحقيقيِّ على PG بأحجامِ نهايةِ موجة.
// لا يُقاسُ هنا سعةٌ ولا قبول — زمنُ خادمٍ لعبارةٍ واحدةٍ وتفكيكُ عباراتِها المتداخلة.
import { createSql } from "/home/user/workspace/ceezr/packages/infrastructure/db/client.ts";
import { createRideRequestCommand } from "/home/user/workspace/ceezr/packages/infrastructure/transport/ride-request-store.ts";
import { ensureActiveCity } from "/home/user/workspace/ceezr/tests/support/active-city.ts";
import { seedCapableDriver } from "/home/user/workspace/ceezr/tests/support/seed-capable-driver.ts";

const URL = process.env.TEST_DATABASE_URL!;
const DRIVERS = Number(process.env.DRIVERS ?? 1500);
const RIDERS = Number(process.env.RIDERS ?? 3000);
const BASE_TG = 810_000_000;
const sql = createSql({ connectionString: URL, max: 4 });
const city = await ensureActiveCity(sql, {});
const cityId = city.cityId;
const ORIGIN = { lat: 21.5433, lng: 39.1728 };
const DEST = { lat: 21.5551, lng: 39.1902 };

const [{ n: have }] = await sql<{ n: number }[]>`select count(*)::int n from users where telegram_id between ${BASE_TG} and ${BASE_TG + 99_999}`;
if (have === 0) {
  console.log("seeding drivers", DRIVERS);
  for (let i = 0; i < DRIVERS; i++) {
    const tg = BASE_TG + i;
    const driverId = await seedCapableDriver({ sql, cityId, service: "transport", telegramId: tg });
    const lat = ORIGIN.lat + (Math.random() - 0.5) * 0.05;
    const lng = ORIGIN.lng + (Math.random() - 0.5) * 0.05;
    await sql`update drivers set last_location = st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography,
      last_location_at = now(), last_location_recorded_at = now() where id = ${driverId}`;
    await sql`insert into driver_availability (city_id, driver_id, is_available) values (${cityId}, ${driverId}, true)
      on conflict (driver_id) do update set is_available = true`;
  }
  console.log("seeding riders", RIDERS);
  for (let i = 0; i < RIDERS; i++) {
    const tg = BASE_TG + 50_000 + i;
    const [u] = await sql<{ id: string }[]>`insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${tg}, 'rider', 'prof', ${`+9665${String(tg).slice(-8)}`}) returning id`;
    await sql`insert into riders (city_id, user_id) values (${cityId}, ${u!.id})`;
  }
}
const cmd = createRideRequestCommand(sql);
const phase = process.env.PHASE ?? "fill";
const from = Number(process.env.FROM ?? 0);
const count = Number(process.env.COUNT ?? RIDERS);
const times: number[] = [];
let ok = 0;
for (let i = from; i < from + count; i++) {
  const tg = BASE_TG + 50_000 + i;
  const t0 = performance.now();
  const r = await cmd.create({
    telegramUserId: String(tg), idempotencyKey: `prof:${phase}:${i}:${crypto.randomUUID()}`,
    service: "transport", origin: ORIGIN, destination: DEST, notes: null, offerSar: null,
  } as never);
  times.push(performance.now() - t0);
  if ((r as { ok: boolean }).ok) ok++;
  else if (i === from) console.log("first result", JSON.stringify(r).slice(0, 300));
}
times.sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!.toFixed(2);
console.log(`phase=${phase} n=${times.length} ok=${ok} wall p50=${p(0.5)}ms p95=${p(0.95)}ms max=${p(0.999)}ms`);
const [s] = await sql<{ orders: number; offers: number; drivers: number }[]>`select (select count(*) from orders)::int orders, (select count(*) from order_offers)::int offers, (select count(*) from drivers)::int drivers`;
console.log("table sizes", JSON.stringify(s));
await sql.end();
