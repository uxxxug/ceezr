/**
 * الغرض: حالاتُ استخدامِ إبلاغِ الاختراقِ (`F12-08` · §16).
 *   قراءةُ الحادثِ، تقييمُ الخطرِ، توليدُ محتوى الإبلاغِ للهيئةِ ولأصحابِ البياناتِ.
 * الحالة: منفَّذٌ — البند `F12-08`.
 * ينتمي إلى: packages/application/privacy
 * الحاكم: المادةُ ٢٤ من اللائحةِ التنفيذيّةِ لـPDPL
 *
 * ## لماذا توليدُ محتوى لا إرسالٌ
 *
 * الهيئةُ تُبلَغُ عبرَ منصّةِ الحوكمةِ الوطنيّةِ للبياناتِ (National Data
 * Governance Platform) بيدِ الإنسان، لا بنداءِ HTTP. وأصحابُ البياناتِ
 * يُبلَّغونَ بالقناةِ الأنسبَةِ للحادثِ. فالمنصّةُ **تُولِّدُ المحتوى**
 * وتُسجِّلُ الإبلاغَ، والإنسانُ يُرسِلُه. وهذا لا يعني عجزاً بل حدودَ
 * المسؤوليّةِ: لا يُدَّعى إرسالٌ لم يقعْ.
 *
 * ## وما لا تفعلهُ هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تُرسِلُ إبلاغاً**: لا قناةَ ولا مزوِّدَ.
 *   ــ **لا تُصدِّقُ امتثالاً**: بناءُ الآليّةِ لا اعتمادٌ تنظيميٌّ.
 *   ــ **لا تقرأُ الحادثَ من القاعدةِ مباشرةً**: عبرَ `BreachIncidentStore`.
 */

import type {
  AuthorityNotificationContent,
  BreachIncidentStatus,
  BreachSeverity,
  SubjectNotificationContent,
} from "../../domain/privacy/breach-notification.ts";
import { AUTHORITY_NOTIFICATION_HOURS } from "../../domain/privacy/breach-notification.ts";
import type { Result } from "../../shared/result/index.ts";

/** عطبُ مخزنٍ — يُنشَرُ `503`. */
export interface BreachIncidentStoreFailure {
  readonly reason: "STORE_ERROR" | "NOT_FOUND" | "MALFORMED_RESULT";
}

/** قراءةُ حادثٍ واحدٍ من القاعدةِ. */
export interface BreachIncidentRecord {
  readonly id: string;
  readonly cityId: string;
  readonly detectedBy: string;
  readonly description: string;
  readonly breachTime: string | null;
  readonly awarenessTime: string;
  readonly severity: BreachSeverity;
  readonly dataCategories: readonly string[];
  readonly affectedCount: number | null;
  readonly personalDataTypes: readonly string[];
  readonly riskDescription: string | null;
  readonly correctiveMeasures: string | null;
  readonly preventionMeasures: string | null;
  readonly authorityNotifiedAt: string | null;
  readonly subjectsNotifiedAt: string | null;
  readonly subjectsNotificationRequired: boolean;
  readonly status: BreachIncidentStatus;
}

/** عقدُ مخزنِ حوادثِ الاختراقِ — قراءةٌ فقط في هذه الطبقةِ. */
export interface BreachIncidentStore {
  /** يقرأُ حادثاً واحدًا. */
  findById(id: string): Promise<Result<BreachIncidentRecord, BreachIncidentStoreFailure>>;
}

/** تبعيّاتُ حالاتِ استخدامِ إبلاغِ الاختراقِ. */
export interface BreachNotificationDeps {
  readonly breachStore: BreachIncidentStore;
  readonly controllerName: string;
  readonly dpoContact: string | null;
}

/** أخطاءٌ مُصنَّفةٌ تُنشَرُ للمستخدمِ. */
export type BreachNotificationPublicErrorCode =
  | "STORE_NOT_AVAILABLE"
  | "INCIDENT_NOT_FOUND"
  | "STORE_ERROR"
  | "MALFORMED_RESULT";

/** هل تأخَّرَ إبلاغُ الهيئةِ؟ حكمٌ يُحسَبُ من وقتِ العلمِ. */
export function isAuthorityNotificationOverdue(
  awarenessTime: string,
  authorityNotifiedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (authorityNotifiedAt !== null) return false;
  const deadline = new Date(awarenessTime);
  deadline.setHours(deadline.getHours() + AUTHORITY_NOTIFICATION_HOURS);
  return now > deadline;
}

