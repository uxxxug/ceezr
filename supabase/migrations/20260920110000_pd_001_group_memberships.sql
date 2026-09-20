-- migration-phase: expand
-- =============================================================================
-- `PD-001` · `ADR 0157` — **بوّابةُ دخولِ قروبِ السائقينَ غيرِ المشتركينَ**:
--   جدولُ `group_memberships` — سجلُّ قراراتِ البوّابةِ بأدنى ما يلزمُ للحكمِ
--   والقياسِ، مقصورٌ على سائقينَ منسوبينَ، ومُدخَلٌ في سجلَّيِ الاستبقاءِ والمحوِ.
--
-- الحالة: منفَّذ فعلياً — البند `PD-001b` (خارطةُ دَينِ المنتَج ·
--   `docs/ROADMAP-PRODUCT-DEBT.md`).
-- ينتمي إلى: supabase/migrations
-- يستخدمه من: `packages/infrastructure/groups/pg-group-memberships.ts` (الكتابةُ)
--   · دالتا التنزيلِ والحذفِ أدناهُ (قسمٌ وعبارةٌ جديدانِ).
-- يحرسُه: tests/integration/group-join-gate.test.ts ·
--   scripts/check-migrations.ts (city_id + FK + RLS) ·
--   scripts/check-retention-policy.ts · scripts/check-erasure-policy.ts
--   (القاعدةُ ٨: قسمٌ مُعلَنٌ يُبنى، والقاعدةُ ٩: حكمُ محوٍ تُنفِّذُهُ عبارة).
--
-- ## لماذا `driver_id` مفتاحَ العضويّةِ لا `telegram_user_id`
--
-- كلُّ صفٍّ سائقٌ معروفٌ (`driver_id` منسوبٌ إلى `drivers`): فمحاولاتُ غيرِ
-- المسجَّلينَ لا تدخلُ الجدولَ أصلًا (سجلٌّ مهيكلٌ حصراً)، فيبقى الجدولُ خالياً من
-- معرِّفِ تلغرامَ المُعرَّى الذي لا يملكُهُ أحدٌ ولا يُعرَفُ لهُ صاحبٌ عندَ طلبِ
-- الحذفِ. وبهذا يصيرُ حكمُ المحوِ (`delete from group_memberships where
-- driver_id = v_driver_id`) قابلًا للإنفاذِ الكاملِ بلا صفٍّ يتيمٍ.
--
-- ## ولماذا `requested_at` و`first_approved_at` لا يُطمَسانِ
--
-- قياسُ التحويلِ (`PD-001e`) سؤالُ زمنٍ: كم مرَّ بينَ دخولِ القروبِ وتفعيلِ
-- الاشتراكِ؟ فلو طُمِسَ أوّلُ طلبٍ عندَ إعادةِ المحاولةِ لصارَ زمنُ الدخولِ
-- كذبًا مقيسًا — وصدقُ القياسِ أوّلُ معاييرِ كسرِ التعادلِ في هذا المستودَعِ.
--
-- ## وما لا تفعلهُ هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُمسُّ منطقَ المطالبةِ الذرّيَّ القائمَ** ولا سقوفَ دورةِ غيرِ
--      المشتركينَ: البوّابةُ زيادةٌ على حدِّ المطالبةِ (`unsub:claim`) لا
--      إعادةُ بناءٍ لهُ.
--   ــ **لا تُنشئُ جردَ أعضاءٍ حيًّا**: لا `chat_member` ولا مغادرةَ ولا
--      مزامنةَ أدوارٍ — المقامُ المبنيُّ هوَ من دخلَ عبرَ البوّابةِ بقرارِها.
--   ـ─ **لا تُصنَّفُ محاولاتُ غيرِ المسجَّلينَ في الجدولِ**: حادثاتُها في
--      السجلِّ المهيكلِ (مُكنَّاةً) — عدُّها مقامٌ آخرُ إنِ احتِيجَ إليهِ.
-- =============================================================================

