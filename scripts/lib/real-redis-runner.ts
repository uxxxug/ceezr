/**
 * الغرض: تدقيقُ أنَّ وظيفةَ «تكامل على Redis حقيقي» **تملكُ خادمَها** في الشغلةِ
 *   نفسِها، وأنَّ ما تُخاطِبُه الاختباراتُ هوَ ذاكَ الخادمُ بعينِه: منفذاً ورمزاً.
 * الحالة: منفّذ فعلياً — `S-3` · `O-2` (ADR 0096)، ومُختبَر في
 *   `tests/unit/check-real-redis-runner.test.ts`.
 * ينتمي إلى: scripts/lib (منطقٌ نقيٌّ يُقاسُ بلا قرصٍ ولا شبكةٍ).
 * يُتوقع أن يستخدمه لاحقاً: `scripts/check-real-redis-runner.ts` وسلسلةُ `ci`.
 * ملاحظات مستقبلية: لو قرَّرَ المشروعُ يوماً أن يعودَ إلى Redis مُستضافٍ عندَ
 *   مُزوِّدٍ خارجيٍّ فذاكَ قرارٌ يُوثَّقُ بـADR **ويُعدَّلُ معه هذا الحاجزُ صراحةً**؛
 *   والممنوعُ هوَ العودةُ صامتاً إلى نقطةٍ لا خادمَ لها فتُقرَأَ الوظيفةُ حمراءَ
 *   أبداً أو — أسوأُ — يُخفَّفَ الحاجزُ لتُقرَأَ خضراءَ بلا تجريبٍ.
 *
 * **لماذا يُقاسُ التوافقُ لا الوجودُ وحدَه؟** لأنَّ ثلاثةَ أرقامٍ ههنا يجب أن
 * تتّفقَ: المنفذُ المنشورُ للقشرةِ، والمنفذُ في `UPSTASH_REDIS_REST_URL`، ورمزُ
 * القشرةِ ورمزُ الاختبارِ. وانحرافُ واحدٍ منها يُنتِج `401` أو `ECONNREFUSED`
 * يُقرَأُ عيباً في كودِ الجلساتِ وهوَ عيبُ تهيئةٍ. فالحاجزُ يقيسُ الاتّفاقَ.
 */

/** اسمُ الوظيفةِ في `.github/workflows/ci.yml` — مفتاحُها لا عنوانُها المعروضُ. */
export const REAL_REDIS_JOB = "real-redis";

/** صورةُ خادمِ Redis الحقيقيِّ: `redis` الرسميّةُ أو ما يُعلَنُ ههنا صراحةً. */
const REAL_REDIS_IMAGE = /^redis(?:-stack(?:-server)?)?:/;

/** قشرةُ REST التي تُنطِقُ Redis بروتوكولَ Upstash. */
const REST_SHIM_IMAGE = /serverless-redis-http/;

interface Block {
  readonly lines: readonly { readonly indent: number; readonly text: string }[];
}

function measure(raw: string): { indent: number; text: string } {
  const match = /^(\s*)(.*)$/.exec(raw);
  const indent = match?.[1]?.length ?? 0;
  return { indent, text: (match?.[2] ?? "").trimEnd() };
}

/** كتلةُ مفتاحٍ بعينِه: سطورُه هوَ وما كانَ أعمقَ منه إزاحةً، بلا سطورٍ فارغةٍ. */
function blockOf(source: Block, key: string): Block | undefined {
  const lines = source.lines;
  const start = lines.findIndex((l) => l.text === `${key}:` || l.text.startsWith(`${key}: `));
  if (start === -1) return undefined;
  const base = lines[start]?.indent ?? 0;
  const out: { indent: number; text: string }[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.text === "") continue;
    if (line.indent <= base) break;
    out.push(line);
  }
  return { lines: out };
}

