-- migration-phase: expand
-- ============================================================================
-- الغرض: WR-42 — التدخّلُ الإداريُّ في الطلباتِ العالقةِ (إلغاء/إنهاء إداريٌّ)
--   بعدَ واقعةِ 2026-11-03: طلبٌ بقيَ في `matched` نحوَ 24 ساعةً (السائقُ وصلَ
--   ولم يبدأْ)، والراكبُ لا يرى زرَّ إلغاءٍ (سياسةُ الواجهةِ تحجبُه بعدَ
--   الإسنادِ رغمَ أنَّ `cancel_order_by_rider` تسمحُ بـ`matched` منذَ WR-22)،
--   ولا مسارَ مساعدةٍ مربوطًا بالطلبِ من شاشةِ الرحلةِ الحيّةِ، ولوحةُ الإدارةِ
--   قراءةٌ بلا فعلٍ. هذا الملفُّ يفتحُ للمشرفِ المسؤولِ مسارًا ذرّيًّا مُسجَّلًا.
--   لا يُنهي هذا الملفُّ رحلةً تلقائيًّا ولا يضعُ مهلةً عامّةً — القرارُ بشريٌّ
--   دائمًا (`F12-04` باقٍ في حكمِه: الكاشفُ عينٌ لا حَكَم).
-- الحالة: منفّذ فعلياً — 2026-11-04.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: مسارُ البوابةِ `POST /admin/live-orders/:id/intervene`
-- ملاحظات مستقبلية: أصنافُ تدخّلٍ جديدةٌ (مثلُ إعادةِ بثٍّ) تُضافُ هنا بقرارٍ
--   معلَنٍ لا ميزةً عابرةً — وهذا هوَ البابُ الذي قالَتْ صفحةُ الطلباتِ الحيّةِ
--   إنّهُ لا يُفتحُ إلّا بأمرٍ صريحٍ.
-- ============================================================================

