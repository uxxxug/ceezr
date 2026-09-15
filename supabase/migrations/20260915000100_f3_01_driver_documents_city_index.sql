-- migration-phase: index
-- `F3-01` — فهرسُ المدينةِ على `driver_documents` متزامناً وحدَه في ملفِّه.
--
-- **عبارةٌ واحدةٌ عن قصدٍ** (`CAP-007`): الفهرسُ المتزامنُ لا يُنفَّذُ داخلَ
-- معاملةٍ، والمُطبِّقُ يُرسِلُ الملفَّ متعدِّدَ العباراتِ في معاملةٍ واحدةٍ.
--
-- **ولِمَ فهرسٌ للمدينةِ**: كلُّ قراءةٍ إداريّةٍ مُقيَّدةٌ بمدينةٍ (`م0-4`)،
-- ومسحُ الجدولِ كلِّه لعرضِ وثائقِ مدينةٍ واحدةٍ يكبرُ بعددِ السائقينَ كلِّهم.
--
-- مسارُ العودةِ: `drop index concurrently if exists driver_documents_city_idx;`
-- ولا يُفقَدُ به حكمٌ — سرعةُ قراءةٍ فقط.

create index concurrently if not exists driver_documents_city_idx
  on public.driver_documents (city_id, doc_type);
