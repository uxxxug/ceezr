-- migration-phase: index

-- LOAD-01 (2026-10-25) — فهرسُ ترتيبِ المسارِ لالتقاطِ الردودِ المؤجَّلة.
--
-- العيبُ المُقاسُ (موجةُ LOAD-01-C1، التشغيلُ 40160348095، الموجاتُ الثماني):
-- `claim_telegram_update_replies` متوسطُها 88.8–177.7ms/نداءً داخلَ PostgreSQL وأقصاها
-- 645–2,517ms (pg_stat_statements)، وتحتجزُ مقعدَ `gatewayRequest` 782ms وسطيًّا في B1
-- (55.5ث احتجازًا من 71 نداءً ≈ 5.6% من زمنِ احتجازِ المجمعِ كلِّه في الموجة).
-- السببُ: قيدُ ترتيبِ المسارِ (`not exists ... e.lane_key = j.lane_key and e.reply_status
-- in ('pending','sending') and e.created_at < j.created_at`) لا يجدُ فهرسًا يطابقُ محمولَ
-- `reply_status` — فهرسُ `telegram_update_jobs_lane_open_idx` جزئيٌّ على `status` لا
-- `reply_status` — فيُمسحُ الجدولُ لكلِّ مرشَّح (تربيعيٌّ في حجمِ الطابور).
-- إعادةُ الإنتاجِ المحليّة (PG 18.6، 16,000 وظيفةٍ منها 5,000 ردٍّ معلَّق): 2,540ms و810,860
-- صفحةً للنداءِ الواحدِ قبلَ الفهرسين؛ 2–3ms و~800 صفحةٍ بعدَهما.
--
-- الدلالةُ لا تتغيّر: لا تُمسُّ الدالةُ ولا ترتيبُها ولا حدودُها؛ فهرسٌ جزئيٌّ صغيرٌ
-- (يحوي الردودَ المفتوحةَ وحدَها). لا رفعَ سعةٍ ولا حدٍّ محميّ.
-- ملفُّ الفهرسِ المتزامنِ وحدَهُ (عبارةٌ واحدةٌ) لأنّ `create index concurrently`
-- لا تقبلُ المعاملة؛ فهرسُ مسحِ الترتيبِ في الملفِّ التالي `20261025160100`.

create index concurrently if not exists telegram_update_jobs_reply_lane_open_idx
  on public.telegram_update_jobs (lane_key, created_at, update_id)
  where reply_status in ('pending', 'sending');
