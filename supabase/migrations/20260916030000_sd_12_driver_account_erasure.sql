-- migration-phase: expand
-- ═══════════════════════════════════════════════════════════════════════════
-- الغرض: حذفُ حسابِ السائقِ بطلبِه — `SD-12`. **بندٌ في القاعدةِ لا زرٌّ في
--   شاشةٍ**: سجلُّ الحذفِ (`packages/shared/config/erasure-policy.ts`) كانَ
--   يُعلِنُ ثمانيةَ عشرَ جدولاً مؤجَّلاً إلى `SD-12`، و`erase_my_account` تردُّ
--   كلَّ دورٍ غيرِ `rider` برمزٍ واحدٍ. فههنا يُبنى النصفُ الغائبُ.
-- الحالة: منفَّذٌ فعليّاً — البند `SD-12` (ضمنَ دفعةِ `F3-08`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `POST /v1/me/erasure` — **المسارُ نفسُه لا مسارٌ ثانٍ**.
-- الحاكم: docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md
--   · docs/adr/0125-a-drivers-erasure-stops-at-money-not-at-role.md
--
-- ## لماذا دالّةٌ واحدةٌ تتفرَّعُ لا دالّتانِ
--
-- «احذفْ حسابي» فعلٌ واحدٌ لصاحبِ حسابٍ واحدٍ. ولو صارَ دالّتَينِ لصارَ للنظامِ
-- **مصدرا حقيقةٍ** في أخطرِ عمليّةٍ فيه: قفلٌ يُكتَبُ مرّتَينِ، وإيصالٌ يُقيَّدُ
-- في `audit_log` بصياغتَينِ، وبوّابةُ «حُذِفَ من قبلُ» تُنسى في إحداهما يوماً.
-- فالتفرُّعُ ههنا **بعدَ** القفلِ والبوّاباتِ المشتركةِ، والاندماجُ **قبلَ**
-- تجهيلِ الجذرِ وقيدِ الإيصالِ: ما يختلفُ بينَ الدورَينِ هوَ **الجداولُ**
-- وحدَها، لا آدابُ المعاملةِ.
--
-- ## ولماذا يُوقَفُ الحذفُ عندَ المالِ لا عندَ الدورِ
--
-- الرفضُ القديمُ `NOT_A_RIDER` كانَ **صحيحاً في زمنِه**: نصفُ حذفٍ أسوأُ من لا
-- حذفٍ، وجداولُ السائقِ مالٌ واشتراكٌ. والآنَ إذ حُكِمَ في كلِّ جدولٍ منها
-- حُكماً مكتوباً، صارَ الرفضُ المشروعُ **رفضاً ماليّاً لا رفضَ دورٍ**:
--   1. `ACTIVE_ORDER` — رحلةٌ جاريةٌ فيها راكبٌ ينتظرُ.
--   2. `WALLET_HAS_BALANCE` — رصيدٌ في محفظةِ الاشتراكِ لم يُسحَبْ ولم يُنفَقْ.
--      وحذفُ الحسابِ عليه يُسقِطُ حقَّ صاحبِه في مالِه، أو يُخفي دَيناً عليه.
-- و`ROLE_NOT_SELF_ERASABLE` يبقى للمشرفِ والدعمِ: حسابُ العملِ يُنهيه من
-- أنشأَه (`F12-10`)، لا صاحبُه بزرٍّ في تطبيقٍ.
--
-- **وما لا تفعلُه هذه الهجرةُ عن قصدٍ**: لا تمسُّ ملفّاتَ المخزَنِ. مساراتُ
-- `driver_documents.object_path` و`logo_object_path` و`barcode_object_path`
-- تُمحى **إشارتُها** من القاعدةِ ههنا، وأمّا البايتاتُ في المخزَنِ فتُنظَّفُ
-- بمُشغِّلٍ مُعلَنٍ في `docs/SYSTEM_STATE.md` — والقولُ بأنَّها مُحيَت من هذه
-- المعاملةِ **كذبٌ** لأنَّ المعاملةَ لا تصلُ المخزَنَ (`ح-5`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── الشطرُ الأوّلُ: **حقُّ الوصولِ** — حزمةُ تنزيلٍ للسائقِ كما للراكبِ ───────
-- ثمانيةَ عشرَ قسماً تُزادُ إلى ثلاثةَ عشرَ. **والحقُّ الأوّلُ قبلَ الثاني**:
-- مَن لا يقدرُ أن يقرأَ ما عندَنا عنه لا يقدرُ أن يحكمَ أيَحذفُ أم لا.
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
comment on function export_my_data(bigint) is
  'حزمةُ بياناتِ صاحبِ الحسابِ محمولةً — للراكبِ وللسائقِ (F2-11 · SD-12): أعمدةٌ مُسمّاةٌ لا *، والدورُ مقروءٌ من الصفِّ لا مُثبَّتٌ نصّاً، وأقسامُ السائقِ الثمانيةَ عشرَ تُبنى للدورَينِ فتُقرأُ فارغةً لمن لا صفَّ سياقةٍ له — فشكلُ الحزمةِ واحدٌ لا يتغيَّرُ بالدورِ. ولا تُنزَّلُ بيانةُ الطرفِ الآخرِ: لا مضمونَ إشعارٍ ولا طلبُ راكبٍ في عرضٍ، ولا رقمُ هويّةٍ نصّاً بل أمُسجَّلٌ هوَ، ولا مسارُ ملفٍّ في المخزَنِ. وتاريخُ الموضعِ مُسقَّفٌ بخمسةِ آلافِ صفٍّ **والسقفُ مُعلَنٌ في الحزمةِ نفسِها** لا مقطوعٌ صامتاً (ADR 0112 · ADR 0113 · ADR 0125).';

revoke execute on function export_my_data(bigint) from public, anon, authenticated;
grant execute on function export_my_data(bigint) to service_role;


-- ── الشطرُ الثاني: **حقُّ المحوِ** ───────────────────────────────────────────

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

      with gone as (delete from driver_capabilities where driver_id = v_driver_id returning 1)
        select count(*) into v_caps from gone;

      with gone as (delete from driver_location_history where driver_id = v_driver_id returning 1)
        select count(*) into v_loc from gone;

      with gone as (delete from tracking_sessions where driver_id = v_driver_id returning 1)
        select count(*) into v_tracking from gone;
    else
      v_docs := 0; v_avail := 0; v_caps := 0; v_loc := 0; v_tracking := 0;
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
comment on function erase_my_account(bigint) is
  'حذفُ الحسابِ بطلبِ صاحبِه — للراكبِ وللسائقِ في دالّةٍ واحدةٍ تتفرَّعُ بعدَ القفلِ والبوّاباتِ المشتركةِ وتندمجُ قبلَ تجهيلِ الجذرِ وقيدِ الإيصالِ. يُمحى ما يملكُه وحدَه، ويُجهَّلُ ما للطرفِ الآخرِ فيه حقٌّ أو ما يُعلَّقُ به مالٌ (صفُّ السياقةِ يبقى مُجهَّلاً لأنَّ الفواتيرَ والمحفظةَ تُشيرُ إليه)، ويبقى ما له أساسٌ نظاميٌّ معَ سببِه في الإيصالِ. ويُرَدُّ الطلبُ عندَ رحلةٍ جاريةٍ (ACTIVE_ORDER) أو رصيدٍ في محفظةِ الاشتراكِ (WALLET_HAS_BALANCE) أو دورٍ لا يُحذَفُ بطلبِ صاحبِه (ROLE_NOT_SELF_ERASABLE ⇐ حلَّ محلَّ NOT_A_RIDER). ولا تمسُّ بايتاتَ المخزَنِ: تمحو إشارتَها فحسبُ (F2-11 · SD-12 · ADR 0112 · ADR 0125).';

revoke execute on function erase_my_account(bigint) from public, anon, authenticated;
grant execute on function erase_my_account(bigint) to service_role;
