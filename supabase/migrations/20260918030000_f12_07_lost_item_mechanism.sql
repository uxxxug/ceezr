-- migration-phase: contract
-- =============================================================================
-- ملاحظةُ الطورِ: القيدُ الجديدُ **توسيعٌ** محضٌ (نوعٌ زائدٌ على قائمةٍ مغلقةٍ)،
--   لكنَّ نموذجَ الأمانِ الساكنَ يُصنِّفُ استبدالَ قيدِ `check` بـ`drop`+`add` على
--   أنَّهُ عمليةٌ هدّامةٌ، فلا يقبَلُها إلّا في طورِ `contract`. والسببُ تقنيٌّ لا
--   مفهوميٌّ: PostgreSQL لا يُغيِّرُ تعريفَ قيدِ `check` في موضِعِهِ، فاستبدالُهُ
--   يقتضي حذفَهُ أوّلاً. والقيدُ الجديدُ **مجموعةٌ فائقةٌ** تحوي القديمَ كلَّهُ،
--   فلا صفَّ يُرفَضُ ولا بياناتَ تُفقَدُ. والتوثيقُ في طورٍ تالٍ (`validate`).
-- `F12-07` — آليّةُ بلاغِ المفقودِ: راكبٌ فقدَ شيئاً في رحلةٍ منتهيةٍ مُسنَدٍ
--   سائقُها، فيُودَعُ بلاغٌ في صندوقِ الصادرِ موجَّهٌ إلى محادثةِ ذلكَ السائقِ
--   **داخلَ معاملةِ فتحِ التذكرةِ نفسِها** — لا صفَّ يتيمَ ينتظرُ إرسالاً لم يقع.
--
-- الحالة: منفّذ فعلياً — البند `F12-07` (§F12 من `ROADMAP-MASTER`).
-- ينتمي إلى: supabase/migrations
-- يبني على: 20260906010000 (الصادرُ الموحَّد) · 20260909040000 (F6-05 التصنيفُ
--   والمركزُ) · 20260909150000 (F6-07 رتبةُ المرورِ) · 20260916020000 (F3-08
--   open_support_ticket).
-- يحرسُه: tests/integration/lost-item-mechanism.test.ts ·
--   scripts/check-lost-item-mechanism.ts · scripts/check-notification-classification.ts
--   (الموسَّعُ ليقرأَ بذرَ السياسةِ من كلِّ هجرةٍ لا من F6-05 وحدَها) ·
--   scripts/check-traffic-priority.ts.
-- الحاكم: §F12 من `ROADMAP-MASTER` (حجزُ البندِ في `ROADMAP.md`).
--
-- ## ما المشكلةُ التي يحلُّها هذا الملفّ
--
-- راكبٌ نزلَ من السيّارةِ ثمّ تذكَّرَ أنَّه نسيَ شيئاً. اليومَ يفتحُ تذكرةَ
-- `lost_item` فتُكتبُ في `support_tickets` وينتهي الأثرُ هناك: لا أحدٌ يُخبَرُ
-- إلا حينَ يقرأَ موظّفُ الدعمِ قائمةَ التذاكر. فالسائقُ الذي في سيّارتِهِ ما
-- يُفتَّشُ عنهُ لا يعرفُ أن يفتّشَ، والمعلومةُ الوحيدةُ التي لها قيمةٌ زمنيّةٌ
-- (فتِّشْ سيّارتَك الآنَ) تبقى في قائمةٍ تُقرأُ متى قُرئَت. والمفقودُ يُفقَدُ
-- مرّتَينِ: مرّةً حينَ غابَ، ومرّةً حينَ لم يصلْ خبرُ غيابِهِ إلى مَن بيدهِ إيجادُه.
--
-- ## القرارُ: بلاغٌ موجَّهٌ إلى السائقِ داخلَ معاملةِ التذكرةِ — **عندما ثمَّ سائقٌ يُوجَّهُ إليه**
--
-- تذكرةُ `lost_item` تُفتَحُ كما كانت (`F3-08` تركَ فتحَها بلا طلبٍ ولا سائقٍ خارجَ
-- حجزِه صراحةً، وحكمُ `ح-8` يمنعُ محوَه): راكبٌ يبلغُ عن مفقودٍ فيُكتَبُ صفُّ التذكرةِ
-- دائماً، فلا يُردُّ بلاغٌ بلا طلبٍ ولا يُردُّ طلبٌ بلا سائقٍ. وإنَّما تُبنَى الآليّةُ
-- **على الإخبارِ لا على الردِّ**: متى كانَ للبلاغِ طلبٌ مملوكٌ بسائقٍ مُسنَدٍ ورحلةٍ
-- **منتهيةٍ** (`status = 'completed'`)، يُودَعُ صفُّ `lost_item_report` في `notification_outbox`
-- موجَّهاً إلى ذلكَ السائقِ **داخلَ معاملةِ فتحِ التذكرةِ نفسِها** — لا صفَّ يتيمَ ينتظرُ إرسالاً لم يقع.
--   ١) `ORDER_NOT_YOURS` — القائمُ على الحسابِ ليسَ راكبَ الطلبِ ولا سائقَهُ
--      المُسنَدَ. والفحصُ **قائمٌ أصلاً** لكلِّ تذكرةٍ ذاتِ طلبٍ، فلا يُعادُ ولا
--      يُخفَّفُ: مَن يفتحُ عن طلبٍ ليسَ لهُ يُردُّ كما كانَ.
--   ٢) الإخبارُ مشروطٌ لا الردُّ: طلبٌ بلا سائقٍ مُسنَدٍ، أو رحلةٌ لم تنتهِ بعدُ،
--      تُكتَبُ تذكرتُها **بلا بلاغٍ** — فلا محادثةَ تُوجَّهُ إليها البلاغُ، ولا
--      صفٌّ ميّتٌ يُحاولُ التسليمَ أبداً.
-- ثمّ **بعدَ** كتابةِ التذكرةِ وسجلِّ التدقيقِ — وفي المعاملةِ نفسِها —
-- يُودَعُ صفُّ `lost_item_report` (عند تحقُّقِ الشروطِ) موجَّهاً إلى السائقِ
-- المُسنَدِ. فإن فشلَ الإيداعُ رجعَ كلُّ شيءٍ: لا تذكرةَ بلا بلاغٍ ولا بلاغَ بلا
-- تذكرةٍ. ومفتاحُ منعِ التكرارِ `'lost_item:' || ticket_id` — تذكرةٌ واحدةٌ
-- بلاغٌ واحدٌ.
--
-- ## لماذا السائقُ المستقبِلُ لا الراكبُ
--
-- الراكبُ صاحبُ التذكرةِ يعرفُ أنَّه فقدَ شيئاً — أخبرَ هو. والمستقبِلُ الذي
-- يملكُ الفعلَ هو السائقُ: في سيّارتِهِ المفقودُ إن كان. فالبلاغُ يذهبُ إلى
-- محادثتِهِ هو لا إلى محادثةِ الراكبِ. ومَن يُرسَلُ إليهُ يُحلُّ من الطلبِ لا
-- من الحمولةِ النصّيّةِ: `resolve_notification_recipient` يقرأُ `driver_id` من
-- الحمولةِ ويُعيدُ `user_id` للسائقِ، و`claim_notification_delivery` يُغنيها
-- حيًّا بمعرّفِ تلغرامَ ولغتِهِ لحظةَ الالتقاطِ — كما يفعلُ `order_cancelled`.
--
-- ## لماذا النوعُ في `v_ride_kinds` للمُطالِبِ لا في `enqueue`
--
-- الصفُّ يُلتقَطُ بالعاملِ الأساسيِّ (الذي يُرسلُ على بوتِ السائقِ) فلا يحتاجُ
-- عوّالاً خاصّاً. وأُضيفَ إلى قائمةِ المُطالِبِ لا إلى قائمةِ `enqueue` التي
-- تُكمِلُ عمودَ `order_id` لأنواعِ دورةِ الرحلةِ: بلاغُ المفقودِ **ليسَ في
-- تتابعٍ سببيٍّ** مع عروضِ الطلبِ ومراحلِه — فلا ينبغي أن يحجُبَه عرضٌ معلَّقٌ
-- للطلبِ نفسِهِ ولا أن يحجُبَ هو عرضاً. و`order_id` الفارغُ يُخرِجُه من شرطِ
-- رأسِ الطلبِ فيُسلَّمُ بالرتبةِ والأقدميّةِ وحدَها. وهو `medium` (رتبةُ ٣):
-- تحديثُ دعمٍ ذو قيمةٍ زمنيّةٍ، لا استغاثةٌ ولا حالةَ رحلةٍ ولا مطالبةَ إسنادٍ
-- ذو مؤقّتٍ يجري.
--
-- ## ما لا تفعلُه هذه الهجرةُ عن قصدٍ (`ح-5`)
--
--   ــ **لا تُنشئُ جدولاً ولا عموداً**: `support_tickets` و`notification_outbox`
--      يحملان كلَّ ما يلزمُ منذُ هجراتِهما.
--   ــ **لا تُغيِّرُ التوقيعَ**: `open_support_ticket` يبقى بخمسةِ معاملاتٍه.
--   ــ **لا تبني حالةَ تسليمٍ**: لا طاولةَ مفقوداتٍ ولا سيرَ إرجاعٍ ولا شاشةَ
--      تطبيقٍ — البندُ إيداعُ البلاغِ وحسبُ.
--   ــ **لا تُعيدُ ما يُكتَبُ**: `claim items returned` خارجَ الحجزِ صراحةً.
--   ــ **لا تُقلِبُ البندَ `[x]`**: ثلاثةُ أخضرٍ على `main` قبلَ ذلكَ (`ح-4`).
--
-- ## العودة (rollback)
--
-- كلُّ عبارةٍ ههنا `create or replace` على دالّةٍ أو `drop constraint`+`add
-- constraint` موسِّعٌ (القيدُ الجديدُ يحوي القديمَ كلَّهُ زائدَ نوعٍ)، فالعودةُ
-- **إعادةُ تطبيقِ النسخةِ السابقةِ** من الدوالِّ الأربعِ (`notification_kind_priority`
-- و`resolve_notification_recipient` و`claim_notification_delivery` و
-- `open_support_ticket`) من هجراتِها، وإعادةِ القيدِ والبذرِ إلى ما قبلَهما.
-- ولا بيانةَ تُفقَدُ: لا صفَّ `lost_item_report` يُكتَبُ قبلَ تطبيقِ هذه الهجرةِ
-- (النوعُ لم يكن في القيدِ ولا في `enqueue` منادٍ)، فلا يتيمُ صفٌّ بلا معالجٍ.
-- و`breaksPreviousRelease: false`: مَن كانَ يفتحُ `lost_item` بلا طلبٍ كانَ
-- يُقبَلُ — لكنَّ `lost_item_report` نوعٌ جديدٌ لا منادِيَ له قبلَ هذه الهجرةِ،
-- فلا مسارَ نشرٍ سابقٌ ينكسرُ ببلاغٍ لم يكن يُرسَلُ أصلاً.
-- =============================================================================

