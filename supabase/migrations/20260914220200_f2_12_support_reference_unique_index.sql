-- migration-phase: index
-- `F2-12` · `ADR 0114` — تفرُّدُ المرجعِ فهرساً متزامناً وحدَه في ملفِّه.
--
-- **عبارةٌ واحدةٌ عن قصدٍ**: `create index concurrently` لا تُنفَّذُ داخلَ
-- معاملةٍ، والمُطبِّقُ يُرسِلُ الملفَّ متعدِّدَ العباراتِ في معاملةٍ واحدةٍ
-- (`CAP-007`). وهذا الفهرسُ **حُكمٌ لا سرعةٌ**: مرجعانِ لتذكرتَينِ يجعلانِ
-- «أرسِلْ لي مرجعَكَ» سؤالاً بلا جوابٍ.
--
-- مسارُ العودةِ: `drop index concurrently if exists support_tickets_reference_key;`
-- **ويُفقَدُ بذلكَ إنفاذُ التفرُّدِ** — فلا يُسقَطُ إلّا معَ إسقاطِ العمودِ.

create unique index concurrently if not exists support_tickets_reference_key
  on public.support_tickets (reference);
