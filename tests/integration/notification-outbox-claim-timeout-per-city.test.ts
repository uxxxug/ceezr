/**
 * `D-37` — مهلةُ استرجاعِ الحجزِ المتروكِ في `claim_notification_delivery()` هيَ
 * مهلةُ **مدينةِ الصفِّ** (`ADR 0196`).
 *
 * كان التعريفُ السابقُ يقرأُ `notification_claim_timeout_seconds` بـ`limit 1` بلا
 * مدينةٍ ويُطبِّقُ القيمةَ الواحدةَ على كلِّ المدنِ. فالاختبارُ يضعُ مدينتينِ بمهلتينِ
 * متباعدتينِ (5s و3600s) وحجزاً عمرُه 60s في كلٍّ منهما: أيُّ قيمةٍ واحدةٍ تُطبَّقُ على
 * الاثنينِ تُخطِئُ في أحدِهما — فالسابقُ يسقطُ هنا أيّاً كانَ الصفُّ الذي يُعيدُه `limit 1`،
 * والحالتانِ المتعاكستانِ تمنعانِ مصادفةَ الترتيبِ الفيزيائيِّ.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const KEY = "notification_claim_timeout_seconds";
const TAG = "d37-claim-timeout";

let sql: Sql;
let short = "";
let long = "";
let saved: { city_id: string; value: unknown }[] = [];

async function setTimeoutOf(cityId: string, seconds: number): Promise<void> {
  await sql`update platform_settings set value = ${sql.json(seconds)} where city_id = ${cityId}::uuid and key = ${KEY}`;
}

async function abandonedClaim(
  cityId: string,
  label: string,
): Promise<{ id: string; token: string }> {
  const rows = await sql<{ id: string; token: string }[]>`
    insert into notification_outbox (city_id, kind, dedup_key, status, claim_token, claimed_at, attempts, next_attempt_at)
    values (${cityId}::uuid, 'dispute_resolution', ${`${TAG}:${label}:${crypto.randomUUID()}`}, 'sending',
            gen_random_uuid(), now() - interval '60 seconds', 1, now() + interval '1 day')
    returning id, claim_token::text as token
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("تعذَّرَ بذرُ الحجزِ");
  return row;
}

async function stateOf(id: string): Promise<{ status: string; token: string | null }> {
  const rows = await sql<{ status: string; token: string | null }[]>`
    select status, claim_token::text as token from notification_outbox where id = ${id}::uuid
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("الصفُّ غائبٌ");
  return row;
}

describeIf("مهلةُ استرجاعِ الحجزِ لكلِّ مدينةٍ — D-37", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string; code: string }[]>`
      select id, code from cities where code in ('JED', 'RUH') order by code
    `;
    short = cities.find((c) => c.code === "JED")?.id ?? "";
    long = cities.find((c) => c.code === "RUH")?.id ?? "";
    if (short === "" || long === "") throw new Error("جدةُ والرياضُ غيرُ مبذورتين");
    saved = await sql<{ city_id: string; value: unknown }[]>`
      select city_id::text, value from platform_settings where key = ${KEY}
    `;
    if (saved.length < 2) throw new Error("الإعدادُ غيرُ مبذورٍ لكلِّ مدينةٍ");
  });

  afterEach(async () => {
    await sql`delete from notification_outbox where dedup_key like ${`${TAG}:%`}`;
  });

  afterAll(async () => {
    for (const row of saved) {
      await sql`update platform_settings set value = ${sql.json(row.value as never)} where city_id = ${row.city_id}::uuid and key = ${KEY}`;
    }
    await sql.end();
  });

  for (const [label, shortCity, longCity] of [
    ["جدةُ قصيرةٌ والرياضُ طويلةٌ", () => short, () => long],
    ["الرياضُ قصيرةٌ وجدةُ طويلةٌ", () => long, () => short],
  ] as const) {
    it(`${label}: يُسترجَعُ حجزُ القصيرةِ وحدَه ويبقى حجزُ الطويلةِ لعاملِه`, async () => {
      await setTimeoutOf(shortCity(), 5);
      await setTimeoutOf(longCity(), 3600);
      const expired = await abandonedClaim(shortCity(), "short");
      const alive = await abandonedClaim(longCity(), "long");

      await sql`select claim_notification_delivery()`;

      const afterExpired = await stateOf(expired.id);
      const afterAlive = await stateOf(alive.id);
      console.log(
        `── D-37 · ${label}: القصيرةُ ${afterExpired.status} (رمزٌ ${afterExpired.token === expired.token ? "قديمٌ" : "مُحرَّرٌ"}) · الطويلةُ ${afterAlive.status} (رمزٌ ${afterAlive.token === alive.token ? "قديمٌ" : "مُحرَّرٌ"})`,
      );
      // المنتهيةُ مهلتُها في مدينتِها: الرمزُ الميّتُ لم يَعُدْ يملكُ الصفَّ — استُرجِعَ
      // وقد يُستلَمُ في النداءِ نفسِه برمزٍ جديدٍ (`next_attempt_at = now()`)، فالرمزُ هوَ الحكمُ.
      expect(afterExpired.token).not.toBe(expired.token);
      // وحجزٌ عمرُه دقيقةٌ في مدينةٍ مهلتُها ساعةٌ لا يُسلَبُ من عاملِه الحيِّ.
      expect(afterAlive).toEqual({ status: "sending", token: alive.token });
    });
  }
});
