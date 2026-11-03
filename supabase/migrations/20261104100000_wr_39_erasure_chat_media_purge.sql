-- migration-phase: contract
-- ============================================================================
-- `WR-39` (قرارُ المالكِ 2026-11-03 · البندُ د من أمرِ الاستلام): المحوُ الفوريُّ
-- لملفّاتِ محادثةِ الطلبِ عندَ حذفِ الحسابِ — يمرُّ بالعاملِ لا بـSQL وحدَه.
-- ADR 0306.
--
-- **الفكرةُ**: حذفُ الحسابِ معاملةٌ واحدةٌ لا تُنقَضُ، وحذفُ ملفٍّ من مخزنِ
-- الكائناتِ ليسَ كتابةَ قاعدةٍ — فلا يُدخَلُ في المعاملةِ نفسِها. والقرارُ
-- المُعلَنُ في `erasure-policy.ts` كانَ صريحًا: محوُ الصفِّ في SQL يُيتِّمُ الكائنَ
-- في التخزينِ (لا يراهُ عاملُ الكنسِ بعدها)، فيبقى صوتُ الإنسانِ بلا مالكٍ ولا
-- موعد. فالترتيبُ هنا ثلاثيٌّ:
--   1) `erase_my_account` تُتمُّ التجهيلَ كما هوَ، ويُقيَّدُ في إيصالِها عدُّ
--      الوسائطِ **طابورًا** (`mediaPurge.mode = worker-after-commit`) — لا محوًا
--      وقعَ — ويعيدُ `user_id` الداخليَّ الثابتَ ليلتقطَهُ العاملُ.
--   2) طبقةُ التطبيقِ، بعدَ نجاحِ المحوِ **بعدَ الإتمامِ**، تنادي فورًا
--      `claim_order_chat_media_purge` فـ`remove` من المخزنِ فـ`complete` — نفسُ
--      ترتيبِ مكنسةِ `WR-34` (احذفِ الملفَّ ثمَّ السجلَّ): سقوطُ العاملِ بينهما
--      يعيدُ الالتقاطَ، والحذفُ متكرّرٌ بلا ضرر.
--   3) فشلُ المحوِ الفوريِّ لا يُسقِطُ الوسائطَ ولا الإيصالَ: الصفوفُ تبقى
--      قابلةً للالتقاطِ، والمكنسةُ الدوريّةُ (`sweep-chat-media` كلَّ 600 ثانيةٍ)
--      تلتقطُها بحكمِ `message_gone` — شبكةُ أمانٍ لا مسارًا وحيدًا.
--
-- **العزلُ**: الالتقاطُ والإتمامُ مُقيَّدانِ بـ`uploader_user_id = صاحبِ الحسابِ
-- المحوِّ` حرفيًّا في الدالتَينِ (لا بمعرّفاتٍ عابرةٍ)، فلا يمسُّ محوُ حسابٍ
-- ملفَّ إنسانٍ آخرَ ولو أُعيدتْ معرّفاتٌ خاطئةٌ.
--
-- الملفُّ لا يُضيِّقُ شيئًا قائمًا: `create or replace` لدالةٍ قائمةٍ بإضافاتٍ
-- (مفتاحُ إيصالٍ · معرّفُ الإرجاعِ)، ودالتانِ جديدتانِ بمنحِ `service_role` وحدَه.
--
-- **العودةُ** (code-only · تُقرأُ في docs/rollback.md):
--        يُستعادُ نصُّ تعريفِ محوِ الحسابِ من هجرةِ 20261013000100 كما هوَ
--        (دونَ مفتاحِ `mediaPurge` في الإيصالِ ودونَ `user_id` في الإرجاعِ)،
--        وتُحذفُ الدالتانِ الجديدتانِ بعدَ سحبِ منحِ `service_role` عنهما.
--        ولا مسَّ لبياناتٍ: الطابورُ هوَ صفوفُ `order_chat_attachments` نفسُها
--        والمكنسةُ الدوريّةُ تلتقطُ ما بقيَ بحكمِ الاستبقاءِ الذاتيِّ كما قبلَ.
-- ============================================================================