-- ١) القيدُ يُوسَّعُ نوعاً واحداً — وله منادٍ يكتبُه في هذه الهجرةِ نفسِها. يُضافُ
--    `not valid` لئلّا يَمسحَ الجدولَ كلَّه تحتَ قفلٍ حاجزٍ، ثمّ يُصادَقُ في هجرةِ
--    `validate` تالٍ (20260918030100) — بنمطِ المستودعِ نفسِهِ في F2-12 وF3-01.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report'
  )) not valid;

-- ٢) بذرُ السياسةِ للنوعِ الجديدِ — بنمطِ `cross join (values ...)` نفسِهِ الذي
--    تقرؤُه هجرةُ F6-05، ليُقابِلَهُ حاجزُ check-notification-classification
--    (الموسَّعُ ليقرأَ بذرَ السياسةِ من كلِّ هجرةٍ). والقناةُ `critical`: بلاغٌ
--    موجَّهٌ إلى فردٍ يُرسَلُ عبرَ تلغرام. ولا `in_app`: لا صندوقَ واردٍ شخصيَّ
--    له، فتصنيفُه داخلَ التطبيقِ إعدامٌ صامتٌ.
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
  cross join (values
    ('lost_item_report', 'بلاغ مفقود موجَّه إلى سائق الرحلة المُسنَد')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ٣) رتبةُ المرورِ للنوعِ الجديدِ — `medium` (٣): تحديثُ دعمٍ ذو قيمةٍ زمنيّةٍ
