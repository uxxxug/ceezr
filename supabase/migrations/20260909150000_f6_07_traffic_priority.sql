-- الغرض: F6-07 / القسمُ ١٥ — **أولويّةُ المرورِ في الطابورِ**: يُلتقَطُ الأحقُّ لا
--   الأسبقُ. تُدخِلُ دالّةَ رتبةٍ ثابتةً (`notification_kind_priority`) تُقابِلُها
--   `packages/shared/config/traffic-priority.ts` بحاجزِ `check-traffic-priority`،
--   وتُعيدُ بناءَ `claim_notification_delivery` بترتيبٍ رتبيٍّ قبلَ الأقدميّةِ،
--   وتُوسِّعُ قائمةَ التأجيلِ (`notification_kind_is_deferrable`) إلى المتوسّطِ
--   والمنخفضِ اشتقاقاً من الرتبةِ لا بقائمةٍ ثانيةٍ تُكتَبُ باليدِ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `expand`.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: claim_notification_delivery ·
--   notification_outbox_backpressure_defer · فهرسُ الرتبةِ في ملفِّ طورِ `index`.
-- ما لا تفعله: لا تُنشئُ عموداً ولا جدولاً ولا تُغيِّرُ بيانةً قائمةً، ولا تُسقِطُ
--   صفّاً ولا تُلغي رسالةً — الرتبةُ ترتيبٌ وتأجيلٌ لا إعدامٌ. ولا تقرأُ إعداداً
--   لكلِّ مدينةٍ: الرتبةُ بنيويّةٌ، والقابلُ للضبطِ حِصّةُ الدلوِ وحدَها وموضعُها
--   `platform_settings` في طبقةِ المُرسِلِ لا ههنا.
-- migration-phase: expand

-- ## العودة (rollback)
--
-- كلُّ عبارةٍ ههنا `create or replace` على دالّةٍ، فالعودةُ **إعادةُ تطبيقِ
-- النسخةِ السابقةِ** من `20260909120000_f6_06_queue_backpressure.sql`
-- (`claim_notification_delivery` بترتيبِ `order by n.created_at`، و
-- `notification_kind_is_deferrable` بقائمةِ `broadcast_recipient` وحدَها)، ثمَّ
-- `drop function if exists notification_kind_priority(text)` بعدَ إسقاطِ فهرسِ
-- الرتبةِ (`drop index concurrently if exists
-- notification_outbox_priority_due_idx`) — بهذا الترتيبِ لأنَّ الفهرسَ يعتمدُ
-- الدالّةَ. ولا بيانةَ تُفقَدُ في الطريقَينِ: لا صفَّ يُكتَبُ ولا يُحذَفُ ههنا.
--
-- ## لماذا الرتبةُ دالّةٌ ثابتةٌ لا عمودٌ في الجدولِ
--
-- عمودُ `priority` يعني: قيمةً تُكتَبُ عندَ الإيداعِ فتُجمَّدُ لحظةَ الكتابةِ. ثمَّ
-- إذا صُحِّحَ تصنيفُ نوعٍ بقيَ ملايينُ الصفوفِ القديمةِ برتبةٍ خاطئةٍ حتّى تُملأَ
-- بمسحٍ كاملٍ (`backfill`) — أي هجرةٌ ثقيلةٌ على جدولٍ حارٍّ لكلِّ تصحيحِ تصنيفٍ.
-- ودالّةٌ `immutable` تُقرأُ من `kind` **في زمنِ الاستعلامِ**، فالتصحيحُ نشرُ
-- دالّةٍ لا مسحُ جدولٍ، وتقبلُها الفهرسةُ (`create index … on
-- notification_outbox (notification_kind_priority(kind), created_at)`) فلا يُدفَعُ
-- ثمنُ حسابِها في كلِّ صفٍّ.
--
-- و`immutable` صادقةٌ لا مُدَّعاةٌ: جسمُها `case` مغلقٌ على ثوابتِ نصٍّ، لا يقرأُ
-- جدولاً ولا إعداداً ولا `now()`. ولو قرأَ إعداداً لكانَ `stable` فلا يُفهرَسُ —
-- وهذا سببٌ بنيويٌّ آخرُ لبقاءِ الرتبةِ خارجَ `platform_settings`.

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
    -- ٢ = مرتفعٌ: تسليمُ العروضِ وتوسيعُ الدائرةِ — خطواتُ الإسنادِ نفسِه.
    when 'offer' then 2
    when 'wider_circle_opened' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ: نوعٌ جديدٌ نُسيَ تصنيفُه يُقدَّمُ لا يُؤخَّرُ،
    -- وسهوُه يُكشَفُ في CI بحاجزِ `scripts/check-traffic-priority.ts` لا في حادثةٍ.
    else 1
  end::smallint;
