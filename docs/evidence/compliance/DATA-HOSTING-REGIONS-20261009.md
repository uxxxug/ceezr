# خريطةُ مواضعِ البياناتِ — F12-15 (2026-10-09)

**قرارُ المالك (لا يُعادُ فتحُه):** يُفضَّلُ الاستضافةُ داخلَ المملكة، ويُسمَحُ بغيرِها. فهذا الملفُّ لا يقرّرُ الموضعَ؛ يوثّقُه ويحدّدُ ما يُلزِمُه النظامُ لكونِه خارجَ المملكة.

## ١. أينَ تقعُ كلُّ فئة

| الفئة | المزوّد / المورد | المنطقة | الوسم | بياناتٌ شخصيّة؟ |
|---|---|---|---|---|
| قاعدةُ الإنتاج (المستخدمون، الطلبات، المواقع، الهويّات، التدقيق) | Supabase · مشروع `jafuchojgxzeuvibkkfx` («veer») · PostgreSQL 17 | `ap-southeast-2` (سيدني، أستراليا) | **فعليّ** — واجهةُ Supabase | نعم، ومنها رقمُ الهويّةِ الوطنيّة |
| وثائقُ السائقِ وصورُ المركبة (Storage) | Supabase Storage في المشروعِ نفسِه | `ap-southeast-2` | فعليّ (المشروعُ نفسُه) | نعم — حسّاسة |
| مشروعُ Supabase الثاني «maaavg» `qqxeuzkseecirxziqygh` | Supabase | `ap-northeast-2` (سيول) | فعليّ | **غيرُ معروف** — يُحدِّدُ المالكُ دورَه (اختبار؟ مهجور؟) |
| البوّابة (معالجةٌ عابرة + سجلّاتُ التطبيق) | Render `waslah-gateway` | `frankfurt` | مُعلَنٌ في `render.yaml`؛ لم يُتحقَّقْ حيّاً (موصلُ Render `unauthorized`) | عابرة؛ السجلّاتُ بلا PII بالتصميم (F1-03) |
| التطبيقُ المصغَّر | Render موقعٌ ساكن (CDN عالميّ) | عالميّ | مُعلَن | لا |
| الجلساتُ والطوابيرُ المؤقّتة | Upstash Redis | **غيرُ معروف** | لا وصولَ إلى الحساب | معرّفُ تيليجرام وحالةُ الحوار (مؤقّتة) |
| النسخُ الاحتياطيّةُ الليليّة | GitHub Actions Artifacts · `uxxxug/ceezr-backups` · احتفاظ 30 يوماً · مشفَّرةٌ بـ`age` | تخزينُ GitHub (الولايات المتّحدة غالباً، لا يُختار) | فعليّ (artifact `wasla-backup-37984540159-1`) | نعم، مشفَّرة |
| نسخُ Google Drive (مسارٌ قديمٌ في `render.yaml`) | Google Drive | غيرُ معروف | مُعلَنٌ بمتغيّراتٍ `sync: false` — هل مفعَّل؟ غيرُ متحقَّق | نعم إن فُعِّل |
| الرسائلُ والملفّاتُ المُرسَلةُ عبرَ البوت | Telegram | خوادمُ تيليجرام | خارجيّ بطبيعتِه | نعم |
| التوجيه | OSRM العامّ `router.project-osrm.org` | خارجيّ | مُعلَن | إحداثيّاتُ الرحلةِ بلا هويّة |

**النتيجة:** كلُّ البياناتِ الشخصيّةِ المخزَّنةِ اليومَ خارجَ المملكة.

## ٢. ما يُلزِمُه النظامُ لكونِها خارجَ المملكة (ليسَ رأياً قانونيّاً)

نظامُ حمايةِ البياناتِ الشخصيّة يسري على معالجةِ بياناتِ المقيمينَ في المملكةِ حتّى من خارجِها، والنقلُ إلى الخارجِ مسموحٌ بشروط ([SDAIA — لائحة نقل البيانات خارج المملكة](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/RegulationonPersonalDataTransferOutsidetheKingdom/!ut/p/z1/jZDLDoIwEEW_hQ8wLTSgLvGRCIiiPMRuTBNKaQKFQHHh11tZSgRnN8m5mTkXYJACLMiTMyJ5LUip9ju2Ho69tw56CA092ZjQQv7JND1kwGgJbl9AnKwVcDF813YQDBDA_-Thj7HhXN6dA5SB0fpbnwHcEFksuMhrkF4p68tBshYBbbuP7I5IErVEdDltz73seEZlQT0uWFZX6lE8eWqFRsC4iwGYkG2qOH0d89BhmvYGeqrWEA!!/dz/d5/L0lDUmlTUSEhL3dHa0FKRnNBLzROV3FpQSEhL2Vu/)):

