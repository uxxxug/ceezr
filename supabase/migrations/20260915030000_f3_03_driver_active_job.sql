-- migration-phase: expand
-- =============================================================================
-- `F3-03` · `SD-05` — مَهمّةُ السائقِ النشطةُ وأطوارُها: قراءةٌ واحدةٌ تقولُ
--   **أيُّ زرٍّ الآنَ**، وثلاثةُ انتقالاتٍ **لكلٍّ منها كاتبٌ واحدٌ**.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-job.test.ts · scripts/check-driver-job-contract.ts
-- الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
--
-- ## العمودُ الذي كانَ غائباً بإعلانٍ — `arrived_at`
--
-- `F2-06` أعلنَ العائقَ بنصِّه: «لا طَورَ (وصلَ السائقُ) فلا عمودَ `arrived_at`»،
-- وقالَت هجرتُه إنَّ كاتبَ ذاكَ الطورِ **تطبيقُ السائقِ** (`SD-05` · `F3-03`)
-- وهوَ غيرُ مبنيٍّ. فهذا هوَ موضعُه: يُضافُ العمودُ **وكاتبُه معاً في هجرةٍ
-- واحدةٍ** — لأنَّ عموداً بلا كاتبٍ خانةٌ فارغةٌ تُقرأُ ميزةً، وكاتباً بلا عمودٍ
-- محالٌ.
--
-- **والطورُ ختمُ فعلِ إنسانٍ لا استنتاجُ مسافةٍ**: «قاربَ السائقُ» ليسَ «وصلَ».
-- ولو اشتُقَّ الطورُ من `st_distance` لَرأى الراكبُ «وصلَ سائقُك» وسائقُه واقفٌ
-- في الإشارةِ على مئةِ مترٍ — وهوَ كذبٌ يُخرِجُ راكباً إلى الشارعِ ليلاً. فلا
-- شرطَ قُربٍ ههنا ألبتّةَ، ولا `st_distance` في هذه الهجرةِ.
--
-- ## ولكلِّ انتقالٍ **كاتبُه القائمُ** (القاعدة 0.6)
--
-- `start_ride(uuid, bigint)` و`complete_ride(uuid, bigint)` قائمتانِ منذُ
-- `20260807170000`/`20260808120000`: تقفلانِ الصفَّ `for update`، وتشترطانِ
-- الحالةَ والإسنادَ، وتكتبانِ `audit_log`، و`complete_ride` تُعيدُ السائقَ
-- متاحاً. فـ`driver_start_ride` و`driver_complete_ride` **تُفوِّضانِ إليهما**:
-- لا `for update` ولا `update orders set status` لهذَينِ الطورَينِ في هذا
-- الملفِّ ألبتّةَ. وذرّيّةٌ ثانيةٌ لا تكونُ «تعزيزاً» بل تكونُ حُكمَينِ في
-- انتقالٍ واحدٍ يومَ يختلفُ الشرطانِ.
--
-- **والغلافُ لا يخترعُ شرطاً ثانياً**: لا يشترطُ `arrived_at is not null` قبلَ
-- البدءِ، لأنَّ الكاتبَ القائمَ لا يشترطُه — وشرطٌ في الغلافِ وحدَه يجعلُ البدءَ
-- من البوتِ جائزاً ومن التطبيقِ ممنوعاً، فيصيرُ للنظامِ حُكمانِ. وترتيبُ
-- الأزرارِ يُوجَّهُ بـ`next_action` في القراءةِ لا بمنعٍ في الكتابةِ.
--
-- ## والمِلكيّةُ قيدُ استعلامٍ لا فحصُ طبقةٍ (القاعدة 0.5)
--
-- كلُّ دالّةٍ ههنا تشترطُ `assigned_driver_id = v_driver.id` **في `where`**،
-- ومَهمّةُ سائقٍ آخرَ تُرَدُّ `JOB_NOT_FOUND` — **بالرمزِ نفسِه** الذي يُرَدُّ به
-- معرِّفٌ معدومٌ، فلا يصيرُ الرمزُ عدَّادَ معرّفاتٍ صحيحةٍ لمن يجرِّبُها.
--
-- ## وما لا تفعلُه هذه الدوالُّ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُعلِنُ رقمَ هاتفِ الراكبِ ولا معرِّفَ تلغرامِه**: `F2-06` منعَ
--      الرقمَ (الاتّصالُ المُقنَّعُ غيرُ مبنيٍّ)، و`driver_accept_offer` أسقطَ
--      المعرِّفَ. والمنشورُ **الاسمُ الأوّلُ** ولغةُ الخطابِ وحدَهما — وأمّا
--      `start_ride`/`complete_ride` فتُعيدانِ الطرفَينِ كاملَينِ للبوتِ،
--      **والغلافُ ههنا يُنقّي جوابَهما** ولا يُمرِّرُه.
--   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ ولا خانةً لهما** (`ADR 0039` §٤ ·
--      `م13-7` · `DEC-11`) — والحاجزُ يُسقِطُ CI على لفظٍ منها في هذه الشريحةِ.
--   ــ **لا تُقدِّرُ زمنَ وصولٍ ولا مدّةَ بقاءٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`).
--   ــ **لا تنشرُ موضعَ السائقِ ولا موضعَ الراكبِ الحيَّ**: `BUG-001` قائمٌ،
--      و`F3-04` بندُ البثِّ.
--   ــ **لا تُرسِلُ إخطاراً**: الإخطارُ صندوقُ الصادرِ القائمُ.
--   ــ **لا تُلغي رحلةً**: `cancel_ride_by_telegram` كاتبُ الإلغاءِ القائمُ،
--      وسياسةُ الإلغاءِ بعدَ الإسنادِ **مُجمَّدةٌ بقرارٍ** لا بتقصيرٍ.
-- =============================================================================

-- ── ١) العمودُ — ختمُ «وصلتُ»، وقيدُه يمنعُ ختماً بلا سائقٍ ────────────────────
-- والقيدُ **ليسَ زينةً**: ختمُ وصولٍ على طلبٍ لا سائقَ له صفٌّ يقولُ «وصلَ
-- لا أحدٌ»، وهوَ ما لا يُقرأُ ولا يُصحَّحُ لاحقاً. والصفوفُ القائمةُ كلُّها
-- `null` في هذا العمودِ، فالتحقُّقُ فوريٌّ ولا يحتاجُ طَورَ `validate` منفصلاً.
alter table orders add column if not exists arrived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_arrived_requires_driver'
  ) then
    alter table orders
      add constraint orders_arrived_requires_driver
      check (arrived_at is null or assigned_driver_id is not null);
  end if;
end;
$$;

comment on column orders.arrived_at is
  'ختمُ طورِ «وصلَ السائقُ إلى نقطةِ الالتقاطِ» بساعةِ القاعدةِ — يكتبُه driver_mark_arrived وحدَه بفعلِ إنسانٍ، ولا يُشتَقُّ من قُربِ مسافةٍ أبداً (F3-03 · SD-05، وهوَ العائقُ المُعلَنُ في F2-06).';

-- ── ٢) القراءةُ — مَهمّةٌ واحدةٌ، وحكمُ الخادمِ على زرِّ المرحلةِ ─────────────
-- والفراغُ يُنشَرُ **عَدَماً صريحاً** (`job: null`) لا قائمةً فارغةً ولا عطباً:
-- سائقٌ بلا مَهمّةٍ حالٌ سويّةٌ لا خطأٌ، والشاشةُ تقولُها ولا تدورُ منتظرةً.
create or replace function driver_active_job(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_order orders%rowtype;
  v_rider riders%rowtype;
  v_rider_user users%rowtype;
  v_rider_first_name text;
  v_next_action text;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- «مَهمّتي» = ما التزمَ به هذا السائقُ ولمّا يُكملْه، بمعنى `orders` الواحدِ
  -- لا بقائمةٍ مكتوبةٍ نصّاً ههنا (`is_driver_engaged_order_status` · القاعدة 0.6).
  -- وأحدثُ إسنادٍ أوّلاً: صفوفٌ قديمةٌ عالقةٌ لا تحجبُ المَهمّةَ القائمةَ.
  select * into v_order
    from orders
   where assigned_driver_id = v_driver.id
     and is_driver_engaged_order_status(status)
   order by matched_at desc nulls last
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'server_time', v_now, 'job', null);
  end if;

  select * into v_rider from riders where id = v_order.rider_id;
  if found then
    select * into v_rider_user from users where id = v_rider.user_id;
  end if;

  -- **الاسمُ الأوّلُ وحدَه**: سائقٌ ينادي راكبَه باسمِه الأوّلِ يكفيهِ، واللقبُ
  -- الكاملُ توسيعٌ للسطحِ بلا حاجةٍ. والفراغُ يُنشَرُ عَدَماً لا نصّاً فارغاً.
  v_rider_first_name := nullif(split_part(coalesce(trim(v_rider_user.full_name), ''), ' ', 1), '');

  -- **حكمُ الخادمِ على زرِّ المرحلةِ** — لا تحكمُ الشاشةُ عليه بنفسِها، وزرٌّ
  -- تفتحُه الشاشةُ وترفضُه القاعدةُ عطبُ منتَجٍ. والحكمُ مُشتقٌّ من الحالةِ
  -- والختمِ وحدَهما، **ولا من مسافةٍ**.
  v_next_action := case
    when v_order.status = 'matched' and v_order.arrived_at is null then 'MARK_ARRIVED'
    when v_order.status = 'matched' then 'START_RIDE'
    when v_order.status = 'in_progress' then 'COMPLETE_RIDE'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    -- لحظةُ الخادمِ تُنشَرُ أبداً: كلُّ عُمرٍ في الشاشةِ فرقٌ عنها لا فرقٌ عن
    -- ساعةِ الجهازِ (نفسُ حكمِ `F3-02`).
    'server_time', v_now,
    'job', jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'service', v_order.service,
      'next_action', v_next_action,
      'matched_at', v_order.matched_at,
      'arrived_at', v_order.arrived_at,
      'started_at', v_order.started_at,
      'pickup', jsonb_build_object(
        'label', v_order.pickup_label,
        'latitude', st_y(v_order.pickup::geometry),
        'longitude', st_x(v_order.pickup::geometry)
      ),
      -- ورحلةٌ بلا وجهةٍ **عَدَمٌ لا صفرٌ** (`ADR 0023`).
      'dropoff', case
        when v_order.dropoff is null then null
        else jsonb_build_object(
               'label', v_order.dropoff_label,
               'latitude', st_y(v_order.dropoff::geometry),
               'longitude', st_x(v_order.dropoff::geometry))
      end,
      'notes', v_order.notes,
      -- **بياناتُ الراكبِ المسموحةُ** وحدَها: لا هاتفَ ولا معرِّفَ تلغرامَ.
      'rider', jsonb_build_object(
        'first_name', v_rider_first_name,
        'language_code', v_rider_user.language_code
      )
    )
  );
end;
$fn$;

comment on function driver_active_job(bigint) is
  'مَهمّةُ السائقِ النشطةُ في قراءةٍ واحدةٍ: الحالةُ وأختامُ الأطوارِ ونقطتا الرحلةِ وملاحظةُ الراكبِ واسمُه الأوّلُ ولغتُه، ومعَها next_action حكماً من الخادمِ على زرِّ المرحلةِ. ولا هاتفَ ولا معرِّفَ تلغرامَ للراكبِ ولا أجرةَ ولا موضعَ حيَّ (SD-05).';

-- ── ٣) «وصلتُ» — الطورُ الوحيدُ الذي لم يكن له كاتبٌ، فهذا كاتبُه ─────────────
create or replace function driver_mark_arrived(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_order orders%rowtype;
  v_now timestamptz := now();
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- القفلُ على الصفِّ **والمِلكيّةُ في `where`**: مَهمّةُ غيرِه ومعرِّفٌ معدومٌ
  -- جوابُهما واحدٌ بالحرفِ.
  select * into v_order
    from orders
   where id = p_order_id and assigned_driver_id = v_driver.id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- و«ختمتُ سلفاً» **ليسَ عطباً ولا نجاحاً صامتاً**: يُقالُ صريحاً بختمِه
  -- الأوّلِ، فضغطتانِ من إبهامٍ واحدٍ لا تُزحزِحانِ لحظةَ وصولٍ حدثَت مرّةً.
  if v_order.arrived_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_ARRIVED',
                              'arrived_at', v_order.arrived_at);
  end if;

  -- والطورُ لا يُختَمُ إلّا في حالتِه: بعدَ الإسنادِ وقبلَ البدءِ.
  if v_order.status <> 'matched' then
    return jsonb_build_object('ok', false, 'error', 'PHASE_MISMATCH', 'status', v_order.status);
  end if;

  update orders set arrived_at = v_now, updated_at = v_now where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user.id, 'order.driver_arrived', 'order', p_order_id,
          jsonb_build_object('driver_id', v_driver.id));

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'arrived_at', v_now);
end;
$fn$;

comment on function driver_mark_arrived(bigint, uuid) is
  'ختمُ طورِ «وصلتُ إلى نقطةِ الالتقاطِ» — الكاتبُ الوحيدُ لـ orders.arrived_at، بفعلِ السائقِ المُسنَدِ وحدَه وعلى طلبٍ matched لم يُختَمْ. ولا يُشتَقُّ من مسافةٍ ولا يُحدِّثُ حالةَ الطلبِ (SD-05).';

-- ── ٤) «بدأتُ الرحلةَ» — تفويضٌ إلى `start_ride` ثمَّ تنقيةُ الجوابِ ──────────
create or replace function driver_start_ride(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_owned boolean;
  v_result jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- المِلكيّةُ تُفحَصُ **لتمييزِ الرمزِ** لا لتقييدِ الانتقالِ: `start_ride`
  -- تشترطُ الإسنادَ في `where` كذلكَ، لكنَّها تردُّ `ORDER_NOT_STARTABLE`
  -- للحالةِ وللمِلكيّةِ معاً — ورمزٌ واحدٌ لسببَينِ يُري السائقَ «الحالةُ لا
  -- تسمحُ» عن مَهمّةٍ ليسَت لهُ أصلاً.
  select exists(
    select 1 from orders where id = p_order_id and assigned_driver_id = v_driver.id
  ) into v_owned;

  if not v_owned then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- **ههنا يقفُ حدُّ هذه الدالّةِ**: لا قفلَ ولا تحديثَ حالةٍ ولا سجلَّ تدقيقٍ —
  -- كلُّ ذاكَ في `start_ride` وحدَها.
  v_result := start_ride(p_order_id, p_telegram_id);

  if coalesce((v_result->>'ok')::boolean, false) then
    -- **التنقيةُ**: `start_ride` تُعيدُ الطرفَينِ بمعرِّفَي تلغرامَ للبوتِ،
    -- وسطحُ السائقِ لا يحتاجُهما — فلا يُنشَرُ ما لا تحتاجُه الشاشةُ.
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'started_at', v_result->>'started_at'
    );
  end if;

  -- ورمزُ الكاتبِ يُترجَمُ إلى مجالِ هذا السطحِ المغلقِ، ولا يُمرَّرُ خاماً:
  -- `DRIVER_NOT_FOUND` منه محالٌ ههنا (حُلَّت الهويّةُ سلفاً)، و«لا تُبدأُ»
  -- حالةٌ لا مِلكيّةٌ لأنَّ المِلكيّةَ فُحِصَت أعلاه.
  return jsonb_build_object(
    'ok', false,
    'error', case v_result->>'error'
      when 'ORDER_NOT_STARTABLE' then 'PHASE_MISMATCH'
      when 'DRIVER_NOT_FOUND' then 'NOT_A_DRIVER'
      else 'TRANSITION_REFUSED'
    end
  );
end;
$fn$;

comment on function driver_start_ride(bigint, uuid) is
  'بدءُ الرحلةِ من سطحِ السائقِ: يفحصُ المِلكيّةَ لتمييزِ الرمزِ ثمَّ يُفوِّضُ الذرّيّةَ إلى start_ride القائمةِ ويُنقّي جوابَها من هويّةِ الراكبِ. ولا شرطَ ثانياً يُخترَعُ في الغلافِ (SD-05).';

-- ── ٥) «أنهيتُ» — تفويضٌ إلى `complete_ride` ثمَّ تنقيةُ الجوابِ ──────────────
create or replace function driver_complete_ride(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_owned boolean;
  v_result jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select exists(
    select 1 from orders where id = p_order_id and assigned_driver_id = v_driver.id
  ) into v_owned;

  if not v_owned then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- التفويضُ كما في البدءِ: `complete_ride` تقفلُ وتكتبُ وتُعيدُ السائقَ متاحاً.
  v_result := complete_ride(p_order_id, p_telegram_id);

  if coalesce((v_result->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'completed_at', v_result->>'completed_at',
      -- المدّةُ **مقيسةٌ في الكاتبِ** من ختمِ البدءِ إلى ختمِ الإنهاءِ — تُنقَلُ
      -- ولا تُعادُ حسبةً ههنا، فلا حاسبانِ لرقمٍ واحدٍ.
      'duration_seconds', (v_result->>'duration_seconds')::integer
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', case v_result->>'error'
      when 'ORDER_NOT_COMPLETABLE' then 'PHASE_MISMATCH'
      when 'DRIVER_NOT_FOUND' then 'NOT_A_DRIVER'
      else 'TRANSITION_REFUSED'
    end
  );
end;
$fn$;

comment on function driver_complete_ride(bigint, uuid) is
  'إنهاءُ الرحلةِ من سطحِ السائقِ: يفحصُ المِلكيّةَ لتمييزِ الرمزِ ثمَّ يُفوِّضُ الذرّيّةَ إلى complete_ride القائمةِ (وهيَ التي تُعيدُ السائقَ متاحاً) ويُنقّي جوابَها من هويّةِ الراكبِ (SD-05).';

-- ── ٦) الصلاحيّاتُ — لا شيءَ لـ`anon` ولا لـ`authenticated` ─────────────────
-- `postgres` يمنحُ `execute` لدورِ `public` على كلِّ دالّةٍ جديدةٍ تلقائيّاً،
-- فدالّةٌ لا يُنزَعُ عنها التنفيذُ تصيرُ منالاً بالمفتاحِ العامِّ المنشورِ في
-- العميلِ. والحكمُ الذي كشفَ هذا في `F2-06` كانَ حكمَ CI لا فحصاً محلّيّاً.
revoke all on function driver_active_job(bigint) from public, anon, authenticated;
revoke all on function driver_mark_arrived(bigint, uuid) from public, anon, authenticated;
revoke all on function driver_start_ride(bigint, uuid) from public, anon, authenticated;
revoke all on function driver_complete_ride(bigint, uuid) from public, anon, authenticated;

grant execute on function driver_active_job(bigint) to service_role;
grant execute on function driver_mark_arrived(bigint, uuid) to service_role;
grant execute on function driver_start_ride(bigint, uuid) to service_role;
grant execute on function driver_complete_ride(bigint, uuid) to service_role;
