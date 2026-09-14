-- =============================================================================
-- migration-phase: expand
-- الغرض: `F2-11` · `SR-12` — حقّانِ يُنفَّذانِ فعلاً لا زرّانِ صوريّانِ (§9.12):
--   **تنزيلُ بياناتي** و**حذفُ حسابي**. حَكَمانِ في القاعدةِ: `export_my_data`
--   يبني الحزمةَ المحمولةَ بأعمدةٍ مُسمّاةٍ لا بـ`*`، و`erase_my_account`
--   يُنفِّذُ الحذفَ ذرّيّاً تحتَ قفلِ صفِّ المستخدمِ ويُصدِرُ **إيصالاً يقولُ ما
--   بقيَ ولِمَ بقيَ**.
-- الحالة: منفّذ فعلياً — 2026-09-14.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/privacy/data-rights-store.ts
--             ← packages/application/privacy/{export-my-data,erase-my-account}.ts
--             ← apps/gateway/src/routes/me-data-rights.ts
--             ← apps/miniapp/src/surfaces/rider/account
-- الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
--         والسجلُّ الحاكمُ: packages/shared/config/erasure-policy.ts
--
-- ## العطبُ الأوّلُ: المخطّطُ كانَ يُخالِفُ سياسةَ الاستبقاءِ المُعلَنةَ
--
-- `user_consents` مُصنَّفٌ في `retention-policy.ts` بـ
-- `audit-unbounded-until-compliance` — أي **لا مدّةَ له**، لأنَّه دليلُ
-- الامتثالِ الذي يُطلَبُ منّا إبرازُه. ومفتاحُه الأجنبيُّ كانَ
-- `on delete cascade` على `users`. فأوّلُ `delete from users` — من هذا البندِ
-- أو من يدٍ إداريّةٍ أو من مهمّةِ صيانةٍ — كانَ **يمحو إثباتَ الموافقةِ صامتاً
-- ويُخالِفُ صنفَه المكتوبَ**. وهذا تناقضُ إقرارَينِ لا نقصُ ميزةٍ: السجلُّ يقولُ
-- «لا يُحَدُّ» والمخطّطُ يقولُ «يذهبُ معَ صاحبِه». فقُلِبَ إلى `restrict` كي
-- يستحيلَ ذلكَ **آليّاً لا بحسنِ النيّةِ** — والحذفُ من بعدُ لا طريقَ له إلّا
-- التجهيلَ، وذاكَ هوَ القرارُ الصحيحُ أصلاً.
--
-- ## العطبُ الثاني: «حُذِفَ حسابُكَ» جملةٌ كاذبةٌ إن قيلَت وحدَها
--
-- فاتورةُ المستخدمِ تبقى ستَّ سنينَ بحدٍّ أدنى، وبلاغُ سلامتِه قد يكونَ محلَّ
-- نزاعٍ، وتقييمُه شهادةٌ لسائقٍ متوسّطُه مبنيٌّ عليها، ورحلتُه صفٌّ للطرفِ
-- الآخرِ فيه استحقاقٌ. فمن يُطمئِنُه بأنَّ «كلَّ شيءٍ مُحِيَ» يكذبُ عليه.
-- فالمردُّ ههنا **إيصالٌ مُصنَّفٌ**: ما مُحِيَ صفّاً · ما جُهِّلَ · **وما بقيَ
-- وبأيِّ أساسٍ** — يُعرَضُ نصّاً من القاموسِ لا يُختَرَعُ في الشاشةِ.
--
-- ## ولِمَ الحكمُ في القاعدةِ لا في التطبيقِ
--
-- الحذفُ يَمَسُّ اثنَي عشرَ جدولاً، ودورةُ رحلةٍ قد تجري في أثنائِه. فلو كانَ
-- الحكمُ طلباتٍ متتاليةً من التطبيقِ لأمكنَ أن يُمحى مكانٌ محفوظٌ ثمَّ يُخفِقَ
-- التجهيلُ فيبقى الحسابُ حيّاً ناقصاً بلا أثرٍ. وههنا معاملةٌ واحدةٌ تحتَ
-- `select ... for update` على صفِّ المستخدمِ: تتمُّ كلُّها أو لا شيءَ منها.
-- **ويُرَدُّ الحذفُ صريحاً عندَ طلبٍ نشطٍ** (`ACTIVE_ORDER`): لا يُجهَّلُ راكبٌ
-- في منتصفِ رحلةٍ فيبقى سائقُه معَ صفٍّ لا اسمَ له.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- ــ **لا تُقرِّرُ مدّةً**: كلُّ مدّةٍ في `retention-policy.ts` (`DEC-15`)، وما
--    كانَ `pending-decision-f12-10` يبقى لـ`F12-10`.
-- ــ **لا تحذفُ حسابَ سائقٍ**: `SD-12`. وجداولُ السائقِ مُعلَنةٌ في سجلِّ
--    الحذفِ بحكمِها وبـ`deferredTo` — ديناً مكتوباً لا سهواً. والدالّةُ ههنا
--    **تردُّ `NOT_A_RIDER`** لمن ليسَ راكباً، فلا تحذفُ نصفَ حسابِ سائقٍ.
-- ــ **لا تُصدِرُ رمزاً حيّاً في التنزيلِ**: `trip_tracking_tokens.token` رابطُ
--    مشاركةٍ نافذٌ و`broadcast_recipients.claim_token` رمزُ مطالبةٍ، وتنزيلُهما
--    يُسلِّمُ مفتاحاً عاملاً لمن يقرأُ الملفَّ. فيُنزَّلُ وجودُهما لا قيمتُهما.
-- ــ **لا تُظهِرُ بيانةَ الطرفِ الآخرِ**: رحلةُ الراكبِ تُنزَّلُ بلا معرّفِ
--    سائقِها ولا اسمِه، وتقييمٌ نالَه يُنزَّلُ بلا مَن كتبَه. حقُّ الوصولِ حقُّ
--    صاحبِ البيانةِ في **بيانتِه** لا نافذةٌ على غيرِه.
-- ــ **لا تُنشِئُ جدولاً جديداً للإيصالِ**: الإيصالُ يُقيَّدُ في `audit_log`،
--    وصنفُه هناكَ «لا مدّةَ له» وهوَ بعينِه ما يلزمُ إيصالَ حذفٍ (القاعدة 0.6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ١) إثباتُ الموافقةِ لا يذهبُ معَ صاحبِه: `cascade` ← `restrict`
-- -----------------------------------------------------------------------------
-- يُبحَثُ عن المفتاحِ بعمودِه لا باسمٍ مُخمَّنٍ: اسمٌ افتراضيٌّ لم يُطابِقْ يجعلُ
-- `drop constraint if exists` يمرُّ صامتاً فيبقى `cascade` قائماً — وذاكَ أسوأُ
-- من الإخفاقِ لأنَّه يبدو نجاحاً.
do $$
declare
  v_conname text;