-- 1) التدخّلُ الإداريُّ — ذرّيٌّ واحدٌ، والفاعلُ مشرفٌ مسؤولٌ لا سائقٌ ولا راكب:
--    'cancel'  : من `searching`/`matched` عبرَ `cancel_order_by_rider` نفسِها
--                (تفريعُها كاملٌ: العروضُ والتفاوضُ والمرشَّحُ وإخطارُ السائقين)،
--                ومن `in_progress` عبرَ `driver_abort_ride` (فكُّ الإسنادِ وإخطارُ
--                الراكبِ) معَ إخطارِ السائقِ المُسنَدِ بنفسِه.
--    'complete': من `in_progress` وحده عبرَ `complete_ride` (الإنهاءُ الحقيقيُّ
--                بالأجرةِ والتقييمِ كما لو أكملَ السائقُ) — لا يُنهي هذا البابُ
--                طلبًا لم يبدأْ قطُّ: ذاكَ إلغاءٌ لا إنهاء.
create or replace function admin_intervene_order(
  p_order_id uuid,
  p_actor_telegram_id bigint,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   users%rowtype;
  v_order   orders%rowtype;
  v_driver  users%rowtype;
  v_now     timestamptz := now();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result  jsonb;
  v_notice jsonb;
  v_notice_enqueued boolean := false;
begin
  -- السببُ شرطُ قبولٍ لا زينةَ: تدخّلٌ بلا سببٍ مكتوبٍ تدخّلٌ بلا محاكمةٍ.
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'REASON_TOO_LONG');
  end if;
  -- رفضُ `NULL` صريحًا: `NOT IN` على قيمةٍ معدومةٍ يُقيَّمُ إلى معدومٍ فلا
  -- يُرفضُ — فالتحققُ هنا يُغلقُ بابَ المنطقِ الثلاثيِّ قبلَ أيِّ مساسٍ بالطلب.
  if p_action is null or p_action not in ('cancel', 'complete') then
    return jsonb_build_object('ok', false, 'error', 'ACTION_UNKNOWN');
  end if;

  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.role not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  -- القفلُ على الصفِّ الحيِّ وحدَه: طلبٌ انتهى (completed/cancelled/failed) لا
  -- يُمسُّ — وثانيُ نداءٍ على طلبٍ خُتِمَ يُرَدُّ بالرمزِ نفسِهِ فلا تدخّلٌ مزدوجٌ.
  -- و`scheduled` مستبعَدٌ عمدًا: مسارُ الإلغاءِ (`cancel_order_by_rider`) لا يقبلُه
  -- ومسارُ القطعِ (`driver_abort_ride`) لا يقبلُهُ (كلاهما `matched`/`in_progress`
  -- أو أضيقَ) — فتدخّلٌ عليهِ يعني رمزَ مسارٍ داخليًّا لا قرارًا واضحًا. يُرفضُ
  -- برمزٍ صريحٍ بلا أيِّ أثرٍ جانبيٍّ، وفتحُهُ لاحقًا بقرارٍ معلَنٍ إنْ لزم.
  select * into v_order
    from orders
   where id = p_order_id
     and status in ('searching', 'matched', 'in_progress')
     for update;

  if not found then
    if exists (select 1 from orders where id = p_order_id) then
      -- إنهاءُ طلبٍ انتهى: رفضُه برمزِ «غيرُ قابلٍ للإنهاء» لا برمزِ «غيرُ
      -- قابلٍ للتدخّل» — فالتمييزُ عقدٌ معَ الواجهةِ (`ORDER_NOT_COMPLETABLE`).
      if p_action = 'complete' then
        return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETABLE');
      end if;
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_INTERVENABLE');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if p_action = 'cancel' then
    if v_order.status in ('searching', 'matched') then
      -- المسارُ القانونيُّ نفسُهُ للإلغاءِ — بيدِ المشرفِ نيابةً عن الراكبِ،
      -- وفروعُهُ (العروضُ، التفاوضُ، المرشَّحُ، إخطارُ السائقين) مُجرّاةٌ كما هي.
      v_result := cancel_order_by_rider(p_order_id, v_order.rider_id, v_reason);
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        return v_result;
      end if;
      -- والراكبُ يُخبَرُ: هوَ لم يُلغِ بنفسِهِ فلا يُتركُ يبحثُ عن طلبٍ «مَنَعَهُ».
      v_notice := enqueue_rider_trip_notice(p_order_id, 'ABORTED');
      v_notice_enqueued := coalesce((v_notice->>'ok')::boolean, false);
    else
      -- `in_progress`: لا إلغاءَ راكبٍ هنا، فالمسارُ قطعُ السائقِ
      -- نفسُهُ (يفكُّ الإسنادَ ويُخطرُ الراكبَ) ثمَّ إخطارُ السائقِ بيدِ من تدخّل.
      if v_order.assigned_driver_id is null then
        return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_INTERVENABLE');
      end if;
      select * into v_driver from users u
        join drivers d on d.user_id = u.id
       where d.id = v_order.assigned_driver_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
      end if;

      v_result := driver_abort_ride(v_driver.telegram_id, p_order_id, v_reason);
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        return v_result;
      end if;
      v_notice_enqueued := true; -- داخلَ driver_abort_ride نفسِها
      -- والسائقُ يُخبَرُ بيدِ مَن قُطِعَت: نصُّ الإلغاءِ الكائنُ يقولُ «العميلُ
      -- ألغى» وهوَ هنا كذبٌ صريحٌ — فنوعُ التدخّلِ الإداريِّ بنصِّهِ الصادقِ.
      -- إيداعٌ مباشرٌ لا عبرَ `enqueue_notification`: ذاكَ يضبطُ `order_id`
      -- للصفِّ لأنواعِ الرحلةِ وحدَها، والإخطارُ هنا من حقِّهِ أن يُنسَبَ
      -- لطلبِهِ (تنظيفُ الاختبارِ وقراءةُ «إشعاراتُ هذا الطلبِ» كذلكَ).
      insert into notification_outbox (city_id, kind, payload, dedup_key, order_id)
      values (v_order.city_id, 'admin_order_intervention',
              jsonb_build_object('order_id', p_order_id::text,
                                 'driver_id', v_order.assigned_driver_id::text,
                                 'action', 'cancel',
                                 'reason', v_reason,
                                 'was_status', v_order.status::text),
              'admin_order_intervention:' || p_order_id::text, p_order_id)
      on conflict (kind, dedup_key) do nothing;
    end if;
  else
    -- 'complete' : إنهاءٌ إداريٌّ لرحلةٍ بدأت فعلًا ولم يصلْ إنهاؤُها — الأجرةُ
    -- والتقييمُ وحسابُ المدّةِ تجري كما في الإنهاءِ الحقيقيِّ لأنَّ الرحلةَ جرت.
    if v_order.status <> 'in_progress' or v_order.assigned_driver_id is null then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETABLE');
    end if;

    select * into v_driver from users u
      join drivers d on d.user_id = u.id
     where d.id = v_order.assigned_driver_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
    end if;

    v_result := complete_ride(p_order_id, v_driver.telegram_id);
    if coalesce((v_result->>'ok')::boolean, false) is not true then
      return v_result;
    end if;

    v_notice := enqueue_rider_trip_notice(p_order_id, 'COMPLETED');
    v_notice_enqueued := coalesce((v_notice->>'ok')::boolean, false);

    -- والسائقُ يُخبَرُ أنَّ رحلتَهُ أُنهِيَت بقرارِ المشرفِ لا بيدِهِ — إشعارٌ
    -- بنوعٍ جديدٍ لأنَّ أنواعَ الإلغاءِ تكذبُ هنا والسكوتَ أخبثُ. وإيداعٌ
    -- مباشرٌ يَنسِبُ الإخطارَ لطلبِهِ كما في فرعِ القطعِ أعلاه.
    insert into notification_outbox (city_id, kind, payload, dedup_key, order_id)
    values (v_order.city_id, 'admin_order_intervention',
            jsonb_build_object('order_id', p_order_id::text,
                               'driver_id', v_order.assigned_driver_id::text,
                               'action', 'complete',
                               'reason', v_reason,
                               'was_status', v_order.status::text),
            'admin_order_intervention:' || p_order_id::text, p_order_id)
    on conflict (kind, dedup_key) do nothing;
  end if;

  -- سجلُّ التدخّلِ : الفاعلُ المشرفُ، والحالةُ قبلَهُ وبعدَهُ، والسببُ — وكلُّ
  -- أثرِ الآليّاتِ (order.cancelled / order.completed / order.aborted_by_driver)
  -- يبقى كما كتبَتْهُ الآليّةُ؛ هذا السطرُ يضيفُ «مَن قرَّرَ ولمَ» فوقَها.
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_actor.id, 'order.admin_intervention', 'order', p_order_id,
          jsonb_build_object('actor_telegram_id', p_actor_telegram_id,
                             'action', p_action,
                             'reason', v_reason,
                             'was_status', v_order.status,
                             'new_status', case p_action when 'cancel' then 'cancelled'
                                                          else 'completed' end,
                             'rider_notified', v_notice_enqueued));

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'action', p_action,
    'was_status', v_order.status,
    'new_status', case p_action when 'cancel' then 'cancelled' else 'completed' end,
    'rider_notified', v_notice_enqueued,
    'intervened_at', v_now
  );