1. **حدُّ الضرورة:** نقلُ أقلِّ قدرٍ لازمٍ للغرض، مع خريطةِ بياناتٍ تربطُ كلَّ فئةٍ بغرضِها ([اللائحة، المادّة 2](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL2/!ut/p/z1/jZBNb4JAEIZ_Sw8cZYbdQGlvWzURCg2NhdK9mCXhK1GWLKvV_no39mLEauc2k-fJzDvAIQfeiV1bC93KTqxN_8W9VcDm3sJZInGyFxc9Gr-57isl-PEInxdAmj0Z4J3EIQsoJhT4f3z8oxje88N7gElAVDyNa-C90M2k7SoJeTJLImKW85u6T0fAON8JuBHAXFivZfH7TNYV1DenqLIqVansrTLjRut-eLbQwnLfK2nXcmcPwsJrQiMHDfk5B_0mzX-iahlMeHH4Zg9Hp-E68g!!/dz/d5/L0lDUmlTUSEhL3dHa0FKRnNBLzROV3FpQSEhL2Vu/)) — الجدولُ أعلاه بدايتُها.
2. **ألّا يُضعِفَ النقلُ** حقوقَ صاحبِ البيانات، ولا سحبَ الموافقة، ولا قدرةَ المتحكّمِ على الإخطارِ بالتسرّب (المصدرُ نفسُه).
3. **مستوى الحماية:** إمّا دولةٌ في قائمةِ الملاءمةِ التي تنشرُها الجهةُ المختصّة، وإلّا فضماناتٌ مناسبة: البنودُ التعاقديّةُ النموذجيّة (SCC) أو القواعدُ المشتركةُ الملزمة أو شهادةُ اعتماد ([لائحة النقل](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/RegulationonPersonalDataTransferOutsidetheKingdom/!ut/p/z1/jZDLDoIwEEW_hQ8wLTSgLvGRCIiiPMRuTBNKaQKFQHHh11tZSgRnN8m5mTkXYJACLMiTMyJ5LUip9ju2Ho69tw56CA092ZjQQv7JND1kwGgJbl9AnKwVcDF813YQDBDA_-Thj7HhXN6dA5SB0fpbnwHcEFksuMhrkF4p68tBshYBbbuP7I5IErVEdDltz73seEZlQT0uWFZX6lE8eWqFRsC4iwGYkG2qOH0d89BhmvYGeqrWEA!!/dz/d5/L0lDUmlTUSEhL3dHa0FKRnNBLzROV3FpQSEhL2Vu/)).
4. **تقييمُ مخاطرِ النقل** قبلَ النقلِ في حالاتٍ منها نقلُ البياناتِ الحسّاسةِ بصفةٍ مستمرّة (المصدرُ نفسُه) — ورقمُ الهويّةِ ووثائقُ السائقِ تُنقَلُ باستمرار، فالتقييمُ **لازمٌ** هنا.
5. **إعلامُ صاحبِ البيانات** بأنَّ بياناتِه تُعالَجُ خارجَ المملكة ([SDAIA — حماية البيانات](https://sdaia.gov.sa/en/Research/Pages/DataProtection.aspx)) — يُتحقَّقُ أنَّ نصَّ سياسةِ الخصوصيّةِ والموافقةِ في التطبيقِ يذكرُه.

## ٣. ما يبقى مفتوحاً (أعمالٌ لا قرارات)

| # | العمل | المالك |
|---|---|---|
| 1 | تقييمُ مخاطرِ النقلِ المكتوب (المادّة 7) للقاعدةِ والتخزينِ والنسخ | المالك + مراجعة قانونيّة |
| 2 | اعتمادُ البنودِ التعاقديّةِ النموذجيّة أو التحقّقُ من وضعِ أستراليا/ألمانيا/الولايات المتّحدة في قائمةِ الملاءمة | مراجعة قانونيّة |
| 3 | قراءةُ منطقةِ Upstash وحالةِ نسخِ Google Drive | يحتاجُ وصولاً إلى الحسابَين |
| 4 | تحديدُ دورِ مشروعِ «maaavg» (سيول) — إن لم يكن له دورٌ فحذفُه قرارُ مالكٍ لا تنفيذٌ تلقائيّ | المالك |
| 5 | ذكرُ المعالجةِ خارجَ المملكةِ صراحةً في نصِّ الخصوصيّة | تنفيذ — بعدَ مراجعةِ النصِّ الحاليّ |

`F12-15` يبقى `[!]` حتّى يُكتبَ تقييمُ المخاطرِ وتُعتمَدَ الضمانات.
