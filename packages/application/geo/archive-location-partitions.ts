/**
 * الغرض: تنفيذُ سياسةِ الاستبقاءِ المعتمدةِ (`DEC-15`) على تاريخِ الموقعِ —
 *   ساخنٌ أربعةَ عشرَ يوماً في القاعدةِ، ثمَّ **أرشيفٌ خارجَها** ثمَّ إسقاطُ
 *   القِسمِ. البند `F7-06`، العائق `CAP-010`، `ADR-0075`.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F7-06`.
 * ينتمي إلى: application/geo
 * يُستخدم من: `apps/workers/src/container.ts` (مهمّةٌ عامّةٌ يوميّةٌ).
 * ملاحظات مستقبلية: وجهةُ الأرشيفِ اليومَ هيَ **مخزنُ النسخِ الاحتياطيّةِ نفسُه**
 *   بمنفذِه نفسِه؛ ويومَ يُحسَمُ `F12-15` قد تختلفُ الوجهةُ لكلِّ مدينةٍ —
 *   والدفترُ مُقسَّمٌ بالمدينةِ منذُ اليومِ الأوّلِ فلا يُعادُ بناءُ ما مضى.
 *
 * ## لماذا مخزنُ النسخِ نفسُه — وليسَ ذلكَ التفافاً على `F12-15`
 *
 * السؤالُ الذي يحكمُه `F12-15` هوَ: **أيَّ حدودٍ تعبرُ بياناتُ الرحلةِ؟** وهذه
 * الصفوفُ بعينِها **تعبرُها اليومَ فعلاً** في كلِّ نسخةٍ احتياطيّةٍ يوميّةٍ منذُ
 * `OPS-002`. فوضعُ الأرشيفِ في المخزنِ نفسِه **لا يفتحُ حدّاً جديداً ولا يُنشئُ
 * تعرُّضاً لم يكنْ**؛ ووضعُه في مخزنٍ ثانٍ هوَ ما كانَ سيفتحُ حدّاً ثانياً
 * يحتاجُ قراراً. فالمسارُ المختارُ هوَ **الأقلُّ إحداثاً للتغييرِ** لا الأسهلُ.
 * ويبقى أنَّ `F12-15` حينَ يُحسَمُ يحكمُ المخزنَينِ معاً بحكمٍ واحدٍ — وذاكَ
 * مقصودٌ: مصدرُ حقيقةٍ واحدٌ لموضعِ البياناتِ لا اثنانِ.
 *
 * ## ولماذا الرفعُ ثمَّ التحقّقُ ثمَّ الإسقاطُ — بهذا الترتيبِ وحدَه
 *
 * لأنَّ الخطوةَ الأخيرةَ لا رجعةَ فيها. فلا يُسقَطُ قِسمٌ حتّى **يُنزَلَ** ما
 * رُفِعَ منه وتُطابَقَ بصمتُه وعددُ صفوفِه. و«قالَ المخزنُ إنّه استلمَ» ليسَ
 * إثباتاً: مهمّةُ التحقّقِ من النسخِ الاحتياطيّةِ في هذا المستودعِ قائمةٌ على
 * المبدأِ نفسِه منذُ `OPS-004` — نسخةٌ لم تُقرأْ قطُّ ليست نسخةً.
 *
 * ## ولماذا الشوطُ يُستأنَفُ ولا يُعيدُ
 *
 * القِسمُ الذي تجاوزَ النافذةَ **ساكنٌ**: ملحَقٌ لا يُحدَّثُ، ويومُه مضى، وحدُّ
 * انحرافِ الساعةِ خمسُ دقائقَ لا أربعةَ عشرَ يوماً. فترتيبُ صفوفِه ثابتٌ،
 * والجزءُ رقمُ `k` هوَ الصفحةُ نفسُها في كلِّ شوطٍ. ولذلكَ يجوزُ للشوطِ الثاني
 * أن يتخطّى ما تُحقِّقَ منه ويُكمِلَ من حيثُ انقطعَ — بلا نسخةٍ مكرّرةٍ ولا فجوةٍ.
 */

import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** صفٌّ واحدٌ كما يخرجُ إلى الأرشيفِ. أسماءُ الحقولِ هيَ أسماءُ الأعمدةِ. */
export interface ArchivedLocationRow {
  readonly city_id: string;
  readonly driver_id: string;
  readonly position: string;
  readonly recorded_at: string;
  readonly written_at: string;
  readonly accuracy_m: number | null;
  readonly quality: string;
  readonly source: string;
}

/** مدينةٌ في يومٍ مستحقٍّ، ومعَها عددُ صفوفِها في القِسمِ. */
export interface DueCity {
  readonly cityId: string;
  readonly rows: number;
}

