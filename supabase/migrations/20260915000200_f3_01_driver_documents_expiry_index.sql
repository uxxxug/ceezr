-- migration-phase: index
-- `F3-01` · `F12-14` — فهرسُ تواريخِ الانتهاءِ على المقبولِ وحدَه.
--
-- **جزئيٌّ عن قصدٍ**: الوثيقةُ التي لم تُقبَلْ لا يُحجَبُ بها أحدٌ بتاريخِها،
-- فحصرُ الفهرسِ في `status = 'accepted'` يجعلُه صغيراً ويجعلَ مسحَ المُنبِّهِ
-- «أيُّ وثيقةٍ تنتهي خلالَ ثلاثينَ يوماً» قراءةَ مدىً لا مسحَ جدولٍ.
--
-- مسارُ العودةِ: `drop index concurrently if exists driver_documents_expiry_idx;`
-- ولا يُفقَدُ به إنفاذٌ — الحجبُ يُحسَبُ من التاريخِ لا من الفهرسِ.

create index concurrently if not exists driver_documents_expiry_idx
  on public.driver_documents (expires_at)
  where status = 'accepted';