begin
  select con.conname
    into v_conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = con.conkey[1]
   where con.conrelid = 'user_consents'::regclass
     and con.contype = 'f'
     and array_length(con.conkey, 1) = 1
     and att.attname = 'user_id';

  if v_conname is null then
    raise exception
      'F2-11: لا مفتاحَ أجنبيّاً واحدَ العمودِ على user_consents.user_id — المخطّطُ غيرُ ما يُفترَضُ';
  end if;

  if v_conname <> 'user_consents_user_id_fkey' then
    raise notice 'F2-11: اسمُ المفتاحِ %، لا الافتراضيُّ — يُسقَطُ باسمِه المقروءِ', v_conname;
  end if;

  execute format('alter table user_consents drop constraint %I', v_conname);

  alter table user_consents
    add constraint user_consents_user_id_fkey
    foreign key (user_id) references users (id) on delete restrict;
end $$;

comment on constraint user_consents_user_id_fkey on user_consents is
  'restrict لا cascade: إثباتُ الموافقةِ دليلُ امتثالٍ صنفُه audit-unbounded-until-compliance، فحذفُ صفِّ users كانَ يمحوه صامتاً ويُخالِفُ صنفَه المُعلَنَ. والحذفُ بطلبِ صاحبِه يكونُ تجهيلاً (F2-11 · ADR 0112).';

-- -----------------------------------------------------------------------------
-- ٢) وسمُ التجهيلِ ومَعرِضُ المعرّفِ البديلِ
-- -----------------------------------------------------------------------------
-- `telegram_id` هوَ `bigint not null unique`، ومعرّفاتُ تيليجرام الحقيقيّةُ
-- موجَبةٌ. فالبديلُ عددٌ **سالبٌ من مَعرِضٍ**: لا يُصادِفُ معرّفاً حقيقيّاً أبداً
-- ولا يتصادمُ بمُجهَّلٍ آخرَ — وذاكَ ما لا يضمنُه اشتقاقٌ من تلبيدٍ.
create sequence if not exists erased_account_telegram_seq as bigint minvalue 1 no cycle;

