/**
 * مساعدُ اختبارِ مخزنِ الإبطالِ (`SEC-18`) — مخزنُ منعٍ في الذاكرةِ لا يُبطِلُ
 * شيئًا. يُستعمَلُ في اختباراتِ المساراتِ التي تحتاجُ `SessionRevocationStore`
 * في `deps` ولا تُختبِرُ الإبطالَ نفسَه.
 */
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";

export function createTestRevocationStore() {
  return createMemorySessionRevocationStore();
}
