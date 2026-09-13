/**
 * الغرض: منعُ منصّة القياس من لمس أيّ قاعدةٍ غير قاعدةِ القياس المخصّصة، ومنعُ
 *   المحوِ الأعمى فيها أيضاً.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench (أدوات قياس، لا تُستورَد من كود المنتج)
 * يُتوقع أن يستخدمه لاحقاً: bench/seed.ts و bench/runner.ts وكلّ سيناريو
 * ملاحظات مستقبلية: أيّ جدولٍ جديد يكتب فيه القياس يُضاف إلى BENCH_OWNED_TABLES.
 *
 * ## لماذا هذا الملفّ أوّلُ ما كُتب في المنصّة
 *
 * منصّةُ القياس أداةٌ تحذف بيانات وتُعيد بذرَها في كلّ تشغيل. أداةٌ كهذه إن
 * أخطأت وجهتَها مرّةً واحدةً كان خطؤها غيرَ قابلٍ للتراجع — لا يشبه خطأ قياسٍ
 * يُعطي رقماً غلطاً. فالحرسُ يُكتب قبل أن توجد القاعدةُ التي يحرسها، ويُختبَر
 * قبل أن يُنادى في مسارٍ يحذف.
 *
 * ## قاعدتان حاكمتان
 *
 * **الأولى: قائمةُ سماحٍ لا قائمةَ منع.** قائمةُ المنع تفشل مفتوحةً: أيُّ اسمٍ
 * أو مضيفٍ لم يفكّر فيه كاتبُها يمرّ. وقائمةُ السماح تفشل مغلقةً: ما لم يُذكَر
 * صراحةً يُرفَض. والوجهةُ هنا واحدةٌ معروفة، فلا عذر لقبول غيرها.
 *
 * **الثانية: وجودُ صفوفٍ غير متوقّعة يعني الرفضَ لا الحذف.** قاعدةُ القياس
 * مخصّصةٌ لها وحدها؛ فإن ظهر فيها صفٌّ لا يملكه القياس فذلك يعني أنّ أحد
 * فرضياتنا كُسِر — إمّا أنّ الوجهة غيرُ ما نظنّ، أو أنّ أحداً يستخدم القاعدة.
 * والحذفُ في هذه الحالة تدميرٌ لبيانات غيرِنا؛ والصحيح أن تتوقّف الأداة وتُبلّغ.
 */

import type { Sql } from "../../../packages/infrastructure/db/client.ts";

/**
 * القاعدةُ الوحيدة المسموح للقياس أن يكتب فيها.
 *
 * ولماذا اسمٌ مخصّص لا `waslah` نفسها؟ لأن خلط بيانات القياس ببيانات التطوير
 * يُفقد الطرفين معنىً: القياسُ يبدأ من حالةٍ لا يعرفها فتصير نتائجُه غيرَ قابلةٍ
 * للمقارنة، والتطويرُ تُمحى بياناتُه في كلّ تشغيل قياس.
 */
export const BENCH_DATABASE_NAMES = ["waslah_bench"] as const;

/** المضيفاتُ المحليّة وحدها. أيُّ مضيفٍ شبكيّ مرفوض ولو كان اسمُه يبدو بريئاً. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

/**
 * أوّلُ معرّف تيليجرام يملكه القياس. وما دونه ليس ملكاً له.
 *
 * الرقمُ ليس اعتباطياً في وظيفته: هو علامةُ الملكيّة التي يقوم عليها سلكُ
 * التعطيل. فصفٌّ بمعرّفٍ أقلَّ منه في جدولٍ يملكه القياس يعني أنّ في القاعدة
 * بياناتٍ ليست منه، فيُرفض المحو.
 */
export const BENCH_TELEGRAM_ID_MIN = 700_000;

export type IsolationFailureCode =
  | "MISSING_DATABASE_URL"
  | "UNPARSEABLE_DATABASE_URL"
  | "PRODUCTION_ENV"
  | "MANAGED_HOST"
  | "REMOTE_HOST"
  | "DATABASE_NOT_ALLOWED";

export type IsolationVerdict =
  | { readonly ok: true; readonly host: string; readonly database: string }
  | { readonly ok: false; readonly code: IsolationFailureCode; readonly message: string };

export interface IsolationInput {
  readonly databaseUrl: string | undefined;
  readonly nodeEnv: string | undefined;
  /** يُمرَّر في الاختبار وحده؛ الافتراضُ هو قائمةُ السماح الحقيقية. */
  readonly allowedDatabases?: readonly string[];
}

/**
 * فحصٌ ساكنٌ لا يلمس الشبكة: هل هذه الوجهةُ وجهةَ قياسٍ مشروعة؟
 *
 * والترتيبُ مقصود — الأعمُّ خطراً أوّلاً — لأن الرسالةَ التي يقرؤها المشغّل يجب
 * أن تُسمّي أخطرَ ما اكتشفناه لا أوّلَ ما صادفناه: بيئةُ إنتاجٍ مع مضيفٍ مُدارٍ
 * تُبلَّغ بأنّها بيئةُ إنتاج.
 */
