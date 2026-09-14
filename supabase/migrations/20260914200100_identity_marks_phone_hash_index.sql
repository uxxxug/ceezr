-- migration-phase: index
-- `ADR 0113` · فهرسُ مطابقةِ الرقمِ في أثرِ الهُويّةِ — متزامنٌ وحدَه.
--
-- **عبارةٌ واحدةٌ في الملفِّ عن قصدٍ**: `create index concurrently` لا تُنفَّذُ
-- داخلَ معاملةٍ، والمُطبِّقُ يُرسِلُ الملفَّ متعدِّدَ العباراتِ في معاملةٍ
-- واحدةٍ (CAP-007) — فالفهرسانِ في ملفَّينِ لا في ملفٍّ.
--
-- ولا يُغيِّرُ هذا الملفُّ مخطّطاً ولا بيانةً ولا يحجبُ كتابةً.
--
-- مسارُ العودةِ: `drop index concurrently if exists identity_marks_phone_hash_idx;`
-- ولا يُفقَدُ بذلكَ إنفاذٌ — هوَ للسرعةِ لا للحكمِ، ومطابقةُ المعرّفِ تمرُّ
-- على قيدِ `unique` القائمِ.
--
-- ولِمَ جزئيٌّ: الرقمُ اختياريٌّ، والصفوفُ بلا رقمٍ لا تُطابَقُ بهِ أبداً.

create index concurrently if not exists identity_marks_phone_hash_idx
  on public.identity_marks (phone_hash)
  where phone_hash is not null;
