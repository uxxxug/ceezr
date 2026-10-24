import postgres from "/home/user/workspace/ceezr/node_modules/.bun/postgres@3.4.9/node_modules/postgres/src/index.js";
const src = await Bun.file("/home/user/workspace/ceezr/packages/infrastructure/dispatch/dispatch-adapters.ts").text();
const m = src.match(/const CANDIDATES_NEARBY_SQL = `([\s\S]*?)`;/);
const QUERY = m![1];
const sql = postgres("postgres://postgres@localhost:55432/ceezr", { prepare: false, max: 1 });
const cityId = (await sql`select id from cities where code = 'JED'`)[0].id as string;
const params = [cityId, 39.19, 21.55, 10000, 39.19, 21.55, 50];
function median(v: number[]) { const s = [...v].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
for (let i = 0; i < 6; i++) await sql.unsafe(QUERY, params);
const times: number[] = [];
for (let i = 0; i < 10; i++) { const t0 = performance.now(); await sql.unsafe(QUERY, params); times.push(performance.now() - t0); }
const count = await sql`select (select count(*) from drivers) as d, (select count(*) from driver_availability where is_available) as a`;
console.log(`${count[0].d} سائقًا / ${count[0].a} متاح → وسيط: ${median(times).toFixed(2)}ms`);
await sql.end({ timeout: 5 });