export function checkIsolation(input: IsolationInput): IsolationVerdict {
  const allowed = input.allowedDatabases ?? BENCH_DATABASE_NAMES;

  if (input.nodeEnv === "production") {
    return {
      ok: false,
      code: "PRODUCTION_ENV",
      message: "منصّة القياس ترفض العمل في بيئة إنتاج: NODE_ENV=production.",
    };
  }

  if (input.databaseUrl === undefined || input.databaseUrl.trim() === "") {
    return {
      ok: false,
      code: "MISSING_DATABASE_URL",
      message: "لا وجهة: BENCH_DATABASE_URL غير مضبوط. القياس لا يفترض وجهةً افتراضية.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.databaseUrl);
  } catch {
    return {
      ok: false,
      code: "UNPARSEABLE_DATABASE_URL",
      message: "تعذّر تحليل BENCH_DATABASE_URL كعنوان صالح، فلا يمكن التحقّق من وجهته.",
    };
  }

  const host = parsed.hostname.toLowerCase();

  /**
   * فحصٌ صريحٌ للمضيفات المُدارة قبل فحص المحليّة، وهو زائدٌ منطقياً: مضيفُ
   * Supabase ليس محليّاً فكان سيُرفض بعده على أيّ حال. لكنّ الرسالةَ تختلف،
   * والرسالةُ هي ما يقرؤه من ضبط الأداة على الإنتاج بالخطأ في الثانية الأولى.
   */
  if (host.includes("supabase") || host.includes("pooler") || host.includes("neon.tech")) {
    return {
      ok: false,
      code: "MANAGED_HOST",
      message: `المضيف «${host}» قاعدةٌ مُدارة (إنتاج أو مرحلة). القياس لا يلمس إلا قاعدةً محليّة.`,
    };
  }

  if (!LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    return {
      ok: false,
      code: "REMOTE_HOST",
      message: `المضيف «${host}» ليس محليّاً. المسموح: ${LOCAL_HOSTS.join(", ")}.`,
    };
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!allowed.includes(database)) {
    return {
      ok: false,
      code: "DATABASE_NOT_ALLOWED",
      message: `القاعدة «${database}» ليست في قائمة سماح القياس: ${allowed.join(", ")}.`,
    };
  }

  return { ok: true, host, database };
}

/** يرفع استثناءً عند الرفض. يُستخدَم في كلّ مسارٍ يكتب أو يحذف. */
export function assertIsolation(input: IsolationInput): { host: string; database: string } {
  const verdict = checkIsolation(input);
  if (!verdict.ok) {
    throw new Error(`[bench/isolation:${verdict.code}] ${verdict.message}`);
  }
  return { host: verdict.host, database: verdict.database };
}

/**
 * الجداولُ التي يملكها القياسُ ويمحوها، وكيف تُعرَف ملكيّةُ صفٍّ فيها.
 *
 * `ownershipSql` يجب أن يُعيد عددَ الصفوف **غيرِ** المملوكة للقياس. وصياغتُه
 * سلبيّةً مقصودة: السؤالُ الذي يحمي ليس «كم صفّاً لي؟» بل «هل هنا صفٌّ ليس
 * لي؟»، والأوّل يمرّ على قاعدةٍ مليئةٍ ببيانات غيرِنا.
 *
 * والجداولُ التي تبذرها الترحيلاتُ نفسها (المدن، إعدادات المنصّة، المحفّزات)
 * **ليست** هنا: هي جزءٌ من المخطّط لا من بيانات التشغيل، ومحوُها يُفسد القاعدة
 * ويجعل إعادةَ البذر تحتاج ترحيلاً من جديد.
 */
export interface BenchOwnedTable {
  readonly table: string;
  readonly ownershipSql: string;
}

/**
 * سلكُ التعطيل: يفحص كلَّ جدولٍ يملكه القياس، ويُعيد ما وجد فيه من صفوفٍ دخيلة.
 *
 * يُنادى **قبل** المحو لا بعده. ولا يحذف شيئاً بنفسه ولا يُصلح شيئاً: مهمّتُه
 * أن يقول ما رآه، والقرارُ لمن يناديه.
 */
export async function findForeignRows(
  sql: Sql,
  tables: readonly BenchOwnedTable[],
): Promise<readonly { table: string; foreignRows: number }[]> {
  const found: { table: string; foreignRows: number }[] = [];
  for (const owned of tables) {
    const rows = await sql.unsafe<{ count: string }[]>(owned.ownershipSql);
    const count = Number(rows[0]?.count ?? "0");
    if (count > 0) found.push({ table: owned.table, foreignRows: count });
  }
  return found;
}

/**
 * الحرسُ الحيّ: يتحقّق أنّ الاتّصال القائم فعلاً على قاعدةِ القياس.
 *
 * ولماذا يُسأل الاتّصالُ نفسُه وقد فُحص العنوان؟ لأن العنوانَ نيّةٌ والاتّصالُ
 * واقع. بينهما `PGDATABASE`، وإعادةُ توجيهٍ في مجمّع اتّصالات، وعنوانٌ عُدِّل
 * بعد الفحص. والفحصان معاً يجعلان الخطأَ يحتاج كسرَ حاجزين لا حاجزٍ واحد.
 */
export async function assertConnectedToBenchDatabase(
  sql: Sql,
  allowed: readonly string[] = BENCH_DATABASE_NAMES,
): Promise<string> {
  const rows = await sql<{ database: string }[]>`select current_database() as database`;
  const database = rows[0]?.database ?? "";
  if (!allowed.includes(database)) {
    throw new Error(
      `[bench/isolation:DATABASE_NOT_ALLOWED] الاتّصال قائمٌ على «${database}» لا على قاعدة القياس (${allowed.join(", ")}).`,
    );
  }
  return database;
}