create table if not exists group_memberships (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid not null references cities(id) on delete cascade,
  -- معرِّفُ قروبِ تلغرامَ: bigint سالبٌ دائمًا للقروباتِ — والحاجزُ أدناهُ
  -- يمنعُ تسلُّلَ معرِّفِ محادثةٍ خاصّةٍ موجبٍ إلى سجلِّ عضويّةٍ.
  chat_id            bigint not null,
  driver_id          uuid not null references drivers(id) on delete cascade,
  -- approved | declined — لا حالةَ «غادرَ»: مغادرةُ عضوٍ حدثٌ لا يُستقبلُ
  -- أصلاً (لا معالجةَ لـchat_member)، فحالةٌ لها لا تُقرأُ شيءٌ كذبٌ مسجَّلٌ.
  status             text not null,
  source             text not null,
  -- مطلوبٌ عندَ الرفضِ وممنوعٌ عندَ القبولِ: قرارٌ بلا سببٍ قراءةٌ لا حكمٌ،
  -- وسببٌ معَ قبولٍ ضجيجٌ يُفسدُ القياسَ.
  reason             text,
  -- أوّلُ طلبٍ للسائقِ في هذا القروبِ: لا يُحدَّثُ عندَ إعادةِ المحاولةِ.
  requested_at       timestamptz not null default now(),
  -- آخرُ طلبٍ — يُحدَّثُ معَ كلِّ قرارٍ، فتُقرأُ حدّةُ المحاولاتِ منَ الفرقِ.
  last_requested_at  timestamptz not null default now(),
  -- أوّلُ قبولٍ: يُكتبُ مرّةً (coalesce عندَ التحديثِ) — أساسُ زمنِ التحويلِ.
  first_approved_at  timestamptz,
  decided_at         timestamptz,
  -- كاتبُ القرارِ: اليومَ البوتُ وحدَه — ومنْ أضافَ كاتبًا آخرَ (إدارةً مثلًا)
  -- يُوسِّعُ هذا القيدَ بوعيٍ لا يُدسُّ قيمةً غريبةً في السجلِّ.
  decided_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint group_memberships_one_decision_per_member unique (chat_id, driver_id),
  constraint group_memberships_status_values check (status in ('approved', 'declined')),
  constraint group_memberships_source_values check (source in ('driver_bot_join_request')),
  constraint group_memberships_decider_values check (decided_by in ('driver_bot')),
  constraint group_memberships_chat_is_group check (chat_id < 0),
  constraint group_memberships_declined_needs_reason check (status <> 'declined' or reason is not null),
  constraint group_memberships_approved_has_no_reason check (status <> 'approved' or reason is null),
  constraint group_memberships_first_approval_once
    check (status <> 'approved' or first_approved_at is not null)
);

alter table group_memberships enable row level security;

comment on table group_memberships is
  'PD-001/ADR 0157: سجلُّ قراراتِ بوّابةِ دخولِ قروبِ السائقينَ غيرِ المشتركينَ — '
  'صفٌّ واحدٌ لكلِّ (قروبٍ × سائقٍ)، مقصورٌ على سائقينَ منسوبينَ، وقرارُهُ الأخيرُ '
  'ظاهرٌ وأوّلُ طلبِهِ وأوّلُ قبولِهِ محفوظانِ لصدقِ قياسِ التحويلِ.';
comment on column group_memberships.reason is
  'سببُ الرفضِ (city_mismatch | driver_not_verified) — إلزاميٌّ عندَ الرفضِ، '
  'ممنوعٌ عندَ القبولِ.';

-- =============================================================================
-- توسيعُ دالّتَيِ التنزيلِ والحذفِ (`F2-11`/`SD-12`): قسمٌ جديدٌ يُنزَّلُ
-- وعبارةُ حذفٍ جديدةٌ تُنفَّذُ. والنسخةُ أدناهُ هيَ **آخرُ تعريفٍ نافذٍ**
-- للدالتَينِ — فأيُّ تعديلٍ لاحقٍ يُبنى عليها لا على ما قبلَها
-- (scripts/check-erasure-policy.ts يقرأُ آخرَ مُعرِّفٍ حرفيًّا).
-- =============================================================================