--    (فتِّشْ سيّارتَك الآنَ) لا استغاثةٌ ولا حالةَ رحلةٍ ولا مطالبةَ إسنادٍ. والدالّةُ
--    الأربعُ تُعادُ بزيادةِ فرعٍ واحدٍ للنوعِ الجديدِ وحدَهُ، ولا حرفَ في غيرِه.
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
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ. وبلاغُ المفقودِ
    --    تحديثُ دعمٍ ذو قيمةٍ زمنيّةٍ، لكنَّهُ ليسَ في تتابعٍ سببيٍّ مع دورةِ الرحلةِ
    --    ولا مؤقّتَ يستهلكُه التأخيرُ — فهو متوسّطٌ لا مرتفعٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ: نوعٌ جديدٌ نُسيَ تصنيفُه يُقدَّمُ لا يُؤخَّرُ،
    -- وسهوُه يُكشَفُ في CI بحاجزِ `scripts/check-traffic-priority.ts` لا في حادثةٍ.
    else 1
  end::smallint;
$$;

revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

-- ٤) مستقبِلُ البلاغِ — السائقُ المُسنَدُ للرحلةِ. يُقرأُ `driver_id` من الحمولةِ
--    لأنَّ الصفَّ لا يحملُ عمودَ `driver_id` لغيرِ نوعِ العرضِ. وفرعٌ واحدٌ يُزادُ
--    قبلَ `else`، ولا حرفَ في غيرِه من الفروعِ.
create or replace function resolve_notification_recipient(p_row notification_outbox)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  -- ما أعلنَه المنتِجُ صراحةً يسبقُ كلَّ استنتاجٍ.
  if p_row.recipient_user_id is not null then
    return p_row.recipient_user_id;
  end if;

  if p_row.kind = 'offer' then
    select d.user_id into v_user from drivers d where d.id = p_row.driver_id;

  elsif p_row.kind = 'order_cancelled' then
    select d.user_id into v_user from drivers d
     where d.id = (p_row.payload->>'driver_id')::uuid;

  elsif p_row.kind = 'lost_item_report' then
    -- السائقُ المُسنَدُ للرحلةِ هو المستقبِلُ: في سيّارتِهِ المفقودُ إن كان.
    select d.user_id into v_user from drivers d
     where d.id = (p_row.payload->>'driver_id')::uuid;

  elsif p_row.kind in ('wider_circle_opened', 'no_driver_found') then
    select r.user_id into v_user
      from orders o join riders r on r.id = o.rider_id
     where o.id = (p_row.payload->>'order_id')::uuid;

  elsif p_row.kind = 'dispute_resolution' then
    select coalesce(d.user_id, r.user_id) into v_user
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
     where tk.id = (p_row.payload->>'ticket_id')::uuid;

  elsif p_row.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    -- الطرفُ مُعلَنٌ في الحمولةِ (`side`) لأنَّ الصفَّ الواحدَ يخصُّ طرفاً واحداً.
    select case when p_row.payload->>'side' = 'driver' then d.user_id else r.user_id end
      into v_user
      from unsubscribed_claims cl
      join drivers d on d.id = cl.driver_id
      join orders o on o.id = cl.order_id
      join riders r on r.id = o.rider_id
     where cl.id = (p_row.payload->>'claim_id')::uuid;

  elsif p_row.kind = 'subscription_notice' then
    select d.user_id into v_user
      from subscriptions s join drivers d on d.id = s.driver_id
     where s.id = (p_row.payload->>'subscription_id')::uuid;

  else
    -- `safety_incident` وكلُّ نوعٍ مُوجَّهٍ إلى مجموعةٍ: لا مستقبِلَ فرداً.
    v_user := null;
  end if;

  return v_user;
