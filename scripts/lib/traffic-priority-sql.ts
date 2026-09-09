/**
 * # قراءةُ رتبةِ المرورِ **من نصِّ الهجراتِ** — لا من الكودِ الذي تُقابِلُه
 *
 * **الغرض:** يستخرجُ من ملفّاتِ الهجراتِ ما تُعلِنُه **القاعدةُ** عن رتبةِ كلِّ
 * نوعِ إشعارٍ (`notification_kind_priority`) وعن قائمةِ التأجيلِ
 * (`notification_kind_is_deferrable`)، كي يُقابِلَ حاجزانِ لا واحدٌ الطرفَينِ:
 * `scripts/check-traffic-priority.ts` (الرتبةُ) و`scripts/check-queue-backpressure.ts`
 * (التأجيلُ).
 *
 * **الحالة:** `F6-07` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** `scripts/lib`.
 *
 * **يُستخدم من:** `check-traffic-priority.ts` · `check-queue-backpressure.ts`.
 *
 * **لماذا يُقرأُ آخِرُ تعريفٍ لا أوّلُه:** الهجراتُ تُطبَّقُ بترتيبِ الطابعِ
 * الزمنيِّ، و`create or replace` تُبطِلُ ما قبلَها. فحاجزٌ يقرأُ أوّلَ تعريفٍ
 * يحكمُ على تاريخٍ مضى لا على القاعدةِ التي ستعملُ.
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يلمسُ قاعدةً ولا يُنفِّذُ SQL. أنَّ الدالّةَ
 * المُطبَّقةَ تُرتِّبُ فعلاً يُثبَتُ في
 * `tests/integration/traffic-priority-claim.test.ts` على PostgreSQL حقيقيٍّ. وحدُّه
 * الآخرُ أنَّه لا يفهمُ DDL مُركَّباً في زمنِ التشغيلِ (`execute format(…)`) — وهوَ
 * الحدُّ المُعلَنُ نفسُه في `scripts/lib/migration-safety.ts`.
 */

export interface SqlMigration {
  readonly file: string;
  readonly sql: string;
}

/** آخِرُ جسمِ دالّةٍ باسمٍ مُعطىً، أو `null` إن لم تُعرَّف في الهجراتِ. */
function lastFunctionBody(migrations: readonly SqlMigration[], name: string): string | null {
  const pattern = new RegExp(
    `create or replace function\\s+${name}\\s*\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    "g",
  );
  let last: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const body = match[1];
      if (body !== undefined) last = body;
    }
  }
  return last;
}

export interface SqlPriorityMap {
  /** رتبةُ كلِّ نوعٍ مذكورٍ صراحةً في `case`. */
  readonly ranks: ReadonlyMap<string, number>;
  /** رتبةُ المجهولِ (`else`)، أو `null` إن لم تُصرَّح. */
  readonly fallback: number | null;
}

/**
 * رتبُ الأنواعِ كما تُعلِنُها القاعدةُ. تُقرأُ من `when '…' then N` في جسمِ
 * `notification_kind_priority`، ورتبةُ المجهولِ من `else N`.
 *
 * والتعليقاتُ تُنزَعُ قبلَ المطابقةِ: جسمُ الدالّةِ فيه شرحٌ عربيٌّ يذكرُ أسماءَ
 * أنواعٍ بينَ علامتَي اقتباسٍ، فمطابقةٌ على النصِّ الخامِ تقرأُ شرحاً رتبةً.
 */
export function priorityMapFromMigrations(migrations: readonly SqlMigration[]): SqlPriorityMap {
  const body = lastFunctionBody(migrations, "notification_kind_priority");
  if (body === null) return { ranks: new Map(), fallback: null };

  const bare = body.replace(/--[^\n]*/g, "");
  const ranks = new Map<string, number>();
  for (const match of bare.matchAll(/when\s+'([a-z_]+)'\s+then\s+(\d+)/g)) {
    const kind = match[1];
    const rank = Number(match[2]);
    if (kind !== undefined && Number.isFinite(rank)) ranks.set(kind, rank);
  }
  const fallbackMatch = /else\s+(\d+)/.exec(bare);
  const fallback = fallbackMatch === null ? null : Number(fallbackMatch[1]);
  return { ranks, fallback: Number.isFinite(fallback) ? fallback : null };
}

/**
 * الأصنافُ القابلةُ للتأجيلِ كما تُعلِنُها القاعدةُ. وتُفهَمُ **صورتانِ**:
 *
 * ١) قائمةٌ صريحةٌ: `select p_kind in ('a', 'b')` — صورةُ `F6-06`.
 * ٢) اشتقاقٌ من الرتبةِ: `select notification_kind_priority(p_kind) >= 3` —
 *    صورةُ `F6-07`، وحينَها تُحسَبُ القائمةُ من رتبِ الأنواعِ المُعلَنةِ في
 *    القاعدةِ نفسِها، **لا من ثوابتِ الكودِ** — فلو انحرفَت رتبةُ نوعٍ في SQL
 *    انحرفَت قائمةُ التأجيلِ معَها وسقطَ الحاجزُ، وهوَ المطلوبُ.
 *
 * وصورةٌ ثالثةٌ لا تُفهَمُ تُردُّ مجموعةً فارغةً، فيسقطُ الحاجزُ بفراقِ
 * القائمتَينِ بدلاً من أن يمرَّ صامتاً. فالجهلُ يُوقِفُ لا يُرخِّصُ.
 */
export function deferrableKindsFromMigrations(migrations: readonly SqlMigration[]): Set<string> {
  const body = lastFunctionBody(migrations, "notification_kind_is_deferrable");
  if (body === null) return new Set();
  const bare = body.replace(/--[^\n]*/g, "");

  const explicit = /p_kind\s+in\s*\(([^)]*)\)/.exec(bare);
  if (explicit?.[1] !== undefined) {
    return new Set([...explicit[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1] as string));
  }

  const derived = /notification_kind_priority\s*\(\s*p_kind\s*\)\s*>=\s*(\d+)/.exec(bare);
  if (derived?.[1] !== undefined) {
    const threshold = Number(derived[1]);
    const { ranks } = priorityMapFromMigrations(migrations);
    const kinds = new Set<string>();
    for (const [kind, rank] of ranks) if (rank >= threshold) kinds.add(kind);
    return kinds;
  }

  return new Set();
}
