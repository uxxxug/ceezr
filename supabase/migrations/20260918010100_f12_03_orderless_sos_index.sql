-- migration-phase: index
-- `F12-03` — فهرسُ مسارِ «استغاثةٍ بلا رحلةٍ».
--
-- **لِمَ فهرسٌ جديدٌ؟** الفهرسُ القائمُ على `safety_incidents` يبدأُ بـ`order_id`،
-- فلا يخدمُ استعلاماً شرطُه `order_id is null` — وهوَ استعلامُ منعِ التكرارِ الذي
-- تُنفِّذُه `trigger_sos` **داخلَ قفلٍ استشاريٍّ** في كلِّ ضغطةِ استغاثةٍ بلا
-- رحلةٍ. ومسحُ جدولٍ داخلَ قفلٍ يُطيلُ القفلَ بنموِّ الجدولِ.
--
-- **جزئيٌّ عن قصدٍ**: `where order_id is null` يحصرُه في الصفوفِ التي تُقرأُ بهذا
-- الطريقِ وحدَها، فيبقى صغيراً ولا يُثقِلُ كتابةَ بلاغاتِ الرحلاتِ.
--
-- مسارُ العودةِ:
-- `drop index concurrently if exists safety_incidents_orderless_reporter_created_idx;`
-- ولا يُفقَدُ به إنفاذٌ — منعُ التكرارِ يُحسَبُ بالشرطِ وبالقفلِ لا بالفهرسِ.

create index concurrently if not exists safety_incidents_orderless_reporter_created_idx
  on public.safety_incidents (reporter_user_id, created_at desc)
  where order_id is null;