end;
$$;

comment on function admin_intervene_order(uuid, bigint, text, text) is
  'التدخّلُ الإداريُّ في طلبٍ حيٍّ (WR-42): إلغاءٌ أو إنهاءٌ بيدِ مشرفٍ مسؤولٍ بسببٍ مكتوبٍ، ذرّيًّا، بإخطارِ الطرفَينِ، وسجلٍّ للفاعلِ والحالةِ قبلَ وبعد — ولا يُنهي رحلةً لم تبدأ ولا يمسُّ طلبًا انتهى.';

revoke all on function admin_intervene_order(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function admin_intervene_order(uuid, bigint, text, text) to service_role;

-- 2) بطاقةُ التذكرةِ تحملُ حالةَ الطلبِ لحظةَ قراءتِها (WR-42 «إرفاقُ رقمِ
--    الطلبِ وحالتِهِ تلقائيًّا») — امتدادٌ للجسمِ القائمِ لا استبدالٌ: يُزادُ
--    `order_status` و`order_stuck_minutes` وحدهما، وقراءةُ الحالةِ حيّةٌ كلَّ
--    مرةٍ تُبنى فيها البطاقةُ فلا تقادمَ فيها.
create or replace function get_support_ticket_context(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ticket  support_tickets%rowtype;
  v_user    users%rowtype;
  v_city    cities%rowtype;
  v_sub     subscriptions%rowtype;
  v_order   orders%rowtype;
begin
  select * into v_ticket from support_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  select * into v_city from cities where id = v_ticket.city_id;

  -- صاحب التذكرة: السائق إن وُجد، وإلا العميل
  if v_ticket.driver_id is not null then
    select u.* into v_user from users u join drivers d on d.user_id = u.id
     where d.id = v_ticket.driver_id;
    -- الاشتراك السارِي إن وُجد، وإلا آخر اشتراك مسجَّل ليرى الموظّف السياق كاملاً
    select * into v_sub from subscriptions
     where driver_id = v_ticket.driver_id
     order by (status in ('trialing', 'active')) desc, created_at desc
     limit 1;
  else
    select u.* into v_user from users u join riders r on r.user_id = u.id
     where r.id = v_ticket.rider_id;
  end if;

  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_OWNER_MISSING');
  end if;

  if v_ticket.order_id is not null then
    select * into v_order from orders where id = v_ticket.order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'type', v_ticket.type,
    'status', v_ticket.status,
    'message', v_ticket.message,
    'attachment_file_id', v_ticket.attachment_file_id,
    'order_id', v_ticket.order_id,
    'order_status', case when v_order.id is null then null else v_order.status::text end,
    'order_stuck_minutes', case when v_order.id is null or v_order.status in ('completed', 'cancelled', 'failed')
                                then null
                                else round(extract(epoch from (now() - v_order.updated_at)) / 60)::int end,
    'group_id', v_city.telegram_support_group_id,
    'city_id', v_ticket.city_id,
    'city_name', v_city.name_ar,
    'created_at', v_ticket.created_at,
    -- LOST-AT · ADR 0253: الوقتُ التقريبيُّ كما قدّمَه صاحبُ البلاغ، أو `null` (لا يُخترَع) —
    -- بقاءٌ حرفيٌّ على عقدِ القراءةِ في `20261009130000`.
    'lost_at', v_ticket.lost_at,
    'full_name', v_user.full_name,
    'phone', v_user.phone,
    'telegram_id', v_user.telegram_id,
    'telegram_username', v_user.telegram_username,
    'language_code', v_user.language_code,
    'driver_id', v_ticket.driver_id,
    'rider_id', v_ticket.rider_id,
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'plan', v_sub.plan,
      'status', v_sub.status,
      'current_period_end', v_sub.current_period_end,
      'trial_ends_at', v_sub.trial_ends_at,
      'is_live', v_sub.status in ('trialing', 'active')
                 and (v_sub.current_period_end is null or v_sub.current_period_end > now())
    ) end
  );