create or replace function export_my_data(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       users;
  v_rider      riders;
  v_driver     drivers;
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
  -- **يُقرأُ للدورَينِ**: قد يكونُ لصاحبِ الحسابِ صفُّ سياقةٍ وإن لم يكن دورُه
  -- `driver` (حسابٌ حُوِّلَ)، والحزمةُ تقولُ ما في القاعدةِ لا ما في الدورِ.
  select * into v_driver from drivers where user_id = v_user.id;
  select c.name_ar into v_city_name from cities c where c.id = v_user.city_id;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    -- **الدورُ يُقرأُ من الصفِّ لا يُثبَّتُ نصّاً**: كانَ `'rider'` حرفاً، وحينَ
    -- صارَت الحزمةُ للسائقِ كذلكَ (`SD-12`) لَكانَ نصّاً كاذباً في حزمتِه.
    'subject', v_user.role,
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
      ), '[]'::jsonb),

      -- identityBar: **أثرُ حذفٍ سابقٍ إن كانَ**. ولا تُنزَّلُ التجزئةُ نفسُها:
      -- سِلسِلةُ ستّينَ خانةً لا تُفيدُ صاحبَها شيئاً، وإخراجُها يُسلِّمُ لمَن
      -- يقرأُ الملفَّ **مفتاحَ مطابقةٍ** يُثبِتُ به أنَّ فلاناً هوَ فلانٌ.
      -- والمُنزَّلُ هوَ الحكمُ الذي يمسُّه: أمحظورٌ هوَ، وكم مرّةً حُذِفَ،
      -- وهل حُمِلَ تقييمُه (ADR 0113).
      'identityBar', coalesce((
        select jsonb_build_object(
          'is_blocked', im.is_blocked,
          'erasure_count', im.erasure_count,
          'rating_count_carried', im.rating_count,
          'first_marked_at', im.first_marked_at,
          'last_marked_at', im.last_marked_at,
          'hash_disclosed', false
        )
        from identity_marks im
        where im.telegram_hash = identity_hash(p_telegram_id::text)
      ), 'null'::jsonb),

      -- ═══ أقسامُ السائقِ (`SD-12`) ═══════════════════════════════════════
      -- **تُبنى للدورَينِ ولا تُخفى بشرطٍ**: قسمٌ يظهرُ لدورٍ ويغيبُ لدورٍ يجعلُ
      -- شكلَ الحزمةِ مُتغيِّراً، فيكسرُ كلَّ قارئٍ آليٍّ لها. وللراكبِ تُقرأُ
      -- فارغةً — وذاكَ **قولٌ صادقٌ**: لا صفَّ سياقةٍ له.

      'driverProfile', case when v_driver.id is null then '{}'::jsonb else jsonb_build_object(
        'verification_status', v_driver.verification_status,
        'vehicle_type', v_driver.vehicle_type,
        'vehicle_year', v_driver.vehicle_year,
        'plate_number', v_driver.plate_number,
        'national_id_present', (v_driver.national_id is not null),
        'preferred_area_label', v_driver.preferred_area_label,
        'rating_average', v_driver.rating_average,
        'rating_count', v_driver.rating_count,
        'created_at', v_driver.created_at
      ) end,

      -- **رقمُ الهويّةِ لا يُنزَّلُ نصّاً**: صاحبُه يعرفُه، وحزمةُ تنزيلٍ تُرسَلُ
      -- في محادثةٍ تُقرأُ في هاتفٍ مسروقٍ. فيُقالُ **أمُسجَّلٌ هوَ** لا ما هوَ.

      'driverDocuments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'doc_type', dd.doc_type,
          'status', dd.status,
          'expires_at', dd.expires_at,
          'review_note', dd.review_note,
          'submitted_at', dd.submitted_at,
          'reviewed_at', dd.reviewed_at,
          'file_disclosed', false
        ) order by dd.submitted_at)
        from driver_documents dd
        where v_driver.id is not null and dd.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAvailability', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', da.is_available,
          'changed_at', da.changed_at
        ) order by da.changed_at)
        from driver_availability da
        where v_driver.id is not null and da.driver_id = v_driver.id
      ), '[]'::jsonb),

      'groupMemberships', coalesce((
        select jsonb_agg(jsonb_build_object(
          'chat_id', gm.chat_id,
          'status', gm.status,
          'source', gm.source,
          'reason', gm.reason,
          'requested_at', gm.requested_at,
          'decided_at', gm.decided_at
        ) order by gm.requested_at)
        from group_memberships gm
        where v_driver.id is not null and gm.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverCapabilities', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', dc.service,
          'is_enabled', dc.is_enabled,
          'updated_at', dc.updated_at
        ) order by dc.service)
        from driver_capabilities dc
        where v_driver.id is not null and dc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAttendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', al.is_available,
          'source', al.source,
          'changed_at', al.changed_at
        ) order by al.changed_at)
        from attendance_log al
        where v_driver.id is not null and al.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **تاريخُ الموضعِ مُسقَّفٌ والسقفُ مُعلَنٌ في الحزمةِ نفسِها**: صفوفُه
      -- تُكتَبُ كلَّ ثوانٍ، فسائقٌ عملَ شهراً قد يُخرِجُ مئاتَ الآلافِ من
      -- الصفوفِ في `jsonb` واحدٍ — فتسقطُ الدالّةُ بالذاكرةِ ولا يَنزِلُ شيءٌ.
      -- والصادقُ أن يُقالَ للإنسانِ **كم أُخرِجَ وما السقفُ ومن أيِّ طرفٍ**، لا
      -- أن يُقطَعَ صامتاً (`ح-5`).
      'driverLocationHistory', jsonb_build_object(
        'cap', 5000,
        'newest_first', true,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'latitude', st_y(h.position::geometry),
            'longitude', st_x(h.position::geometry),
            'accuracy_m', h.accuracy_m,
            'quality', h.quality,
            'source', h.source,
            'recorded_at', h.recorded_at
          ) order by h.recorded_at desc)
          from (
            select dlh.position, dlh.accuracy_m, dlh.quality, dlh.source, dlh.recorded_at
              from driver_location_history dlh
             where v_driver.id is not null and dlh.driver_id = v_driver.id
             order by dlh.recorded_at desc
             limit 5000
          ) h
        ), '[]'::jsonb)
      ),

      'trackingSessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'started_at', ts.started_at,
          'last_fix_at', ts.last_fix_at,
          'ended_at', ts.ended_at,
          'end_reason', ts.end_reason,
          'fixes', ts.last_sequence
        ) order by ts.started_at)
        from tracking_sessions ts
        where v_driver.id is not null and ts.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **العرضُ يُنزَّلُ ولا يُنزَّلُ معَه طلبُ راكبٍ**: القرارُ واقعةُ السائقِ،
      -- وموضعُ الراكبِ ووجهتُه بيانةُ غيرِه.
      'orderOffers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'round', oo.round,
          'status', oo.status,
          'distance_km', oo.distance_km,
          'expires_at', oo.expires_at,
          'responded_at', oo.responded_at,
          'created_at', oo.created_at
        ) order by oo.created_at)
        from order_offers oo
        where v_driver.id is not null and oo.driver_id = v_driver.id
      ), '[]'::jsonb),

      'unsubscribedClaims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', uc.position,
          'outcome', uc.outcome,
          'opened_at', uc.opened_at,
          'closed_at', uc.closed_at
        ) order by uc.opened_at)
        from unsubscribed_claims uc
        where v_driver.id is not null and uc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'plan', s.plan,
          'status', s.status,
          'trial_ends_at', s.trial_ends_at,
          'current_period_end', s.current_period_end,
          'price_amount', s.price_amount,
          'currency', s.currency,
          'cancel_at_period_end', s.cancel_at_period_end,
          'cancellation_requested_at', s.cancellation_requested_at,
          'cancellation_reason', s.cancellation_reason,
          'created_at', s.created_at
        ) order by s.created_at)
        from subscriptions s
        where v_driver.id is not null and s.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionInvoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'invoice_number', si.invoice_number,
          'invoice_year', si.invoice_year,
          'amount_minor', si.amount_minor,
          'currency', si.currency,
          'plan', si.plan,
          'issued_at', si.issued_at
        ) order by si.issued_at)
        from subscription_invoices si
        where v_driver.id is not null and si.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionRefunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'amount_minor', sr.amount_minor,
          'currency', sr.currency,
          'destination', sr.destination,
          'reason', sr.reason,
          'reference', sr.reference,
          'created_at', sr.created_at
        ) order by sr.created_at)
        from subscription_refunds sr
        where v_driver.id is not null and sr.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الرصيدُ لا يُحسَبُ ههنا**: مصدرُ حقيقتِه `subscription_wallet_balance`،
      -- وجمعٌ ثانٍ في دالّةِ تنزيلٍ يجعلُ للمالِ حسابَينِ (القاعدة 0.6).
      'subscriptionWallets', case when v_driver.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', sw.currency,
          'created_at', sw.created_at,
          'balance', subscription_wallet_balance(sw.driver_id)
        ))
        from subscription_wallets sw
        where sw.driver_id = v_driver.id
      ), '[]'::jsonb) end,

      'subscriptionWalletEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_kind', swe.entry_kind,
          'direction', swe.direction,
          'amount_minor', swe.amount_minor,
          'currency', swe.currency,
          'reason', swe.reason,
          'reference', swe.reference,
          'created_at', swe.created_at
        ) order by swe.created_at)
        from subscription_wallet_entries swe
        where v_driver.id is not null and swe.driver_id = v_driver.id
      ), '[]'::jsonb),

      'paymentTransactions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'purpose', pt.purpose,
          'amount_minor', pt.amount_minor,
          'currency', pt.currency,
          'provider', pt.provider,
          'status', pt.status,
          'created_at', pt.created_at
        ) order by pt.created_at)
        from payment_transactions pt
        where v_driver.id is not null and pt.payer_driver_id = v_driver.id
      ), '[]'::jsonb),

      'ledgerEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_type', le.entry_type,
          'amount_minor', le.amount_minor,
          'currency', le.currency,
          'created_at', le.created_at
        ) order by le.created_at)
        from ledger_entries le
        where v_driver.id is not null and le.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الصادرُ يُنزَّلُ حالاً لا مضموناً**: `payload` فيه بيانةُ طلبٍ لراكبٍ
      -- ونصُّ رسالةٍ، وإخراجُه يجعلُ حزمةَ السائقِ نافذةً على غيرِه.
      'notificationsSent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', no2.kind,
          'status', no2.status,
          'attempts', no2.attempts,
          'delivered_at', no2.delivered_at,
          'error_code', no2.error_code,
          'created_at', no2.created_at,
          'payload_disclosed', false
        ) order by no2.created_at)
        from notification_outbox no2
        where (v_driver.id is not null and no2.driver_id = v_driver.id)
           or no2.recipient_user_id = v_user.id
      ), '[]'::jsonb),

      'subscriptionNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sn.kind,
          'status', sn.status,
          'attempts', sn.attempts,
          'sent_at', sn.sent_at,
          'error_code', sn.error_code,
          'created_at', sn.created_at
        ) order by sn.created_at)
        from subscription_notices sn
        where v_driver.id is not null and sn.driver_id = v_driver.id
      ), '[]'::jsonb)
    )
  );