/** قيمةُ مفتاحٍ مُسطَّحٍ داخلَ كتلةٍ، بلا عَلامَتَي اقتباسٍ وبلا تعليقٍ. */
function scalarOf(block: Block, key: string): string | undefined {
  for (const line of block.lines) {
    if (!line.text.startsWith(`${key}:`)) continue;
    const raw = line.text.slice(key.length + 1).trim();
    if (raw === "") return undefined;
    return raw.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** مفاتيحُ الخدماتِ: أسماءُ الأبناءِ المباشرينَ لكتلةِ `services`. */
function childKeys(block: Block): readonly string[] {
  const min = Math.min(...block.lines.map((l) => l.indent));
  return block.lines
    .filter((l) => l.indent === min && /^[A-Za-z0-9_-]+:$/.test(l.text))
    .map((l) => l.text.slice(0, -1));
}

function parse(text: string): Block {
  return { lines: text.split("\n").map(measure) };
}

/**
 * يُعيدُ قائمةَ المخالفاتِ — فارغةً حينَ تكونُ الوظيفةُ مالكةً لخادمِها ومتّفقةً
 * معه. ولا يقرأُ قرصاً ولا شبكةً: نصٌّ يدخلُ ونصوصٌ تخرجُ، فيُقاسُ بالسقوطِ.
 */
export function auditRealRedisRunner(workflow: string): readonly string[] {
  const violations: string[] = [];
  const jobs = blockOf(parse(workflow), "jobs");
  if (jobs === undefined) return [`لا كتلةَ \`jobs\` في الملفِّ — وهذا ليس مسارَ CI.`];

  const job = blockOf(jobs, REAL_REDIS_JOB);
  if (job === undefined) {
    return [
      `لا وظيفةَ \`${REAL_REDIS_JOB}\` في مسارِ CI — و\`O-2\` لا يُغلَقُ بحذفِ الوظيفةِ ` +
        `التي تقيسُه (ح-7: لا يُبنى حولَ الحاجزِ).`,
    ];
  }

  const services = blockOf(job, "services");
  if (services === undefined) {
    return [
      `وظيفةُ \`${REAL_REDIS_JOB}\` بلا \`services\` — فلا خادمَ Redis تملكُه، وعودتُها ` +
        `إلى نقطةٍ خارجيّةٍ قرارٌ يُوثَّقُ بـADR ويُعدَّلُ معه هذا الحاجزُ صراحةً.`,
    ];
  }

  let redisName: string | undefined;
  let shim: { name: string; token: string; port: string; target: string } | undefined;
  for (const name of childKeys(services)) {
    const service = blockOf(services, name);
    if (service === undefined) continue;
    const image = scalarOf(service, "image") ?? "";
    if (REAL_REDIS_IMAGE.test(image)) redisName = name;
    if (!REST_SHIM_IMAGE.test(image)) continue;
    const env = blockOf(service, "env");
    const connection = env === undefined ? "" : (scalarOf(env, "SRH_CONNECTION_STRING") ?? "");
    const ports = /"(\d+):80"/.exec(service.lines.map((l) => l.text).join("\n"));
    shim = {
      name,
      token: (env === undefined ? undefined : scalarOf(env, "SRH_TOKEN")) ?? "",
      port: ports?.[1] ?? "",
      target: connection,
    };
  }

  if (redisName === undefined) {
    violations.push(
      `لا خدمةَ خادمِ Redis حقيقيٍّ في \`${REAL_REDIS_JOB}\` — والصورةُ المقبولةُ ما طابقَ ` +
        `\`${REAL_REDIS_IMAGE.source}\`، لا محاكياً في الذاكرةِ ولا عميلاً مزدوجاً.`,
    );
  }
  if (shim === undefined) {
    violations.push(
      `لا قشرةَ REST (\`serverless-redis-http\`) في \`${REAL_REDIS_JOB}\` — وكودُ الإنتاجِ ` +
        `يتكلّمُ بروتوكولَ Upstash، فبلا القشرةِ لا يُخاطَبُ الخادمُ ببروتوكولِ الإنتاجِ.`,
    );
  }
  if (redisName !== undefined && shim !== undefined) {
    if (!new RegExp(`^rediss?://${redisName}(:\\d+)?$`).test(shim.target)) {
      violations.push(
        `قشرةُ \`${shim.name}\` تُخاطِبُ \`${shim.target || "(لا شيءَ)"}\` لا خدمةَ ` +
          `\`${redisName}\` في الوظيفةِ نفسِها — فالمُخاطَبُ خادمٌ آخرُ أو لا خادمَ.`,
      );
    }
    if (shim.port === "") {
      violations.push(
        `قشرةُ \`${shim.name}\` لا تنشرُ منفذاً على \`80\` — فلا تصلُها الاختباراتُ من المُشغِّلِ.`,
      );
    }
  }

  const steps = blockOf(job, "steps");
  const stepText = steps === undefined ? "" : steps.lines.map((l) => l.text).join("\n");
  /**
   * تُقرَأُ المفاتيحُ من كتلةِ الخطواتِ كلِّها لا من أوّلِ `env` فيها: الوظيفةُ فيها
   * أكثرُ من خطوةٍ ذاتِ بيئةٍ (تطبيقُ الهجراتِ مثلاً)، وهذه المفاتيحُ الثلاثةُ لا
   * تتكرَّرُ في الوظيفةِ، فقراءتُها بالاسمِ أصدقُ من قراءتِها بالموضعِ.
   */
  const url = steps === undefined ? undefined : scalarOf(steps, "UPSTASH_REDIS_REST_URL");
  const token = steps === undefined ? undefined : scalarOf(steps, "UPSTASH_REDIS_REST_TOKEN");
  const requireFlag = steps === undefined ? undefined : scalarOf(steps, "REQUIRE_REAL_REDIS");

  if (requireFlag !== "1") {
    violations.push(
      `\`REQUIRE_REAL_REDIS\` ليس \`"1"\` في خطوةِ الاختبارِ — وبلا شرطِ التفعيلِ يصيرُ ` +
        `غيابُ النقطةِ تخطّياً صامتاً، وهوَ العيبُ الذي وُجدَ الحاجزُ لأجلِه.`,
    );
  }
  if (shim !== undefined && shim.port !== "") {
    const expected = `http://localhost:${shim.port}`;
    if (url !== expected) {
      violations.push(
        `\`UPSTASH_REDIS_REST_URL\` = \`${url ?? "(غائبٌ)"}\` والقشرةُ منشورةٌ على ` +
          `\`${expected}\` — وانحرافُ المنفذِ يُنتِجُ رفضَ اتّصالٍ يُقرَأُ عيباً في الجلساتِ.`,
      );
    }
    if (token !== shim.token || shim.token === "") {
      violations.push(
        `رمزُ الاختبارِ لا يطابقُ \`SRH_TOKEN\` للقشرةِ — وانحرافُ الرمزِ يُنتِجُ \`401\` ` +
          `يُقرَأُ عيباً في الجلساتِ وهوَ عيبُ تهيئةٍ.`,
      );
    }
    /**
     * يُقاسُ حملُ `PING` نفسُه لا ذكرُ الكلمةِ: رسالةُ الإخفاقِ في الخطوةِ تذكرُ
     * `PING` أيضاً، فمطابقةُ الكلمةِ وحدَها تجعلُ حذفَ الفحصِ يمرُّ.
     */
    if (!stepText.includes(expected) || !stepText.includes("'[\"PING\"]'")) {
      violations.push(
        `لا خطوةَ جهوزيّةٍ تُخاطِبُ \`${expected}\` بـ\`PING\` قبلَ الاختبارِ — والمنفذُ ` +
          `يُفتَحُ قبلَ أن تتّصلَ القشرةُ بـRedis، فيسقطُ أوّلُ اختبارٍ على سببٍ زمنيٍّ.`,
      );
    }
  }

  return violations;
}