end;
$$;

comment on function get_support_ticket_context(uuid) is
  'قراءةُ سياقِ التذكرةِ للبطاقةِ: كلُّ ما تعرضُهُ مقروءٌ الآن، ومعَهُ (WR-42) حالةُ الطلبِ المربوطِ وعمرُ سكونِهِ إن كانَ حيًّا.';

-- ============================================================================
-- 2) النوعُ الجديدُ في صندوقِ الصادرِ الموحَّدِ: إشعارُ السائقِ بالتدخّلِ
--    الإداريِّ (أُنهيت رحلتُك بقرارِ المشرفِ). إشعارُ الإلغاءِ الكائنُ يكذبُ
--    هنا، والسكوتَ أخبثُ، فنوعٌ جديدٌ بنصِّهِ الصادقِ. (`not valid` ثمَّ
--    تثبيتُهُ في 20261104120001 — نمطُ `WR-13`).
-- ============================================================================
--    توسيعُ القائمةِ مجموعةٌ فائقةٌ تحوي القديمَ كلَّهُ فلا صفَّ موجوداً يُرفَضُ،
--    والتبديلُ داخلَ حارسِ `do $$` بنمطِ `WR-34` (نفسُ القيدِ بالاسمِ لا قيدانِ).
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'notification_outbox'::regclass
                and conname = 'notification_outbox_kind_check') then
    alter table notification_outbox drop constraint notification_outbox_kind_check;
  end if;
  alter table notification_outbox add constraint notification_outbox_kind_check
    check (kind in (
      'offer', 'dispute_resolution',
      'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
      'wider_circle_opened', 'no_driver_found',
      'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
      'lost_item_report',
      'safety_resolution_closed', 'safety_resolution_blocked',
      'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
      'driver_location_reminder', 'driver_city_notice',
      'admin_order_intervention'
    )) not valid;