/** يومٌ تجاوزَ النافذةَ الساخنةَ. */
export interface DueDay {
  readonly day: string;
  readonly partition: string;
  readonly cities: readonly DueCity[];
}

/** جزءٌ مُسجَّلٌ في الدفترِ. */
export interface ManifestPart {
  readonly part: number;
  readonly rowCount: number;
  readonly verified: boolean;
}

/** ما يُسجَّلُ عندَ رفعِ جزءٍ. */
export interface RecordPartInput {
  readonly cityId: string;
  readonly day: string;
  readonly part: number;
  readonly objectName: string;
  readonly remoteFileId: string;
  readonly rowCount: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** حصيلةُ نداءِ الإسقاطِ كما تُرجِعُها الدالّةُ. */
export interface DropDayOutcome {
  readonly status: "dropped" | "already-dropped" | "refused";
  readonly reason?: string;
  readonly droppedRows?: number;
}

/** دفترُ الأرشيفِ والقِسمُ — كلُّ ما يمسُّ القاعدةَ. */
export interface LocationArchiveCatalog {
  dueDays(hotDays: number, maxDays: number): Promise<Result<readonly DueDay[], PortFailureError>>;
  parts(day: string, cityId: string): Promise<Result<readonly ManifestPart[], PortFailureError>>;
  readPage(
    day: string,
    cityId: string,
    offset: number,
    limit: number,
  ): Promise<Result<readonly ArchivedLocationRow[], PortFailureError>>;
  recordPart(input: RecordPartInput): Promise<Result<void, PortFailureError>>;
  markVerified(cityId: string, day: string, part: number): Promise<Result<void, PortFailureError>>;
  dropDay(day: string, hotDays: number): Promise<Result<DropDayOutcome, PortFailureError>>;
}

/** المخزنُ الخارجيُّ: رفعٌ وقراءةٌ. لا يعرفُ قاعدةً ولا سياسةً. */
export interface ArchiveObjectStore {
  upload(
    name: string,
    content: Uint8Array,
  ): Promise<Result<{ readonly remoteFileId: string; readonly bytes: number }, PortFailureError>>;
  download(remoteFileId: string): Promise<Result<Uint8Array, PortFailureError>>;
}

/** ترميزُ صفحةٍ وبصمتُها — يُحقَنُ كي تبقى هذه الطبقةُ بلا `node:` ولا `Bun`. */
export interface ArchiveCodec {
  encode(rows: readonly ArchivedLocationRow[]): Uint8Array;
  digest(content: Uint8Array): string;
}

export interface ArchiveLocationPartitionsDeps {
  readonly catalog: LocationArchiveCatalog;
  readonly store: ArchiveObjectStore;
  readonly codec: ArchiveCodec;
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ArchiveLocationPartitionsOptions {
  readonly hotDays: number;
  readonly maxDays: number;
  readonly partRows: number;
}

/** حصيلةُ شوطٍ كاملٍ. */
export interface ArchiveRunReport {
  /** أيّامٌ نُظِرَ فيها. */
  readonly daysExamined: number;
  /** أجزاءٌ رُفِعَت وتُحقِّقَ منها في هذا الشوطِ. */
  readonly partsUploaded: number;
  /** صفوفٌ خرجَت إلى الأرشيفِ في هذا الشوطِ. */
  readonly rowsArchived: number;
  /** أقسامٌ أُسقِطَت. */
  readonly partitionsDropped: number;
  /** صفوفٌ أُسقِطَت معَ أقسامِها — بعدَ إثباتِ خروجِها. */
  readonly rowsDropped: number;
  /** أيّامٌ رُفِضَ إسقاطُها، معَ سببِ الرفضِ. */
  readonly refused: readonly { readonly day: string; readonly reason: string }[];
}

/** اسمُ الكائنِ في المخزنِ. مقروءٌ بالعينِ ومرتَّبٌ بالتاريخِ. */
export function archiveObjectName(day: string, cityId: string, part: number): string {
  const padded = String(part).padStart(5, "0");
  return `location-archive/${day}/${cityId}-${padded}.ndjson`;
}

/**
 * شوطُ أرشفةٍ واحدٌ.
 *
 * ولا يُوقِفُ الشوطَ كلَّه فشلُ يومٍ: يومٌ يتعذّرُ رفعُه (مخزنٌ لا يستجيبُ،
 * مدينةٌ ناقصةٌ) يُسجَّلُ في `refused` ويمضي الشوطُ إلى الذي بعدَه. فالتوقّفُ
 * الكاملُ عندَ أوّلِ عطلٍ يجعلُ يوماً واحداً معطوباً يوقفُ الاستبقاءَ كلَّه إلى
 * الأبدِ — وذاكَ عطلٌ يكبرُ صامتاً حتّى يمتلئَ القرصُ.
 */
export async function archiveDueLocationPartitions(
  deps: ArchiveLocationPartitionsDeps,
  options: ArchiveLocationPartitionsOptions,
): Promise<Result<ArchiveRunReport, PortFailureError>> {
  const due = await deps.catalog.dueDays(options.hotDays, options.maxDays);
  if (!due.ok) return due;

  let partsUploaded = 0;
  let rowsArchived = 0;
  let partitionsDropped = 0;
  let rowsDropped = 0;
  const refused: { day: string; reason: string }[] = [];

  for (const day of due.value) {
    let dayComplete = true;

    for (const city of day.cities) {
      const existing = await deps.catalog.parts(day.day, city.cityId);
      if (!existing.ok) {
        refused.push({ day: day.day, reason: `PARTS_READ_FAILED:${existing.error.detail}` });
        dayComplete = false;
        break;
      }
      const verified = new Set(
        existing.value.filter((entry) => entry.verified).map((entry) => entry.part),
      );

      const totalParts = Math.ceil(city.rows / options.partRows);
      for (let part = 0; part < totalParts; part += 1) {
        if (verified.has(part)) continue;

        const page = await deps.catalog.readPage(
          day.day,
          city.cityId,
          part * options.partRows,
          options.partRows,
        );
        if (!page.ok) {
          refused.push({ day: day.day, reason: `PAGE_READ_FAILED:${page.error.detail}` });
          dayComplete = false;
          break;
        }
        if (page.value.length === 0) continue;

        const body = deps.codec.encode(page.value);
        const sha256 = deps.codec.digest(body);
        const objectName = archiveObjectName(day.day, city.cityId, part);

        const uploaded = await deps.store.upload(objectName, body);
        if (!uploaded.ok) {
          refused.push({ day: day.day, reason: `UPLOAD_FAILED:${uploaded.error.detail}` });
          dayComplete = false;
          break;
        }

        const recorded = await deps.catalog.recordPart({
          cityId: city.cityId,
          day: day.day,
          part,
          objectName,
          remoteFileId: uploaded.value.remoteFileId,
          rowCount: page.value.length,
          bytes: uploaded.value.bytes,
          sha256,
        });
        if (!recorded.ok) {
          refused.push({ day: day.day, reason: `MANIFEST_WRITE_FAILED:${recorded.error.detail}` });
          dayComplete = false;
          break;
        }

        /**
         * التحقّقُ: يُنزَلُ ما رُفِعَ وتُطابَقُ بصمتُه. وبصمةٌ لا تُطابِقُ لا
         * تُوسَمُ `verified_at`، فيبقى الجزءُ ناقصاً في الدفترِ ويرفضُ الحارسُ
         * إسقاطَ اليومِ — وذاكَ عينُ ما يُرادُ: لا إسقاطَ على نسخةٍ مشكوكٍ فيها.
         */
        const back = await deps.store.download(uploaded.value.remoteFileId);
        if (!back.ok) {
          refused.push({ day: day.day, reason: `VERIFY_DOWNLOAD_FAILED:${back.error.detail}` });
          dayComplete = false;
          break;
        }
        if (deps.codec.digest(back.value) !== sha256) {
          deps.log?.("location_archive.digest_mismatch", {
            day: day.day,
            city_id: city.cityId,
            part,
          });
          refused.push({ day: day.day, reason: "DIGEST_MISMATCH" });
          dayComplete = false;
          break;
        }

        const marked = await deps.catalog.markVerified(city.cityId, day.day, part);
        if (!marked.ok) {
          refused.push({ day: day.day, reason: `VERIFY_MARK_FAILED:${marked.error.detail}` });
          dayComplete = false;
          break;
        }

        partsUploaded += 1;
        rowsArchived += page.value.length;
      }

      if (!dayComplete) break;
    }

    if (!dayComplete) continue;

    const dropped = await deps.catalog.dropDay(day.day, options.hotDays);
    if (!dropped.ok) {
      refused.push({ day: day.day, reason: `DROP_CALL_FAILED:${dropped.error.detail}` });
      continue;
    }
    if (dropped.value.status === "dropped") {
      partitionsDropped += 1;
      rowsDropped += dropped.value.droppedRows ?? 0;
    } else if (dropped.value.status === "refused") {
      refused.push({ day: day.day, reason: dropped.value.reason ?? "REFUSED" });
    }
  }

  return ok({
    daysExamined: due.value.length,
    partsUploaded,
    rowsArchived,
    partitionsDropped,
    rowsDropped,
    refused,
  });
}
