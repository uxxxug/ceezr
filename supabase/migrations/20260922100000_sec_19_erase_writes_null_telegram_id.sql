-- migration-phase: switch
-- ============================================================================
-- SEC-19 بندُ ٤ (متابعة): `erase_my_account` يكتبُ `null` لا السالبَ
-- ----------------------------------------------------------------------------
-- **السياقُ:** البندُ ٤ (هجرةُ `20260922090000`) أسقطَ `not null` عن
-- `users.telegram_id`. لكنَّ `erase_my_account()` كانَ لا يزالُ يكتبُ
-- `v_sentinel` (معرّفٌ سالبٌ من `erased_account_telegram_seq`) إلى العمودِ.
-- فالذي نُفِّذَ هوَ السماحُ بالتمثيلِ `null`، لا استعمالُه فعليًّا في مسارِ
-- التجهيلِ الجديدِ.
--
-- **التغييرُ:** `update users set telegram_id = null` بدلَ `v_sentinel`.
-- و`v_sentinel` يبقى لحقولِ `chat_id` في `broadcast_recipients` و
-- `notification_outbox` و`subscription_notices` — فهذه الأعمدةُ لا تقبلُ
-- `null` (قيدُ `chat_id <> 0`)، فالسالبُ ضرورتُها.
--
-- **ولا يُنزَعُ `erased_account_telegram_seq`:** الصفوفُ القائمةُ تحملُ
-- سوالبَ مُولَّدةً منه، وتبقى كما هيَ — هذا تمثيلٌ للكتاباتِ الجديدةِ لا
-- ترحيلٌ للقديمةِ.
--
-- **المُشغِّلُ `mark_identity_before_erasure` آمنٌ:** يقرأُ `OLD.telegram_id`
-- (القيمةَ قبلَ التحديثِ) لا `NEW.telegram_id`، فانتقالُ `NEW` إلى `null`
-- لا يُأثِّرُ في أثرِ الهويّةِ المكتوبِ في `identity_marks`.
--
-- **التغييرُ الأدنى:** سطرٌ واحدٌ في جسمِ الدالّةِ — `telegram_id = v_sentinel`
-- يصيرُ `telegram_id = null`. ولا تغييرَ في التواقيعِ ولا في السطحِ العلنيِّ.
-- ============================================================================

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

    -- SEC-19 بندُ ٣: المِلكيّةُ بـ`users.id` الثابتِ لا بـ`telegram_id` الذي
    -- يَزولُ بالتجهيلِ. والعمودُ القديمُ (`created_by bigint`) مسلكٌ تراثيٌّ
    -- للصفوفِ التي لم تُعَيَّن بعدُ.
    with gone as (delete from trip_tracking_tokens
      where created_by_user_id = v_user.id
         or (created_by_user_id is null and created_by = p_telegram_id)
      returning 1)
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

    -- SEC-19 بندُ ٣: المِلكيّةُ بـ`users.id` الثابتِ — نفسُ المنطقِ في
    -- مسارِ الراكبِ أعلاه.
    with gone as (delete from trip_tracking_tokens
      where created_by_user_id = v_user.id
         or (created_by_user_id is null and created_by = p_telegram_id)
      returning 1)
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
     set telegram_id       = null,
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
  'تُجهّلُ حسابَ صاحبه وتُعيدُ إيصالاً مُفصَّلاً (F2-11 / ADR 0112). SEC-19 بندُ ٣: حذفُ رموزِ التتبُّعِ بـ`created_by_user_id` الثابتِ لا بـ`telegram_id`. SEC-19 بندُ ٤: `telegram_id = null` لا السالبَ — التمثيلُ المستقبليُّ (`ADR 0175`).';
