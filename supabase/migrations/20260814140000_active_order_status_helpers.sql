-- =============================================================================
-- الغرض: إصلاحٌ وقائيّ لجذر العيب الذي أصلحته الترحيلة 20260814120000: أسماءُ
--   حالات الطلب كانت مكتوبةً نصّاً داخل كلّ دالّة تحتاجها، فحين حُرّر النوع
--   `order_status` لم يُحرَّر معه إلا بعضُ المواضع — وبقيت `update_driver_city`
--   و`update_rider_city` تقارنان بأسماءٍ لا وجود لها فتُخفقان بـ22P02 دائماً.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (الادعاء 2.2 من تقرير المراجعة).
-- ينتمي إلى: supabase/migrations
--
-- ## القرار: تعريفٌ واحد لمعنى «الطلبُ قائم»
--
-- دالّتان قصيرتان `immutable` تحملان المعنى، وكلُّ من يسأل يسألهما لا يُعيد كتابة
-- القائمة. والمكسبُ ليس جمالاً في الكود: هو أنّ موضعَ التحرير صار **واحداً**.
--
-- ولماذا معنيان لا معنى واحد؟ لأنّ «القائم» للسائق ليس «القائم» للراكب:
--   • الراكب: البحثُ عن سائق طلبٌ قائم — نقلُ مدينته وطلبُه يبحث يترك طلباً
--     يُوزَّع في مدينةٍ ما عاد فيها.
--   • السائق: البحثُ لا يخصّه — لم يُسند إليه شيءٌ بعد، فمنعُه من تغيير مدينته
--     لأجل طلبٍ يبحث عن غيره حجرٌ بلا سبب.
-- ودالّةٌ واحدة بمعاملٍ منطقيّ («احسب البحث أم لا») كانت ستُخفي هذا الفرق خلف
-- `true`/`false` في موضع النداء — أي تُعيد الغموضَ الذي جاءت لتزيله.
--
-- ## الحرس: النوعُ لا يتوسّع في صمت
--
-- الدالّتان تُعدّدان الحالات، فحالةٌ جديدة في `order_status` لن تُخفق فيهما —
-- ستُصنَّف «منتهية» ضمناً وهذا قد يكون خطأً صامتاً. فيُثبَّت بعدهما تأكيدٌ يقارن
-- مجموعةَ تسميات النوع بالمجموعة المعروفة، ويرمي استثناءً إن اختلفت: من أضاف
-- حالةً جديدة سيسقط ترحيلُه هنا فيقرأ الرسالة ويقرّر — لا أن يكتشف الأثر في
-- الإنتاج بسائقٍ غيّر مدينته وهو في رحلة.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) المعنى
-- ---------------------------------------------------------------------------

create or replace function is_active_order_status(p_status order_status)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  -- طلبٌ لمّا يُنتهِ منه: يبحث، أو أُسند، أو جارٍ. والمنتهي: completed/cancelled/failed.
  select p_status in ('searching', 'matched', 'in_progress');
$$;

create or replace function is_driver_engaged_order_status(p_status order_status)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  -- ما التزم به سائقٌ بعينه ولمّا يُكمله. البحثُ خارجَه: لا سائق فيه بعد.
  select p_status in ('matched', 'in_progress');
$$;

comment on function is_active_order_status(order_status) is
  'هل الطلب قائم (يبحث/أُسند/جارٍ)؟ المصدر الوحيد لهذا المعنى — لا تُكتب القائمة نصّاً في مكان آخر.';
comment on function is_driver_engaged_order_status(order_status) is
  'هل الطلب التزامٌ قائم على سائق بعينه (أُسند/جارٍ)؟ البحث خارجه: لا سائق فيه بعد.';

-- ---------------------------------------------------------------------------
-- ٢) الحرس: تسميات order_status كما تعرفها الدالّتان
-- ---------------------------------------------------------------------------

do $$
declare
  v_known text[] := array['searching', 'matched', 'in_progress', 'completed', 'cancelled', 'failed'];
  v_actual text[];
