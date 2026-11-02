-- migration-phase: expand
-- =============================================================================
-- سببُ قرارِ توثيقِ السائقِ — قرارُ المالكِ 2026-11-02 (ADR 0302)
-- =============================================================================
--
-- ## الفجوةُ
--
-- `admin_set_driver_verification` تعيّنُ الحالةَ (`pending`/`verified`/`rejected`/
-- `suspended`) بلا سببٍ مكتوبٍ، والسائقُ المرفوضُ لا يعرفُ لماذا رُفضَ ولا ما
-- الذي يُعدِّلُه — معَ أنَّ قرارَ المالكِ الجديدَ جعلَ المراجعةَ الإداريّةَ على
-- **البياناتِ المكتوبةِ** وحدها، فالسببُ المكتوبُ هو وصلةُ السائقِ الوحيدةُ.
--
-- ## العلاجُ
--
-- 1. عمودٌ `drivers.verification_note` (نصٌّ حتى 500 حرفًا، يُحفَظُ عندَ الرفضِ
--    والتعليقِ، ويُمحى عندَ التوثيقِ والعودةِ للمراجعةِ).
-- 2. `admin_set_driver_verification` تقبَلُ `p_note`: إلزاميٌّ معَ `rejected`
--    (رفضٌ بلا سببٍ يُردُّ `NOTE_REQUIRED`)، واختياريٌّ معَ `suspended`.
-- 3. لوحُ وثائقِ السائقِ ولوحُ عروضِهِ ينشرانِ السببَ للسائقِ نفسِه.
-- =============================================================================

alter table drivers
  add column if not exists verification_note text;

comment on column drivers.verification_note is
  'سببُ قرارِ التوثيقِ الأخيرِ كما كتبَهُ المسؤولُ — يُعرضُ للسائقِ نفسِه (قرارُ المالكِ 2026-11-02، ADR 0302). يُمحى عندَ التوثيقِ أو العودةِ إلى المراجعةِ.';

-- التوقيعُ تغيّرَ (4 وسائطَ) — `create or replace` لا يُبدِّلُ التحميلَ القديمَ
-- بل يُنشئُ ثانيًا فيصيرَ النداءُ بثلاثٍ غامضًا («not unique»). يُحذَفُ القديمُ
-- صريحةً: البديلُ الرباعيُّ يقبلُ النداءَ الثلاثيَّ (p_note افتراضيّةٌ null).
drop function if exists admin_set_driver_verification(uuid, uuid, text);

create or replace function admin_set_driver_verification(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_status        text,
  p_note          text default null
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
  v_note   text;
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

  -- حارسُ الاعتمادِ (F12-21): لا يُعيَّنُ سائقٌ `verified` ووثائقُ مدينتِهِ
  -- تُلزِمُهُ بما لم يستوفِه. وبسياسةِ «لا وثائقَ مطلوبةً» (ADR 0302) يعودُ
  -- الحارسُ فارغَ الأسبابِ فيمرُّ القرارُ — وإن أعادَتِ الإدارةُ الإلزامَ عادَ.
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

  -- السببُ المكتوبُ: إلزاميٌّ للرفضِ، واختياريٌّ للتعليقِ، ومحوٌ عندَ التوثيقِ
  -- والعودةِ إلى المراجعةِ (قرارٌ بلا سببٍ معروضٍ للسائقِ يُعرَفُ فقط من الرافضِ).
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if length(coalesce(v_note, '')) > 500 then
    v_note := left(v_note, 500);
  end if;
  if p_status = 'rejected' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;
  if p_status in ('verified', 'pending') then
    v_note := null;
  end if;

  if v_driver.verification_status::text = p_status
     and v_driver.verification_note is not distinct from v_note then
    return jsonb_build_object('ok', true, 'changed', false, 'status', p_status);
  end if;

  update drivers
     set verification_status = p_status::verification_status,
         verification_note   = v_note
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
          jsonb_build_object('from', v_driver.verification_status, 'to', p_status,
                             'note', v_note));

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

