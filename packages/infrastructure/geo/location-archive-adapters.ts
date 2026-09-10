/**
 * الغرض: محوّلاتُ أرشفةِ تاريخِ الموقعِ — دفترُ الأرشيفِ على PostgreSQL، وترميزُ
 *   الصفحةِ وبصمتُها، وجسرٌ يُسلِّمُ منفذَ النسخِ الاحتياطيّةِ إلى حالةِ
 *   الاستخدامِ. البند `F7-06`، `ADR-0075`، `DEC-15`.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F7-06`.
 * ينتمي إلى: infrastructure/geo
 * يُستخدم من: `apps/workers/src/container.ts`.
 * ملاحظات مستقبلية: يومَ يُضافُ مزوّدُ تخزينٍ ثانٍ للأرشيفِ يُحقَنُ من الجسرِ
 *   ههنا بلا مساسٍ بحالةِ الاستخدامِ.
 *
 * ## لماذا `NDJSON` لا `COPY … to`
 *
 * لأنَّ الأرشيفَ يُقرَأُ بعدَ سنواتٍ في أداةٍ لا نعرفُها اليومَ. وسطرٌ لكلِّ صفٍّ
 * فيه أسماءُ الأعمدةِ صريحةً يُقرَأُ بأيِّ أداةٍ وبلا مخطّطٍ مصاحبٍ، أمّا
 * `COPY` فيلزمُه ترتيبُ الأعمدةِ ومعناها — وهما في هجرةٍ قد تكونُ تغيّرَت. وحجمُ
 * الفارقِ يذهبُ في الضغطِ.
 *
 * ## ولماذا الترتيبُ على الأعمدةِ **كلِّها**
 *
 * الاستئنافُ يشترطُ ترتيباً يُعطي الصفحةَ رقمَ `k` المحتوى نفسَه في كلِّ شوطٍ،
 * وإلّا تكرّرَ صفٌّ وسقطَ آخرُ. والترتيبُ على `(recorded_at, driver_id)` وحدَه
 * **غيرُ حاسمٍ**: صفّانِ لسائقٍ واحدٍ في الطابعِ نفسِه واردانِ. فالترتيبُ ههنا
 * على الأعمدةِ كلِّها؛ وحينَها لا يقعُ التعادلُ إلّا بينَ صفَّينِ **متطابقَينِ
 * في كلِّ عمودٍ** — وترتيبُهما بينَهما لا يُغيِّرُ محتوى صفحةٍ إذ لا يُميَّزُ
 * أحدُهما عن الآخرِ أصلاً.
 *
 * و`ctid` كانَ أقصرَ، ولا يجوزُ: هوَ عمودٌ نظاميٌّ لا يُقرَأُ من جدولٍ أبٍ
 * مقسَّمٍ، ولا يُبنى استئنافٌ على تفصيلٍ ماديٍّ في الصفحاتِ.
 */

import { createHash } from "node:crypto";
import type {
  ArchiveCodec,
  ArchivedLocationRow,
  ArchiveObjectStore,
  DropDayOutcome,
  DueDay,
  LocationArchiveCatalog,
  ManifestPart,
  RecordPartInput,
} from "../../application/geo/archive-location-partitions.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { BackupStoragePort } from "../backup/backup-port.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

const CATALOG_PORT = "geo.locationArchiveCatalog";
const STORE_PORT = "geo.locationArchiveStore";

/** ترميزُ صفحةٍ: سطرٌ لكلِّ صفٍّ، وبصمةُ `sha256` على البايتاتِ المرفوعةِ عينِها. */
export function createLocationArchiveCodec(): ArchiveCodec {
  return {
    encode: (rows: readonly ArchivedLocationRow[]): Uint8Array => {
      const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      return new TextEncoder().encode(text);
    },
    digest: (content: Uint8Array): string =>
      createHash("sha256").update(Buffer.from(content)).digest("hex"),
  };
}

/**
 * جسرٌ من منفذِ النسخِ الاحتياطيّةِ إلى منفذِ الأرشيفِ. ولا يُقبَلُ مخزنٌ بلا
 * `download`: مخزنٌ يُكتَبُ فيه ولا يُقرَأُ منه لا يصلحُ للأرشفةِ ألبتّةَ، إذ
 * التحقّقُ شرطُ الإسقاطِ — فيُرفَضُ صريحاً لا يُتجاوَزُ صامتاً.
 */
export function createLocationArchiveStore(storage: BackupStoragePort): ArchiveObjectStore {
  return {
    upload: (name: string, content: Uint8Array) =>
      guard(STORE_PORT, async () => {
        const uploaded = await storage.upload(name, content);
        if (!uploaded.ok) throw new Error(uploaded.error.detail);
        return { remoteFileId: uploaded.value.remoteFileId, bytes: uploaded.value.bytes };
      }),
    download: (remoteFileId: string) =>
      guard(STORE_PORT, async () => {
        const read = storage.download;
        if (read === undefined) {
          throw new Error("مخزنُ الأرشيفِ لا يُقدِّمُ قراءةً، والتحقّقُ شرطُ الإسقاطِ");
        }
        const got = await read.call(storage, remoteFileId);
        if (!got.ok) throw new Error(got.error.detail);
        return got.value;
      }),
  };
}

