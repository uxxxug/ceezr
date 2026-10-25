-- migration-phase: index

-- LOAD-01 (2026-10-25) — فهرسُ مسحِ الترتيبِ لالتقاطِ الردودِ المؤجَّلة.
--
-- رفيقُ `20261025160000`: الاستعلامُ الخارجيُّ في `claim_telegram_update_replies` يرشِّحُ
-- `reply_status in ('pending','sending')` ويرتِّبُ `order by created_at`؛ الفهرسُ القائمُ
-- `telegram_update_jobs_reply_due_idx` مرتَّبٌ على `reply_next_attempt_at` فلا يخدمُ الترتيب.
-- محليًّا (المزرعةُ نفسُها): فهرسُ المسارِ وحدَهُ 2,540→~12ms و~11,000 صفحة؛ معَ هذا
-- الفهرسِ ~2–3ms و~800 صفحة. الدلالةُ لا تتغيّر — فهرسٌ جزئيٌّ على الردودِ المفتوحةِ وحدَها.

create index concurrently if not exists telegram_update_jobs_reply_open_created_idx
  on public.telegram_update_jobs (created_at)
  where reply_status in ('pending', 'sending');
