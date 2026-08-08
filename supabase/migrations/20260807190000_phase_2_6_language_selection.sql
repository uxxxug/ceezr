-- =====================================================================================
-- المرحلة 2.6 — اختيار اللغة أساساً للترجمة المتبادلة
--
-- الترجمة بلا لغة معلومة لكل طرف ترجمةٌ إلى العدم. وقبل هذه الهجرة كانت اللغة
-- تُلتقط مرّة واحدة من تلميح تيليجرام عند التسجيل ثم لا يملك المستخدم تغييرها.
-- هذا يكفي لمن جهازه بلغته، ولا يكفي لسائق باكستاني يعمل بهاتف عربي الإعداد.
--
-- ما تضيفه:
--   1) set_user_language: كتابة ذرّية للغة مع قيد على اللغات المدعومة فعلاً
--   2) get_user_language: قراءة اللغة بلا تسريب بقية صفّ المستخدم
--   3) قيد قاعدة على language_code — اللغة المدعومة تُحرَس هنا لا في التطبيق وحده
--
-- ما لا تضيفه عمداً: جدول ترجمات مخزَّنة. ذاكرة الترجمة المؤقتة تعيش في العملية
-- ثم في Redis (القسم 5)، لأن ترجمة رسالة تفاوض عابرة لا تستحق صفّاً دائماً.
-- =====================================================================================

-- 1) قيد اللغات المدعومة -------------------------------------------------------------
-- القائمة هنا ليست قيمة تجارية بل عقد بين القاعدة وملفّات packages/shared/i18n.
-- توسيعها يتطلّب ملفّ قاموس جديداً، فبقاؤها في هجرة صريحة أصدق من إعداد قابل للتغيير
-- من لوحة الإدارة إلى لغة لا قاموس لها.
do $$ begin
  alter table users
    add constraint users_language_supported
    check (language_code in ('ar', 'en', 'ur'));
exception when duplicate_object then null; end $$;

-- 2) قراءة اللغة ---------------------------------------------------------------------
create or replace function get_user_language(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'language_code', v_user.language_code,
    'role', v_user.role
  );
end;
$$;

-- 3) كتابة اللغة ---------------------------------------------------------------------
-- الكتابة ذرّية ومسجَّلة في audit_log: تغيير اللغة يغيّر كل ما يصل المستخدم بعدها،
-- فإن اشتكى أنه لا يفهم رسائله وجب أن نعرف متى تغيّرت لغته وبأي قيمة.
create or replace function set_user_language(
  p_telegram_id bigint,
  p_language text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     users%rowtype;
  v_previous text;
begin
  if p_language is null or p_language not in ('ar', 'en', 'ur') then
    return jsonb_build_object('ok', false, 'error', 'LANGUAGE_NOT_SUPPORTED');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  v_previous := v_user.language_code;

  -- الاختيار نفسه ليس خطأً ولا كتابةً: يُعاد نجاحاً مع changed = false حتى
  -- لا يمتلئ سجلّ التدقيق بضغطات زرّ لا تغيّر شيئاً.
  if v_previous = p_language then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'language_code', v_previous,
      'previous_language', v_previous
    );
  end if;

  update users
     set language_code = p_language
   where id = v_user.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_user.city_id,
    v_user.id,
    'user.language_changed',
    'user',
    v_user.id,
    jsonb_build_object('from', v_previous, 'to', p_language)
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'language_code', p_language,
    'previous_language', v_previous
  );
end;
$$;

-- 4) لغتا طرفَي طلب — تُقرأ بنداء واحد لأن قرار الترجمة يحتاج الاثنتين معاً ------------
create or replace function get_order_languages(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_driver   drivers%rowtype;
  v_driver_u users%rowtype;
  v_rider    riders%rowtype;
  v_rider_u  users%rowtype;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  if v_order.assigned_driver_id is null then
    return jsonb_build_object(
      'ok', true,
      'rider_language', v_rider_u.language_code,
      'driver_language', null
    );
  end if;

  select * into v_driver from drivers where id = v_order.assigned_driver_id;
  select * into v_driver_u from users where id = v_driver.user_id;

  return jsonb_build_object(
    'ok', true,
    'rider_language', v_rider_u.language_code,
    'driver_language', v_driver_u.language_code,
    'rider_telegram_id', v_rider_u.telegram_id,
    'driver_telegram_id', v_driver_u.telegram_id
  );
end;
$$;
