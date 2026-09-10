-- =============================================================================
-- migration-phase: expand
-- الغرض: `F8-05` — نداءُ الاستغاثةِ لا يحتاجُ قراءةً سابقةً. تُعادُ `trigger_sos`
--   بالتوقيعِ نفسِه لتقبلَ `p_order_id = null` بمعنى **«حُلَّ الطلبَ القائمَ
--   للمُبلِّغِ بنفسِك»**، فيصيرُ مسارُ الاستقبالِ نداءً واحداً على تبعيّةٍ واحدةٍ.
-- الحالة: منفّذ فعلياً — 2026-09-10.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/safety/safety-adapters.ts
--             ← packages/application/safety/trigger-sos.ts
--             ← حوارا الراكبِ والسائقِ في packages/application/bots
-- الحاكم: docs/adr/0077-sos-intake-resolves-its-own-order.md
--
-- ## العطبُ: الاستغاثةُ كانت تموتُ بعطبِ قراءةٍ لا تخصُّها
--
-- كانَ الوصولُ إلى هذه الدالّةِ يشترطُ **قراءتَين ناجحتَين** قبلَها:
--   • حوارُ الراكبِ: `riders.findByTelegramId` ثمَّ `activeOrdersOf`.
--   • حوارُ السائقِ: `drivers.findByTelegramId` (لكلِّ أمرٍ) ثمَّ `tripCards.cardOf`.
-- وإخفاقُ أيٍّ منهما يردُّ «حدثَ عطلٌ، أعِد المحاولةَ» **فتُسقَطُ الاستغاثةُ**.
-- وهذا نقضٌ لِما بُنيَت عليه الدالّةُ نفسُها: تعليقُ ملفِّ التطبيقِ يقولُ إنَّ
-- تيليجرام قد يفشلُ ولا يجوزُ أن يصيرَ فشلُه فقداناً لنداءِ الطوارئِ — والقراءتانِ
-- تفعلانِ بالضبطِ ما نُهيَ عنه، في طبقةٍ أدنى وقبلَ أن يُقيَّدَ شيءٌ.
--
-- ## ولمَ هذه الدالّةُ هيَ موضعُ الإصلاحِ
--
-- لأنَّ القراءتَين لم تكونا تُضيفانِ ضماناً: الدالّةُ **تُثبِتُ الملكيّةَ بنفسِها**
-- (`ORDER_NOT_OWNED` / `ORDER_NOT_ASSIGNED`) تحتَ `for update`. فكانتا تكراراً
-- لحكمٍ قائمٍ، مع فارقٍ واحدٍ: أنَّهما تُسقِطانِ النداءَ إذا أخفقَتا، والدالّةُ لا.
-- فحذفُهما من طبقةِ الحوارِ يقتضي أن يُحَلَّ الطلبُ **ههنا** حيثُ القفلُ والحكمُ.
--
-- ## ما تغيَّرَ حرفاً
--
-- ١) `p_order_id` صارَ يقبلُ `null`، ومعناهُ: اقرأِ الطلبَ القائمَ للمُبلِّغِ نفسِه.
-- ٢) تحقُّقُ الدورِ (`INVALID_REPORTER_ROLE`) صعِدَ إلى أوّلِ الجسمِ، لأنَّ الدورَ
--    صارَ **يختارُ فرعَ الحلِّ** فلا يُقرأُ بعدَه.
-- ٣) خطأٌ جديدٌ واحدٌ: `NO_ACTIVE_ORDER` — لا طلبَ قائمَ للمُبلِّغِ.
--
-- وما لم يتغيَّرْ: مفاتيحُ المُرجَعِ (`ok`/`incident_id`/`created`/`error`) · القفلُ
-- الاستشاريُّ · نافذةُ منعِ التكرارِ · إنشاءُ الحادثِ · الإيداعُ في الصندوقِ
-- الموحَّدِ (`ADR-0061`) · معنى `last_known_location` · التوقيعُ · سطحُ الصلاحيّاتِ.
--
-- ## ومعنى «الطلبُ القائمُ» لا يُكتَبُ ههنا نصّاً
--
-- يُسألُ عنه `is_active_order_status` للراكبِ و`is_driver_engaged_order_status`
-- للسائقِ — وهما المصدرُ الوحيدُ لهذا المعنى منذُ هجرةِ `20260814140000`، وفيها
-- حرزٌ يُسقِطُ الهجرةَ إن توسَّعَ التعدادُ. وكتابةُ `status in (...)` ههنا كانت
-- ستكونَ **رابعَ** موضعٍ يُحرَّرُ ثلاثةٌ منها فيُنسى الرابعُ — وهوَ عينُ العطبِ
-- الذي أُنشئَت تلكَ الهجرةُ لإزالتِه.
--
-- ## والفرقُ بينَ المعنيَينِ مقصودٌ لا سهوٌ
--
-- للراكبِ: `searching` طلبٌ قائمٌ. راكبٌ ينتظرُ سائقاً في موقفٍ مُقفِرٍ **أحوجُ**
-- ما يكونُ إلى الزرِّ، ولا سائقَ أُسنِدَ إليه بعدُ.
-- وللسائقِ: `searching` خارجَ عنه، لم يُسنَدْ إليه شيءٌ. فلو حُسِبَ له لأمكنَ أن
-- تُنسَبَ استغاثتُه إلى طلبِ راكبٍ لم يلتقِه — وذاكَ إبلاغٌ عن حادثٍ في مكانٍ
-- خطأٍ، وهوَ أسوأُ من ردٍّ يقولُ «لا رحلةَ قائمةٌ».
--
-- ## وما رُفِضَ عن قصدٍ
--
-- • **حِمْلٌ زائدٌ في الزرِّ** (تمريرُ `orderId` من بياناتِ الزرِّ بلا قراءةٍ):
--   مُدخَلٌ خارجيٌّ يُزوَّرُ، وكانَ سيجعلُ الحكمَ على الملكيّةِ الحاجزَ الوحيدَ
--   بلا حاجةٍ إليه أصلاً — والأسوأُ أنَّ زرّاً قديماً في محادثةٍ تتحرَّكُ يشيرُ
--   إلى طلبٍ **انتهى**، فتُنسَبُ الاستغاثةُ إلى رحلةِ الأمسِ.
-- • **حادثٌ بلا طلبٍ**: `safety_incidents.order_id` إلزاميٌّ، والقروبُ ومدينتُه
--   يُقرآنِ من الطلبِ. وإرخاءُ ذلكَ بندٌ آخرُ (`F2-10`/`SR-14`) لا هذا.
-- • **دالّةٌ ثانيةٌ** (`trigger_sos_for_actor`): مصدرُ حقيقةٍ مكرَّرٌ للحكمِ نفسِه.
-- • **إسقاطُ تحقُّقِ الملكيّةِ** في فرعِ الحلِّ لأنَّ الوصلَ يضمنُه: يبقى قائماً،
--   فحذفُه يجعلُ الضمانَ في شكلِ الاستعلامِ لا في حكمٍ مكتوبٍ.
--
-- ## مسارُ العودةِ (`OPS-010`)
--
-- إعادةُ تعريفِ الدالّةِ من هجرةِ `20260908010000` حرفاً. ولا عمودَ أُضيفَ ولا
-- نوعَ ولا قيدَ، فالعودةُ شيفرةٌ لا مخطَّطٌ، ولا تكسرُ الإصدارَ السابقَ: النسخةُ
-- القديمةُ تعملُ معَ مُنادٍ يُمرِّرُ `orderId` صريحاً، والنسخةُ الجديدةُ تعملُ معَ
-- كلَيهما. **والاتّجاهُ الوحيدُ الذي لا يعملُ**: شيفرةٌ جديدةٌ تُمرِّرُ `null` على
-- دالّةٍ قديمةٍ — تردُّ `ORDER_NOT_FOUND`. فالعودةُ تُنفَّذُ **معَ** عودةِ الشيفرةِ لا
-- قبلَها، وذاكَ ما يُعلِنُه السجلُّ.
-- =============================================================================

