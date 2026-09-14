-- =============================================================================
-- migration-phase: expand
-- الغرض: `F2-10` · `SR-14` — سطحُ الاستغاثةِ في التطبيقِ المصغَّرِ. يُزادُ
--   حَكَمٌ واحدٌ `sos_surface_state` يُجيبُ السؤالَ كاملاً في قراءةٍ ذرّيّةٍ
--   واحدةٍ، وتُوسَّعُ `trigger_sos` بالتوقيعِ نفسِه لتقبلَ **نافذةَ ما بعدَ
--   الرحلةِ**: مَن انتهت رحلتُه قبلَ دقائقَ ما يزالُ في مكانِها.
-- الحالة: منفّذ فعلياً — 2026-09-14.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/safety/sos-surface-store.ts
--             ← packages/application/safety/sos-surface.ts
--             ← apps/gateway/src/routes/safety.ts
--             ← apps/miniapp/src/surfaces/rider/sos
-- الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
--         وسابقُه القائمُ: docs/adr/0077-sos-intake-resolves-its-own-order.md
--
-- ## العطبُ الأوّلُ: الاستغاثةُ تنقطعُ في اللحظةِ التي تبدأُ فيها الحاجةُ
--
-- `trigger_sos` منذُ `F8-05` تَحُلُّ الطلبَ القائمَ بنفسِها، **والقائمُ وحدَه**.
-- فما إن تُختَمَ الرحلةُ `completed` أو `cancelled` حتّى يُجابَ المُبلِّغُ
-- `NO_ACTIVE_ORDER` — وهوَ ما يزالُ على الرصيفِ نفسِه معَ الشخصِ نفسِه. وأخطرُ
-- دقائقِ رحلةٍ ليست أثناءَها بل عندَ النزولِ منها، وهيَ بالضبطِ الدقائقُ التي
-- كانَ النظامُ يُغلِقُ فيها البابَ.
--
-- والنافذةُ **إعدادٌ لا عددٌ مكتوبٌ** (القاعدة 0.3)، وتُقرأُ بمدينةِ **الطلبِ**
-- لا بمدينةِ المُبلِّغِ: الحادثُ يقعُ حيثُ وقعَت الرحلةُ، وفريقُ التصعيدِ الذي
-- سيستقبلُه فريقُ تلكَ المدينةِ. وحينَ يغيبُ الإعدادُ يُنشَرُ مصدرُ القيمةِ
-- باسمِه (`FALLBACK_DEFAULT`) ولا يُخفى خلفَ رقمٍ يبدو مضبوطاً.
--
-- ### ومعنى «انتهت» يُقرأُ بختمٍ مُعلَنٍ لا بتخمينٍ
--
-- `completed_at` هوَ الختمُ الصادقُ للرحلةِ المكتملةِ. وأمّا الملغاةُ فلا ختمَ
-- إنهاءٍ لها في المخطَّطِ، فيُقرأُ `updated_at` — **وهوَ آخرُ كتابةٍ لا لحظةُ
-- الإلغاءِ**، وكتابةٌ لاحقةٌ تُطيلُ النافذةَ. وهذا انحرافٌ **مُعلَنٌ** لا مطويٌّ،
-- واتّجاهُه مقصودٌ: يُخطئُ نحوَ **السماحِ** بالنداءِ لا نحوَ منعِه. ومَن أرادَ
-- ختماً دقيقاً للإلغاءِ فذاكَ عمودٌ يُضافُ في بندٍ يخصُّه، لا تخمينٌ يُكتَبُ ههنا.
--
-- ## العطبُ الثاني: الزرُّ كانَ سيكذبُ قبلَ أن يُضغَطَ
--
-- زرُّ استغاثةٍ يُعرَضُ دائماً ثمَّ يردُّ «لا رحلةَ قائمةٌ» عندَ الضغطِ **وعدٌ
-- مكسورٌ في أسوأِ لحظةٍ**. وزرٌّ رماديٌّ مُعطَّلٌ أسوأُ: يُرى ولا يُفهَمُ لِمَ.
-- فالحكمُ يُقرأُ **قبلَ العرضِ** من `sos_surface_state`، والبطاقةُ تُخفي نفسَها
-- إن لم يكن ثمَّةَ ما يُقالُ، وتُعلِنُ السببَ مُصنَّفاً إن كانَ.
--
-- ### ولماذا حَكَمٌ واحدٌ لا ثلاثُ قراءاتٍ
--
-- السؤالُ ثلاثيُّ الأطرافِ: أيجوزُ النداءُ؟ وهل ناديتُ قبلَ قليلٍ وما حالُ
-- ندائي؟ وماذا سيُفصَحُ عنّي إن ناديتُ؟ وثلاثُ قراءاتٍ من الواجهةِ تعني ثلاثَ
-- لحظاتٍ مختلفةٍ في شاشةٍ واحدةٍ: بطاقةٌ تقولُ «يجوزُ» وحادثٌ يقولُ «مفتوحٌ»
-- لرحلةٍ أخرى. فقراءةٌ ذرّيّةٌ واحدةٌ **تُلغي الاحتمالَ** لا تُقلِّلُه.
--
-- ### وعُمرُ الحادثِ بساعةِ القاعدةِ لا بساعةِ الجهازِ
--
-- الهاتفُ يُضبَطُ يدوياً وقد يُخالِفُ بساعاتٍ. و«بلاغُكَ منذُ دقيقتَينِ» محسوبةً
-- على جهازٍ مُنحرِفٍ تقولُ «منذُ ساعتَينِ» فيُعادُ النداءُ ظنّاً أنَّ الأوّلَ
-- ضاعَ، أو تقولُ «الآنَ» فيُنتَظَرُ ردٌّ لن يأتيَ. فالعُمرُ يُحسَبُ ههنا.
--
-- ### ولِمَ الحادثُ المنشورُ حادثُ **الطلبِ المحلولِ** لا آخرُ حادثٍ مطلقاً
--
-- لأنَّ البطاقةَ بطاقةُ هذه الرحلةِ. وحادثٌ مُغلَقٌ من الشهرِ الماضي يظهرُ في
-- شاشةِ رحلةِ اليومِ **ضجيجٌ يُفسَّرُ حالةً قائمةً**، وكانَ سيقتضي إعداداً
-- ثالثاً لمدّةِ ظهورِه — سطحٌ يُزادُ لِيُحَلَّ ما لا يجبُ أن يُعرَضَ أصلاً.
--
-- ## الإفصاحُ يُقرأُ من القاعدةِ لأنّه مشروطٌ بما **سيُكتَبُ فعلاً**
--
-- «يُرسَلُ موقعُكَ» ليست جملةً ثابتةً: للسائقِ تُقرأُ من `drivers.last_location`
-- وقد تكونُ غائبةً، فيصيرُ الصدقُ `SOS_NO_LOCATION_AVAILABLE`. فالقاعدةُ تقولُ
-- **أيُّ** الرموزِ ينطبقُ الآنَ، والمجالُ المغلقُ لتلكَ الرموزِ مُعرَّفٌ في
-- `packages/domain/safety/sos-surface.ts` — ورمزٌ خارجَه يُقرأُ عطبَ عقدٍ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- • **لا تُرخي `safety_incidents.order_id`**: يبقى `not null`. وحادثٌ بلا طلبٍ
--   أبداً بندٌ آخرُ (`F12-03`)، وجوابُه ههنا `NO_ACTIVE_ORDER` مُصنَّفاً.
-- • **لا تُغيِّرُ مفاتيحَ مُرجَعِ `trigger_sos` ولا رموزَه ولا توقيعَه**، ولا
--   تمسُّ القفلَ الاستشاريَّ ولا نافذةَ منعِ التكرارِ ولا الإيداعَ في الصندوقِ.
-- • **لا تتّصلُ بأحدٍ ولا تنتظرُ خارجاً**: الضغطةُ تُقيِّدُ وتُودِعُ وترجعُ
--   (§٧: p99 ≤ 500ms)، والإيصالُ عملُ عاملِ الصندوقِ.
-- • **لا تعرفُ مالاً ولا أجرةً ولا عقوبةً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
--
-- ## مسارُ العودةِ (`OPS-010`)
--
-- `trigger_sos`: إعادةُ تعريفِها من هجرةِ `20260910210000` حرفاً. ولا عمودَ
-- أُضيفَ ولا نوعَ ولا قيدَ، فالعودةُ شيفرةٌ لا مخطَّطٌ، **ولا تكسرُ الإصدارَ
-- السابقَ**: النسخةُ القديمةُ تعملُ معَ كلِّ مُنادٍ قائمٍ، وغايةُ ما يقعُ أن
-- يُجابَ مَن انتهت رحلتُه `NO_ACTIVE_ORDER` كما كانَ يُجابُ قبلَ اليومِ.
-- `sos_surface_state`: دالّةٌ جديدةٌ، وعودتُها `drop function`، ومعَها يعودُ
-- سطحُ الواجهةِ إلى الإخفاءِ الكاملِ — ولا بياناتٍ تُفقَدُ لأنّها قارئةٌ محضةٌ.
-- والإعدادُ المزروعُ يبقى: صفٌّ في `platform_settings` لا يضرُّ مَن لا يقرؤُه.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ١) الإعدادُ: نافذةُ ما بعدَ الرحلةِ — قيمةُ عملٍ في القاعدةِ لا في الشيفرةِ.
-- -----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'sos_post_ride_window_minutes', '30'::jsonb, 'number',
       'المدّةُ بالدقائقِ التي يبقى فيها زرُّ الاستغاثةِ مفتوحاً بعدَ انتهاءِ الرحلةِ — أخطرُ دقائقِ الرحلةِ دقائقُ النزولِ منها (F2-10 · SR-14).',
       false
  from cities c
