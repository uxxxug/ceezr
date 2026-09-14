/**
 * الغرض: نطاقُ سطحِ الاستغاثةِ (`F2-10` · `SR-14`) — مفرداتُ الجوازِ وأسبابِه،
 *   وحالُ الحادثِ القائمِ، **ومجالُ رموزِ الإفصاحِ المغلقُ**. بلا نصٍّ معروضٍ
 *   وبلا نداءِ شبكةٍ: رموزٌ وأرقامٌ وحدَها.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: packages/domain/safety
 * يُستخدم من: `application/safety/sos-surface.ts` ·
 *   `infrastructure/safety/sos-surface-store.ts` · `apps/gateway/src/routes/safety.ts`
 *   · سطحُ الطوارئِ في التطبيقِ المصغَّرِ · `scripts/lib/sos-surface-contract.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F12-03` حينَ يُسمَحُ بحادثٍ بلا طلبٍ — يُزادُ أصلٌ
 *   ثالثٌ إلى `SOS_ORIGINS` ولا يُكتَبُ اتّحادٌ ثانٍ.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لماذا سببُ المنعِ **رمزُ القاعدةِ نفسُه** لا مفرداتٌ للواجهةِ
 *
 * الحَكَمُ (`sos_surface_state`) والحاكمُ (`trigger_sos`) دالّتانِ اثنتانِ
 * تُجيبانِ سؤالاً واحداً في لحظتَينِ: قبلَ العرضِ وعندَ الضغطِ. ولو تُرجِمَ رمزُ
 * الأولى إلى مفرداتٍ «ألطفَ» في هذه الطبقةِ، لَصارَ للسطحِ الواحدِ قاموسانِ،
 * ولَأمكنَ أن يُخفى رمزٌ جديدٌ يظهرُ في الحاكمِ ولا يُقابِلُه شيءٌ في الحَكَمِ —
 * فيُعرَضُ زرٌّ يَعِدُ ثمَّ يُرفَضُ عندَ الضغطِ، وذاكَ أسوأُ ما يقعُ في هذا البندِ.
 *
 * ## ولماذا الإفصاحُ **مجالٌ مغلقٌ ههنا** وقائمةٌ تُقرأُ من القاعدةِ
 *
 * أيُّ الرموزِ ينطبقُ الآنَ مشروطٌ بما **سيُكتَبُ فعلاً**: موقعُ السائقِ قد
 * يكونُ غائباً فيصيرُ الصدقُ `SOS_NO_LOCATION_AVAILABLE` لا وعداً بموقعٍ. فالقاعدةُ
 * تُجيبُ «أيُّها»، وهذا الملفُّ يُعرِّفُ «أيُّها **جائزٌ**». ورمزٌ يصلُ من خارجِ
 * المجالِ يُقرأُ **عطبَ عقدٍ** لا حالةً تُطوى: قائمةُ إفصاحٍ ناقصةٌ وعدُ خصوصيّةٍ
 * مكسورٌ، وإسقاطُ الرمزِ المجهولِ بصمتٍ يجعلُ الكسرَ غيرَ مرئيٍّ أبداً.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحسبُ عُمراً ولا يقرأُ ساعةً**: العُمرُ يأتي محسوباً بساعةِ القاعدةِ.
 *   ــ **لا يقرِّرُ نصّاً ولا لوناً ولا شكلاً**: مفاتيحُ الترجمةِ شأنُ الواجهةِ.
 *   ــ **لا يعرفُ هاتفاً ولا رقمَ طوارئٍ ولا مزوِّدَ اتّصالٍ**: المنصّةُ لا تتّصلُ
 *      بأحدٍ، و`SOS_NO_PHONE_CALL` إفصاحٌ عن ذلكَ لا تمهيدٌ له.
 *   ــ **لا يعرفُ مالاً ولا أجرةً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 */