end $$;

revoke execute on function resolve_notification_recipient(notification_outbox) from public, anon, authenticated;
grant execute on function resolve_notification_recipient(notification_outbox) to service_role;

-- ٥) المُطالِبُ — يُزادُ `lost_item_report` إلى قائمةِ أنواعِ دورةِ الرحلةِ التي
--    يُلتقَطُ صفُّها بالعاملِ الأساسيِّ، ويُزادُ فرعُ إغناءٍ يقرأُ محادثةَ السائقِ
--    ولغتَهُ حيًّا لحظةَ الالتقاطِ — كما يفعلُ `order_cancelled`. وما عدا ذلكَ
--    منسوخٌ حرفًا عن نسخةِ F6-07.
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
    'wider_circle_opened', 'no_driver_found', 'order_cancelled',
    'lost_item_report'
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
  -- وبلاغُ المفقودِ (`lost_item_report`) من هذه: لا `order_id` في صفِّهِ، فلا
  -- يحجُبُه عرضٌ معلَّقٌ للطلبِ نفسِه ولا يحجُبُ هو عرضاً — بلاغٌ مستقلٌّ.
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
  elsif v_delivery.kind = 'lost_item_report' then
    -- محادثةُ السائقِ ولغتُهُ كما هما في القاعدةِ لحظةَ الالتقاطِ لا لحظةَ الإيداعِ.
    -- والمرجعُ المنطوقُ للتذكرةِ في الحمولةِ (أُودِعَ حينَ فتحِها) فيُبنى به النصُّ.
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

