# ADR 0250: قراراتُ المنصّةِ PRD-004 حتى PRD-007 — إعادةُ الكتابة، وخرائطُ المصدر، وHSTS، وتباينُ السمة

**الحالة:** مقبول — بتفويضِ المالكِ في مهمّةِ 2026-10-09 («اتخذ القرارات التقنية القابلة للتراجع… ووثّق أسبابها»)
**التاريخ:** 2026-10-09
**المرجع:** `docs/governance/PRODUCTION_READINESS_GATE.md` (PRD-004…007) · ADR 0245 §«ما بقي» · ADR 0233 §2 · ADR 0206 (staging)
**Work Packet:** `docs/work-packets/prd-004-007-platform-decisions.json`

## السياق

سجّلَ ADR 0245 أربعَ فجواتٍ تحتاجُ قرارًا لا إصلاحًا. قِيسَت حيّةً قبلَ القرار (2026-10-09):

- `https://waslah-miniapp.onrender.com/v1/me` → 401 JSON، و`/socket.io/?EIO=4&transport=polling` → 200، و`/health` → 200: إعادةُ الكتابةِ قائمةٌ في لوحةِ Render وحدَها.
- `/assets/*.js.map` تُخدَمُ علنًا (`sourcemap: true`)، ولا مستهلِكَ لها في المستودع.
- `https://waslah-gateway.onrender.com/health` بلا `Strict-Transport-Security`.
- سمةُ تيليجرامَ الافتراضيّة: `#999999`/أبيض 2.84:1، `#2481cc`/أبيض 4.12:1، `#708499`/`#17212b` و`#5288c1`/أبيض دونَ 4.5:1.

## القرار

1. **PRD-004:** القواعدُ الثلاثُ (`/v1/*`، `/socket.io/*`، `/health`) تُكتَبُ في `render.yaml` قبلَ احتياطِ `/*` بالقيمِ المقيسةِ حيًّا. واشتقاقُ staging (`scripts/lib/staging-blueprint.ts`) يُلحِقُ `-staging` بأصلِ كلِّ خدمةٍ من المخطّطِ نفسِه (فرقٌ ثالثٌ مُعلَن)، فلا تصلُ staging بوّابةَ الإنتاج. عنوانُ staging الفعليُّ يُتحقَّقُ منه عندَ إنشائها (PRD-201).
2. **PRD-005:** `sourcemap: false` في `apps/miniapp/vite.config.ts` (الخيار ب). العودةُ: `"hidden"` مع رافعٍ إلى خدمةِ أخطاءٍ متى وُجدت.
3. **PRD-006:** البوّابةُ تكتبُ `Strict-Transport-Security: max-age=31536000` على كلِّ ردٍّ (وسيطٌ قبلَ كلِّ مسار). بلا `includeSubDomains` ولا `preload` لأنّ `onrender.com` نطاقٌ مشترك — كقاعدةِ التطبيقِ المصغَّر.
4. **PRD-007 (الخيار أ، معالجةٌ متوافقة):** سمةُ المضيفِ تبقى المصدرَ (Layer 1)، لكنّ ألوانَ النصِّ (`hint` · `subtitle` · `link` · `section_header` · `accent`) التي تسقطُ دونَ 4.5:1 على `bg`/`secondary_bg` تُزاحُ أقلَّ إزاحةٍ نحوَ `text_color`، و`button_color` نحوَ القطبِ المقابلِ لنصِّه (`apps/miniapp/src/tg/readable.ts`). اللونُ المجتازُ لا يُمسّ، ولا يُخترَعُ لونٌ لمفتاحٍ غائب، وألوانُ إطارِ المضيف تُرسَلُ كما هي. `TgThemeReport.adjusted` يُعلِنُ ما أُزيح.

## العواقب

- الحرّاس: `tests/unit/prd-004-007-decisions.test.ts` و`tests/unit/staging-blueprint.test.ts` و`apps/miniapp/src/tg/readable.test.ts`.
- لا endpoint ولا هجرة ولا تغييرَ عقد. التراجعُ لكلِّ بندٍ سطرٌ واحد موثَّقٌ أعلاه.
- **التطبيقُ على Render:** القواعدُ في `render.yaml` لا تسري إلّا بمزامنةِ Blueprint؛ وقِيسَ أنّ اللوحةَ تختلفُ عن الملفّ (رأسُ `Cache-Control` للمسار `/` حيًّا `public, max-age=0, s-maxage=300` لا `no-cache`). المزامنةُ تحتاجُ وصولًا إلى Render.
- حالاتُ البنودِ في البوابة لا تصيرُ `ADR-Closed` إلّا بعدَ النشرِ والقياسِ الحيّ (لا خرائطَ `.map`، وHSTS على البوّابة، والقواعدُ قائمة).
