-- F4-05: إضافة driver_id و city_id إلى get_tracking_position
--
-- الغرض: صفحة التتبّع العامّة (SS-06) تحتاج معرّفَ السائقِ والمدينةِ لقراءةِ
-- الحالةِ الساخنةِ من Redis بدلَ قراءةِ القاعدةِ كلَّ خمسِ ثوانٍ.
-- والقاعدةُ تُعيدُ الآنَ هذين الحقلَينِ معَ الحمولةِ الحاليّةِ، ولا تُغيِّرُ
-- شيئاً في القراءةِ نفسِها — الإحداثيّةُ والطابعُ والحكمُ كما كانَت.
--
-- ولا خطرَ على الخصوصيّةِ: المعرّفاتُ تُعادُ للبوابةِ الداخليّةِ لا للعميلِ،
-- وحمولةُ الصفحةِ العامةِ لا تحملُ هويّةً (حاجزُ check-ride-share-contract).

create or replace function get_tracking_position(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select t.order_id,
         t.city_id,
         o.status,
         o.assigned_driver_id,
         d.last_location,
         d.last_location_at
    into v_row
    from trip_tracking_tokens t
    join orders o on o.id = t.order_id
    left join drivers d on d.id = o.assigned_driver_id
   where t.token = p_token
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_NOT_FOUND');
  end if;

  if v_row.last_location is null or v_row.last_location_at is null then
    return jsonb_build_object(
      'ok', true,
      'has_position', false,
      'active', is_active_order_status(v_row.status),
      'driver_id', v_row.assigned_driver_id,
      'city_id', v_row.city_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'has_position', true,
    'lat', st_y(v_row.last_location::geometry),
    'lng', st_x(v_row.last_location::geometry),
    'updated_at', v_row.last_location_at,
    'active', is_active_order_status(v_row.status),
    'driver_id', v_row.assigned_driver_id,
    'city_id', v_row.city_id
  );
end;
$$;

comment on function get_tracking_position(text) is
  'موقعُ سائقِ الطلب بالرمز — بلا أيّ هويّة، وسببٌ واحد لكلّ فشل. تُنادى بلا مصادقة عبر البوابة (§4.2). F4-05: أُضيفَ driver_id و city_id لقراءةِ الحالةِ الساخنةِ.';