create or replace function trigger_sos(
  p_order_id uuid,
  p_actor_telegram_id bigint,
  p_reporter_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_actor users%rowtype;
  v_incident safety_incidents%rowtype;
  v_window integer;
  v_location geography(Point, 4326);
begin
  -- الدورُ أوّلاً: صارَ يختارُ فرعَ الحلِّ، فقراءتُه بعدَ استعمالِه لا معنى لها.
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;

  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;

  if p_order_id is null then
    /**
     * الطلبُ يُحَلُّ ههنا لأنَّ ههنا القفلَ: `for update of o` يُقفِلُ صفَّ الطلبِ
     * وحدَه لا صفوفَ الوصلِ — وقفلُ `riders`/`drivers` بلا حاجةٍ يُزاحِمُ مساراتٍ
     * أخرى في أكثرِ لحظةٍ لا تُحتمَلُ فيها مزاحمةٌ.
     *
     * و`order by o.created_at desc`: الأحدثُ هوَ الرحلةُ التي فيها المُبلِّغُ الآنَ.
     * والأقدمُ قد يكونُ طلباً منسيّاً في `searching` تُنسَبُ إليه استغاثةٌ وقعَت
     * في غيرِه. وتعدُّدُ الطلباتِ القائمةِ حالٌ قائمةٌ لا نظريّةٌ: الراكبُ يملكُ
     * إلى `MAX_ACTIVE_ORDERS` منها.
     */
    if p_reporter_role = 'rider' then
      select o.* into v_order
        from orders o
        join riders r on r.id = o.rider_id
       where r.user_id = v_actor.id
         and is_active_order_status(o.status)
       order by o.created_at desc
       limit 1
         for update of o;
    else
      select o.* into v_order
        from orders o
        join drivers d on d.id = o.assigned_driver_id
       where d.user_id = v_actor.id
         and is_driver_engaged_order_status(o.status)
       order by o.created_at desc
       limit 1
         for update of o;
    end if;
    if not found then return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_ORDER'); end if;
  else
    select * into v_order from orders where id = p_order_id for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); end if;
  end if;

  -- الملكيّةُ تبقى حكماً مكتوباً لا ضمناً في شكلِ الاستعلامِ: في فرعِ الحلِّ
  -- يمرُّ الشرطُ بحكمِ الوصلِ، وفي فرعِ المُعرِّفِ الصريحِ هوَ الحاجزُ الوحيدُ.
  if p_reporter_role = 'rider' and not exists (
    select 1 from riders r where r.id = v_order.rider_id and r.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_OWNED'); end if;
  if p_reporter_role = 'driver' and not exists (
    select 1 from drivers d where d.id = v_order.assigned_driver_id and d.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ASSIGNED'); end if;
  if not exists (
    select 1 from cities
     where id = v_order.city_id and is_active and telegram_escalation_group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'ESCALATION_GROUP_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_window
    from platform_settings where city_id = v_order.city_id and key = 'sos_dedup_window_seconds';
  if v_window is null then return jsonb_build_object('ok', false, 'error', 'SOS_DEDUP_SETTING_MISSING'); end if;
  perform pg_advisory_xact_lock(hashtext('sos:' || v_order.id::text || ':' || v_actor.id::text));
  select * into v_incident from safety_incidents
   where order_id = v_order.id and reporter_user_id = v_actor.id
     and created_at >= now() - make_interval(secs => v_window)
   order by created_at desc limit 1 for update;
  if found then
    -- إعادةُ التسليمِ ضمنَ النافذةِ: إن وُجدَ صفُّ تسليمٍ للحادثِ فلا شيءَ (on conflict)،
    -- وإلّا يُودَعُ صفٌّ جديدٌ في الصندوقِ الموحَّد.
    insert into notification_outbox (city_id, kind, dedup_key, payload)
      values (v_incident.city_id, 'safety_incident', 'safety_incident:' || v_incident.id::text,
              jsonb_build_object('incident_id', v_incident.id))
      on conflict (kind, dedup_key) do nothing;
    return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', false);
  end if;
  if p_reporter_role = 'driver' then
    select d.last_location into v_location from drivers d
      where d.id = v_order.assigned_driver_id;
  else
    v_location := v_order.pickup;
  end if;
  insert into safety_incidents(city_id, order_id, reporter_user_id, reporter_role, last_known_location)
    values (v_order.city_id, v_order.id, v_actor.id, p_reporter_role, v_location)
    returning * into v_incident;
  insert into notification_outbox (city_id, kind, dedup_key, payload)
    values (v_order.city_id, 'safety_incident', 'safety_incident:' || v_incident.id::text,
            jsonb_build_object('incident_id', v_incident.id));
  return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', true);
end $$;

comment on function trigger_sos(uuid, bigint, text) is
  'يُقيِّدُ استغاثةً ويُودِعُ تسليمَها في المعاملةِ نفسِها. و p_order_id = null معناهُ: حُلَّ الطلبَ القائمَ للمُبلِّغِ بنفسِك — فلا يحتاجُ المُنادي قراءةً سابقةً (F8-05 · ADR 0077).';

-- إعادةُ قفلِ سطحِ definer بعدَ create or replace.
revoke execute on function trigger_sos(uuid, bigint, text) from public, anon, authenticated;
grant execute on function trigger_sos(uuid, bigint, text) to service_role;
