-- DEC-27 — إشعارُ انتهاءِ وثيقةِ السائقِ قبلَ ثلاثينَ يومًا
-- migration-phase: expand
-- الطور: expand — إضافةُ عمودِ تتبُّعِ الإشعارِ بلا قيدٍ

alter table driver_documents
  add column if not exists expiry_warning_sent_at timestamptz;

comment on column driver_documents.expiry_warning_sent_at is
  'وقتُ إرسالِ إشعارِ الاقترابِ من الانتهاءِ — null يعني لم يُرسَلْ بعدُ. DEC-27.';

-- دالّةٌ تُقرأُ منها الوثائقُ التي تقتربُ من الانتهاءِ ولم يُنبَّهْ صاحبُها
create or replace function driver_documents_expiring_soon(
  p_city_id uuid,
  p_days integer
)
returns table (
  document_id uuid,
  driver_id uuid,
  telegram_id bigint,
  language_code text,
  doc_type text,
  expires_at text,
  days_left integer
)
language sql
security definer
set search_path = public
as $$
  select
    dd.id as document_id,
    dd.driver_id,
    u.telegram_id,
    coalesce(u.language_code, 'ar') as language_code,
    dd.doc_type::text,
    to_char(dd.expires_at, 'YYYY-MM-DD') as expires_at,
    (dd.expires_at - current_date) as days_left
  from driver_documents dd
  join users u on u.id = dd.driver_id
  where dd.city_id = p_city_id
    and dd.status = 'accepted'
    and dd.expires_at is not null
    and dd.expires_at <= current_date + p_days
    and dd.expires_at > current_date
    and dd.expiry_warning_sent_at is null
$$;

comment on function driver_documents_expiring_soon(uuid, integer) is
  'الوثائقُ المقبولةُ التي تنتهي خلال p_days يومًا ولم يُرسَلْ لها إشعارٌ بعدُ. DEC-27.';

-- تسجيلُ إرسالِ الإشعارِ — لا تُكرِّرْهُ
create or replace function record_document_expiry_warning(
  p_document_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update driver_documents
  set expiry_warning_sent_at = now(),
      updated_at = now()
  where id = p_document_id
    and expiry_warning_sent_at is null
$$;

comment on function record_document_expiry_warning(uuid) is
  'يسجِّلُ أنَّ إشعارَ الاقترابِ من الانتهاءِ أُرسِلَ لهذه الوثيقةِ. DEC-27.';