create or replace function erase_my_account(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
  v_media_pending   integer;
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
      'ok', true, 'reason', 'ALREADY_ERASED', 'erased_at', v_user.erased_at,
      'user_id', v_user.id
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

  -- WR-39: عدُّ ما بقيَ لصاحبِ الحسابِ من ملفّاتِ محادثةٍ (حجزٌ أو جاهزٌ) **قبلَ
  -- أيِّ حذفٍ**: يُقيَّدُ في الإيصالِ بوصفِهِ طابورَ المحوِ الفوريِّ الذي يلتقطُهُ
  -- العاملُ بعدَ إتمامِ المعاملةِ — لا بوصفِهِ محوًا وقعَ. والإيصالُ لا يدَّعي
  -- أبدًا حذفَ الوسائطِ ما لم يُحذَفِ الملفُّ من المخزنِ فعلًا.
  select count(*) into v_media_pending
    from order_chat_attachments
   where uploader_user_id = v_user.id
     and status in ('pending', 'ready');

  v_sentinel := -nextval('erased_account_telegram_seq');

  if v_user.role = 'rider' then
    select r.id into v_rider_id from riders r where r.user_id = v_user.id;

    if v_rider_id is not null then
      select count(*) into v_active
        from orders o
       where o.rider_id = v_rider_id
         and o.status in ('scheduled', 'searching', 'matched', 'in_progress');
      if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
      end if;
    end if;

    -- ── ما يُمحى صفّاً: مِلكُه وحدَه ───────────────────────────────────────
    with gone as (delete from saved_places where user_id = v_user.id returning 1)
      select count(*) into v_places from gone;

    -- WR-04: ما كتبَه في محادثاتِ الطلباتِ ومواضعُ قراءتِه — مِلكُه وحدَه.
    delete from order_message_reads where user_id = v_user.id;
    delete from order_messages where sender_user_id = v_user.id;

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

    -- WR-04: ما كتبَه في محادثاتِ الطلباتِ ومواضعُ قراءتِه — مِلكُه وحدَه.
    delete from order_message_reads where user_id = v_user.id;
    delete from order_messages where sender_user_id = v_user.id;

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

  -- WR-39 (قرارُ المالكِ 2026-11-03): المحوُ الفوريُّ للوسائطِ يمرُّ بالعاملِ
  -- لا بـSQL وحدَه — ومحوُ الصفِّ في SQL يُيتِّمُ الكائنَ في المخزنِ. فالإيصالُ
  -- يقولُها صريحةً: الوسائطُ **طابورٌ يُلتقطُ فورًا بعدَ هذه المعاملةِ**، وفشلُ
  -- العاملِ لا يُسقِطُها (المكنسةُ الدوريّةُ شبكةُ الأمانِ كلَّ 600 ثانيةٍ)، ولا
  -- يدَّعي الإيصالُ حذفَ ملفٍّ لم يُحذَف.
  v_receipt := jsonb_set(
    v_receipt,
    '{mediaPurge}',
    jsonb_build_object(
      'pendingAttachments', v_media_pending,
      'mode', 'worker-after-commit'
    )
  );

  -- الإيصالُ يُقيَّدُ في `audit_log`: صنفُه هناكَ «لا مدّةَ له» وهوَ عينُ ما
  -- يلزمُ إيصالَ حذفٍ. والفاعلُ صاحبُ الحسابِ نفسُه، ومفتاحُه `restrict` فلا
  -- يذهبُ الإيصالُ معَ الصفِّ.
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'account.erased', 'user', v_user.id, v_receipt);

  -- WR-39: المعرّفُ الداخليُّ الثابتُ يُعادُ ليلتقطَهُ العاملُ في طبقةِ التطبيقِ
  -- فيمحوَ ملفّاتِ محادثةِ هذا الحسابِ فورًا بعدَ الإتمامِ — `telegram_id` قد
  -- زالَ بالتجهيلِ فلا يصلحُ مفتاحَ مطاردةٍ.
  return jsonb_build_object(
    'ok', true, 'reason', 'ERASED', 'erased_at', now(), 'user_id', v_user.id,
    'receipt', v_receipt
  );
end;
$fn$;

