/**
 * الغرض: السطح العامّ للطبقة. **`gateway.ts` وحده وما يلزم لاستدعائه من أنواع.**
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: محوِّل رفيع في `apps/gateway` وحده
 * ملاحظات مستقبلية: أي تصدير يُضاف هنا يصير عقداً عامّاً يصعب سحبه. لا يُضاف شيء
 *   إلا لأن المشروع الأساسي يحتاجه فعلاً — لا لأنه «قد ينفع».
 *
 * ما **لا** يُصدَّر عمداً: الوكلاء، والذاكرة، والمعرفة، والأدوات، والحراس،
 * والسياسات، و`memoryUpdater` خصوصاً. المشروع الأساسي لا يملك أن يكتب في الذاكرة
 * الطويلة، ولا أن يستدعي وكيلاً مباشرة، ولا أن يتجاوز حارساً. **ما لا يُصدَّر لا
 * يُستدعى**، وهذا أوثق من أي اتفاق.
 */

export type { AgentCoreConfig } from "./config.ts";
export { DEFAULT_CONFIG, loadConfig } from "./config.ts";
export type { AgentCoreGateway, AgentCoreLog, AgentCoreOptions } from "./gateway.ts";
export { createAgentCore } from "./gateway.ts";
export type {
  DecisionResult,
  DecisionStatus,
  EventPayload,
  EventType,
  EvidenceItem,
  OutcomeVerdict,
  ToolLevel,
} from "./schemas.ts";
export { EVENT_TYPES, isEventType, MAX_ALLOWED_TOOL_LEVEL } from "./schemas.ts";
