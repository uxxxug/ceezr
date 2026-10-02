/**
 * الغرض: `OPS-POOL-01` — الاتّصالُ الخاملُ يُحرَّرُ افتراضياً، وتجمُّعُ الأقفالِ مُستثنى صراحةً.
 * الحالة: اختبار فعلي — لا اتّصالَ يُفتَحُ (postgres.js كسولٌ).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: لا شيء.
 */
import { describe, expect, it } from "bun:test";
import {
  createSql,
  DEFAULT_DB_IDLE_TIMEOUT_SECONDS,
} from "../../packages/infrastructure/db/client.ts";

const URL = "postgres://u:p@127.0.0.1:1/db";
const idleOf = (sql: unknown) =>
  (sql as { options: { idle_timeout: number | null | undefined } }).options.idle_timeout;

describe("idle_timeout", () => {
  it("الافتراضيُّ يُحرِّرُ الخاملَ", () => {
    expect(idleOf(createSql({ connectionString: URL }))).toBe(DEFAULT_DB_IDLE_TIMEOUT_SECONDS);
  });
  it("null ⇒ لا إغلاقَ (تجمُّعُ الأقفالِ)", () => {
    expect(idleOf(createSql({ connectionString: URL, idleTimeoutSeconds: null }))).toBeFalsy();
  });
});