comment on function admin_set_driver_verification(uuid, uuid, text, text) is
  'تعيينُ حالةِ توثيقِ سائقٍ معَ سببٍ مكتوبٍ يُعرَضُ للسائقِ — حارسُ F12-21 يمنعُ verified ما دامتْ وثائقُ مدينتِهِ تُلزِمُهُ بما لم يستوفِهِ. بدءُ التجربةِ تلقائيًّا (PD-040). الرفضُ بلا سببٍ يُردُّ NOTE_REQUIRED.';

-- التحميلُ الجديدُ (4 وسائط) وُلدَ بالصلاحيةِ الافتراضيّةِ (EXECUTE لـPUBLIC)
-- ولم يرثْ سحبَ التحميلِ القديمِ — يُسحَبُ صريحةً كما فعلتِ هجرةُ phase_2_7
-- (وإلا كشفَها حاجزُ الفحصِ الهجومي: anon لا ينفذُ دالةً مملوكةً).
revoke all on function admin_set_driver_verification(uuid, uuid, text, text)
  from public, anon, authenticated;

-- لوحُ وثائقِ السائقِ ينشرُ السببَ والأنواعَ الإلزاميّةَ المعلنةَ (لعرضِ
-- «لا وثائقَ مطلوبةً» بصدقٍ لا لاجترارِ رفْعٍ لا يُطلَبُ).
create or replace function driver_document_dashboard(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_warning integer;
  v_rows jsonb;
  v_reasons text[];
  v_required driver_document_type[];
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_warning := coalesce(
    get_setting_number(v_driver.city_id, 'driver_document_expiry_warning_days')::integer, 30);

  v_required := driver_required_document_types(v_driver.city_id);

  select coalesce(jsonb_agg(row order by ord), '[]'::jsonb)
    into v_rows
    from (
      select t.ord,
             jsonb_build_object(
               'doc_type', t.doc_type,
               'submitted', d.id is not null,
               -- الغيابُ **ليسَ حالةً مكتوبةً**: `status` يبقى `null` ولا
               -- يُختَرَعُ له `'not_submitted'` فيصيرَ قيمةً سادسةً في نوعٍ
               -- معدودٍ لا تعرفُها القاعدةُ.
               'status', d.status,
               'expires_at', d.expires_at,
               'days_left', case when d.expires_at is null then null
                                 else (d.expires_at - current_date) end,
               'expires_soon', case
                 when d.expires_at is null or d.status <> 'accepted' then false
                 else d.expires_at - current_date between 0 and v_warning end,
               'review_note', d.review_note,
               'submitted_at', d.submitted_at,
               'reviewed_at', d.reviewed_at
             ) as row
        from (
          select doc_type, row_number() over () as ord
            from unnest(v_required) as u(doc_type)
        ) as t
        left join driver_documents d
               on d.driver_id = v_driver.id and d.doc_type = t.doc_type
    ) as built;

  v_reasons := driver_document_block_reasons(v_driver.id);

  return jsonb_build_object(
    'ok', true,
    'verification_status', v_driver.verification_status,
    'verification_note', v_driver.verification_note,
    'warning_days', v_warning,
    'required_document_types', to_jsonb(v_required),
    'documents', v_rows,
    'block_reasons', to_jsonb(v_reasons),
    -- **الحجبُ جوابٌ واحدٌ**: البوّابةُ لا تُعيدُ حسابَه من الصفوفِ.
    'is_blocked', array_length(v_reasons, 1) is not null
  );
end;
$$;

comment on function driver_document_dashboard(bigint) is
  'لوحُ وثائقِ السائقِ — ينشرُ حالةَ التوثيقِ وسببَهُ والأنواعَ الإلزاميّةَ المعلنةَ (فارغةٌ = لا وثيقةَ مطلوبةً) والصفوفِ وأسبابَ الحجبِ. لا رابطَ ولا بايتاتٍ ههنا.';

-- لوحُ عروضِ السائقِ ينشرُ السببَ كي يراهُ المرفوضُ في أوّلِ شاشةٍ يفتحُها.
create or replace function driver_offer_board(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_availability driver_availability%rowtype;
  v_reasons text[];
  v_offers jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_availability from driver_availability where driver_id = v_driver.id;

  v_reasons := driver_document_dispatch_block_reasons(v_driver.id);

  select coalesce(jsonb_agg(entry order by expires_at), '[]'::jsonb)
    into v_offers
    from (
      select o.expires_at,
             jsonb_build_object(
               'offer_id', o.id,
               'order_id', o.order_id,
               'round', o.round,
               'service', r.service,
               -- **ولا تُنشَرُ لحظةُ الانتهاءِ نفسُها**: قيمةٌ مُطلقةٌ في الحمولةِ
               -- دعوةٌ إلى مقارنتِها بساعةِ الجهازِ، وساعةُ هاتفٍ منحرفةٌ دقيقةً
               -- تُخفي عرضاً صالحاً أو تُبقي منتهياً. فالباقي وحدَه يُنشَرُ
               -- ولحظةُ الخادمِ معَه، فيكونُ العدُّ فرقاً لا مقارنةً.
               -- الباقي بساعةِ القاعدةِ، ولا سالبَ يُنشَرُ: صفرٌ يعني «انتهَت».
               'seconds_left',
               greatest(0, floor(extract(epoch from (o.expires_at - v_now)))::integer),
               -- المسافةُ **موسومةٌ في نوعِها** لا رقمٌ عارياً (`ADR 0024`):
               -- نسبةُ الانعراجِ المقيسةُ هناكَ تجعلُ رقماً بلا وسمٍ كذباً.
               'rider_distance', case
                 when o.distance_km is null then null
                 else jsonb_build_object(
                        'kind', 'STRAIGHT_LINE',
                        'meters', round(o.distance_km * 1000, 1))
               end,
               'trip_distance', case
                 when r.dropoff is null then null
                 else jsonb_build_object(
                        'kind', 'STRAIGHT_LINE',
                        'meters', round(st_distance(r.pickup, r.dropoff)::numeric, 1))
               end,
               'pickup_label', r.pickup_label,
               'dropoff_label', r.dropoff_label
             ) as entry
        from order_offers o
        join orders r on r.id = o.order_id
       where o.driver_id = v_driver.id
         and o.status = 'pending'
         and o.expires_at > v_now
         -- طلبٌ خرجَ من البحثِ لا يُعرَضُ ولو بقيَ صفُّ عرضِهِ معلَّقاً.
         and r.status = 'searching'
    ) as built;

  return jsonb_build_object(
    'ok', true,
    -- **زمنُ الخادمِ يُنشَرُ صريحاً**: بغيرِه لا يقدرُ العميلُ أن يعرفَ فرقَ
    -- ساعتِه، فيصيرُ عدُّه التنازليُّ زينةً.
    'server_time', v_now,
    'is_available', coalesce(v_availability.is_available, false),
    'availability_changed_at', v_availability.changed_at,
    'verification_status', v_driver.verification_status,
    'verification_note', v_driver.verification_note,
    'block_reasons', to_jsonb(v_reasons),
    'is_blocked', array_length(v_reasons, 1) is not null,
    'offers', v_offers
  );
end;
$$;

comment on function driver_offer_board(bigint) is
  'لوحُ عروضِ السائقِ: العروضُ المعلَّقةُ غيرُ المنتهيةِ بمؤقّتٍ من ساعةِ القاعدةِ ومسافاتٍ موسومةٍ، ومعَها حالةُ التوفُّرِ وأسبابُ الحجبِ وسببُ قرارِ التوثيقِ (SD-03 · ADR 0302).';
