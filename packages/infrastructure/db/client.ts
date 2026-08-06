/**
 * الغرض: الاتصال الحقيقي بقاعدة PostgreSQL (قاعدة Supabase نفسها عبر بروتوكول Postgres المباشر).
 *   اخترنا الاتصال المباشر لا PostgREST لأن كل عملياتنا الحرجة دوالُّ قاعدة، ولأن هذا يجعل
 *   المحوّلات قابلة للاختبار على قاعدة محلية حقيقية بلا أي مفتاح إنتاج.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر في tests/integration.
 * ينتمي إلى: infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: كل محوّل في packages/infrastructure، apps/gateway، apps/workers
 * ملاحظات مستقبلية: في الإنتاج يُستخدم رابط pooler الخاص بـ Supabase بـ prepare:false.
 */

import postgres from "postgres";
import { PortFailureError } from "../../application/ports/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

export type Sql = postgres.Sql<Record<string, never>>;

export interface DbOptions {
  readonly connectionString: string;
  readonly max?: number;
  /** مطلوب مع pooler الخاص بـ Supabase (transaction mode لا يدعم الجُمل المُحضَّرة). */
  readonly prepare?: boolean;
}

export function createSql(options: DbOptions): Sql {
  return postgres(options.connectionString, {
    max: options.max ?? 5,
    prepare: options.prepare ?? true,
    onnotice: () => {},
    transform: { undefined: null },
  });
}

/**
 * يلفّ أي استعلام: خطأ القاعدة عطلٌ تقني يُعاد كـ Result، ولا يُرمى استثناءً (القسم 2.5).
 */
export async function guard<T>(
  port: string,
  run: () => Promise<T>,
): Promise<Result<T, PortFailureError>> {
  try {
    return ok(await run());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(new PortFailureError(port, detail));
  }
}

/** شكل ردّ كل دوال RPC عندنا: jsonb فيه ok وerror. */
export interface RpcEnvelope {
  readonly ok: boolean;
  readonly error?: string | null;
  readonly [key: string]: unknown;
}

export function readEnvelope(value: unknown): RpcEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") return null;
  return candidate as unknown as RpcEnvelope;
}