/**
 * أصلُ الطلبِ الذي ستُنسَبُ إليه الاستغاثةُ. **يُنشَرُ للواجهةِ** لأنّه يُغيِّرُ
 * الجملةَ: «أنتَ في رحلةٍ» غيرُ «رحلتُكَ انتهت قبلَ قليلٍ وما يزالُ بوسعِكَ
 * النداءُ» — والثانيةُ تُطمئنُ مَن يظنُّ أنَّ البابَ أُغلِقَ بنزولِه.
 */
export type SosOrigin = "ACTIVE_ORDER" | "RECENT_ORDER";

export const SOS_ORIGINS: readonly SosOrigin[] = ["ACTIVE_ORDER", "RECENT_ORDER"];

export function isSosOrigin(value: unknown): value is SosOrigin {
  return typeof value === "string" && SOS_ORIGINS.some((candidate) => candidate === value);
}

/**
 * سببُ الحكمِ — **رموزُ `trigger_sos` حرفاً** حينَ يكونُ منعاً، وأصلُ الطلبِ
 * حينَ يكونُ جوازاً. فمن قرأَ سبباً ههنا يقرؤُه بالمعنى نفسِه في ردِّ الضغطِ.
 */
export type SosBlockReason =
  /** لا رحلةَ قائمةٌ ولا رحلةَ انتهت ضمنَ نافذةِ ما بعدَ الرحلةِ. */
  | "NO_ACTIVE_ORDER"
  /** مدينةُ الرحلةِ بلا قروبِ تصعيدٍ مضبوطٍ — نقصُ تهيئةٍ لا رفضُ سياسةٍ. */
  | "ESCALATION_GROUP_MISSING"
  /** إعدادُ نافذةِ منعِ التكرارِ غائبٌ — الحاكمُ سيرفضُ، فلا يُعرَضُ وعدٌ. */
  | "SOS_DEDUP_SETTING_MISSING";

export const SOS_BLOCK_REASONS: readonly SosBlockReason[] = [
  "NO_ACTIVE_ORDER",
  "ESCALATION_GROUP_MISSING",
  "SOS_DEDUP_SETTING_MISSING",
];

export function isSosBlockReason(value: unknown): value is SosBlockReason {
  return typeof value === "string" && SOS_BLOCK_REASONS.some((candidate) => candidate === value);
}

/** حالُ الحادثِ كما يُسمّيها عمودُ `safety_incidents.status` حرفاً. */
export type SosIncidentStatus = "open" | "received" | "closed";

export const SOS_INCIDENT_STATUSES: readonly SosIncidentStatus[] = ["open", "received", "closed"];

export function isSosIncidentStatus(value: unknown): value is SosIncidentStatus {
  return (
    typeof value === "string" && SOS_INCIDENT_STATUSES.some((candidate) => candidate === value)
  );
}

/**
 * مجالُ رموزِ الإفصاحِ المغلقُ. **كلُّ رمزٍ ههنا له مفتاحُ ترجمةٍ في القواميسِ
 * الثلاثةِ**، ويُحرَسُ ذلكَ بحاجزٍ ساكنٍ: رمزٌ بلا نصٍّ يصلُ المستخدمَ فراغاً في
 * موضعِ وعدِ خصوصيّةٍ.
 */
export type SosDisclosureCode =
  /** آخرُ موقعٍ معروفٍ سيُرفَقُ ببلاغِكَ. */
  | "SOS_SHARES_LAST_LOCATION"
  /** لا موقعَ معروفٌ الآنَ — يُقالُ صراحةً ولا يُترَكُ الوعدُ معلَّقاً. */
  | "SOS_NO_LOCATION_AVAILABLE"
  /** مرجعُ الرحلةِ وخدمتُها يصلانِ فريقَ السلامةِ. */
  | "SOS_SHARES_ORDER_REFERENCE"
  /** صفتُكَ في الرحلةِ (راكبٌ أو سائقٌ) تصلُ معَ البلاغِ. */
  | "SOS_SHARES_ROLE"
  /** فريقُ سلامةِ مدينتِكَ يُخطَرُ فوراً. */
  | "SOS_NOTIFIES_CITY_TEAM"
  /** المنصّةُ **لا تتّصلُ** بشرطةٍ ولا إسعافٍ نيابةً عنكَ. */
  | "SOS_NO_PHONE_CALL";