end;
$$;

-- 3) أولويّةُ النوعِ: متوسّطةٌ (٣) — خبرُ مآلٍ لا مطالبةُ إسنادٍ ولا استغاثةٌ.
--    صورةُ `20261012170000` حرفًا معَ بندٍ واحدٍ جديدٍ.
create or replace function notification_kind_priority(p_kind text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_kind
    -- ١ = حرجٌ: استغاثةٌ، وحالةُ رحلةٍ نشطةٍ، ومطالبةُ إسنادٍ لها مؤقّتٌ يجري.
    when 'safety_incident' then 1
    when 'order_cancelled' then 1
    when 'negotiation_turn_opened' then 1
    when 'negotiation_turn_closed' then 1
    when 'negotiation_agreed' then 1
    -- `WR-15` — إشعارُ طورِ الرحلةِ للراكبِ (قبول، وصول، بدء، إكمال): حالةُ رحلةٍ نشطةٍ.
    when 'rider_trip_notice' then 1
    -- `WR-09` — مآلُ المرشَّحِ عندَ السائق: له مؤقّتٌ يجري (قرارُ الراكب).
    when 'driver_candidate_notice' then 1
    -- ٢ = مرتفعٌ: تسليمُ العروضِ وتوسيعُ الدائرةِ — خطواتُ الإسنادِ نفسِه.
    when 'offer' then 2
    when 'wider_circle_opened' then 2
    -- `WR-04` — تنبيهُ رسالةِ محادثةٍ جديدةٍ لطرفٍ خارجَ Mini App أثناءَ رحلةٍ قائمة.
    when 'order_chat_message' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    -- `WR-12` — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه: إشعارٌ تشغيليٌّ عاديّ.
    when 'driver_location_reminder' then 3
    -- `WR-13` — إخطارُ السائقِ بتغيّرِ مدينتِه حسبَ موقعِه أو بخروجِه من التغطية.
    when 'driver_city_notice' then 3
    when 'safety_resolution_closed' then 3
    when 'safety_resolution_blocked' then 3
    -- `WR-42` — خبرُ تدخّلٍ إداريٍّ بوصولِ السائقِ (عنوانُه حيٌّ) — مآلٌ لا طلبُ فعلٍ.
    when 'admin_order_intervention' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ (حاجزُ `scripts/check-traffic-priority.ts`).
    else 1
  end::smallint;
$$;
revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

-- 4) التسليمُ: صورةُ `20261018130000` (آخرُ تعريفٍ على main) حرفًا معَ إدخالِ النوعِ الجديدِ في
--    مواضعِهِ الأربعةِ (قائمةُ الأنواعِ، الإغناءُ، حرسُ العنوانِ، قائمةُ
--    الأنواعِ التي بلا تسليمٍ مطلوبٍ — وليسَ منها هذا النوعُ: رسالتُهُ
--    تلغراميةٌ فلا تُطوى بـNOT_REQUIRED).
create or replace function claim_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery notification_outbox%rowtype;
  v_token uuid := gen_random_uuid();
  v_max integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
  v_resolution text;
  v_claim record;
  v_rider record;
  v_driver record;
  v_batch_limit integer;
  v_concurrency integer;
  v_claimed bigint;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
    'driver_location_reminder', 'driver_city_notice',
    'admin_order_intervention'
  ];
  v_chat_id text;
  v_undeliverable_reason text;
  v_party record;