comment on sequence erased_account_telegram_seq is
  'مَعرِضُ المعرّفِ البديلِ للحساباتِ المُجهَّلةِ: telegram_id يصيرُ -nextval فلا يُصادِفُ معرّفاً حقيقيّاً موجَباً ولا يتصادمُ بغيرِه (F2-11).';

alter table users add column if not exists erased_at timestamptz;

comment on column users.erased_at is
  'ختمُ تجهيلِ الحسابِ بطلبِ صاحبِه. غيرُ فارغٍ ⇒ لا اسمَ ولا رقمَ ولا معرّفَ تيليجرام حقيقيّاً في الصفِّ، وما بقيَ من صفوفٍ تشيرُ إليه مقطوعُ النسبةِ إلى إنسانٍ (F2-11 · ADR 0112).';

-- صفٌّ مُجهَّلٌ لا يُنتظَرُ منه اسمٌ ولا رقمٌ: القيدُ يمنعُ تجهيلاً نصفَ تامٍّ
-- يبدو مُجهَّلاً وفيه بيانةُ تعريفٍ باقيةٌ.
do $$ begin
  alter table users add constraint users_erased_rows_carry_no_identity
    check (
      erased_at is null
      or (full_name is null and phone is null and telegram_username is null and telegram_id < 0)
    );
exception when duplicate_object then null; end $$;

-- **ولا فهرسَ على `erased_at` ههنا عن قصدٍ**: لا استعلامَ في هذا البندِ يُرشِّحُ
-- بهِ — القراءةُ والحذفُ كلاهما بـ`telegram_id` وهوَ مفهرسٌ فريدٌ سلفاً. وفهرسٌ
-- لا قارئَ له كلفةُ كتابةٍ على جدولٍ حارٍّ بلا مقابلٍ مقيسٍ (`ح-5`)، ولو لزمَ
-- تقريرَ امتثالٍ يوماً فمكانُه `F12-10` بملفِّ طَورِ فهرسٍ وحدَه.