export const SOS_DISCLOSURE_CODES: readonly SosDisclosureCode[] = [
  "SOS_SHARES_LAST_LOCATION",
  "SOS_NO_LOCATION_AVAILABLE",
  "SOS_SHARES_ORDER_REFERENCE",
  "SOS_SHARES_ROLE",
  "SOS_NOTIFIES_CITY_TEAM",
  "SOS_NO_PHONE_CALL",
];

export function isSosDisclosureCode(value: unknown): value is SosDisclosureCode {
  return typeof value === "string" && SOS_DISCLOSURE_CODES.some((candidate) => candidate === value);
}

/** مصدرُ قيمةِ النافذةِ **باسمِه** — كما في `maxAgeSource` في `F2-09`. */
export type SosWindowSource = "SETTING" | "FALLBACK_DEFAULT";

export const SOS_WINDOW_SOURCES: readonly SosWindowSource[] = ["SETTING", "FALLBACK_DEFAULT"];

export function isSosWindowSource(value: unknown): value is SosWindowSource {
  return typeof value === "string" && SOS_WINDOW_SOURCES.some((candidate) => candidate === value);
}

/** بلاغٌ قائمٌ لهذه الرحلةِ من هذا المُبلِّغِ، وعُمرُه بساعةِ القاعدةِ. */
export interface SosIncidentState {
  readonly incidentId: string;
  readonly status: SosIncidentStatus;
  readonly ageSeconds: number;
}

/**
 * حالُ السطحِ. **اتّحادٌ لا حقولٌ اختياريّةٌ**: «لا رحلةَ» ليست حالةً ناقصةً من
 * «رحلةٌ»، وخلطُهما في شكلٍ واحدٍ يجعلُ كلَّ قارئٍ يخترعُ شرطَه.
 */
export type SosSurfaceState =
  | {
      readonly eligible: true;
      readonly orderId: string;
      readonly origin: SosOrigin;
      readonly postRideWindowMinutes: number;
      readonly postRideWindowSource: SosWindowSource;
      readonly incident: SosIncidentState | null;
      readonly disclosure: readonly SosDisclosureCode[];
    }
  | {
      readonly eligible: false;
      readonly reason: SosBlockReason;
      readonly incident: SosIncidentState | null;
      readonly disclosure: readonly SosDisclosureCode[];
    };

/**
 * أيُنتظَرُ ردٌّ على بلاغٍ قائمٍ؟ **حسابٌ واحدٌ في النطاقِ** لا شرطٌ يُكتَبُ في
 * الواجهةِ: `open` و`received` كلاهُما «قائمٌ»، و`closed` وحدَها منتهيةٌ.
 */
export function isIncidentPending(incident: SosIncidentState | null): boolean {
  return incident !== null && incident.status !== "closed";
}

/**
 * أتُعرَضُ البطاقةُ أصلاً؟ **البطاقةُ تُخفي نفسَها** حينَ لا رحلةَ ولا بلاغَ:
 * زرٌّ رماديٌّ في شاشةِ راكبٍ لا رحلةَ له ضجيجٌ، وزرٌّ يَعِدُ ثمَّ يُرفَضُ كذبٌ.
 * وأمّا بلاغٌ قائمٌ فيبقى مرئيّاً ولو زالَ الجوازُ: مَن نادى يستحقُّ أن يرى
 * مصيرَ ندائِه حتّى يُغلَقَ.
 */
export function isSurfaceVisible(state: SosSurfaceState): boolean {
  return state.eligible || state.incident !== null;
}
