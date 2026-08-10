-- ----------------------------------------------------------------------------
-- الغرض: سدّ سباق (race condition) في حدّ تهدئة فتح تذاكر الدعم.
--
-- العطل المكتشَف في تمشيط دوال القاعدة (الشرط الأول من التقرير النهائي):
--   كانت `open_support_ticket` تفحص ثم تكتب بلا قفل:
--
--       select max(created_at) into v_last from support_tickets ...  -- فحص
--       if v_last > now() - cooldown then return COOLDOWN_ACTIVE;    -- قرار
--       insert into support_tickets ...                              -- كتابة
--
--   وبين الفحص والكتابة نافذةٌ مفتوحة. تحت عزل READ COMMITTED — وهو الافتراضي
--   في Postgres — لا ترى المعاملة المتزامنة صفوف غيرها غير المُثبَّتة، فتقرأ كل
--   واحدة «لا تذكرة حديثة» وتُقرّر الفتح.
--
--   المرصود فعلياً بـ scripts/race-support-ticket.ts (20 جولة × 20 متزامناً):
--   خمس جولات خُرقت، وبلغت إحداها **أربع** تذاكر حيث الحدّ واحدة.
--
--   الأثر: مَن يرسل بالتوازي يتجاوز تهدئةً وُضعت أصلاً لمنع إغراق قروب الدعم
--   على تلغرام — أي أن الحماية تُلتَفّ بالتزامن وحده. وحدّ المعدّل على الويبهوك
--   (30 رسالة/10ث) لا يسدّها لأنه يسمح بعشرات الرسائل داخل نافذة التهدئة.
--
-- الإصلاح: قفل صفّ المستخدم `for update` عند قراءته أصلاً في أول الدالّة.
--   يُسلسِل فتح التذاكر للمستخدم الواحد فلا يقرأ اثنان الحالة نفسها، ولا يمسّ
--   مستخدمين آخرين لأن القفل على صفّه هو. وهو نفس الاصطلاح المستعمَل في
--   `issue_admin_login_code` وفي atomic_rpcs للسائقين — لا نمط جديد ولا آلية جديدة.
--
-- ما لم يتغيّر: التوقيع، والردّ، وكل فروع الرفض، ورسائل الأخطاء، وترتيب الفحوص.
--   التغيير الوحيد هو `for update` على قراءة صفّ المستخدم.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_support_ticket(p_telegram_id bigint, p_type support_ticket_type, p_message text, p_file_id text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_rider_id uuid;
  v_city_id uuid;
  v_cooldown integer;
  v_last timestamptz;
  v_group bigint;
  v_id uuid;
begin
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  select id into v_rider_id from riders where user_id = v_user.id;
  if v_driver_id is null and v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  end if;
  if p_type = 'subscription' and v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_city_id := v_user.city_id;

  select telegram_support_group_id into v_group from cities where id = v_city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- حدّ التكرار: يُقاس على آخر تذكرة لهذا الشخص لا على عدد التذاكر، فلا يُعاقَب
  -- من فتح تذكرتين مشروعتين متباعدتين.
  v_cooldown := coalesce(get_setting_number(v_city_id, 'support_ticket_cooldown_seconds'), 0);
  if v_cooldown > 0 then
    select max(created_at) into v_last
      from support_tickets
     where (driver_id is not null and driver_id = v_driver_id)
        or (rider_id is not null and rider_id = v_rider_id);
    if v_last is not null and v_last > now() - make_interval(secs => v_cooldown) then
      return jsonb_build_object(
        'ok', false,
        'error', 'COOLDOWN_ACTIVE',
        'retry_after_seconds',
          ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::integer
      );
    end if;
  end if;

  -- النزاع يجب أن يتعلّق بطلب يملكه صاحب التذكرة فعلاً، وإلا صار باباً للتلصّص
  if p_order_id is not null then
    if not exists (
      select 1 from orders o
       where o.id = p_order_id
         and (o.rider_id = v_rider_id or o.assigned_driver_id = v_driver_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_YOURS');
    end if;
  end if;

  insert into support_tickets
    (city_id, type, driver_id, rider_id, order_id, message, attachment_file_id)
  values
    (v_city_id, p_type,
     case when p_type = 'subscription' then v_driver_id else v_driver_id end,
     v_rider_id, p_order_id, btrim(p_message), nullif(btrim(coalesce(p_file_id, '')), ''))
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user.id, 'support.ticket_opened', 'support_ticket', v_id,
          jsonb_build_object('type', p_type, 'has_attachment', p_file_id is not null));

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_id,
    'city_id', v_city_id,
    'group_id', v_group,
    'type', p_type
  );
end;
$function$

;