end;
$fn$;

create or replace function erase_my_account(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user            users;
  v_rider_id        uuid;
  v_driver_id       uuid;
  v_active          integer;
  v_places          integer;
  v_notifications   integer;
  v_tokens          integer;
  v_orders          integer;
  v_broadcasts      integer;
  v_consents        integer;
  v_ratings         integer;
  v_bar_rows        integer;
  v_tickets         integer;
  v_incidents       integer;
  v_audit           integer;
  v_sentinel        bigint;
  v_receipt         jsonb;
  -- ما يخصُّ السائقَ وحدَه
  v_docs            integer;
  v_avail           integer;
  v_memberships     integer;
  v_caps            integer;
  v_loc             integer;
  v_tracking        integer;
  v_outbox          integer;
  v_notices         integer;
  v_offers          integer;
  v_claims          integer;
  v_attendance      integer;
  v_ledger          integer;
  v_payments        integer;
  v_invoices        integer;
  v_refunds         integer;
  v_wallet_rows     integer;
  v_wallets         integer;
  v_subs            integer;
  v_balance         jsonb;
  v_balance_minor   bigint;
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

  -- حسابُ العملِ يُنهيه مَن أنشأَه لا صاحبُه: المشرفُ والدعمُ خارجَ هذا البابِ
  -- (`F12-10`). والرمزُ **مُسمّىً بما يعنيه** لا `NOT_A_RIDER`: الأخيرُ كانَ
  -- يقولُ للسائقِ «لستَ راكباً» وهوَ جوابٌ لا يُفيدُه شيئاً.
  if v_user.role not in ('rider', 'driver') then
    return jsonb_build_object(
      'ok', false, 'reason', 'ROLE_NOT_SELF_ERASABLE', 'role', v_user.role
    );
  end if;

  v_sentinel := -nextval('erased_account_telegram_seq');

  if v_user.role = 'rider' then
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

    -- ── ما يُمحى صفّاً: مِلكُه وحدَه ───────────────────────────────────────
    with gone as (delete from saved_places where user_id = v_user.id returning 1)
      select count(*) into v_places from gone;

    with gone as (delete from user_notifications where user_id = v_user.id returning 1)
      select count(*) into v_notifications from gone;

    -- `created_by` معرّفُ تيليجرام لا `uuid` (نصُّ الهجرةِ `F7-01`): يُطابَقُ
    -- بالوسيطِ نفسِه، ويُمحى **قبلَ** تجهيلِ المعرّفِ وإلّا لم يُطابِقْ شيئاً.
    with gone as (delete from trip_tracking_tokens where created_by = p_telegram_id returning 1)
      select count(*) into v_tokens from gone;

    -- ── ما يُجهَّلُ: يبقى الصفُّ ويُمحى ما يُعرَفُ به إنسانٌ ───────────────
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

    with hushed as (
      update broadcast_recipients
         set chat_id = v_sentinel, claim_token = null
       where user_id = v_user.id
      returning 1
    ) select count(*) into v_broadcasts from hushed;

    if v_rider_id is not null then
      update riders set rating_average = null, rating_count = 0 where id = v_rider_id;
    end if;

    -- ── ما بقيَ بأساسٍ: يُعَدُّ ليُقالَ في الإيصالِ، ولا يُمَسُّ ─────────────
    select count(*) into v_consents  from user_consents   where user_id = v_user.id;
    select count(*) into v_ratings   from ratings         where rater_user_id = v_user.id or ratee_user_id = v_user.id;
    select count(*) into v_tickets   from support_tickets where v_rider_id is not null and rider_id = v_rider_id;
    select count(*) into v_incidents from safety_incidents where reporter_user_id = v_user.id;
    select count(*) into v_audit     from audit_log       where actor_user_id = v_user.id;

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
  else
    -- ═══ دورُ السائقِ ═══════════════════════════════════════════════════════
    select d.id into v_driver_id from drivers d where d.user_id = v_user.id;

    if v_driver_id is not null then
      -- `searching` لا سائقَ لها؛ فالجاريةُ للسائقِ ما أُسنِدَ إليه فعلاً.
      select count(*) into v_active
        from orders o
       where o.assigned_driver_id = v_driver_id
         and o.status in ('matched', 'in_progress');
      if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
      end if;

      -- **الرصيدُ يُقرأُ من مصدرِ حقيقتِه لا يُحسَبُ ههنا ثانيةً**: حسابُ
      -- الرصيدِ مِلكُ `subscription_wallet_balance`، ونسخُ جمعِه في هذه
      -- الدالّةِ يجعلُ للرصيدِ حسابَينِ يفترقانِ يوماً (القاعدة 0.6).
      v_balance := subscription_wallet_balance(v_driver_id);
      if coalesce((v_balance->>'ok')::boolean, false) then
        v_balance_minor := coalesce((v_balance->>'balance_minor')::bigint, 0);
        if v_balance_minor <> 0 then
          return jsonb_build_object(
            'ok', false,
            'reason', 'WALLET_HAS_BALANCE',
            'wallet_balance_minor', v_balance_minor,
            'currency', v_balance->>'currency'
          );
        end if;
      end if;
    end if;

    -- ── ما يُمحى صفّاً ─────────────────────────────────────────────────────
    with gone as (delete from user_notifications where user_id = v_user.id returning 1)
      select count(*) into v_notifications from gone;

    with gone as (delete from saved_places where user_id = v_user.id returning 1)
      select count(*) into v_places from gone;

    with gone as (delete from trip_tracking_tokens where created_by = p_telegram_id returning 1)
      select count(*) into v_tokens from gone;

    if v_driver_id is not null then
      with gone as (delete from driver_documents where driver_id = v_driver_id returning 1)
        select count(*) into v_docs from gone;

      with gone as (delete from driver_availability where driver_id = v_driver_id returning 1)
        select count(*) into v_avail from gone;

      with gone as (delete from group_memberships where driver_id = v_driver_id returning 1)
        select count(*) into v_memberships from gone;

      with gone as (delete from driver_capabilities where driver_id = v_driver_id returning 1)
        select count(*) into v_caps from gone;

      with gone as (delete from driver_location_history where driver_id = v_driver_id returning 1)
        select count(*) into v_loc from gone;

      with gone as (delete from tracking_sessions where driver_id = v_driver_id returning 1)
        select count(*) into v_tracking from gone;
    else
      v_docs := 0; v_avail := 0; v_caps := 0; v_loc := 0; v_tracking := 0; v_memberships := 0;
    end if;

    -- ── ما يُجهَّلُ في مكانِه ───────────────────────────────────────────────
    with hushed as (
      update broadcast_recipients
         set chat_id = v_sentinel, claim_token = null
       where user_id = v_user.id
      returning 1
    ) select count(*) into v_broadcasts from hushed;

    -- صندوقُ الصادرِ يحملُ **مقصداً**: `chat_id` هوَ عينُ ما يُوصِلُ إلى
    -- إنسانٍ. ولا يُصفَّرُ (`chat_id <> 0` قيدٌ) بل يُبدَلُ بالحاجزِ السالبِ
    -- نفسِه، ويُمحى معرّفُ الرسالةِ المُوصَلةِ وآخرُ عطبٍ.
    if v_driver_id is not null then
      with hushed as (
        update notification_outbox
           set chat_id = v_sentinel,
               delivered_message_id = null,
               last_error = null
         where driver_id = v_driver_id or recipient_user_id = v_user.id
        returning 1
      ) select count(*) into v_outbox from hushed;

      with hushed as (
        update subscription_notices
           set chat_id = v_sentinel, message_id = null
         where driver_id = v_driver_id
        returning 1
      ) select count(*) into v_notices from hushed;

      -- صفُّ السياقةِ يبقى **لأنَّ المالَ مُعلَّقٌ به**: الفواتيرُ والمحفظةُ
      -- والحضورُ كلُّها تُشيرُ إليه، ومحوُه يمحوها معَه بالسلسلةِ. فيُجهَّلُ:
      -- لوحةٌ ورقمُ هويّةٍ وصورةٌ وشعارٌ وباركودٌ وموضعٌ ومنطقةٌ مُفضَّلةٌ.
      update drivers
         set plate_number              = null,
             national_id               = null,
             vehicle_photo_file_id     = null,
             logo_object_path          = null,
             barcode_object_path       = null,
             preferred_area_label      = null,
             preferred_area_location   = null,
             last_location             = null,
             last_location_at          = null,
             last_location_accuracy_m  = null,
             last_location_quality     = null,
             last_location_recorded_at = null,
             rating_average            = null,
             rating_count              = 0
       where id = v_driver_id;
    else
      with hushed as (
        update notification_outbox
           set chat_id = v_sentinel,
               delivered_message_id = null,
               last_error = null
         where recipient_user_id = v_user.id
        returning 1
      ) select count(*) into v_outbox from hushed;
      v_notices := 0;
    end if;

    -- ── ما بقيَ بأساسٍ: يُعَدُّ ولا يُمَسُّ ─────────────────────────────────
    select count(*) into v_consents   from user_consents    where user_id = v_user.id;
    select count(*) into v_ratings    from ratings          where rater_user_id = v_user.id or ratee_user_id = v_user.id;
    select count(*) into v_tickets    from support_tickets  where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_incidents  from safety_incidents where reporter_user_id = v_user.id;
    select count(*) into v_audit      from audit_log        where actor_user_id = v_user.id;

    select count(*) into v_attendance from attendance_log              where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_ledger     from ledger_entries              where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_payments   from payment_transactions        where v_driver_id is not null and payer_driver_id = v_driver_id;
    select count(*) into v_invoices   from subscription_invoices       where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_refunds    from subscription_refunds        where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_wallet_rows from subscription_wallet_entries where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_wallets    from subscription_wallets        where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_subs       from subscriptions               where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_offers     from order_offers                where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_claims     from unsubscribed_claims         where v_driver_id is not null and driver_id = v_driver_id;

    v_receipt := jsonb_build_object(
      'erased', jsonb_build_object(
        'driverDocuments', v_docs,
        'driverAvailability', v_avail,
        'groupMemberships', v_memberships,
        'driverCapabilities', v_caps,
        'driverLocationHistory', v_loc,
        'trackingSessions', v_tracking,
        'notificationsReceived', v_notifications,
        'savedPlaces', v_places,
        'tripTrackingTokens', v_tokens
      ),
      'anonymized', jsonb_build_object(
        'profile', 1,
        'driverProfile', case when v_driver_id is null then 0 else 1 end,
        'broadcastsReceived', v_broadcasts,
        'notificationOutbox', v_outbox,
        'subscriptionNotices', v_notices
      ),
      'retained', jsonb_build_array(
        jsonb_build_object('section', 'consents',                 'rows', v_consents,    'basis', 'CONSENT_IS_COMPLIANCE_EVIDENCE'),
        jsonb_build_object('section', 'ratings',                  'rows', v_ratings,     'basis', 'RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY'),
        jsonb_build_object('section', 'supportTickets',           'rows', v_tickets,     'basis', 'SUPPORT_RECORD_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'safetyIncidents',          'rows', v_incidents,   'basis', 'SAFETY_REPORT_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'auditTrail',               'rows', v_audit,       'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE'),
        jsonb_build_object('section', 'driverAttendance',         'rows', v_attendance,  'basis', 'ATTENDANCE_PROVES_DRIVER_ENTITLEMENT'),
        jsonb_build_object('section', 'ledgerEntries',            'rows', v_ledger,      'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'paymentTransactions',      'rows', v_payments,    'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionInvoices',     'rows', v_invoices,    'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionRefunds',      'rows', v_refunds,     'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionWalletEntries','rows', v_wallet_rows, 'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionWallets',      'rows', v_wallets,     'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptions',            'rows', v_subs,        'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'orderOffers',              'rows', v_offers,      'basis', 'DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY'),
        jsonb_build_object('section', 'unsubscribedClaims',       'rows', v_claims,      'basis', 'DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY')
      )
    );
  end if;

  -- ── تجهيلُ الجذرِ: به تنقطعُ نسبةُ كلِّ ما بقيَ إلى إنسانٍ ────────────────
  update users
     set telegram_id       = v_sentinel,
         telegram_username = null,
         full_name         = null,
         phone             = null,
         is_blocked        = true,
         erased_at         = now()
   where id = v_user.id;

  -- **الأثرُ يُقرأُ بعدَ التجهيلِ لا قبلَه، ولا تكتبُه هذه الدالّةُ**: كتبَه
  -- المُشغِّلُ `users_mark_identity_before_erasure` في أثناءِ التحديثِ أعلاه.
  select count(*) into v_bar_rows
    from identity_marks im
   where im.telegram_hash = identity_hash(p_telegram_id::text);

  v_receipt := jsonb_set(
    v_receipt,
    '{retained}',
    (v_receipt->'retained') || jsonb_build_array(
      jsonb_build_object(
        'section', 'identityBar', 'rows', v_bar_rows, 'basis', 'BLOCK_AND_STANDING_SURVIVE_ERASURE'
      )
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
