-- migration-phase: index
-- `ADR 0113` · فهرسُ المحظورينَ في أثرِ الهُويّةِ — متزامنٌ وحدَه.
--
-- **عبارةٌ واحدةٌ في الملفِّ** لعِلَّةِ CAP-007 نفسِها المشروحةِ في
-- `20260914200100_identity_marks_phone_hash_index.sql`.
--
-- فهرسٌ جزئيٌّ صغيرٌ يخدمُ المراجعةَ والإحصاءَ — لا مسارَ التسجيلِ الحارَّ،
-- فذاكَ يمرُّ على `identity_marks_telegram_hash_key`.
--
-- مسارُ العودةِ: `drop index concurrently if exists identity_marks_blocked_idx;`

create index concurrently if not exists identity_marks_blocked_idx
  on public.identity_marks (telegram_hash)
  where is_blocked;