on conflict (city_id, key) do nothing;

-- -----------------------------------------------------------------------------
-- ٢) قارئُ النافذةِ — **موضعٌ واحدٌ** يقرؤُه الحاكمُ والحَكَمُ معاً.
--
-- يُرجِعُ القيمةَ **ومصدرَها باسمِه**: `SETTING` إن كانَ الصفُّ موجوداً،
-- و`FALLBACK_DEFAULT` إن غابَ. ورقمٌ بلا مصدرٍ يُقرأُ في الشاشةِ وعداً مضبوطاً
-- وهوَ افتراضٌ، فيُفسَّرُ سياسةً مُقرَّرةً وهوَ نقصُ إعدادٍ لم يُلحَظْ.
-- والغلافُ الأدنى `1` لأنَّ نافذةَ صفرٍ تُساوي إطفاءَ البندِ بخطأٍ مطبعيٍّ في
-- إعدادٍ، وإطفاءُ سطحِ استغاثةٍ لا يجوزُ أن يقعَ بلا قرارٍ مكتوبٍ.
-- -----------------------------------------------------------------------------
create or replace function sos_post_ride_window(p_city_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_raw jsonb;
  v_minutes integer;
begin
  v_raw := get_setting(p_city_id, 'sos_post_ride_window_minutes');
  if v_raw is null then
    return jsonb_build_object('minutes', 30, 'source', 'FALLBACK_DEFAULT');
  end if;
  v_minutes := greatest(1, (v_raw #>> '{}')::integer);
  return jsonb_build_object('minutes', v_minutes, 'source', 'SETTING');
end;
$fn$;

comment on function sos_post_ride_window(uuid) is
  'نافذةُ بقاءِ زرِّ الاستغاثةِ بعدَ انتهاءِ الرحلةِ بالدقائقِ، ومصدرُ القيمةِ باسمِه (F2-10 · ADR 0111).';

revoke execute on function sos_post_ride_window(uuid) from public, anon, authenticated;
grant execute on function sos_post_ride_window(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- ٣) `trigger_sos` — التوقيعُ نفسُه، والرموزُ نفسُها، ويُزادُ فرعُ النافذةِ.
-- -----------------------------------------------------------------------------
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
  v_post_ride_minutes integer;
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

    /**
     * `F2-10` — نافذةُ ما بعدَ الرحلةِ. **تُجرَّبُ بعدَ القائمِ لا قبلَه**:
     * رحلةٌ جاريةٌ أولى بالنداءِ من رحلةٍ انتهت، ولو قُدِّمَ المنتهي لَأمكنَ أن
     * تُنسَبَ استغاثةٌ واقعةٌ الآنَ إلى رحلةِ الساعةِ الماضيةِ.
     *
     * والنافذةُ تُقرأُ بمدينةِ **الطلبِ** المرشَّحِ: لذلكَ يُختارُ الصفُّ أوّلاً
     * ثمَّ يُوزَنُ عُمرُه — لا يُقرأُ إعدادٌ لمدينةٍ لا يُعرَفُ بعدُ أيُّها هيَ.
     */
    if not found then
      if p_reporter_role = 'rider' then
        select o.* into v_order
          from orders o
          join riders r on r.id = o.rider_id
         where r.user_id = v_actor.id
           and not is_active_order_status(o.status)
         order by coalesce(o.completed_at, o.updated_at) desc
         limit 1
           for update of o;
      else
        select o.* into v_order
          from orders o
          join drivers d on d.id = o.assigned_driver_id
         where d.user_id = v_actor.id
           and not is_driver_engaged_order_status(o.status)
         order by coalesce(o.completed_at, o.updated_at) desc
         limit 1
           for update of o;
      end if;
      if not found then return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_ORDER'); end if;

      v_post_ride_minutes := (sos_post_ride_window(v_order.city_id) ->> 'minutes')::integer;
      if coalesce(v_order.completed_at, v_order.updated_at)
           < now() - make_interval(mins => v_post_ride_minutes) then
        return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_ORDER');
      end if;
    end if;
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
  'يُقيِّدُ استغاثةً ويُودِعُ تسليمَها في المعاملةِ نفسِها. و p_order_id = null معناهُ: حُلَّ الطلبَ القائمَ للمُبلِّغِ بنفسِك، فإن لم يكن فآخرُ رحلةٍ انتهت ضمنَ نافذةِ ما بعدَ الرحلةِ (F8-05 · F2-10 · ADR 0077 · ADR 0111).';

-- إعادةُ قفلِ سطحِ definer بعدَ create or replace.
revoke execute on function trigger_sos(uuid, bigint, text) from public, anon, authenticated;
grant execute on function trigger_sos(uuid, bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- ٤) `sos_surface_state` — الحَكَمُ. قراءةٌ واحدةٌ تُجيبُ السؤالَ ثلاثيَّ الأطرافِ.
--
-- الأطرافُ: أيجوزُ النداءُ ولِمَ لا؟ · وما حالُ ندائي في هذه الرحلةِ وكم عُمرُه؟
-- · وماذا سيُفصَحُ عنّي إن ناديتُ؟ وكلُّها في لحظةٍ واحدةٍ من ساعةِ القاعدةِ.
--
-- **ورمزُ عدمِ الجوازِ هوَ رمزُ `trigger_sos` حرفاً**: لو أجابَ الحَكَمُ برمزٍ
-- من عندِه لَصارَ للسطحِ الواحدِ مفرداتُ رفضٍ مزدوجةٌ، ولَأمكنَ أن يقولَ الحَكَمُ
-- «يجوزُ» ويقولَ الحاكمُ «لا» — وذاكَ زرٌّ يَعِدُ ثمَّ يخلفُ في لحظةِ الخطرِ.
--
-- **ولا يكتبُ شيئاً ولا يُقفِلُ شيئاً**: `stable` قارئةٌ محضةٌ. فقراءةُ الشاشةِ
-- كلَّ ثوانٍ لا يجوزُ أن تُزاحِمَ صفَّ طلبٍ يكتبُ فيه عاملٌ.
-- -----------------------------------------------------------------------------
create or replace function sos_surface_state(
  p_actor_telegram_id bigint,
  p_reporter_role text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_actor users%rowtype;
  v_order orders%rowtype;
  v_incident safety_incidents%rowtype;
  v_window jsonb;
  v_minutes integer;
  v_ended_at timestamptz;
  v_origin text;
  v_dedup integer;
  v_has_location boolean;
  v_reason text;
  v_eligible boolean;
  v_disclosure jsonb;
  v_incident_json jsonb;
begin
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;

  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;

  -- الطلبُ يُحَلُّ بالترتيبِ نفسِه الذي تحلُّه به `trigger_sos`: القائمُ أوّلاً
  -- ثمَّ المنتهي في النافذةِ. وأيُّ افتراقٍ ههنا يعني زرّاً يظهرُ لرحلةٍ ويُقيَّدُ
  -- لأخرى.
  if p_reporter_role = 'rider' then
    select o.* into v_order
      from orders o
      join riders r on r.id = o.rider_id
     where r.user_id = v_actor.id
       and is_active_order_status(o.status)
     order by o.created_at desc
     limit 1;
  else
    select o.* into v_order
      from orders o
      join drivers d on d.id = o.assigned_driver_id
     where d.user_id = v_actor.id
       and is_driver_engaged_order_status(o.status)
     order by o.created_at desc
     limit 1;
  end if;

  if found then
    v_origin := 'ACTIVE_ORDER';
  else
    if p_reporter_role = 'rider' then
      select o.* into v_order
        from orders o
        join riders r on r.id = o.rider_id
       where r.user_id = v_actor.id
         and not is_active_order_status(o.status)
       order by coalesce(o.completed_at, o.updated_at) desc
       limit 1;
    else
      select o.* into v_order
        from orders o
        join drivers d on d.id = o.assigned_driver_id
       where d.user_id = v_actor.id
         and not is_driver_engaged_order_status(o.status)
       order by coalesce(o.completed_at, o.updated_at) desc
       limit 1;
    end if;
    if found then
      v_window := sos_post_ride_window(v_order.city_id);
      v_minutes := (v_window ->> 'minutes')::integer;
      v_ended_at := coalesce(v_order.completed_at, v_order.updated_at);
      if v_ended_at >= now() - make_interval(mins => v_minutes) then
        v_origin := 'RECENT_ORDER';
      else
        v_origin := null;
      end if;
    else
      v_origin := null;
    end if;
  end if;

  if v_origin is null then
    -- لا رحلةَ. **والبطاقةُ تُخفي نفسَها** — وهذا هوَ الرمزُ الذي يقرؤُه سطحُ
    -- الواجهةِ فلا يرسمُ زرّاً رمادياً ولا يَعِدُ بما سيُرفَضُ.
    return jsonb_build_object(
      'ok', true,
      'role', p_reporter_role,
      'order_id', null,
      'origin', null,
      'eligible', false,
      'reason', 'NO_ACTIVE_ORDER',
      'post_ride_window_minutes', null,
      'post_ride_window_source', null,
      'incident', null,
      'disclosure', jsonb_build_array('SOS_NO_PHONE_CALL')
    );
  end if;

  if v_window is null then
    v_window := sos_post_ride_window(v_order.city_id);
  end if;

  -- الموانعُ تُفحَصُ بالترتيبِ الذي تفحصُه به `trigger_sos` نفسُها.
  v_eligible := true;
  v_reason := v_origin;
  if not exists (
    select 1 from cities
     where id = v_order.city_id and is_active and telegram_escalation_group_id is not null
  ) then
    v_eligible := false;
    v_reason := 'ESCALATION_GROUP_MISSING';
  else
    select greatest(1, (value #>> '{}')::integer) into v_dedup
      from platform_settings where city_id = v_order.city_id and key = 'sos_dedup_window_seconds';
    if v_dedup is null then
      v_eligible := false;
      v_reason := 'SOS_DEDUP_SETTING_MISSING';
    end if;
  end if;

  -- حادثُ **هذه الرحلةِ** لهذا المُبلِّغِ وحدَه. وعُمرُه بساعةِ القاعدةِ.
  select * into v_incident from safety_incidents
   where order_id = v_order.id and reporter_user_id = v_actor.id
   order by created_at desc limit 1;
  if found then
    v_incident_json := jsonb_build_object(
      'id', v_incident.id,
      'status', v_incident.status,
      'age_seconds', greatest(0, floor(extract(epoch from (now() - v_incident.created_at)))::integer)
    );
  else
    v_incident_json := null;
  end if;

  -- الإفصاحُ: ما **سيُكتَبُ فعلاً** لا ما يُقالُ عادةً.
  if p_reporter_role = 'driver' then
    select d.last_location is not null into v_has_location
      from drivers d where d.id = v_order.assigned_driver_id;
  else
    v_has_location := v_order.pickup is not null;
  end if;
  v_disclosure := jsonb_build_array(
    case when coalesce(v_has_location, false)
      then 'SOS_SHARES_LAST_LOCATION' else 'SOS_NO_LOCATION_AVAILABLE' end,
    'SOS_SHARES_ORDER_REFERENCE',
    'SOS_SHARES_ROLE',
    'SOS_NOTIFIES_CITY_TEAM',
    'SOS_NO_PHONE_CALL'
  );

  return jsonb_build_object(
    'ok', true,
    'role', p_reporter_role,
    'order_id', v_order.id,
    'origin', v_origin,
    'eligible', v_eligible,
    'reason', v_reason,
    'post_ride_window_minutes', (v_window ->> 'minutes')::integer,
    'post_ride_window_source', v_window ->> 'source',
    'incident', v_incident_json,
    'disclosure', v_disclosure
  );
end;
$fn$;

comment on function sos_surface_state(bigint, text) is
  'حَكَمُ سطحِ الاستغاثةِ: جوازُ النداءِ وسببُه المُصنَّفُ، وحالُ حادثِ الرحلةِ وعُمرُه بساعةِ القاعدةِ، وقائمةُ الإفصاحِ رموزاً — قراءةٌ واحدةٌ ذرّيّةٌ (F2-10 · SR-14 · ADR 0111).';

revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;
grant execute on function sos_surface_state(bigint, text) to service_role;
