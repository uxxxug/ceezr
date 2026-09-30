-- migration-phase: expand
-- =============================================================================
-- `F12-21` — منعُ ناقصِ الوثائقِ من الاعتمادِ: حارسٌ في مسارِ الاعتمادِ
--   لا في مسارِ العرضِ وحدَه.
--
-- الحالة: منفَّذٌ — البند `F12-21` (دَينُ `F12-14`/`SD-02`).
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-documents-approval-guard.test.ts
-- الحاكم: docs/adr/0215-incomplete-documents-block-verification.md
--
-- ## الفجوةُ
--
-- `admin_set_driver_verification` (هجرةُ `20260808140000`) تسمحُ بتعيينِ
-- حالةِ السائقِ إلى `verified` **بلا فحصِ وثائقَ إلزاميّةٍ**. و`F12-14` بنى
-- الحجبَ في مسارِ العرضِ (`driver_document_block_reasons` في `open_offer_round`)
-- لكنَّ مسارَ الاعتمادِ نفسَه لا يمنعُ ناقصَ الوثائقِ من القبولِ.
--
-- ## العلاجُ
--
-- حارسٌ واحدٌ في `admin_set_driver_verification`: حينَ يطلبُ المسؤولُ `verified`
-- تُستدعَى `driver_document_block_reasons` فإن أعادَت أسباباً يُرفَضُ الطلبُ
-- برمزٍ مُصنَّفٍ `INCOMPLETE_DOCUMENTS` والقائمةُ في الحمولةِ. وغيرُ `verified`
-- يمرُّ بلا فحصٍ — فالتعليقُ والرفضُ لا يشترطانِ وثائقَ.
--
-- ## ولا يُمسُّ مسارُ العرضِ
--
-- `driver_document_block_reasons` في `open_offer_round` يبقى كما هو — الحجبُ
-- هناك ساعةٌ لا رايةٌ، وهنا حارسُ بوّابةٍ. والاثنانِ يقرآنِ المصدرَ نفسَه.
-- =============================================================================

create or replace function admin_set_driver_verification(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_status        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  users%rowtype;
  v_driver drivers%rowtype;
  v_block_reasons text[];
  v_city   cities%rowtype;
  v_trial  jsonb;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_status not in ('pending', 'verified', 'rejected', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  -- **حارسُ الاعتمادِ (F12-21):** لا يُعيَّنُ سائقٌ `verified` ووثائقُه ناقصةٌ.
  -- `driver_document_block_reasons` تحسبُ الناقصَ والمرفوضَ وغيرِ المقبولِ
  -- والمنتهي — فهي المصدرُ الواحدُ لمسارَي العرضِ والاعتمادِ معاً.
  if p_status = 'verified' then
    v_block_reasons := driver_document_block_reasons(v_driver.id);
    if array_length(v_block_reasons, 1) is not null then
      return jsonb_build_object(
        'ok', false,
        'error', 'INCOMPLETE_DOCUMENTS',
        'block_reasons', to_jsonb(v_block_reasons)
      );
    end if;
  end if;

  if v_driver.verification_status::text = p_status then
    return jsonb_build_object('ok', true, 'changed', false, 'status', p_status);
  end if;

  update drivers
     set verification_status = p_status::verification_status
   where id = v_driver.id;

  -- سائق لم يعد موثَّقاً لا يبقى «متاحاً» في جدول الإتاحة: بقاؤه متاحاً يعني
  -- أن محرّك المطابقة سيرشّحه بعد لحظة من تعليقه.
  if p_status <> 'verified' then
    update driver_availability
       set is_available = false, changed_at = now()
     where driver_id = v_driver.id and is_available = true;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_actor.id, 'admin.driver_verification_changed', 'driver',
          v_driver.id,
          jsonb_build_object('from', v_driver.verification_status, 'to', p_status));

  -- بدءُ التجربةِ تلقائيًّا عندَ التوثيقِ إن لم يكنْ للسائقِ اشتراكٌ
  -- والمدينةُ مفعّلةٌ (القاعدةُ المعلنةُ في PD-040)
  if p_status = 'verified' and not exists (
    select 1 from subscriptions where driver_id = v_driver.id
  ) then
    select * into v_city from cities where id = v_driver.city_id;
    if v_city.is_active then
      v_trial := start_trial(v_driver.id, 'transport');
      -- نتيجةُ التجربةِ في الحمولةِ لا تُسقِطُ التوثيقَ إن فشلت
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (v_driver.city_id, v_actor.id, 'admin.trial_auto_started', 'driver',
              v_driver.id, v_trial);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_status);
end;
$$;

comment on function admin_set_driver_verification(uuid, uuid, text) is
  'تعيينُ حالةِ توثيقِ سائقٍ — حارسُ `F12-21` يمنعُ `verified` بلا وثائقَ إلزاميّةٍ كاملةٍ (`driver_document_block_reasons`). بدءُ التجربةِ تلقائيًّا (PD-040).';