-- ٦) الفتحُ — ثلاثةُ شروطٍ للنوعِ `lost_item` وحدَهُ، وبلاغٌ يُودَعُ في معاملةِ
--    التذكرةِ نفسِها. والتوقيعُ كما هوَ — خمسةُ معاملاتٍ — ولا حرفَ في حكمٍ آخرَ.
create or replace function public.open_support_ticket(
  p_telegram_id bigint,
  p_type support_ticket_type,
  p_message text,
  p_file_id text default null::text,
  p_order_id uuid default null::uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_rider_id uuid;
  v_city_id uuid;
  v_cooldown integer;
  v_last timestamptz;
  v_group bigint;
  v_id uuid;
  v_reference text;
  v_lost_driver uuid;
  v_order_status order_status;
begin
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  select id into v_rider_id from riders where user_id = v_user.id;
  if v_driver_id is null and v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  end if;
  -- أصنافُ السائقِ الأربعةُ (`SD-10`): اشتراكٌ · خصمٌ · راكبٌ مسيءٌ · مركبةٌ.
  -- والقائمةُ **مكتوبةٌ ههنا مرّةً** ويُقابِلُها مجالٌ مغلقٌ في طبقةِ التطبيقِ،
  -- وحاجزٌ ساكنٌ يمنعُ افتراقَهما.
  if p_type = any (array['subscription', 'deduction', 'rider_conduct', 'vehicle']::support_ticket_type[])
     and v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_city_id := v_user.city_id;

  select telegram_support_group_id into v_group from cities where id = v_city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  v_cooldown := get_setting_number(v_city_id, 'support_ticket_cooldown_seconds')::integer;
  if v_cooldown > 0 then
    select max(created_at) into v_last
      from support_tickets
     where (driver_id is not null and driver_id = v_driver_id)
        or (rider_id is not null and rider_id = v_rider_id);
    if v_last is not null and v_last > now() - make_interval(secs => v_cooldown) then
      return jsonb_build_object(
        'ok', false,
        'error', 'COOLDOWN_ACTIVE',
        'retry_after_seconds',
          ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::integer
      );
    end if;
  end if;

  -- `F12-07`: بلاغُ المفقودِ يُفتَحُ كما كانَ بلا طلبٍ (`F3-08` · `ح-8`) — لا ردَّ
  -- ORDER_REQUIRED. والآليّةُ تُبنَى **على الإخبارِ لا على الردِّ**: متى كانَ للبلاغِ
  -- طلبٌ مملوكٌ، يُقرأُ سائقُهُ المُسنَدُ وحالتُهُ — فإن كانَ ثَمَّ سائقٌ ورحلةٌ
  -- منتهيةٌ (`completed`)، أُودِعَ البلاغُ في معاملةِ التذكرةِ؛ وإلّا فُتِحَتِ التذكرةُ
  -- بلا بلاغٍ، فلا صفٌّ ميّتٌ يُحاولُ التسليمَ أبداً.
  if p_type = 'lost_item' and p_order_id is not null then
    select o.assigned_driver_id, o.status
      into v_lost_driver, v_order_status
      from orders o
     where o.id = p_order_id;
  end if;

  if p_order_id is not null then
    if not exists (
      select 1 from orders o
       where o.id = p_order_id
         and (o.rider_id = v_rider_id or o.assigned_driver_id = v_driver_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_YOURS');
    end if;
  end if;

  insert into support_tickets
    (city_id, type, driver_id, rider_id, order_id, message, attachment_file_id)
  values
    (v_city_id, p_type, v_driver_id, v_rider_id, p_order_id, btrim(p_message),
     nullif(btrim(coalesce(p_file_id, '')), ''))
  returning id, reference into v_id, v_reference;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user.id, 'support.ticket_opened', 'support_ticket', v_id,
          jsonb_build_object('type', p_type, 'has_attachment', p_file_id is not null));

  -- `F12-07`: البلاغُ يُودَعُ في معاملةِ التذكرةِ نفسِها — فإن رجعَت رجعَ معها.
  -- ومفتاحُ منعِ التكرارِ `'lost_item:' || ticket_id` — تذكرةٌ واحدةٌ بلاغٌ واحدٌ.
  -- والنوعُ `lost_item_report` لا `lost_item`: التذكرةُ `lost_item`، والبلاغُ
  -- `lost_item_report` — اسمانِ لمسمَّينِ. **والإيداعُ مشروطٌ** (`ح-8`): لا بلاغَ
  -- إلا لسائقٍ مُسنَدٍ ورحلةٍ منتهيةٍ — فالطلبُ بلا سائقٍ أو الرحلةُ غيرُ المنتهيةِ
  -- تُفتَحُ تذكرتُها بلا بلاغٍ، ولا صفٌّ ميّتٌ يُحاولُ التسليمَ أبداً.
  if p_type = 'lost_item'
     and v_lost_driver is not null
     and v_order_status = 'completed' then
    perform enqueue_notification(
      v_city_id,
      'lost_item_report',
      jsonb_build_object(
        'ticket_id', v_id,
        'order_id', p_order_id,
        'driver_id', v_lost_driver,
        'reference', v_reference
      ),
      'lost_item:' || v_id::text
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_id,
    'reference', v_reference,
    'city_id', v_city_id,
    'group_id', v_group,
    'type', p_type
  );
end;
$function$;

comment on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid) is
  'تفتحُ تذكرةَ دعمٍ وتُعيدُ **مرجعَها المنطوقَ** معَ قروبِ مدينتِها. حكمُها كما كانَ، وأصنافُ السائقِ الأربعةُ تُردُّ لمَن ليسَ سائقاً (`ADR 0114` · `SD-10`). وبلاغُ المفقودِ (`F12-07`) يُودَعُ في معاملةِ التذكرةِ نفسِها **عندما ثمَّ سائقٌ مُسنَدٌ ورحلةٌ منتهيةٌ** — لا ردَّ ORDER_REQUIRED ولا NO_DRIVER_ON_ORDER: التذكرةُ تُفتَحُ دائماً، والبلاغُ مشروطٌ بسائقٍ وحالةٍ.';

revoke execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  to service_role;