-- -----------------------------------------------------------------------------
-- ٣) `export_my_data` — الحزمةُ المحمولةُ بأعمدةٍ مُسمّاةٍ
-- -----------------------------------------------------------------------------
-- كلُّ قسمٍ ههنا يقابلُه `exportSection` في سجلِّ الحذفِ، والحاجزُ
-- `scripts/check-erasure-policy.ts` يُقابِلُ المجموعتَينِ في الاتّجاهَينِ: قسمٌ
-- مفقودٌ يُسقِطُ CI، وقسمٌ بلا جدولٍ يُسقِطُه. فيستحيلُ أن نحكمَ على جدولٍ
-- بالحذفِ ولا نُرِيَ صاحبَه ما فيه، ويستحيلُ أن يُنسى جدولٌ نسياناً صامتاً.
create or replace function export_my_data(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       users;
  v_rider      riders;
  v_city_name  text;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_ERASED');
  end if;

  select * into v_rider from riders where user_id = v_user.id;
  select c.name_ar into v_city_name from cities c where c.id = v_user.city_id;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'subject', 'rider',
    'sections', jsonb_build_object(

      -- profile ← users. لا `id` ولا `city_id`: معرّفاتٌ داخليّةٌ لا بيانةُ
      -- إنسانٍ، واسمُ المدينةِ هوَ ما يعني صاحبَها.
      'profile', jsonb_build_object(
        'telegram_id', v_user.telegram_id,
        'telegram_username', v_user.telegram_username,
        'full_name', v_user.full_name,
        'phone', v_user.phone,
        'language_code', v_user.language_code,
        'role', v_user.role,
        'city', v_city_name,
        'is_blocked', v_user.is_blocked,
        'created_at', v_user.created_at
      ),

      'riderProfile', case when v_rider.id is null then '{}'::jsonb else jsonb_build_object(
        'rating_average', v_rider.rating_average,
        'rating_count', v_rider.rating_count,
        'created_at', v_rider.created_at
      ) end,

      'savedPlaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sp.kind,
          'label', sp.label,
          'latitude', st_y(sp.point::geometry),
          'longitude', st_x(sp.point::geometry),
          'created_at', sp.created_at
        ) order by sp.created_at)
        from saved_places sp where sp.user_id = v_user.id
      ), '[]'::jsonb),

      -- orders: بلا `assigned_driver_id` ولا اسمِ سائقٍ — حقُّ الوصولِ في
      -- بيانتِه لا نافذةٌ على الطرفِ الآخرِ. ويُنزَّلُ **أنَّ سائقاً أُسنِدَ**
      -- لأنَّ ذاكَ واقعةُ رحلتِه، لا **مَن هوَ**.
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', o.service,
          'status', o.status,
          'pickup_label', o.pickup_label,
          'dropoff_label', o.dropoff_label,
          'pickup_latitude', st_y(o.pickup::geometry),
          'pickup_longitude', st_x(o.pickup::geometry),
          'dropoff_latitude', st_y(o.dropoff::geometry),
          'dropoff_longitude', st_x(o.dropoff::geometry),
          'notes', o.notes,
          'driver_was_assigned', (o.assigned_driver_id is not null),
          'matched_at', o.matched_at,
          'started_at', o.started_at,
          'completed_at', o.completed_at,
          'cancelled_reason', o.cancelled_reason,
          'created_at', o.created_at
        ) order by o.created_at)
        from orders o
        where v_rider.id is not null and o.rider_id = v_rider.id
      ), '[]'::jsonb),

      -- ratings: ما أعطاه وما نالَه. وفي المنالِ **لا مَن كتبَه**.
      'ratings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'role', case when r.rater_user_id = v_user.id then 'given' else 'received' end,
          'stars', r.stars,
          'comment', r.comment,
          'is_flagged', r.is_flagged,
          'created_at', r.created_at
        ) order by r.created_at)
        from ratings r
        where r.rater_user_id = v_user.id or r.ratee_user_id = v_user.id
      ), '[]'::jsonb),

      'consents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', uc.kind,
          'version', uc.version,
          'accepted_at', uc.accepted_at
        ) order by uc.accepted_at)
        from user_consents uc where uc.user_id = v_user.id
      ), '[]'::jsonb),

      'notificationsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', un.kind,
          'channel', un.channel,
          'payload', un.payload,
          'created_at', un.created_at,
          'read_at', un.read_at
        ) order by un.created_at)
        from user_notifications un where un.user_id = v_user.id
      ), '[]'::jsonb),

      -- supportTickets: نصُّ شكواه والرَدُّ عليها. بلا `claimed_by_user_id`
      -- ولا `resolved_by_user_id`: هُويّةُ موظَّفِ الدعمِ ليست بيانتَه.
      'supportTickets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', st.type,
          'message', st.message,
          'status', st.status,
          'resolution', st.resolution,
          'created_at', st.created_at,
          'resolved_at', st.resolved_at
        ) order by st.created_at)
        from support_tickets st
        where st.rider_id is not null and v_rider.id is not null and st.rider_id = v_rider.id
      ), '[]'::jsonb),

      'safetyIncidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reporter_role', si.reporter_role,
          'status', si.status,
          'decision', si.decision,
          'last_known_latitude', st_y(si.last_known_location::geometry),
          'last_known_longitude', st_x(si.last_known_location::geometry),
          'created_at', si.created_at,
          'decided_at', si.decided_at
        ) order by si.created_at)
        from safety_incidents si where si.reporter_user_id = v_user.id
      ), '[]'::jsonb),

      -- auditTrail: الفعلُ وختمُه. **بلا `payload`** — قد يحملُ بيانةَ غيرِه،
      -- ومصدرُ حقيقةِ بيانتِه هوَ الأقسامُ أعلاه لا حِمْلُ سجلٍّ.
      'auditTrail', coalesce((
        select jsonb_agg(jsonb_build_object(
          'action', al.action,
          'entity_type', al.entity_type,
          'created_at', al.created_at
        ) order by al.created_at)
        from audit_log al where al.actor_user_id = v_user.id
      ), '[]'::jsonb),

      -- broadcastsReceived: بلا `chat_id` ولا `claim_token` — معرّفُ محادثةٍ
      -- ورمزٌ نافذٌ. ويُنزَّلُ أنَّه بُلِّغَ ومتى.
      'broadcastsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', br.status,
          'language_code', br.language_code,
          'sent_at', br.sent_at,
          'created_at', br.created_at
        ) order by br.created_at)
        from broadcast_recipients br where br.user_id = v_user.id
      ), '[]'::jsonb),

      -- tripTrackingTokens: **وجودُ** رابطِ مشاركةٍ لا قيمتُه. رمزٌ نافذٌ في
      -- ملفٍّ يُنزَّلُ على جهازٍ هوَ مفتاحٌ عاملٌ بيدِ مَن يقرأُ الملفَّ.
      'tripTrackingTokens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'created_at', tt.created_at,
          'expires_at', tt.expires_at,
          'revoked_at', tt.revoked_at,
          'token_disclosed', false
        ) order by tt.created_at)
        from trip_tracking_tokens tt where tt.created_by = p_telegram_id
      ), '[]'::jsonb)
    )
  );
