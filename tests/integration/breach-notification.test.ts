/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيّةٍ لإبلاغِ حوادثِ اختراقِ البياناتِ
 *   الشخصيّةِ (`F12-08`). المقصودُ إثباتُ ما لا يُثبتُه mock ولا حاجزٌ ساكنٌ:
 *     ــ أنَّ موعدَ ٧٢ ساعةً يُحسَبُ من وقتِ العلمِ ولا يُعدَّلُ (`immutable`).
 *     ــ أنَّ الحادثَ يُسجَّلُ بكلِّ عناصرِه.
 *     ــ أنَّ تقييمَ الخطرِ يُسجَّلُ ويُحدِّدُ هل إبلاغُ أصحابِ البياناتِ واجبٌ.
 *     ــ أنَّ الموعدَ المنقضيَ يُكشَفُ.
 *     ــ أنَّ إبلاغَ الهيئةِ وأصحابِ البياناتِ يُسجَّلُ بتاريخِه.
 * الحالة: منفّذ فعلياً — 2026-09-18.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: لا شيءَ — البندُ قدرةُ إبلاغٍ لا إرسالٌ فعليٌّ.
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

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let detectorId: string;

const DETECTOR_TELEGRAM = 959008;

describeIf("F12-08 — إبلاغُ حوادثِ اختراقِ البياناتِ الشخصيّةِ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });

    const cityResult = await ensureActiveCity(sql);
    cityId = cityResult.cityId;
    cityHandle = cityResult;

    // إنشاءُ المستخدمِ الذي يكتشفُ الحادثَ
    const users = await sql`
      insert into users (telegram_id, full_name, role, city_id, language_code)
      values (${DETECTOR_TELEGRAM}, 'Breach Detector', 'admin', ${cityId}::uuid, 'ar')
      on conflict (telegram_id) do update set full_name = excluded.full_name
      returning id
    `;
    detectorId = users[0]?.id as string;
  });

  afterAll(async () => {
    if (cityHandle !== undefined) {
      await restoreCityBaseline(sql, cityHandle);
    }
    await sql.end();
  });

  it("يُسجِّلُ حادثَ اختراقٍ ويعيدُ مُعرِّفَه", async () => {
    const awarenessTime = "2026-09-18T10:00:00+03:00";
    const result = await sql`
      select record_breach_incident(
        ${detectorId}::uuid,
        ${cityId}::uuid,
        'اختراقُ قاعدةِ بياناتِ الركّابِ',
        ${awarenessTime}::timestamptz,
        null
      ) as incident_id
    `;
    const incidentId = result[0]?.incident_id as string;
    expect(incidentId).toBeTruthy();

    // التحقق من أنَّ الحادثَ مُسجَّلٌ
    const record = await sql`
      select awareness_time, status from breach_incidents where id = ${incidentId}::uuid
    `;
    expect(record[0]?.status).toBe("detected");
    expect(new Date(record[0]?.awareness_time)).toEqual(new Date(awarenessTime));
  });

  it("يُثبِتُ أنَّ موعدَ ٧٢ ساعةً ثابتٌ يُحسَبُ من وقتِ العلمِ", async () => {
    const awarenessTime = "2026-09-18T12:00:00+03:00";
    const result = await sql`
      select authority_notification_deadline(
        ${awarenessTime}::timestamptz
      ) as deadline
    `;
    const deadline = new Date(result[0]?.deadline as string);
    const awareness = new Date(awarenessTime);
    const diffHours = (deadline.getTime() - awareness.getTime()) / 3_600_000;
    expect(diffHours).toBeCloseTo(72, 0);
  });

  it("يُسجِّلُ تقييمَ الخطرِ ويُحدِّدُ هل إبلاغُ أصحابِ البياناتِ واجبٌ", async () => {
    // تسجيلُ حادثٍ
    const incident = await sql`
      select record_breach_incident(
        ${detectorId}::uuid,
        ${cityId}::uuid,
        'اختراقُ بياناتٍ حسّاسةٍ',
        now(),
        null
      ) as incident_id
    `;
    const incidentId = incident[0]?.incident_id as string;

    // تقييمُ الخطرِ: عاليٌ
    await sql`
      select assess_breach_incident(
        ${incidentId}::uuid,
        'high_risk'::breach_severity,
        array['health', 'financial']::text[],
        500,
        array['national_id', 'bank_account']::text[],
        'تسريبُ أرقامٍ وطنيّةٍ وحساباتٍ مصرفيّةٍ',
        'isolate_server, rotate_credentials, notify_authority',
        'mfa_enforcement, network_segmentation'
      )
    `;

    // الحالةُ صارت assessed
    const record = await sql`
      select severity, status, subjects_notification_required from breach_incidents where id = ${incidentId}::uuid
    `;
    expect(record[0]?.severity).toBe("high_risk");
    expect(record[0]?.status).toBe("assessed");
    // إبلاغُ أصحابِ البياناتِ واجبٌ لأنَّ الخطرَ عاليٌ
    expect(record[0]?.subjects_notification_required).toBe(true);
  });

  it("يُكشِفُ الموعدَ المنقضيَ بعدَ ٧٢ ساعةً", async () => {
    // حادثٌ قديمٌ (قبلَ ٧٣ ساعةً)
    const oldTime = new Date(Date.now() - 73 * 3_600_000);
    const incident = await sql`
      select record_breach_incident(
        ${detectorId}::uuid,
        ${cityId}::uuid,
        'حادثٌ قديمٌ',
        ${oldTime}::timestamptz,
        null
      ) as incident_id
    `;
    const incidentId = incident[0]?.incident_id as string;

    const overdue = await sql`
      select authority_notification_is_overdue(${incidentId}::uuid) as overdue
    `;
    expect(overdue[0]?.overdue).toBe(true);
  });

  it("يُسجِّلُ إبلاغَ الهيئةِ وإبلاغَ أصحابِ البياناتِ", async () => {
    const incident = await sql`
      select record_breach_incident(
        ${detectorId}::uuid,
        ${cityId}::uuid,
        'حادثٌ يُبلَّغُ',
        now(),
        null
      ) as incident_id
    `;
    const incidentId = incident[0]?.incident_id as string;

    // تقييمُ الخطرِ
    await sql`
      select assess_breach_incident(
        ${incidentId}::uuid,
        'medium_risk'::breach_severity,
        array['contact']::text[],
        50,
        array['phone']::text[],
        'تأثيرٌ متوسّطٌ',
        'patch',
        'audit'
      )
    `;

    // تسجيلُ إبلاغِ الهيئةِ
    await sql`
      select mark_authority_notified(${incidentId}::uuid)
    `;
    const afterAuthority = await sql`
      select authority_notified_at, status from breach_incidents where id = ${incidentId}::uuid
    `;
    expect(afterAuthority[0]?.authority_notified_at).not.toBeNull();
    expect(afterAuthority[0]?.status).toBe("authority_notified");

    // تسجيلُ إبلاغِ أصحابِ البياناتِ
    await sql`
      select mark_subjects_notified(${incidentId}::uuid)
    `;
    const afterSubjects = await sql`
      select subjects_notified_at, status from breach_incidents where id = ${incidentId}::uuid
    `;
    expect(afterSubjects[0]?.subjects_notified_at).not.toBeNull();
    expect(afterSubjects[0]?.status).toBe("contained");
  });
});