begin
  select array_agg(e.enumlabel::text order by e.enumsortorder)
    into v_actual
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'order_status';

  if v_actual is null then
    raise exception 'النوع order_status غير موجود — لا يمكن التحقق من دالّات حالة الطلب';
  end if;

  -- المقارنة بالمحتوى لا بالترتيب: إضافةُ حالةٍ في وسط النوع تغيّر الترتيب بلا
  -- أن تغيّر المعنى، ورفضُها لذلك وحده إزعاجٌ بلا فائدة.
  if not (v_actual <@ v_known and v_known <@ v_actual) then
    raise exception using
      message = 'تسميات order_status تغيّرت: ' || array_to_string(v_actual, ', '),
      hint = 'حدّث is_active_order_status و is_driver_engaged_order_status وقائمة v_known في هذه الترحيلة قبل المتابعة — الحالة الجديدة تُعدّ «منتهية» ضمناً وهذا قد يكون خطأً صامتاً.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٣) إعادة كتابة الدالّتين على المعنى لا على النصّ
-- ---------------------------------------------------------------------------
--
-- ما تغيّر: شرطُ `status in (...)` صار نداءً للدالّة. وما لم يتغيّر: كلُّ شيءٍ
-- آخر — القفلُ والتحقّقُ من المدينة وسجلُّ التغيير والقيمُ المُعادة، فسلوكُ
-- الدالّتين وعقدُهما مع التطبيق كما هو، واختباراتُهما القائمة تُثبته.

create or replace function update_driver_city(
  p_driver_id uuid,
  p_new_city_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver record;
  v_active_city_count integer;
  v_active_order_count integer;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select count(*) into v_active_city_count
    from cities where id = p_new_city_id and is_active = true;
  if v_active_city_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  if v_driver.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- رحلةٌ قائمة للسائق: ما أُسند إليه ولمّا يُكمَل أو يُلغَ.
  select count(*) into v_active_order_count
    from orders
   where assigned_driver_id = p_driver_id
     and is_driver_engaged_order_status(status);
  if v_active_order_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  update drivers set city_id = p_new_city_id, updated_at = now()
   where id = p_driver_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  select p_new_city_id, v_driver.user_id, 'driver.city_changed', 'driver', p_driver_id,
         jsonb_build_object('old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);
end;
$$;

create or replace function update_rider_city(
  p_rider_id uuid,
  p_new_city_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider record;
  v_active_city_count integer;
  v_active_order_count integer;
begin
  select * into v_rider from riders where id = p_rider_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_FOUND');
  end if;

  select count(*) into v_active_city_count
    from cities where id = p_new_city_id and is_active = true;
  if v_active_city_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  if v_rider.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- طلبٌ قائم للراكب: البحثُ عن سائق طلبٌ قائم أيضاً.
  select count(*) into v_active_order_count
    from orders
   where rider_id = p_rider_id
     and is_active_order_status(status);
  if v_active_order_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  update riders set city_id = p_new_city_id, updated_at = now()
   where id = p_rider_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  select p_new_city_id, v_rider.user_id, 'rider.city_changed', 'rider', p_rider_id,
         jsonb_build_object('old_city_id', v_rider.city_id, 'new_city_id', p_new_city_id);

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_rider.city_id, 'new_city_id', p_new_city_id);
end;
$$;

comment on function update_driver_city is
  'يغيّر مدينة السائق ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا رحلة قائمة له (المعنى من is_driver_engaged_order_status)';
comment on function update_rider_city is
  'يغيّر مدينة الراكب ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا طلب قائم له (المعنى من is_active_order_status)';

-- ---------------------------------------------------------------------------
-- ٤) سطحُ الصلاحيات
-- ---------------------------------------------------------------------------
--
-- `create or replace` يعيد كلَّ دالّة مفتوحةً لـPUBLIC، فتُسحب صراحةً. ودالّتا
-- المعنى لا تُمنحان لـservice_role: لا يُنادَيان من التطبيق بل من داخل القاعدة،
-- والمنحُ بلا حاجةٍ توسيعُ سطحٍ بلا مقابل.

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'update_driver_city(uuid, uuid)',
    'update_rider_city(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;

  foreach v_sig in array array[
    'is_active_order_status(order_status)',
    'is_driver_engaged_order_status(order_status)'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon, authenticated', v_sig);
  end loop;
end $$;
