-- الغرض: تعديلُ إعدادٍ من اللوحة يقبل ما يكتبه المسؤول بلغته لا بلغةِ JSON.
-- الحالة: مُطبَّقة.
-- ينتمي إلى: لوحة الإدارة — إعدادات المدينة (`platform_settings`).
-- يُتوقع أن يستخدمه لاحقاً: كلُّ مسارٍ يعدّل إعداداً نصّياً أو منطقيّاً أو قائمة.
--
-- المشكلة: `admin_update_setting` كان يستقبل `jsonb`، والمسارُ يحوّل نصَّ النموذج
-- بـ`::text::jsonb`. فمن كتب رابطَ قروبٍ عادياً — وهو أوّلُ ما يُملأ في مدينةٍ
-- جديدة: `unsubscribed_drivers_group_link` — استقبله PostgreSQL كـJSON فاسد،
-- فارتفع استثناءٌ وردّت البوابةُ 500 بلا بيان. ولا سبيلَ للنجاح إلّا أن يعرف
-- المسؤولُ أن عليه إحاطةُ النصِّ بعلامتَي تنصيص. إعدادٌ لا يمكن ضبطه من اللوحة
-- إعدادٌ غيرُ موجود.
--
-- الحلّ: الدالةُ تستقبل نصّاً وتُحوّله بحسب `value_type` المعلَن في الصفّ نفسه،
-- فمصدرُ الحقيقة في النوع هو الجدول لا صيغةُ ما كُتب. والخطأُ يعود رمزاً مفهوماً
-- (`INVALID_NUMBER` / `INVALID_BOOLEAN` / `INVALID_ARRAY`) لا استثناءً مكتوماً.

-- التوقيعُ القديم يُحذف: بقاؤه يعني مسارَين للكتابة، وأحدهما يُسقط الطلب.
drop function if exists admin_update_setting(uuid, uuid, text, jsonb);

create or replace function admin_update_setting(
  p_actor_user_id uuid,
  p_city_id       uuid,
  p_key           text,
  p_value         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   users%rowtype;
  v_setting platform_settings%rowtype;
  v_raw     text;
  v_value   jsonb;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_value is null then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_VALUE');
  end if;

  select * into v_setting
  from platform_settings
  where city_id = p_city_id and key = p_key
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SETTING_NOT_FOUND');
  end if;

  v_raw := btrim(p_value);

  -- النصُّ يُؤخذ كما هو بعد تقليم الفراغ: لا تفسيرَ ولا اقتباسَ يفرضه المسؤول.
  -- ومن أحاطه بتنصيصٍ لأنّه رأى القيمةَ معروضةً كذلك في اللوحة نُزيلها عنه.
  if v_setting.value_type = 'string' then
    if v_raw ~ '^".*"$' and jsonb_typeof(v_raw::jsonb) = 'string' then
      v_value := v_raw::jsonb;
    else
      v_value := to_jsonb(v_raw);
    end if;

  elsif v_setting.value_type = 'number' then
    if v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_NUMBER', 'received', v_raw);
    end if;
    v_value := to_jsonb(v_raw::numeric);

  elsif v_setting.value_type = 'boolean' then
    if lower(v_raw) in ('true', '1', 'نعم') then
      v_value := to_jsonb(true);
    elsif lower(v_raw) in ('false', '0', 'لا') then
      v_value := to_jsonb(false);
    else
      return jsonb_build_object('ok', false, 'error', 'INVALID_BOOLEAN', 'received', v_raw);
    end if;

  else
    -- القائمةُ تُكتب JSON: لا صيغةَ أبسطَ تحفظ عناصرَ فيها فواصلُ أو مسافات.
    begin
      v_value := v_raw::jsonb;
    exception
      when others then
        return jsonb_build_object('ok', false, 'error', 'INVALID_ARRAY', 'received', v_raw);
    end;
    if jsonb_typeof(v_value) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_ARRAY', 'received', v_raw);
    end if;
  end if;

  if v_setting.value = v_value then
    return jsonb_build_object('ok', true, 'changed', false, 'value', v_setting.value);
  end if;

  update platform_settings
     set value = v_value,
         -- قيمة راجعها مسؤول ووافق عليها لم تعد مبدئية بانتظار مراجعة
         is_provisional = false
   where id = v_setting.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (p_city_id, v_actor.id, 'admin.setting_updated', 'platform_setting', v_setting.id,
          jsonb_build_object('key', p_key, 'from', v_setting.value, 'to', v_value));

  return jsonb_build_object('ok', true, 'changed', true, 'value', v_value);
end;
$$;

revoke all on function admin_update_setting(uuid, uuid, text, text) from public;
grant execute on function admin_update_setting(uuid, uuid, text, text) to service_role;