end;
$fn$;

comment on function export_my_data(bigint) is
  'حزمةُ بياناتِ صاحبِ الحسابِ محمولةً: أعمدةٌ مُسمّاةٌ لا *، بلا بيانةِ الطرفِ الآخرِ وبلا رمزٍ نافذٍ — وأقسامُها مُقابَلةٌ بسجلِّ الحذفِ في الحاجزِ (F2-11 · SR-12 · ADR 0112).';

revoke execute on function export_my_data(bigint) from public, anon, authenticated;
grant execute on function export_my_data(bigint) to service_role;

-- -----------------------------------------------------------------------------
-- ٤) `erase_my_account` — حكمٌ ذرّيٌّ وإيصالٌ يقولُ ما بقيَ
-- -----------------------------------------------------------------------------
create or replace function erase_my_account(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user            users;
  v_rider_id        uuid;
  v_active          integer;
  v_places          integer;
  v_notifications   integer;
  v_tokens          integer;
  v_orders          integer;
  v_broadcasts      integer;
  v_consents        integer;
  v_ratings         integer;
  v_tickets         integer;
  v_incidents       integer;
  v_audit           integer;
  v_sentinel        bigint;
  v_receipt         jsonb;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  -- القفلُ **قبلَ** كلِّ قراءةٍ تُبنى عليها كتابةٌ: طلبٌ يُنشأُ بينَ الفحصِ
  -- والتجهيلِ يجعلُ الفحصَ كذباً، والقفلُ على صفِّ المستخدمِ هوَ ما يُسلسِلُ
  -- إنشاءَ الطلبِ معَ الحذفِ (مسارُ الطلبِ يقرأُ صفَّ صاحبِه).
  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    -- إعادةٌ لا خطأٌ: الطلبُ الثانيَ يجدُ الحالَ المطلوبَ قائماً.
    return jsonb_build_object(
      'ok', true, 'reason', 'ALREADY_ERASED', 'erased_at', v_user.erased_at
    );
  end if;

  -- حسابُ السائقِ بندٌ آخرُ (`SD-12`) وجداولُه مالٌ واشتراكٌ. ونصفُ حذفٍ أسوأُ
  -- من لا حذفٍ: يُرَدُّ صريحاً لا يُنفَّذُ ناقصاً.
  if v_user.role <> 'rider' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_RIDER', 'role', v_user.role);
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user.id;

  if v_rider_id is not null then
    select count(*) into v_active
      from orders o
     where o.rider_id = v_rider_id
       and o.status in ('searching', 'matched', 'in_progress');
    if v_active > 0 then
      return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
    end if;
  end if;

  -- ── ما يُمحى صفّاً: مِلكُه وحدَه ─────────────────────────────────────────
  with gone as (delete from saved_places where user_id = v_user.id returning 1)
    select count(*) into v_places from gone;

  with gone as (delete from user_notifications where user_id = v_user.id returning 1)
    select count(*) into v_notifications from gone;

  -- `created_by` معرّفُ تيليجرام لا `uuid` (نصُّ الهجرةِ `F7-01`): يُطابَقُ
  -- بالوسيطِ نفسِه، ويُمحى **قبلَ** تجهيلِ المعرّفِ وإلّا لم يُطابِقْ شيئاً.
  with gone as (delete from trip_tracking_tokens where created_by = p_telegram_id returning 1)
    select count(*) into v_tokens from gone;

  -- ── ما يُجهَّلُ: يبقى الصفُّ ويُمحى ما يُعرَفُ به إنسانٌ ─────────────────
  if v_rider_id is not null then
    with hushed as (
      update orders
         set notes = null, pickup_label = null, dropoff_label = null
       where rider_id = v_rider_id
         and (notes is not null or pickup_label is not null or dropoff_label is not null)
      returning 1
    ) select count(*) into v_orders from hushed;
  else
    v_orders := 0;
  end if;

  -- المعرّفُ البديلُ يُسحَبُ مرّةً واحدةً ويُستعمَلُ في الموضعَينِ: صفُّ
  -- المستخدمِ وصفوفُ التبليغِ. و`chat_id` عليه `check (chat_id <> 0)` فلا
  -- يُصفَّرُ — وتصفيرُه كانَ سيُسقِطُ الحذفَ كلَّه بقيدٍ لا بخطأِ منطقٍ.
  v_sentinel := -nextval('erased_account_telegram_seq');

  with hushed as (
    update broadcast_recipients
       set chat_id = v_sentinel, claim_token = null
     where user_id = v_user.id
    returning 1
  ) select count(*) into v_broadcasts from hushed;

  if v_rider_id is not null then
    update riders set rating_average = null, rating_count = 0 where id = v_rider_id;
  end if;

  -- ── ما بقيَ بأساسٍ: يُعَدُّ ليُقالَ في الإيصالِ، ولا يُمَسُّ ───────────────
  select count(*) into v_consents  from user_consents   where user_id = v_user.id;
  select count(*) into v_ratings   from ratings         where rater_user_id = v_user.id or ratee_user_id = v_user.id;
  select count(*) into v_tickets   from support_tickets where v_rider_id is not null and rider_id = v_rider_id;
  select count(*) into v_incidents from safety_incidents where reporter_user_id = v_user.id;
  select count(*) into v_audit     from audit_log       where actor_user_id = v_user.id;

  -- ── تجهيلُ الجذرِ: به تنقطعُ نسبةُ كلِّ ما بقيَ إلى إنسانٍ ────────────────
  update users
     set telegram_id       = v_sentinel,
         telegram_username = null,
         full_name         = null,
         phone             = null,
         is_blocked        = true,
         erased_at         = now()
   where id = v_user.id;

  v_receipt := jsonb_build_object(
    'erased', jsonb_build_object(
      'savedPlaces', v_places,
      'notificationsReceived', v_notifications,
      'tripTrackingTokens', v_tokens
    ),
    'anonymized', jsonb_build_object(
      'profile', 1,
      'riderProfile', case when v_rider_id is null then 0 else 1 end,
      'orders', v_orders,
      'broadcastsReceived', v_broadcasts
    ),
    'retained', jsonb_build_array(
      jsonb_build_object('section', 'consents',        'rows', v_consents,  'basis', 'CONSENT_IS_COMPLIANCE_EVIDENCE'),
      jsonb_build_object('section', 'ratings',         'rows', v_ratings,   'basis', 'RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY'),
      jsonb_build_object('section', 'supportTickets',  'rows', v_tickets,   'basis', 'SUPPORT_RECORD_MAY_BE_DISPUTED'),
      jsonb_build_object('section', 'safetyIncidents', 'rows', v_incidents, 'basis', 'SAFETY_REPORT_MAY_BE_DISPUTED'),
      jsonb_build_object('section', 'auditTrail',      'rows', v_audit,     'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE')
    )
  );

  -- الإيصالُ يُقيَّدُ في `audit_log`: صنفُه هناكَ «لا مدّةَ له» وهوَ عينُ ما
  -- يلزمُ إيصالَ حذفٍ. والفاعلُ صاحبُ الحسابِ نفسُه، ومفتاحُه `restrict` فلا
  -- يذهبُ الإيصالُ معَ الصفِّ.
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'account.erased', 'user', v_user.id, v_receipt);

  return jsonb_build_object('ok', true, 'reason', 'ERASED', 'erased_at', now(), 'receipt', v_receipt);
end;
$fn$;

comment on function erase_my_account(bigint) is
  'حذفُ حسابِ الراكبِ بطلبِه: معاملةٌ واحدةٌ تحتَ قفلِ صفِّه — يُمحى ما يملكُه وحدَه، ويُجهَّلُ ما للطرفِ الآخرِ فيه حقٌّ، ويبقى ما له أساسٌ نظاميٌّ؛ ويُرَدُّ إيصالٌ مُصنَّفٌ يقولُ ما بقيَ ولِمَ بقيَ ويُقيَّدُ في audit_log. ويُرَدُّ الطلبُ عندَ رحلةٍ جاريةٍ أو لغيرِ راكبٍ (F2-11 · SR-12 · ADR 0112).';

revoke execute on function erase_my_account(bigint) from public, anon, authenticated;
grant execute on function erase_my_account(bigint) to service_role;
