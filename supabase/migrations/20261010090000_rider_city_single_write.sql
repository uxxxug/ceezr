-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- مدينةُ الراكب بكتابةٍ واحدةٍ متّسقة — إغلاقُ الدَّينِ المسجَّلِ في ADR 0252 (ADR 0255)
--
-- الغرض: مسارُ البوت لتغييرِ مدينةِ الراكب (`rider-dialog` · `awaiting_city_change`
--   → `update_rider_city`) كانَ يكتبُ `riders.city_id` وحدَه، بينما `request_ride()`
--   تقرأُ المدينةَ من `users.city_id` (القاعدة 0.4). فالراكبُ الذي ينتقلُ من البوتِ
--   يقرأُ «تمَّ تغييرُ المدينة» ثمَّ يُحكَمُ طلبُه بالمدينةِ القديمة.
--
-- ## مصدرُ الحقيقة
--
-- `users.city_id` هوَ ما يحكمُ الطلبَ (`request_ride`) والاقتباسَ (`quote_ride`)
-- والمدينةَ التشغيليّةَ في التطبيقِ المصغَّر (`locate_rider_operating_city`)؛ و
-- `riders.city_id` نسخةٌ يجبُ أن تطابقَه. فالدالّةُ تكتبُ الاثنين في معاملةٍ واحدة،
-- كما تفعلُ `locate_rider_operating_city` تماماً.
--
-- ## الحراسات (لا تتغيّرُ ولا تُخفَّف)
--
-- - قفلُ صفِّ المستخدمِ **أوّلاً** ثمَّ صفِّ الراكب: الترتيبُ نفسُه في
--   `locate_rider_operating_city`، فلا تعارضَ قفلٍ بينهما، ويُسلسَلُ معَ إنشاءِ الطلب.
-- - `NOT_A_RIDER`: صفُّ مستخدمٍ دورُه غيرُ `rider` لا تُمَسُّ مدينتُه (لا سائقَ ولا مشرف).
-- - `CITY_NOT_FOUND_OR_INACTIVE`: المدينةُ المفعَّلةُ وحدَها.
-- - `ACTIVE_ORDER_IN_PROGRESS`: رحلةٌ قائمة (`is_active_order_status`) تمنعُ التغيير؛
--   و`orders.city_id` لا يُمَسُّ أبداً، فلا تتغيّرُ مدينةُ رحلةٍ بأثرٍ رجعيّ.
-- - «نفسُ المدينة» لا يُحكَمُ إلّا إذا تطابقَ السجلّان معَ الهدف؛ وإلّا يُكتَبُ الهدفُ
--   في الاثنين (يُصلِحُ أيَّ تباعدٍ سابق). قيسَ على الإنتاجِ قبلَ الهجرة: 0 تباعد.
-- - سجلُّ التدقيق `rider.city_changed` كما كانَ، معَ مدينتَي السجلَّين قبلَ التغيير.
--
-- التوقيعُ ورموزُ الردِّ كما هي (`ok` · `already_same` · `old_city_id` · `new_city_id`
-- · `error`)، والرمزُ الجديدُ `NOT_A_RIDER` يقرؤه البوتُ فشلاً عامّاً موجوداً.
--
-- مسارُ العودة: إعادةُ تعريفِ الدالّة من `20260814140000_active_order_status_helpers.sql`.
-- ────────────────────────────────────────────────────────────────────────────

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
  v_user_id   uuid;
  v_user      record;
  v_rider     record;
  v_old_city  uuid;
begin
  select r.user_id into v_user_id from riders r where r.id = p_rider_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_FOUND');
  end if;

  -- صفُّ المستخدمِ أوّلاً (ترتيبُ `locate_rider_operating_city`)، ثمَّ صفُّ الراكب.
  select u.id, u.city_id, u.role into v_user from users u where u.id = v_user_id for update;
  select r.id, r.city_id, r.user_id into v_rider from riders r where r.id = p_rider_id for update;
  if v_rider.id is null or v_rider.user_id is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_FOUND');
  end if;

  if v_user.role <> 'rider' then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_RIDER');
  end if;

  if not exists (select 1 from cities c where c.id = p_new_city_id and c.is_active) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  if v_user.city_id = p_new_city_id and v_rider.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- رحلةٌ قائمةٌ للراكب (البحثُ عن سائقٍ قائمٌ أيضاً): لا تغيير.
  if exists (
    select 1 from orders o
     where o.rider_id = p_rider_id
       and is_active_order_status(o.status)
  ) then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  v_old_city := coalesce(v_user.city_id, v_rider.city_id);

  update users set city_id = p_new_city_id where id = v_user.id;
  update riders set city_id = p_new_city_id, updated_at = now() where id = p_rider_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    p_new_city_id, v_user.id, 'rider.city_changed', 'rider', p_rider_id,
    jsonb_build_object(
      'old_city_id', v_old_city,
      'new_city_id', p_new_city_id,
      'old_user_city_id', v_user.city_id,
      'old_rider_city_id', v_rider.city_id,
      'source', 'bot_city_change'
    )
  );

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_old_city, 'new_city_id', p_new_city_id);
end;
$$;

comment on function update_rider_city is
  'يغيّر مدينة الراكب ذرّياً في users.city_id وriders.city_id معاً — مدينةٌ مفعّلة، دورُ rider، ولا طلب قائم (ADR 0255)';

revoke execute on function update_rider_city(uuid, uuid) from public, anon, authenticated;
grant execute on function update_rider_city(uuid, uuid) to service_role;
