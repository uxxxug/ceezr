/**
 * الغرض: الاتصال الحقيقي بقاعدة PostgreSQL (قاعدة Supabase نفسها عبر بروتوكول Postgres المباشر).
 *   اخترنا الاتصال المباشر لا PostgREST لأن كل عملياتنا الحرجة دوالُّ قاعدة، ولأن هذا يجعل
 *   المحوّلات قابلة للاختبار على قاعدة محلية حقيقية بلا أي مفتاح إنتاج.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر في tests/integration.
 * ينتمي إلى: infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: كل محوّل في packages/infrastructure، apps/gateway، apps/workers
 * ملاحظات مستقبلية: في الإنتاج يُستخدم رابط pooler الخاص بـ Supabase. يُشتقّ وضعُ pooler
 *   من الرابط عبر detectDbPoolerMode، فإذا كان transaction pooler يُعطَّل `prepare` تلقائيّاً
 *   لأنّ transaction pooling لا يدعم الجُملَ المُحضَّرة (CAP-004 / ADR 0056).
 */

import postgres from "postgres";
import { PortFailureError } from "../../application/ports/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

export type Sql = postgres.Sql<Record<string, never>>;

export interface DbOptions {
  readonly connectionString: string;
  readonly max?: number;
  /** إن لم يُمرَّر يُشتقّ من رابط الاتصال عبر resolvePrepare. */
  readonly prepare?: boolean;
}

/** وضعُ pooler المُكتشَف من رابط الاتصال. */
export type DbPoolerMode = "transaction" | "session" | "direct" | "unknown";

/**
 * يكشفُ وضعَ pooler من رابط الاتصال:
 * - `transaction`: Supabase transaction pooler (pooler.supabase…:6543) أو `?pgbouncer=true` —
 *   لا يدعم الجُملَ المُحضَّرة، فيُعطَّل `prepare` آمناً قبلَ أن يفشلَ في وقتِ التشغيلِ.
 * - `session`: Supabase session pooler (pooler.supabase…:5432) — يدعمها فتبقى مُفعَّلة.
 * - `direct`: اتصالٌ مباشرٌ (db.…supabase.co أو مضيفٌ محليٌّ) — يدعمها فتبقى مُفعَّلة.
 * - `unknown`: رابطٌ غيرُ قابلٍ للتحليلِ بصيغةِ URL (مثلَ صيغةِ key=value) — يُحافَظُ على السلوكِ السابقِ.
 */
export function detectDbPoolerMode(connectionString: string): DbPoolerMode {
  if (!connectionString) return "unknown";
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return "unknown";
  }
  const host = url.hostname.toLowerCase();
  const port = url.port;
  const isSupabasePooler = host.includes("pooler.supabase");
  const pgbouncer = url.searchParams.get("pgbouncer") === "true";
  if (pgbouncer || (isSupabasePooler && port === "6543")) return "transaction";
  if (isSupabasePooler) return "session";
  return "direct";
}

/**
 * يقررُ هل تُفعَّلُ الجُملُ المُحضَّرةُ (prepared statements).
 * قاعدةُ السلامةِ: pooler المعاملاتِ (transaction) **يمنعُها تماماً** — حتى لو طُلِبَ `prepare:true`
 * صراحةً، لأنّ pooler المعاملاتِ لا يدعمُها فيعطّلُ الإعدادَ آمناً قبلَ أن يفشلَ في وقتِ التشغيلِ.
 * لغيرِ ذلك يُحترَمُ التمريرُ الصريحُ أو يُرجَعُ الافتراضيُّ `true`.
 */
export function resolvePrepare(options: DbOptions): boolean {
  const mode = detectDbPoolerMode(options.connectionString);
  if (mode === "transaction") return false;
  return options.prepare ?? true;
}

export function createSql(options: DbOptions): Sql {
  return postgres(options.connectionString, {
    max: options.max ?? 5,
    prepare: resolvePrepare(options),
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
