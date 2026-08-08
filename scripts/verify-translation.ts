/**
 * الغرض: التحقّق من أن مزوّد الترجمة المضبوط يترجم فعلاً عبر الشبكة الحقيقية.
 *   ليس اختبار وحدة ولا تكامل: يخرج عن المستودع إلى خدمة خارجية، فلا مكان له في CI
 *   الذي لا يُضمَن له منفذ إنترنت ولا حصّة مزوّد — واختبارٌ يسقط لانقطاع شبكة
 *   يُدرِّب الفريق على تجاهل الأحمر، وهذا أسوأ من غيابه.
 * الحالة: منفّذ فعلياً وشُغِّل على شبكة حقيقية — المرحلة 2.6.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: المشغّل قبل النشر، وبعد تغيير المزوّد أو مفتاحه
 * ملاحظات مستقبلية: يُستدعى من فحص جهوزية النشر (القسم 6) للتأكّد من المفتاح قبل الإقلاع.
 *
 * التشغيل:
 *   TRANSLATION_PROVIDER=mymemory bun scripts/verify-translation.ts
 *   TRANSLATION_PROVIDER=deepl TRANSLATION_API_KEY=... bun scripts/verify-translation.ts
 */

import { translateMessage } from "../packages/application/i18n-translation/index.ts";
import type { SupportedLanguage } from "../packages/domain/i18n-translation/index.ts";
import {
  createMemoryTranslationCache,
  createTranslationProvider,
  type TranslationProviderName,
} from "../packages/infrastructure/i18n-translation/index.ts";
import { systemClock } from "../packages/shared/kernel/index.ts";

interface Case {
  readonly text: string;
  readonly from: SupportedLanguage;
  readonly to: SupportedLanguage;
  readonly why: string;
}

/** جمل من واقع التفاوض بين سائق وعميل، لا جمل معجمية. */
const CASES: readonly Case[] = [
  {
    text: "أنا واصل بعد خمس دقائق، انتظرني عند البوابة",
    from: "ar",
    to: "en",
    why: "سائق عربي ← عميل إنجليزي",
  },
  {
    text: "I am waiting next to the pharmacy entrance",
    from: "en",
    to: "ar",
    why: "عميل إنجليزي ← سائق عربي",
  },
  { text: "میں راستے میں ہوں، پانچ منٹ", from: "ur", to: "ar", why: "سائق أردي ← عميل عربي" },
  { text: "وصلت، السيارة بيضاء", from: "ar", to: "ur", why: "عميل عربي ← سائق أردي" },
];

const provider = createTranslationProvider({
  provider: (process.env.TRANSLATION_PROVIDER ?? "mymemory") as TranslationProviderName,
  ...(process.env.TRANSLATION_API_KEY === undefined
    ? {}
    : { apiKey: process.env.TRANSLATION_API_KEY }),
  ...(process.env.TRANSLATION_CONTACT_EMAIL === undefined
    ? {}
    : { contactEmail: process.env.TRANSLATION_CONTACT_EMAIL }),
});

if (provider === null) {
  console.error("❌ لا مزوّد مضبوط. اضبط TRANSLATION_PROVIDER ومفتاحه إن كان يحتاجه.");
  process.exit(1);
}

const cache = createMemoryTranslationCache(systemClock);
let failures = 0;

console.log(`🌐 المزوّد: ${provider.name}\n`);

for (const testCase of CASES) {
  const outcome = await translateMessage(
    { text: testCase.text, pair: { from: testCase.from, to: testCase.to } },
    { provider, cache },
  );

  const mark = outcome.translated ? "✅" : "❌";
  if (!outcome.translated) failures += 1;

  console.log(`${mark} ${testCase.from}→${testCase.to} — ${testCase.why}`);
  console.log(`   الأصل   : ${testCase.text}`);
  console.log(`   الترجمة : ${outcome.text}`);
  if (!outcome.translated) console.log(`   السبب   : ${outcome.skipped}`);
  console.log();
}

// الطلب الثاني للنصّ نفسه يجب أن يأتي من الذاكرة بلا نداء شبكة — وإلا فالذاكرة
// موجودة ولا تعمل، وهذا إنفاق صامت على حصّة المزوّد.
const first = CASES[0];
if (first !== undefined) {
  const repeat = await translateMessage(
    { text: first.text, pair: { from: first.from, to: first.to } },
    { provider, cache },
  );
  const cachedMark = repeat.cached ? "✅" : "❌";
  if (!repeat.cached) failures += 1;
  console.log(`${cachedMark} الذاكرة المؤقتة: الطلب المكرَّر cached=${repeat.cached}`);
}

console.log(failures === 0 ? "\n✅ كل الحالات نجحت." : `\n❌ حالات فاشلة: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
