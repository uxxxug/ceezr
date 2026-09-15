/**
 * الغرض: التأكد أن كل قاموس لغة يحمل نفس المفاتيح — فلا رسالة تظهر كمفتاح خام للمستخدم.
 * الحالة: منفّذ فعلياً — يعمل كبوابة في CI.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: عند إضافة لغة جديدة تُضاف هنا تلقائياً بقراءة المجلد.
 *
 * ## وقد صارَ يفحصُ **قاموسَي البوتاتِ والتطبيقِ المصغَّرِ** بـ`F3-05` — زيادةً (`ح-8`)
 *
 * ترويسةُ `packages/shared/i18n/miniapp/index.ts` كانت تقولُ إنَّ فصلَ
 * القاموسَينِ «ما يفرضُه الحاجزُ حرفاً لا ما نأملُه» — **ولم يكن يفرضُه**: الحاجزُ
 * كانَ يقرأُ مجلَّدَ البوتاتِ وحدَه، فقاموسُ الشاشاتِ (٨٤٤ مفتاحاً) بلا حاجزِ
 * تماثلٍ ألبتّةَ. فكانَ مفتاحٌ يُضافُ إلى العربيّةِ وحدَها **يظهرُ مفتاحاً خاماً**
 * في وجهِ مستخدمٍ إنجليزيٍّ أو أرديٍّ ولا يردُّه شيءٌ قبلَ الدمجِ.
 *
 * وزِيدَ معَه فحصُ **انفصالِ المجموعتَينِ**: مفتاحٌ مشتركٌ يعني نصّاً في موضعَينِ
 * يفترقُ أحدُهما (القاعدة 0.6)، وهوَ عينُ ما تنفيهِ تلكَ الترويسةُ.
 *
 * ## وما لا يفحصُه هذا الحاجزُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يفحصُ صحّةَ ترجمةٍ**: تماثلُ المفاتيحِ لا جودةُ النصِّ.
 *   ــ **لا يفحصُ استعمالَ مفتاحٍ**: مفتاحٌ ميّتٌ لا يُرَدُّ ههنا.
 *   ــ **لا يفحصُ مُعامَلاتِ النصِّ** (`{seconds}`): تفاوتُها بينَ اللغاتِ حالٌ
 *      مشروعةٌ حينَ يختلفُ التركيبُ، وحاجزُه يحتاجُ عقداً لكلِّ مفتاحٍ.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** مجموعتانِ **منفصلتانِ بقصدٍ**: نصُّ البوتاتِ لا يُحمَّلُ في حزمةِ الشاشاتِ. */
const GROUPS: readonly { readonly name: string; readonly dir: string }[] = [
  { name: "قواميس البوتات", dir: join(import.meta.dir, "..", "packages", "shared", "i18n") },
  {
    name: "قواميس التطبيق المصغَّر",
    dir: join(import.meta.dir, "..", "packages", "shared", "i18n", "miniapp"),
  },
];

let failed = false;
const keysByGroup = new Map<string, Set<string>>();
const summary: string[] = [];

for (const group of GROUPS) {
  const files = readdirSync(group.dir).filter((f) => f.endsWith(".json"));
  const keysByFile = new Map<string, Set<string>>();

  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(group.dir, file), "utf8")) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || value.trim() === "") {
        console.error(`❌ ${group.name}/${file}: المفتاح ${key} ليس نصاً غير فارغ`);
        process.exit(1);
      }
    }
    keysByFile.set(file, new Set(Object.keys(parsed)));
  }

  const reference = keysByFile.get("ar.json");
  if (reference === undefined) {
    console.error(`❌ ${group.name}: القاموس العربي غير موجود`);
    process.exit(1);
  }

  for (const [file, keys] of keysByFile) {
    const missing = [...reference].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !reference.has(key));
    if (missing.length > 0) {
      console.error(
        `❌ ${group.name}/${file}: مفاتيح ناقصة (${missing.length}): ${missing.join(", ")}`,
      );
      failed = true;
    }
    if (extra.length > 0) {
      console.error(
        `❌ ${group.name}/${file}: مفاتيح زائدة (${extra.length}): ${extra.join(", ")}`,
      );
      failed = true;
    }
  }

  keysByGroup.set(group.name, reference);
  summary.push(`${group.name}: ${keysByFile.size} قواميس، ${reference.size} مفتاحاً`);
}

/**
 * **الانفصالُ يُفحَذُ لا يُؤمَلُ**: مفتاحٌ في القاموسَينِ نصٌّ له مصدرانِ، وحينَ
 * يُصحَّحُ أحدُهما يبقى الآخرُ على غلطِه في نصفِ الشاشاتِ.
 */
const [botKeys, miniappKeys] = [
  keysByGroup.get("قواميس البوتات"),
  keysByGroup.get("قواميس التطبيق المصغَّر"),
];
if (botKeys !== undefined && miniappKeys !== undefined) {
  const shared = [...botKeys].filter((key) => miniappKeys.has(key));
  if (shared.length > 0) {
    console.error(
      `❌ مفاتيح مشتركة بين قاموسَي البوتات والمصغَّر (${shared.length}): ${shared.join(", ")}`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`✅ ${summary.join(" | ")} — ولا مفتاح مشترك بين المجموعتين`);