/** عددٌ من قيمةٍ مجهولةِ النوعِ — `bigint` يعودُ نصّاً من السائقِ. */
function countOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** قراءةُ أيّامِ الاستحقاقِ من المغلَّفِ — ما ليسَ على الشكلِ يُطرَحُ لا يُخمَّنُ. */
function readDueDays(raw: Record<string, unknown>): readonly DueDay[] {
  const days = raw.days;
  if (!Array.isArray(days)) return [];
  const parsed: DueDay[] = [];
  for (const entry of days) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const day = record.day;
    const partition = record.partition;
    if (typeof day !== "string" || typeof partition !== "string") continue;
    const cities = Array.isArray(record.cities) ? record.cities : [];
    parsed.push({
      day,
      partition,
      cities: cities.flatMap((city) => {
        if (typeof city !== "object" || city === null) return [];
        const cityRecord = city as Record<string, unknown>;
        const cityId = cityRecord.city_id;
        if (typeof cityId !== "string") return [];
        return [{ cityId, rows: countOf(cityRecord.rows) }];
      }),
    });
  }
  return parsed;
}

export function createLocationArchiveCatalog(sql: Sql): LocationArchiveCatalog {
  return {
    dueDays: (
      hotDays: number,
      maxDays: number,
    ): Promise<Result<readonly DueDay[], PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select location_archive_due_days(${hotDays}::integer, ${maxDays}::integer) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردُّ location_archive_due_days غيرُ مفهومٍ");
        if (!envelope.ok) {
          throw new Error(envelope.error ?? "location_archive_due_days أرجعَ فشلاً بلا سببٍ");
        }
        return readDueDays(envelope as unknown as Record<string, unknown>);
      }),

    parts: (
      day: string,
      cityId: string,
    ): Promise<Result<readonly ManifestPart[], PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        const rows = await sql<
          { part: number; row_count: string | number; verified_at: Date | null }[]
        >`
          select part, row_count, verified_at
            from location_archive_manifest
           where city_id = ${cityId}::uuid
             and partition_date = ${day}::date
           order by part asc
        `;
        return rows.map((row) => ({
          part: countOf(row.part),
          rowCount: countOf(row.row_count),
          verified: row.verified_at !== null,
        }));
      }),

    readPage: (
      day: string,
      cityId: string,
      offset: number,
      limit: number,
    ): Promise<Result<readonly ArchivedLocationRow[], PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        const rows = await sql<ArchivedLocationRow[]>`
          select
            city_id::text as city_id,
            driver_id::text as driver_id,
            st_asewkt(position) as position,
            to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') as recorded_at,
            to_char(written_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') as written_at,
            accuracy_m,
            quality,
            source
          from driver_location_history
          where city_id = ${cityId}::uuid
            and recorded_at >= ${day}::date
            and recorded_at < (${day}::date + 1)
          order by
            recorded_at asc,
            driver_id asc,
            written_at asc,
            quality asc,
            source asc,
            accuracy_m asc nulls first,
            st_asewkt(position) asc
          limit ${limit}::integer offset ${offset}::integer
        `;
        return rows;
      }),

    recordPart: (input: RecordPartInput): Promise<Result<void, PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        /**
         * `on conflict … do update` لا `do nothing`: الشوطُ الذي رفعَ ثمَّ سقطَ
         * قبلَ التحقّقِ يترُكُ صفّاً غيرَ مُتحقَّقٍ منه، وشوطٌ ثانٍ يرفعُ الصفحةَ
         * نفسَها إلى كائنٍ جديدٍ — فالدفترُ يجبُ أن يحملَ الكائنَ الأخيرَ لا
         * الأوّلَ المهجورَ. و`verified_at` يعودُ فارغاً عندَ كلِّ رفعٍ جديدٍ:
         * إثباتُ نسخةٍ سابقةٍ لا يُثبِتُ التي حلَّت محلَّها.
         */
        await sql`
          insert into location_archive_manifest (
            city_id, partition_date, part, object_name, remote_file_id,
            row_count, bytes, sha256, exported_at, verified_at
          ) values (
            ${input.cityId}::uuid, ${input.day}::date, ${input.part}::integer,
            ${input.objectName}, ${input.remoteFileId},
            ${input.rowCount}::bigint, ${input.bytes}::bigint, ${input.sha256},
            now(), null
          )
          on conflict (city_id, partition_date, part) do update set
            object_name = excluded.object_name,
            remote_file_id = excluded.remote_file_id,
            row_count = excluded.row_count,
            bytes = excluded.bytes,
            sha256 = excluded.sha256,
            exported_at = excluded.exported_at,
            verified_at = null
        `;
      }),

    markVerified: (
      cityId: string,
      day: string,
      part: number,
    ): Promise<Result<void, PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        await sql`
          update location_archive_manifest
             set verified_at = now()
           where city_id = ${cityId}::uuid
             and partition_date = ${day}::date
             and part = ${part}::integer
        `;
      }),

    dropDay: (day: string, hotDays: number): Promise<Result<DropDayOutcome, PortFailureError>> =>
      guard(CATALOG_PORT, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select location_archive_drop_day(${day}::date, ${hotDays}::integer) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردُّ location_archive_drop_day غيرُ مفهومٍ");
        const raw = envelope as unknown as Record<string, unknown>;
        /**
         * الرفضُ **ليسَ عطلاً**: هوَ الحارسُ يعملُ. فيُقرَأُ حصيلةً مُسمّاةً لا
         * يُرمى استثناءً — ورميُه استثناءً كانَ سيجعلَ المهمّةَ تسقطُ في كلِّ
         * شوطٍ بينما النظامُ يفعلُ الصوابَ بعينِه.
         */
        if (!envelope.ok) {
          return {
            status: "refused" as const,
            reason: typeof raw.error === "string" ? raw.error : "REFUSED",
          };
        }
        const status =
          raw.status === "dropped" ? ("dropped" as const) : ("already-dropped" as const);
        return { status, droppedRows: countOf(raw.dropped_rows) };
      }),
  };
}