begin
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind = any(v_ride_kinds)
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => coalesce(
           (select greatest(1, (ps.value #>> '{}')::integer)
              from platform_settings ps
             where ps.city_id = n.city_id
               and ps.key = 'notification_claim_timeout_seconds'),
           300));

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind = any(v_ride_kinds)
     and not exists (
       select 1 from notification_outbox o
        where o.order_id = n.order_id
          -- `D8` (CAP-RUN-20261016-CONTINUATION): تسلسلُ «نفسِ الطلبِ» يَسري على
          -- المستلِمِ نفسِهِ فقط (المستلِمُ = recipient_user_id) — لا على الطلبِ كلِّهِ.
          -- القياسُ (جولةُ J1 على مقعدِ D8): عاصفةُ العروضِ للسائقينَ كانت تحجبُ
          -- إشعاراتِ الرحلةِ الحرجةَ للركابِ خلفَ أقدمِ عرضٍ لمُستلِمٍ آخرَ (بوابةُ
          -- رأسِ السطرِ داخلَ الطلبِ) — فتأخرتِ الحرجةُ خلفَ الدفعةِ المُغرقةِ.
          -- بالنطاقِ على المستلِمِ يبقى التسلسلُ المنطقيُّ لكلِّ مستلِمٍ (لا يرى
          -- أحدٌ قصتَهُ مبعثرةً) ويتحررُ المسارُ الحرجُ من حجبِ مستلِمٍ آخر.
          and o.recipient_user_id is not distinct from n.recipient_user_id
          and o.status = 'pending'
          and o.kind = any(v_ride_kinds)
          and o.next_attempt_at <= now()
          and (o.created_at, o.id) < (n.created_at, n.id)
          -- `LOAD-01` (P4): المحسومُ لا يحجبُ — صفٌّ ميّتٌ لا يؤجّلُ الحيَّ خلفَهُ.
          and not exists (
            select 1 from order_offers od
             where od.id = o.offer_id
               and od.status in ('accepted'::offer_status, 'cancelled'::offer_status, 'expired'::offer_status)
          )
     )
     -- `LOAD-01` (P4): العرضُ المحسومُ (قُبِلَ/أُلغيَ/انتهت صلاحيّتُه) ليس مرشّحًا
     -- للالتقاطِ أصلًا — كانَ يُلتقطُ ثمّ يُهجَرُ فورًا (دورةُ التقاطٍ كاملةٌ بلا أثرٍ).
     -- الصفُّ يظلُّ كما هو للكنسِ الدوريِّ (`sweep_decided_offer_notifications`) الذي
     -- يوسمُهُ بالسببِ نفسِهِ (`ABANDONED`) — فلا يُحذفُ حدثٌ ولا يتغيّرُ تدقيقٌ.
     and not exists (
       select 1 from order_offers decided
        where decided.id = n.offer_id
          and decided.status in ('accepted'::offer_status, 'cancelled'::offer_status, 'expired'::offer_status)
     )
   order by notification_kind_priority(n.kind), n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  v_concurrency := queue_limit_or_null(v_delivery.city_id, 'outbox_queue_consumer_concurrency');
  select count(*) into v_claimed from notification_outbox n
   where n.city_id = v_delivery.city_id and n.status = 'sending';

  if v_concurrency is null or v_concurrency <= 0 or coalesce(v_claimed, 0) >= v_concurrency then
    perform record_queue_backpressure_event(
      v_delivery.city_id, 'notification_outbox', 'CONSUMER_CONCURRENCY',
      jsonb_build_object('claimed', v_claimed, 'consumer_concurrency', v_concurrency)
    );
    return jsonb_build_object(
      'ok', true, 'delivery', null, 'backpressure', 'CONSUMER_CONCURRENCY',
      'claimed', coalesce(v_claimed, 0), 'consumer_concurrency', v_concurrency
    );
  end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  v_batch_limit := greatest(1, v_concurrency);

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  if v_delivery.kind = 'offer' then
    -- `WR-08`: إثراءُ `PD-051` (`20260920210000`) مُعادٌ حرفًا — الخدمةُ والانطلاقُ والوصولُ
    -- والملاحظاتُ من `orders`. سقطَ في إعادةِ كتابةِ `20260921000000` وما بعدَها.
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text,
             'service', ord.service::text,
             'pickup_label', ord.pickup_label,
             'dropoff_label', ord.dropoff_label,
             'notes', ord.notes
           )
      into v_payload
      from order_offers o
      join orders ord on ord.id = o.order_id
     where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end,
           tk.resolution
      into v_owner_telegram, v_owner_language, v_owner_kind, v_resolution
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind,
      'resolution', v_resolution
    );
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    select c.negotiation_id, c.order_id, c.position,
           du.telegram_id::text as driver_chat_id, du.language_code as driver_language,
           ru.telegram_id::text as rider_chat_id, ru.language_code as rider_language,
           get_setting_number(c.city_id, 'unsubscribed_negotiate_seconds')::integer as seconds
      into v_claim
      from unsubscribed_claims c
      join drivers d on d.id = c.driver_id
      join users du on du.id = d.user_id
      join orders o on o.id = c.order_id
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where c.id = (v_delivery.payload->>'claim_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'negotiation_id', v_claim.negotiation_id,
      'order_id', v_claim.order_id,
      'position', v_claim.position,
      'deadline_seconds', v_claim.seconds,
      'chat_id', case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end,
      'language', coalesce(
        case when v_delivery.payload->>'side' = 'driver'
             then v_claim.driver_language else v_claim.rider_language end,
        'ar'
      )
    );
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found', 'rider_trip_notice') then
    select ru.telegram_id::text as chat_id, ru.language_code as language,
           o.service::text     as service
      into v_rider
      from orders o
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where o.id = (v_delivery.payload->>'order_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar'),
      'service', v_rider.service
    );
  elsif v_delivery.kind = 'order_cancelled' then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind in (
    'lost_item_report', 'driver_candidate_notice', 'driver_city_notice',
    'admin_order_intervention'
  ) then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind = 'driver_location_reminder' then
    -- `WR-12` — محادثةُ السائقِ ولغتُه، و**حالُه الآنَ** لا لحظةَ الإيداع: ما زالَ متوفّرًا
    -- وما زالَ موقعُه أقدمَ من مهلةِ التذكير؟ وإلّا يطويه المعالج.
    select du.telegram_id::text as chat_id, du.language_code as language,
           coalesce(da.is_available, false) as is_available,
           (coalesce(d.last_location_recorded_at, d.last_location_at) is null
             or coalesce(d.last_location_recorded_at, d.last_location_at)
                < now() - make_interval(secs => greatest(1, driver_location_reminder_seconds(d.city_id)))
           ) as still_stale,
           case when coalesce(d.last_location_recorded_at, d.last_location_at) is null then null
                else floor(extract(epoch from now() - coalesce(d.last_location_recorded_at, d.last_location_at)) / 60)::integer
           end as minutes
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
      left join driver_availability da on da.driver_id = d.id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar'),
      'is_available', coalesce(v_driver.is_available, false),
      'still_stale', coalesce(v_driver.still_stale, false),
      'minutes', v_driver.minutes
    );
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    -- `PD-021` — إشعارُ مآلٍ عامٌّ للمُبلِّغِ. محادثتُهُ ولغتُهُ كما هما في
    -- القاعدةِ لحظةَ الالتقاطِ، والحمولةُ تَحملُ القرارَ لا السببَ الداخليَّ.
    select ru.telegram_id::text as chat_id, ru.language_code as language
      into v_rider
      from safety_incidents si
      join users ru on ru.id = si.reporter_user_id
     where si.id = (v_delivery.payload->>'incident_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar')
    );
  elsif v_delivery.kind = 'order_chat_message' then
    -- `WR-04` — المستقبِلُ مُعلَنٌ في الصفّ (`recipient_user_id`)، ومحادثتُه ولغتُه حيّتان.
    -- و`read` = قرأَ الرسالةَ داخلَ Mini App قبلَ موعدِ التنبيه ⇒ المعالجُ يطويه.
    select u.telegram_id::text as chat_id, u.language_code as language,
           o.status::text as order_status,
           coalesce(rd.last_read_seq, 0) >= coalesce((v_delivery.payload->>'seq')::bigint, 0) as read
      into v_party
      from users u
      join orders o on o.id = v_delivery.order_id
      left join order_message_reads rd on rd.order_id = o.id and rd.user_id = u.id
     where u.id = v_delivery.recipient_user_id
       and u.erased_at is null;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_party.chat_id,
      'language', coalesce(v_party.language, 'ar'),
      'order_status', v_party.order_status,
      'read', coalesce(v_party.read, false)
    );
  else
    v_payload := v_delivery.payload;
  end if;

  -- ---------------------------------------------------------------------------
  -- `SEC-19-ب-٣` — حرسُ العنوانِ الغائبِ
  --
  -- بعدَ حلِّ العنوانِ وقبلَ الإرجاعِ: إذا كانَ العنوانُ غائبًا، يُعلَنُ الصفُّ
  -- `undeliverable` بـ`died_at` وسببٍ مُسمّىً، ويُعادُ `delivery: null`.
  --
  -- والفرعُ `offer` لا يُفحَصُ ههنا — عنوانُهُ في TypeScript (الخطوةُ الرابعة).
  -- ---------------------------------------------------------------------------

  if v_delivery.kind = 'dispute_resolution' then
    v_chat_id := v_owner_telegram::text;
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    v_chat_id := case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end;
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found', 'rider_trip_notice') then
    v_chat_id := v_rider.chat_id;
  elsif v_delivery.kind in (
    'order_cancelled', 'lost_item_report', 'driver_candidate_notice', 'driver_location_reminder',
    'driver_city_notice', 'admin_order_intervention'
  ) then
    v_chat_id := v_driver.chat_id;
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    v_chat_id := v_rider.chat_id;
  elsif v_delivery.kind = 'order_chat_message' then
    v_chat_id := v_party.chat_id;
  else
    v_chat_id := null;
  end if;

  if v_chat_id is null and v_delivery.kind in (
    'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
    'driver_location_reminder', 'driver_city_notice',
    'admin_order_intervention'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report','driver_candidate_notice','driver_location_reminder','driver_city_notice','admin_order_intervention') and v_delivery.payload->>'driver_id' is not null)
    or (v_delivery.kind in ('safety_resolution_closed','safety_resolution_blocked') and v_delivery.payload->>'incident_id' is not null)
    or (v_delivery.kind = 'order_chat_message' and v_delivery.recipient_user_id is not null)
  ) then
    if v_delivery.kind in (
      'wider_circle_opened', 'no_driver_found',
      'dispute_resolution', 'lost_item_report', 'order_chat_message',
      'driver_location_reminder', 'driver_city_notice'
    ) then
      v_undeliverable_reason := 'TELEGRAM_DELIVERY_NOT_REQUIRED';
    else
      v_undeliverable_reason := 'TELEGRAM_DELIVERY_UNAVAILABLE';
    end if;

    update notification_outbox
       set status = 'undeliverable',
           died_at = now(),
           dead_reason = v_undeliverable_reason,
           claim_token = null,
           claimed_at = null
     where id = v_delivery.id;

    return jsonb_build_object(
      'ok', true, 'delivery', null,
      'undeliverable', v_delivery.id,
      'kind', v_delivery.kind,
      'reason', v_undeliverable_reason,
      'batch_limit', v_batch_limit
    );
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'batch_limit', v_batch_limit,
      'signal_wait_count', n.signal_wait_count,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;

-- 5) سياسةُ قناةِ النوعِ الجديدِ لكلِّ مدينةٍ موجودةٍ (بذرُ `F6-05` للنوعِ
--    الجديدِ): قناةٌ حرجةٌ كسائرِ أنواعِ التلغرامِ — لا قيمةَ `in_app` هنا.
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
  cross join (values
    ('admin_order_intervention', 'إخطارُ السائقِ بتدخّلٍ إداريٍّ في رحلتِهِ: قطعٌ أو إنهاءٌ بقرارٍ من الإدارةِ معَ السببِ المسجَّلِ')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;