$$;

revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

-- ---------------------------------------------------------------------------
-- قائمةُ التأجيلِ مُشتقّةً من الرتبةِ — لا مصدرَ حقيقةٍ ثانياً للتأجيلِ
--
--    كانَت (`F6-06`) `p_kind in ('broadcast_recipient')` وسببُ صراحتِها مُعلَناً:
--    الرتبةُ الكاملةُ بندُ `F6-07`. وقد جاءَ، فصارَت **`الرتبةُ >= 3`** — أي
--    المتوسّطُ والمنخفضُ، وهوَ نصُّ القسمِ ١٥: «تُقلَّص الوظائف الثانوية، ويؤجَّل
--    البثّ غير الضروري». والحرجُ والمرتفعُ لا يُؤجَّلانِ لأنَّ لهما مؤقّتاً يجري،
--    فتأجيلُهما إسقاطٌ بالحسابِ لا تهدئةٌ.
--
--    وأثرُ التوسيعِ محدودٌ بابِه: التأجيلُ لا يقعُ إلّا **عندَ خرقِ حدٍّ** في
--    `notification_outbox_backpressure_defer` (عمقٌ أو حدُّ مُنتِجٍ)، فالمرورُ
--    الهادئُ لا يُمَسُّ بحرفٍ.
-- ---------------------------------------------------------------------------

