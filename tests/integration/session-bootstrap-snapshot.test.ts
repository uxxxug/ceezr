/**
 * الغرض: `LOAD-01` — قراءةُ الإقلاعِ المُدمَجةُ على PostgreSQL الحقيقيِّ **تُكافئُ** المحوّلَينِ
 *   المنفردَينِ (`createViewerAccountReader` · `createConsentRecordReader`) نتيجةً بنتيجةٍ،
 *   وتصلُ القاعدةَ **بعبارةٍ واحدةٍ** لا اثنتَين. الحالاتُ: مستخدمٌ بسجلِّ موافقاتٍ (بختمٍ
 *   بدقّةِ الميكروثانيةِ وترتيبٍ يخالفُ ترتيبَ الإدراجِ)، ومستخدمٌ محظورٌ بلا موافقاتٍ
 *   ولغةٍ غيرِ افتراضيّةٍ، ومعرّفٌ غائبٌ، ومعرّفٌ غيرُ رقميٍّ (صفرُ عبارات).
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلُّ هجرةٍ تمسُّ `users` أو `list_user_consents`.
 * ملاحظات مستقبلية: لا شيء.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createConsentRecordReader } from "../../packages/infrastructure/consent/consent-store.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSessionBootstrapSnapshotReader } from "../../packages/infrastructure/identity/session-bootstrap-snapshot.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const WITH_CONSENTS = 900_007_411;
const BLOCKED_NO_CONSENTS = 900_007_412;
const ABSENT = 900_007_413;

/** عدّادُ عباراتٍ حولَ الاتصالِ الحقيقيِّ — `unsafe` وحدَه ما يستعملُه المحوّلون الثلاثة. */
function counting(base: Sql): { readonly sql: Sql; readonly count: () => number } {
  let n = 0;
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (...args: Parameters<Sql["unsafe"]>) => {
          n += 1;
          return target.unsafe(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { sql: proxy, count: () => n };
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  await sql`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    select c.id, ${WITH_CONSENTS}, 'driver', 'سائق اختبار الإقلاع', '+966500007411', 'ar'
      from cities c order by c.code limit 1
  `;
  await sql`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code, is_blocked)
    select c.id, ${BLOCKED_NO_CONSENTS}, 'rider', 'راكب اختبار الإقلاع', '+966500007412', 'en', true
      from cities c order by c.code limit 1
  `;
  // إدراجٌ بترتيبٍ يخالفُ ترتيبَ الختمِ، وختمٌ بدقّةِ الميكروثانية: ترتيبُ الدالّةِ والتحليلُ
  // يجبُ أن يبقيا كما في المحوّلِ المنفردِ حرفاً.
  for (const [kind, version, at] of [
    ["privacy_policy", "2026-09-12", "2026-10-02T08:00:00.123456Z"],
    ["terms_of_service", "2026-09-12", "2026-10-01T08:00:00.654321Z"],
    ["terms_of_service", "2026-08-01", "2026-09-01T08:00:00.000001Z"],
  ] as const) {
    const [row] = await sql<{ result: { ok?: boolean } }[]>`
      select record_user_consent(${WITH_CONSENTS}::bigint, ${kind}::text, ${version}::text,
                                 ${at}::timestamptz) as result
    `;
    if (row?.result.ok !== true) throw new Error(`تعذّر زرعُ الموافقة: ${JSON.stringify(row)}`);
  }
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`
    delete from user_consents
     where user_id in (select id from users where telegram_id in (${WITH_CONSENTS}, ${BLOCKED_NO_CONSENTS}))
  `;
  await sql`delete from users where telegram_id in (${WITH_CONSENTS}, ${BLOCKED_NO_CONSENTS})`;
  await sql.end();
});

describeIf("LOAD-01 — قراءةُ الإقلاعِ المُدمَجةُ على قاعدةٍ حقيقيّة", () => {
  it("تكافئُ المحوّلَينِ المنفردَينِ في كلِّ حالةٍ، بعبارةٍ واحدةٍ بدلَ اثنتَين", async () => {
    const coalesced = counting(sql);
    const separate = counting(sql);
    const snapshot = createSessionBootstrapSnapshotReader(coalesced.sql);
    const accounts = createViewerAccountReader(separate.sql);
    const consents = createConsentRecordReader(separate.sql);

    for (const id of [String(WITH_CONSENTS), String(BLOCKED_NO_CONSENTS), String(ABSENT)]) {
      const before = { c: coalesced.count(), s: separate.count() };
      const got = await snapshot.read(id);
      const account = await accounts.findByTelegramUserId(id);
      const recorded = await consents.listForTelegramUser(id);
      expect(got.account).toEqual(account);
      expect(got.consents).toEqual(recorded);
      expect(coalesced.count() - before.c).toBe(1);
      expect(separate.count() - before.s).toBe(2);
    }

    // قيمٌ مطلقةٌ لا تكافؤٌ وحدَه — كي لا يجتازَ تكافؤُ خطأَينِ متماثلَين.
    const seeded = await snapshot.read(String(WITH_CONSENTS));
    expect(seeded.account).toEqual({
      ok: true,
      value: { role: "driver", isBlocked: false, languageCode: "ar" },
    });
    if (!seeded.consents.ok) throw new Error("فشلَت قراءةُ الموافقات");
    expect(seeded.consents.value.map((c) => [c.kind, c.version, c.acceptedAtMs])).toEqual([
      ["terms_of_service", "2026-08-01", Date.parse("2026-09-01T08:00:00.000Z")],
      ["terms_of_service", "2026-09-12", Date.parse("2026-10-01T08:00:00.654Z")],
      ["privacy_policy", "2026-09-12", Date.parse("2026-10-02T08:00:00.123Z")],
    ]);
    const blocked = await snapshot.read(String(BLOCKED_NO_CONSENTS));
    expect(blocked.account).toEqual({
      ok: true,
      value: { role: "rider", isBlocked: true, languageCode: "en" },
    });
    expect(blocked.consents).toEqual({ ok: true, value: [] });
    const absent = await snapshot.read(String(ABSENT));
    expect(absent).toEqual({
      account: { ok: true, value: null },
      consents: { ok: true, value: [] },
    });
  });

  it("معرّفٌ غيرُ رقميٍّ لا يصلُ القاعدةَ — كالمحوّلَينِ المنفردَين", async () => {
    const coalesced = counting(sql);
    const got = await createSessionBootstrapSnapshotReader(coalesced.sql).read("12ab");
    expect(got).toEqual({ account: { ok: true, value: null }, consents: { ok: true, value: [] } });
    expect(coalesced.count()).toBe(0);
  });

  it("سالبٌ: عبارةٌ تفشلُ = خطأٌ مصنَّفٌ للقراءتَينِ كلتيهما لا رميٌ", async () => {
    const broken = new Proxy(sql, {
      get(target, prop, receiver) {
        if (prop === "unsafe") return () => Promise.reject(new Error("connection lost"));
        return Reflect.get(target, prop, receiver);
      },
    });
    const got = await createSessionBootstrapSnapshotReader(broken).read(String(WITH_CONSENTS));
    expect(got.account).toEqual({
      ok: false,
      error: { code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" },
    });
    expect(got.consents).toEqual({
      ok: false,
      error: { code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" },
    });
  });
});
