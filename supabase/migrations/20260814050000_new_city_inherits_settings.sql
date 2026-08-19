-- =============================================================================
-- الغرض: مدينةٌ تُضاف إلى `cities` تُبذَر إعداداتُها من مدينةٍ قائمة في اللحظة
--   نفسها، ولا تُفعَّل مدينةٌ ناقصةُ الإعدادات.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: كلُّ إضافةِ مدينةٍ بعد اليوم — بترحيلةٍ أو بغيرها.
--
-- ## العلّة
--
-- البذرُ اليدويّ داخل كلّ ترحيلةِ مدينة (نسخُ مفاتيح جدة) عمل ما دام أحدٌ يتذكّره.
-- لكنّ `insert into cities` وحده — من اللوحة، أو من سكربتٍ تشغيليّ، أو من ترحيلةٍ
-- كتبها من لم يقرأ ترحيلةَ المدن السابقة — يُنشئ مدينةً بصفرِ إعدادات. ونتيجتُها
-- ليست عطلاً صريحاً بل سلسلةُ رفضٍ صامت: `claim_broadcast_recipients` تردّ
-- `BROADCAST_BATCH_SETTING_MISSING`، وإشعاراتُ الاشتراك تردّ
-- `NOTICE_BATCH_SETTING_MISSING`، والتسعيرُ لا يجد سعراً. مدينةٌ موجودةٌ في
-- الجدول ولا تعمل، ولا شيء في القاعدة يقول لماذا.
--
-- ## القرار
--
-- البذرُ من مدينةٍ قائمة لا من جدولِ افتراضاتٍ عالميّ: البند 0.4 يفرض `city_id`
-- على كلّ صفّ، وجدولٌ بلا مدينةٍ خرقٌ له. والنسخُ من مدينةٍ عاملة يضمن أنّ كلَّ
-- مفتاحٍ أضافته ترحيلةٌ لاحقة يصل المدينةَ الجديدة تلقائياً، فلا كتالوجَ ثانٍ
-- ينزلق عن الحقيقة.
--
-- وكلُّ قيمةٍ منسوخة تُرفع لها صفةُ «مبدئية» ولو كانت محسومةً في مصدرها: السعرُ
-- الذي راجعه فريقُ جدة ليس سعرَ الطائف، وعرضُه في اللوحة محسوماً يعني أنّ أحداً
-- لن ينظر إليه.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) البذر
-- ---------------------------------------------------------------------------

create or replace function seed_city_settings(
  p_city_id uuid,
  p_template_city_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_seeded integer;
begin
  if p_city_id is null or not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  if p_template_city_id is not null then
    if p_template_city_id = p_city_id then
      return jsonb_build_object('ok', false, 'error', 'TEMPLATE_IS_TARGET');
    end if;
    if not exists (select 1 from platform_settings where city_id = p_template_city_id) then
      return jsonb_build_object('ok', false, 'error', 'TEMPLATE_HAS_NO_SETTINGS');
    end if;
    v_template := p_template_city_id;
  else
    -- أقدمُ مدينةٍ لها إعدادات: اختيارٌ حاسمٌ لا عشوائيّ، فبذرُ مدينتين في
    -- يومٍ واحد يُنتج نفسَ الأصل لا أصلَين مختلفَين.
    select c.id into v_template
      from cities c
     where c.id <> p_city_id
       and exists (select 1 from platform_settings p where p.city_id = c.id)
     order by c.created_at, c.code
     limit 1;
  end if;

  -- أوّلُ مدينةٍ في قاعدةٍ فارغة لا أصلَ لها، وهذه ليست حالةَ خطأ: ترحيلةُ
  -- البذرِ الأولى هي التي تُنشئ المفاتيح، والمُنبِّه يمرّ بلا عمل.
  if v_template is null then
    return jsonb_build_object('ok', true, 'seeded', 0, 'template', null);
  end if;

  with copied as (
    insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
    select p_city_id, s.key, s.value, s.value_type, s.description_ar, true
      from platform_settings s
     where s.city_id = v_template
    on conflict (city_id, key) do nothing
    returning 1
  )
  select count(*) into v_seeded from copied;

  return jsonb_build_object('ok', true, 'seeded', v_seeded, 'template', v_template);
end;
$$;

revoke all on function seed_city_settings(uuid, uuid) from public;
grant execute on function seed_city_settings(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ٢) المُنبِّه: البذرُ لحظةَ الإنشاء لا خطوةً يتذكّرها أحد
-- ---------------------------------------------------------------------------

create or replace function cities_seed_settings_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_city_settings(new.id);
  return null;
end;
$$;

-- دالّةُ المُنبِّه تُنزع من `public` كبقيّة دوالّنا: المُنبِّه يستدعيها بصلاحيّة
-- مالكِها، فلا حاجةَ لأن يقدر عليها دورٌ مجهول.
revoke all on function cities_seed_settings_after_insert() from public;

drop trigger if exists cities_seed_settings on cities;
create trigger cities_seed_settings
  after insert on cities
  for each row execute function cities_seed_settings_after_insert();

-- ---------------------------------------------------------------------------
-- ٣) لا تُفعَّل مدينةٌ ينقصها مفتاح
-- ---------------------------------------------------------------------------
-- `cities_active_requires_groups` يمنع التفعيلَ بلا قروبات، وهذا يمنعه بلا
-- إعدادات: مدينةٌ مفعَّلةٌ ناقصةُ مفتاحٍ تظهر للركّاب ثمّ ترفض كلَّ طلبٍ برمزٍ
-- داخليّ. والفحصُ مقصورٌ على لحظةِ التفعيل: مدينةٌ مطفأةٌ ناقصةٌ حالةٌ مشروعة
-- تُملأ على مهل.

create or replace function cities_require_complete_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
begin
  if not new.is_active or coalesce(old.is_active, false) then
    return new;
  end if;

  -- المفاتيحُ التي تعرفها مدينةٌ أخرى ولا تعرفها هذه: مصدرُ الحقيقة هو ما
  -- تعمل به المدنُ القائمة، لا قائمةٌ مكتوبةٌ هنا تُنسى عند إضافة مفتاح.
  select array_agg(distinct s.key order by s.key) into v_missing
    from platform_settings s
   where s.city_id <> new.id
     and not exists (
       select 1 from platform_settings t
        where t.city_id = new.id and t.key = s.key
     );

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'CITY_SETTINGS_INCOMPLETE: %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function cities_require_complete_settings() from public;

drop trigger if exists cities_require_complete_settings on cities;
create trigger cities_require_complete_settings
  before update of is_active on cities
  for each row execute function cities_require_complete_settings();

-- ---------------------------------------------------------------------------
-- ٤) ترميمُ ما مضى: كلُّ مدينةٍ قائمة تُكمَل من أخواتها
-- ---------------------------------------------------------------------------
-- لا أثرَ لها اليوم — المدنُ الخمس متساويةُ المفاتيح — لكنّ الترحيلةَ تُطبَّق على
-- قواعدَ لا نراها، وصمتُها عند التساوي هو الدليل لا الافتراض.

do $$
declare
  v_city uuid;
begin
  for v_city in select id from cities order by created_at, code loop
    perform seed_city_settings(v_city);
  end loop;
end $$;