create or replace function notification_kind_is_deferrable(p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select notification_kind_priority(p_kind) >= 3;
$$;

revoke all on function notification_kind_is_deferrable(text) from public, anon, authenticated;
grant execute on function notification_kind_is_deferrable(text) to service_role;

-- ---------------------------------------------------------------------------
-- المُطالِبُ بترتيبٍ رتبيٍّ — تغييرُ سطرٍ واحدٍ في دالّةٍ نُقِلَت حرفاً
--
--    الفرقُ عن نسخةِ `20260909120000` موضعانِ لا أكثرُ:
--      (١) سطرُ الترتيبِ:
--          قبلَ:  order by n.created_at
--          بعدَ:  order by notification_kind_priority(n.kind), n.created_at
--      (٢) شرطُ **رأسِ الطلبِ** (`not exists`) المُضافُ إلى `where` — تصحيحٌ
--          مُضافٌ بعدَ حكمِ CI `34393076336`: الرتبةُ وحدَها قلبَت التتابعَ
--          السببيَّ لرسائلِ الطلبِ الواحدِ فأسقطَت اختباراً قائماً، والشرحُ
--          عندَ الشرطِ نفسِه أدناه وفي `docs/adr/0071-…` §٩.
--
--    وبقيَ ما بعدَه كما هوَ حرفاً — الاسترجاعُ قبلَ السقفِ، وسقفُ التزامنِ،
--    و`batch_limit` من مفتاحِه، وبناءُ الحِمْلِ لكلِّ نوعٍ — لأنَّ `create or
--    replace` تستبدلُ الجسمَ كلَّه، فأيُّ حذفٍ ههنا حذفٌ في الإنتاجِ. ولا تُعادُ
--    كتابتُها لتُصحَّحَ، بل تُنقَلُ لتُقارَنَ سطراً بسطرٍ في المراجعةِ.
--
--    و**الأقدميّةُ باقيةٌ فاصلاً ثانياً** لا مُلغاةً: داخلَ الرتبةِ الواحدةِ
--    الأقدمُ أسبقُ، فلا صفَّ يُترَكُ إلى الأبدِ لأنَّ رتبتَه أدنى ما دامَ
--    الأعلى يفرغُ. وجَوعُ المنخفضِ (`starvation`) عندَ فيضٍ حرجٍ **حدٌّ مُعلَنٌ**
--    في `docs/adr/0071-traffic-priority-classes.md` §٥ لا مسكوتٌ عنه.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- تصحيحٌ مُضافٌ ثانٍ (حكمُ CI 34395013243): `order_id` عمودٌ لا حمولةٌ
--
--    شرطُ رأسِ الطلبِ يقرأُ عمودَ `order_id`، وأنواعُ دورةِ الرحلةِ المُودَعةُ عبرَ
--    `enqueue_notification` كانَت تتركُه فارغاً وتضعُ معرّفَ الطلبِ في الحمولةِ
--    وحدَها (`order_id` نصّاً، أو `claim_id` يُحيلُ إليه). فبقيَ الشرطُ صحيحاً
--    ولا يُطبَّقُ على شيءٍ، وبقيَ الانقلابُ السببيُّ واقعاً في CI بعدَ إضافتِه.
--
--    والعلاجُ **إكمالُ العمودِ عندَ الإيداعِ** لا قراءةُ الحمولةِ في المُطالِبِ:
--    فيبقى للمُطالِبِ مصدرُ حقيقةٍ واحدٌ مفهرَسٌ، ولا يُقرأُ معرّفٌ من نصٍّ في
--    كلِّ شوطٍ. والحمولةُ تبقى كما هيَ حرفاً — لا حقلَ حُذِفَ ولا اسمَ تغيَّرَ —
--    فقارئوها في العامِلِ لا يُمَسّونَ.
--
--    وحدودُه مُعلَنةٌ: (١) أنواعُ دورةِ الرحلةِ وحدَها تُكمَلُ — وهيَ نطاقُ هذا
--    المُطالِبِ — فلا يُكتَبُ عمودٌ لنوعٍ لا يقرؤُه أحدٌ. (٢) الصفوفُ القديمةُ
--    المُودَعةُ قبلَ هذه الهجرةِ تبقى بعمودٍ فارغٍ فلا يحجُبُ بعضُها بعضاً — وهيَ
--    صفوفُ دقائقَ لا تاريخٌ (الصادرُ يُفرَغُ في ثوانٍ)، فلا تُعادُ كتابةُ بيانةٍ
--    قائمةٍ بظنٍّ. (٣) والطلبُ المعدومُ (مرجعٌ في حمولةٍ لا يقابلُه صفٌّ) يُترَكُ
--    فارغاً لا يُسقِطُ الإيداعَ: مفتاحُ الغيرِ (`on delete restrict`) كانَ سيُحوِّلَ
--    حمولةً مُعطَلةً إلى إشعارٍ لا يُودَعُ أصلاً — وذلكَ أضرُّ من إشعارٍ بلا تتابعٍ.
-- ---------------------------------------------------------------------------

create or replace function enqueue_notification(
  p_city_id uuid, p_kind text, p_payload jsonb, p_dedup_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_order uuid;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled'
  ];
begin
  if p_kind = any(v_ride_kinds) then
    -- معرّفُ الطلبِ صريحاً في الحمولةِ (`enqueue_rider_order_notification` وما
    -- يُشبِهُه)، وإلّا فبمعرّفِ المطالبةِ (`enqueue_negotiation_notification`).
    v_order := nullif(v_payload->>'order_id', '')::uuid;
    if v_order is null and nullif(v_payload->>'claim_id', '') is not null then
      select c.order_id into v_order
        from unsubscribed_claims c
       where c.id = (v_payload->>'claim_id')::uuid;
    end if;
    if v_order is not null and not exists (select 1 from orders o where o.id = v_order) then
      v_order := null;
    end if;
  end if;

  insert into notification_outbox (city_id, kind, payload, dedup_key, order_id)
  values (p_city_id, p_kind, v_payload, p_dedup_key, v_order)
  on conflict (kind, dedup_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

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
  v_timeout integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
  v_claim record;
  v_rider record;
  v_driver record;
  v_batch_limit integer;
  v_concurrency integer;
  v_claimed bigint;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled'
  ];
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  -- استرجاعُ الحجوزِ المتروكةِ لأنواعِ دورةِ الرحلةِ وحدَها — ما للعاملِ الأساسيِّ
  -- معالجُه. الأنواعُ الموحَّدةُ (safety_incident، subscription_notice) لها
  -- عوّالُها ومطالِبُها الخاصُّ فلا يُمسُّها هذا الاسترجاعُ.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind = any(v_ride_kinds)
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  -- **رأسُ الطلبِ وحدَه مؤهَّلٌ** (`not exists` أدناه): الرتبةُ تُزاحِمُ **بينَ**
  -- الطلباتِ ولا تُعيدُ ترتيبَ رسائلِ الطلبِ الواحدِ. ولولا هذا القيدُ لَانقلبَ
  -- التتابعُ السببيُّ في محادثةٍ واحدةٍ: «فُتِحَت دائرةٌ أوسعُ» (رتبةُ 2) مُودَعٌ
  -- قبلَ «تمَّ الاتفاقُ» (رتبةُ 1) للطلبِ نفسِه، فيَصِلُ الراكبَ الاتفاقُ ثمَّ
  -- يَصِلُه بعدَه خبرٌ متقادمٌ عن بحثٍ انتهى — وهوَ عطبٌ يراهُ المستخدِمُ لا
  -- تحسينٌ. **وقيسَ لا استُنبِطَ**: التشغيلُ `34393076336` أسقطَ
  -- `unsubscribed-negotiation.test.ts` بهذا الانقلابِ عينِه قبلَ إضافةِ القيدِ.
  --
  -- والصفُّ المؤجَّلُ بتراجعٍ (`next_attempt_at` في المستقبلِ) **لا يحجُبُ** ما
  -- بعدَه: شرطُ الحجبِ يقرأُ المستحقَّ وحدَه، فصفٌّ يُعيدُ المحاولةَ بعدَ دقيقةٍ
  -- لا يُجمِّدُ رسائلَ طلبِه دقيقةً. وهذا حدٌّ مُعلَنٌ: التتابعُ مضمونٌ للمستحقِّ
  -- لا للمُتراجِعِ (ADR-0071 §٩).
  --
  -- و`order_id` الفارغُ لا يُقارَنُ بفارغٍ (`null = null` مجهولٌ) فالصفوفُ التي
  -- لا طلبَ لها تبقى متزاحمةً بالرتبةِ وحدَها — وهيَ ليست في تتابعٍ سببيٍّ أصلاً.
  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind = any(v_ride_kinds)
     and not exists (
       select 1 from notification_outbox o
        where o.order_id = n.order_id
          and o.status = 'pending'
          and o.kind = any(v_ride_kinds)
          and o.next_attempt_at <= now()
          and (o.created_at, o.id) < (n.created_at, n.id)
     )
   order by notification_kind_priority(n.kind), n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  -- سقفُ التزامنِ: يُقاسُ بعدَ الاسترجاعِ وبعدَ اختيارِ الصفِّ — فلا يُقرأُ
  -- إعدادٌ ولا يُعَدُّ صفٌّ إن كان الطابورُ فارغاً (الحالةُ الغالبةُ في كلِّ
  -- شوطٍ). والصفُّ المختارُ محجوزٌ بـ`for update` فلا يسبقُنا إليه غيرُنا، فإن
  -- رُدَّ الالتقاطُ عادَ إلى `pending` بانتهاءِ المعاملةِ سليماً كما كان.
  v_concurrency := queue_limit_or_null(v_delivery.city_id, 'outbox_queue_consumer_concurrency');
  select count(*) into v_claimed from notification_outbox n
   where n.city_id = v_delivery.city_id and n.status = 'sending';

  if v_concurrency is null or v_concurrency <= 0 or coalesce(v_claimed, 0) >= v_concurrency then
    perform record_queue_backpressure_event(
      v_delivery.city_id, 'notification_outbox', 'CONSUMER_CONCURRENCY',
      jsonb_build_object('claimed', v_claimed, 'consumer_concurrency', v_concurrency)
    );
    -- `delivery: null` كحالةِ «لا معلَّقَ»، و`backpressure` يُميِّزُ السببَ: شوطٌ
    -- يتوقّفُ لضغطٍ ليسَ شوطاً وجدَ الطابورَ فارغاً، ولا يُقرآنِ واحداً.
    return jsonb_build_object(
      'ok', true, 'delivery', null, 'backpressure', 'CONSUMER_CONCURRENCY',
      'claimed', coalesce(v_claimed, 0), 'consumer_concurrency', v_concurrency
    );
  end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  -- سقفُ صفوفِ الشوطِ: من مفتاحِ التزامنِ لا من سقفِ المحاولاتِ (تصحيحُ العطبِ «أ»).
  v_batch_limit := greatest(1, v_concurrency);

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  if v_delivery.kind = 'offer' then
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text
           )
      into v_payload
      from order_offers o where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end
      into v_owner_telegram, v_owner_language, v_owner_kind
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind
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
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found') then
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
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'batch_limit', v_batch_limit,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
