/**
 * الغرض: مخزنُ حوادثِ الاختراقِ — يقرأُ من قاعدةِ البياناتِ عبرَ PostgREST
 *   (`F12-08`).
 * الحالة: منفَّذٌ — البند `F12-08`.
 * ينتمي إلى: packages/infrastructure/privacy
 * يُستخدم من: `application/privacy/breach-notification.ts`
 * الحاكم: المادةُ ٢٤ من اللائحةِ التنفيذيّةِ لـPDPL
 *
 * ## لماذا قراءةٌ فقط في هذه الطبقةِ
 *
 * لأنَّ التسجيلَ والتقييمَ والإبلاغَ دوالُّ قاعدةٍ (security definer) — تُستدعى
 * عبرَ PostgREST لا عبرَ HTTP مباشرًا. والقراءةُ ههنا للمعاينةِ والتدقيقِ.
 * ولو كتبَ المخزنُ الحادثَ مباشرةً لكانَ مصدرَ حقيقةٍ ثانٍ للدوالِّ التي
 * تُسجِّلُه في القاعدةِ.
 */

import type {
  BreachIncidentRecord,
  BreachIncidentStore,
  BreachIncidentStoreFailure,
} from "../../application/privacy/breach-notification.ts";
import type {
  BreachIncidentStatus,
  BreachSeverity,
} from "../../domain/privacy/breach-notification.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/** صفٌّ خامٌّ من PostgREST — يُترجَمُ إلى `BreachIncidentRecord`. */
interface BreachIncidentRow {
  id: string;
  city_id: string;
  detected_by: string;
  description: string;
  breach_time: string | null;
  awareness_time: string;
  severity: BreachSeverity;
  data_categories: string[];
  affected_count: number | null;
  personal_data_types: string[];
  risk_description: string | null;
  corrective_measures: string | null;
  prevention_measures: string | null;
  authority_notified_at: string | null;
  subjects_notified_at: string | null;
  subjects_notification_required: boolean;
  status: BreachIncidentStatus;
}

/** عقدُ قارئِ PostgREST — يُحقَنُ ولا يُبنى. */
export interface PostgrestBreachReader {
  /** يقرأُ صفّاً واحدًا من `breach_incidents` بمعرّفِه. */
  selectOne(
    id: string,
  ): Promise<
    | { ok: true; row: BreachIncidentRow }
    | { ok: false; reason: "NOT_FOUND" | "STORE_ERROR" | "MALFORMED_RESULT" }
  >;
}

/** مُحوِّلٌ يُترجِمُ صفّاً خاماً إلى سجلٍّ مقروءٍ. */
function toRecord(row: BreachIncidentRow): BreachIncidentRecord {
  return {
    id: row.id,
    cityId: row.city_id,
    detectedBy: row.detected_by,
    description: row.description,
    breachTime: row.breach_time,
    awarenessTime: row.awareness_time,
    severity: row.severity,
    dataCategories: row.data_categories,
    affectedCount: row.affected_count,
    personalDataTypes: row.personal_data_types,
    riskDescription: row.risk_description,
    correctiveMeasures: row.corrective_measures,
    preventionMeasures: row.prevention_measures,
    authorityNotifiedAt: row.authority_notified_at,
    subjectsNotifiedAt: row.subjects_notified_at,
    subjectsNotificationRequired: row.subjects_notification_required,
    status: row.status,
  };
}

/** مُحوِّلٌ يُترجِمُ سببَ القراءةِ إلى سببِ المخزنِ. */
function toStoreFailure(
  reason: "NOT_FOUND" | "STORE_ERROR" | "MALFORMED_RESULT",
): BreachIncidentStoreFailure {
  return { reason };
}

/** مخزنُ حوادثِ الاختراقِ — يقرأُ فقط. */
export class BreachIncidentPostgrestStore implements BreachIncidentStore {
  constructor(private readonly reader: PostgrestBreachReader) {}

  async findById(id: string): Promise<Result<BreachIncidentRecord, BreachIncidentStoreFailure>> {
    const result = await this.reader.selectOne(id);
    if (!result.ok) {
      return err(toStoreFailure(result.reason));
    }
    try {
      return ok(toRecord(result.row));
    } catch {
      return err({ reason: "MALFORMED_RESULT" });
    }
  }
}