-- ٦) حالةُ البحثِ للراكب: ثلاثةُ حقولٍ جديدة، والمجدولُ يُلغى بلا عقوبة.
CREATE OR REPLACE FUNCTION public.ride_search_state(p_telegram_id bigint, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_order     record;
  v_notified  integer;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الملكيّةُ شرطُ القراءةِ، **وغيرُ المالكِ يُرَدُّ بـ`ORDER_NOT_FOUND` لا
  -- بـ`FORBIDDEN`**: رمزُ المنعِ يُقِرُّ بوجودِ الرحلةِ لمن ليسَ له، فيُصبِحُ
  -- عدَّادَ معرّفاتٍ صحيحةً لمن يجرِّبُها.
  select o.id, o.status, o.service, o.broadcast_round, o.created_at, o.assigned_driver_id,
         o.searching_since, o.pickup_at, o.dispatch_at
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select count(distinct oo.driver_id) into v_notified
  from order_offers oo
  where oo.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'broadcast_round', v_order.broadcast_round,
    'created_at', v_order.created_at,
    -- `WR-06`: بدءُ البحثِ الفعليّ (إطلاقُ المجدولِ) ليُقاسَ منه العدّاد، وموعدا المجدول.
    'search_started_at', coalesce(v_order.searching_since, v_order.created_at),
    'pickup_at', v_order.pickup_at,
    'dispatch_at', v_order.dispatch_at,
    'notified_driver_count', coalesce(v_notified, 0),
    -- الدائرةُ الأوسعُ مفتوحةٌ: صفٌّ واحدٌ في دوراتِ غيرِ المشتركينَ يكفي —
    -- والفهرسُ الفريدُ الجزئيُّ `unsubscribed_negotiations_single_open` يمسُّ
    -- الحيَّ منها، وههنا يُسألُ عن الوجودِ قطّ (أيُّ دورةٍ) لأنَّ الراكبَ يسألُ
    -- «هل وسّعتم؟» لا «في أيِّ دورةٍ أنا؟».
    'wider_circle_opened', exists (
      select 1 from unsubscribed_negotiations un where un.order_id = v_order.id
    ),
    -- التصعيدُ المُسلَّمُ وحدَهُ (راجعْ تعليقَ الرأسِ): الصفوفُ القديمةُ بلا
    -- المفتاحِ تُقرَأُ مُسلَّمةً كما في حراسةِ `mark_escalation_delivered`.
    'escalated', exists (
      select 1 from audit_log a
       where a.entity_type = 'order' and a.entity_id = v_order.id
         and a.action = 'order.escalated'
         and coalesce((a.payload->>'delivered')::boolean, true) = true
    ),
    -- الإلغاءُ **بلا عقوبةٍ قبلَ الإسنادِ** نصُّ `SR-05`. والقابليّةُ تُحكَمُ ههنا
    -- لا في العميلِ، لأنَّ زرّاً يُظهِرُهُ العميلُ بحسبِ حالةٍ قديمةٍ يُلغي رحلةً
    -- أُسنِدَت فعلاً — أو يُخفي زرّاً يستحقُّه الراكبُ.
    'cancellable_without_penalty', v_order.status in ('searching', 'scheduled')
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- WR-39: دالتا المحوِ الفوريِّ — تُنادى من طبقةِ التطبيقِ بعدَ إتمامِ المحوِ.
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * التقاطُ ملفّاتِ محادثةِ حسابٍ محوٍّ — **مقيَّدٌ بمالكِها حرفيًّا**: لا يعيدُ
 * إلا صفوفَ `uploader_user_id = p_user_id` الحجزَ منها والجاهزَ (المحذوفُ قد
 * انتهى). الدالةُ **لا تُغيّرُ شيئًا** (stable): الالتقاطُ هنا قراءةٌ، والقفلُ
 * غيرُ لازمٍ لأنَّ الإتمامَ متسامحٌ معَ التكرارِ (متزامنَانِ يلتقطانِ الصفوفَ
 * نفسَها فيحذفانِ الملفَّ مرّتينِ بلا ضررٍ، والإتمامُ يَعدُّ ولا يَكرَّرُ أثرُه).
 * والترتيبُ معَ المخزنِ: احذفِ الملفَّ ثمَّ السجلَّ — لا العكس.
 */
create or replace function claim_order_chat_media_purge(p_user_id uuid, p_limit integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'object_path', c.object_path)), '[]'::jsonb)
    from (
      select a.id, a.object_path
        from order_chat_attachments a
       where a.uploader_user_id = p_user_id
         and a.status in ('pending', 'ready')
       order by a.created_at
       limit least(greatest(coalesce(p_limit, 500), 1), 500)
    ) c;
$$;

revoke all on function claim_order_chat_media_purge(uuid, integer) from public, anon, authenticated;
grant execute on function claim_order_chat_media_purge(uuid, integer) to service_role;

/**
 * إتمامُ المحوِ بعدَ حذفِ الملفّاتِ من المخزنِ — **مقيَّدٌ بمالكِها في كلِّ
 * سطرٍ**: الحجزُ المعلَّقُ يُحذفُ صفُّه (لم يُسلَّمْ يومًا فلا سجلَّ يبقى)،
 * والجاهزُ يصيرُ `deleted` ويبقى سجلُّه دليلَ حذفٍ (لا يختفي من سجلِّ المحادثةِ:
 * الرسالةُ تقولُ «انتهت صلاحيةُ الملف»). ولو مُرِّرتْ معرّفاتُ ملفّاتِ إنسانٍ
 * آخرَ معَ معرّفِ هذا الحسابِ لم يُمَسَّ منها شيءٌ — العزلُ شرطٌ في الدالّةِ لا
 * أملٌ في المتنادي. والإتمامُ متكررٌ بلا ضررٍ: ما صارَ `deleted` لا يعودُ.
 */
create or replace function complete_order_chat_media_purge(p_ids uuid[], p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
  v_expired integer;
begin
  delete from order_chat_attachments
   where id = any(p_ids)
     and uploader_user_id = p_user_id
     and status = 'pending';
  get diagnostics v_removed = row_count;

  update order_chat_attachments
     set status = 'deleted', deleted_at = now()
   where id = any(p_ids)
     and uploader_user_id = p_user_id
     and status = 'ready';
  get diagnostics v_expired = row_count;

  return jsonb_build_object('ok', true, 'removed', v_removed, 'expired', v_expired);
end;
$$;

revoke all on function complete_order_chat_media_purge(uuid[], uuid) from public, anon, authenticated;
grant execute on function complete_order_chat_media_purge(uuid[], uuid) to service_role;