/** الوقتُ المتبقّي لإبلاغِ الهيئةِ بالساعاتِ — أو `null` إن بُلِّغَت. */
export function hoursUntilAuthorityDeadline(
  awarenessTime: string,
  authorityNotifiedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (authorityNotifiedAt !== null) return null;
  const deadline = new Date(awarenessTime);
  deadline.setHours(deadline.getHours() + AUTHORITY_NOTIFICATION_HOURS);
  const diff = deadline.getTime() - now.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
}

/** هل يجب إبلاغُ أصحابِ البياناتِ؟ حكمٌ من شدّةِ الخطرِ. */
export function isSubjectNotificationRequired(severity: BreachSeverity): boolean {
  return severity === "high_risk" || severity === "medium_risk";
}

/** يُولِّدُ محتوى إبلاغِ الهيئةِ (SDAIA) من حادثٍ مُقيَّمٍ. */
export function generateAuthorityNotification(
  incident: BreachIncidentRecord,
  controllerName: string,
  dpoContact: string | null,
): AuthorityNotificationContent {
  return {
    incidentDescription: {
      breachTime: incident.breachTime,
      awarenessTime: incident.awarenessTime,
      description: incident.description,
    },
    dataScope: {
      dataCategories: incident.dataCategories,
      affectedCount: incident.affectedCount,
      personalDataTypes: incident.personalDataTypes,
    },
    riskAssessment: {
      riskDescription: incident.riskDescription,
      correctiveMeasures: incident.correctiveMeasures,
      preventionMeasures: incident.preventionMeasures,
    },
    subjectsNotified: incident.subjectsNotifiedAt !== null,
    contact: {
      controllerName,
      dpoContact,
    },
  };
}

/** يُولِّدُ محتوى إبلاغِ صاحبِ البياناتِ من حادثٍ مُقيَّمٍ. */
export function generateSubjectNotification(
  incident: BreachIncidentRecord,
  controllerName: string,
  dpoContact: string | null,
): SubjectNotificationContent {
  return {
    breachDescription: incident.description,
    riskDescription: incident.riskDescription,
    correctiveMeasures: incident.correctiveMeasures,
    contact: {
      controllerName,
      dpoContact,
    },
  };
}

/**
 * يقرأُ حادثاً ويُولِّدُ الإبلاغَينِ معاً — للهيئةِ ولأصحابِ البياناتِ.
 * يُنشَرُ `INCIDENT_NOT_FOUND` إن لم يُوجَدْ، و`STORE_ERROR` إن فشِلَ المخزنُ.
 */
export async function readBreachIncidentForNotification(
  deps: BreachNotificationDeps,
  incidentId: string,
): Promise<
  Result<
    {
      readonly incident: BreachIncidentRecord;
      readonly authorityNotification: AuthorityNotificationContent;
      readonly subjectNotification: SubjectNotificationContent | null;
      readonly authorityOverdue: boolean;
      readonly hoursRemaining: number | null;
    },
    { readonly code: BreachNotificationPublicErrorCode }
  >
> {
  const result = await deps.breachStore.findById(incidentId);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code:
          result.error.reason === "NOT_FOUND"
            ? "INCIDENT_NOT_FOUND"
            : result.error.reason === "STORE_ERROR"
              ? "STORE_ERROR"
              : "MALFORMED_RESULT",
      },
    };
  }

  const incident = result.value;
  const authorityOverdue = isAuthorityNotificationOverdue(
    incident.awarenessTime,
    incident.authorityNotifiedAt,
  );
  const hoursRemaining = hoursUntilAuthorityDeadline(
    incident.awarenessTime,
    incident.authorityNotifiedAt,
  );

  const authorityNotification = generateAuthorityNotification(
    incident,
    deps.controllerName,
    deps.dpoContact,
  );

  const subjectNotification =
    incident.subjectsNotificationRequired || incident.subjectsNotifiedAt !== null
      ? generateSubjectNotification(incident, deps.controllerName, deps.dpoContact)
      : null;

  return {
    ok: true,
    value: {
      incident,
      authorityNotification,
      subjectNotification,
      authorityOverdue,
      hoursRemaining,
    },
  };
}
