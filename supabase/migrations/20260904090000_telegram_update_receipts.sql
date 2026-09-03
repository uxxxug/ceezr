-- =============================================================================
-- الغرض: سجلُّ استلامٍ **صامدٌ في القاعدةِ** لتحديثاتِ تيليجرام — هو نفسُه سجلُّ
--   منعِ التكرارِ وسجلُّ الحجزِ، وفقَ ADR 0054 (`docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md`).
-- الحالة: منفّذ فعلياً — أُضيف في 2026-09-04 لإغلاقِ `BUG-002`.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/messaging/telegram-update-intake.ts،
--   apps/gateway/src/routes/telegram-webhook.ts (عبرَ منفَذٍ لا استيراداً مباشراً).
--
-- ## العلّة بحرفِها
--
-- منعُ التكرارِ كان خريطةً في ذاكرةِ العملية (`apps/gateway/src/routes/update-dedup.ts`)،
-- ونداؤها `admit()` **يفحص ويَسِم في نداءٍ واحدٍ**، وكان يُنادى **قبلَ** حدِّ المعدَّل.
-- فترتّب عليه عطبان:
--   ١) إعادةُ الإقلاعِ تمحو القرارَ كلَّه، فالتحديثُ المعالَجُ يُعالَج ثانيةً.
--   ٢) الأسوأُ: طلبٌ مرفوضٌ بـ429 كان **قد استهلك `update_id` في الوسم**، فإعادةُ
--      تيليجرام للتحديثِ نفسِه تُبتلَع بوصفِها «مكرَّراً» — **فقدٌ دائمٌ للأصلِ**.
--
-- ## القرار
--
-- سجلُّ الاستلامِ نفسُه هو سجلُّ منعِ التكرار، والقرارُ **ذرّيٌّ في القاعدةِ** بـ
-- `insert … on conflict (bot, update_id) do nothing` — لا `select` ثمّ `insert`
-- منفصلين، فلا نافذةَ بينهما تُقتنص. والقاعدةُ 0.5 مُستوفاةٌ: كلُّ قرارٍ حرجٍ في
-- دالّةٍ ذرّيّةٍ واحدةٍ، والاستقصاءُ للحجزِ بـ`update … where` على صفٍّ واحدٍ (وهو
-- يُقيِّم شرطَه على النسخةِ الأحدثِ بعدَ الانتظار، فيُنتج إقصاءً متبادلاً حقيقيّاً).
--
-- ### لا حمولةَ في السجلّ — ولا حاجةَ إليها
--
-- ADR 0054 §٧/١ يمنع تخزينَ التحديثِ الخام. ويبقى الوفاءُ بـ«مرّةً على الأقلّ»
-- ممكناً بلا حمولةٍ لأنّ **إعادةَ إرسالِ تيليجرام نفسَها هي ناقلُ الحمولةِ**: صفٌّ
-- غيرُ مختومٍ (`pending`/`failed`/حجزٌ مهجورٌ) يُستأنَف حينَ يعود التحديثُ نفسُه.
-- فالسجلُّ يحفظ **القرارَ** لا **المحتوى**.
--
-- ### لماذا لا `city_id`
--
-- الملحقُ الحاكمُ 2026-09-04 في `docs/MASTER_DIRECTIVE.md` أقرّ صنفاً واحداً مغلقاً
-- اسمُه `domain-ingress receipt` يجوز له وحدَه ألّا يحمل `city_id` لحظةَ الإنشاء —
-- لأنّ قرارَ الاستلامِ **يسبق أيَّ تفسيرٍ للحمولةِ**، فلا مدينةَ معلومةً بعدُ، ونسبتُه
-- إلى مدينةٍ اشتقاقٌ اصطناعيٌّ منهيٌّ عنه في الملحقِ نفسِه. والانتماءُ **مزدوجُ الشرطِ**
-- وقابلٌ للتحقّقِ آليّاً: اسمٌ في القائمةِ المغلقةِ في
-- `packages/shared/config/domain-ingress.ts`، **و**التصريحُ الحرفيُّ التالي:
--
-- domain-ingress-receipt: telegram_update_receipts
--
-- و`RLS` **لا تسقط** بهذا الإقرار، والقاعدةُ 0.4 مطلقةٌ خارجَ هذا الصنفِ الواحد.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الجدول
-- ---------------------------------------------------------------------------

create table if not exists telegram_update_receipts (
  -- البوتُ المقصودُ كما في المسار: قسمةُ فضاءِ `update_id` بين البوتين، فتيليجرام
  -- يعدّ لكلِّ بوتٍ وحدَه ولا معنى لتصادمِ رقمين من بوتين مختلفين.
  bot          text not null,
  -- `bigint` لا `integer`: `update_id` عدّادٌ لا يُصفَّر عندَ تيليجرام، وحدُّ
  -- الأربعِ بايتاتٍ سقفٌ لا سببَ للاقترابِ منه.
  update_id    bigint not null,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  -- رمزُ الحجزِ: من يحمله وحدَه يحقُّ له الختم (`NOT_CLAIMED_BY_CALLER` لغيره).
  claim_token  uuid,
  -- عمودٌ صريحٌ لا `updated_at`: الاسمُ يقول ما يقيس، والاسترجاعُ يُقاس عليه وحدَه.
  claimed_at   timestamptz,
  error_code   text,
  first_seen_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (bot, update_id),
  constraint telegram_update_receipts_bot_known check (bot in ('driver', 'rider')),
  constraint telegram_update_receipts_status_known
    check (status in ('pending', 'claimed', 'failed', 'done')),
  -- المختومُ لا يحمل حجزاً، وله وقتُ ختمٍ. شرطُ صحّةٍ في القاعدةِ لا في الكودِ،
  -- فلا يُخِلّ به مسارٌ جديدٌ ينسى أحدَ الحقلين.
  constraint telegram_update_receipts_done_is_sealed
    check (
      status <> 'done'
      or (claim_token is null and claimed_at is null and completed_at is not null)
    ),
  -- المحجوزُ يحمل الرمزَ والوقتَ معاً: أحدُهما بلا الآخرِ حجزٌ لا يُسترجَع أو
  -- يُسترجَع بلا صاحبٍ، وكلاهما عطبٌ صامتٌ.
  constraint telegram_update_receipts_claim_is_paired
    check ((claim_token is null) = (claimed_at is null))
);

-- فهرسٌ جزئيٌّ على المحجوزِ وحدَه: هو ما يُمسَح للاسترجاع، والمختومُ لا يُقرأ بهذا
-- السؤالِ أبداً — فالفهرسُ الكاملُ كان سيكبر بما لا يُستعمَل.
create index if not exists telegram_update_receipts_claimed_idx
  on telegram_update_receipts (claimed_at)
  where status = 'claimed';

comment on table telegram_update_receipts is
  'سجلُّ استلامٍ صامدٌ لتحديثاتِ تيليجرام: هو نفسُه سجلُّ منعِ التكرارِ والحجز (ADR 0054). من صنفِ domain-ingress receipt بالملحقِ الحاكمِ 2026-09-04، فلا يحمل city_id، ولا يخزّن التحديثَ الخام.';

-- ---------------------------------------------------------------------------
-- ٢) الالتقاطُ الذرّيّ: قرارُ الاستلامِ ومنعِ التكرارِ والحجزِ في نداءٍ واحدٍ
-- ---------------------------------------------------------------------------

create or replace function claim_telegram_update(
  p_bot text,
  p_update_id bigint,
  p_claim_timeout_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   uuid;
  v_attempts integer;
  v_status  text;
begin
  if p_bot is null or p_bot not in ('driver', 'rider') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_BOT');
  end if;
  if p_update_id is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_UPDATE_ID');
  end if;
  if p_claim_timeout_seconds is null or p_claim_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CLAIM_TIMEOUT');
  end if;

  -- أوّلُ استلامٍ: الإيداعُ والحجزُ معاً. `on conflict do nothing` يجعل السؤالَ
  -- «هل أنا الأوّل؟» جواباً لكتابةٍ واحدةٍ لا لفحصٍ يسبق كتابةً.
  insert into telegram_update_receipts as r
    (bot, update_id, status, attempts, claim_token, claimed_at, first_seen_at)
  values
    (p_bot, p_update_id, 'claimed', 1, gen_random_uuid(), now(), now())
  on conflict (bot, update_id) do nothing
  returning r.claim_token, r.attempts into v_token, v_attempts;

  if v_token is not null then
    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'claim_token', v_token, 'attempts', v_attempts
    );
  end if;

  -- الصفُّ قائمٌ. الاستئنافُ مشروطٌ: غيرُ مختومٍ، وحجزُه إمّا معدومٌ (فُكَّ بفشلٍ) أو
  -- مهجورٌ بمضيِّ المهلةِ. والاسترجاعُ **داخلَ الالتقاطِ نفسِه** لا في مهمّةٍ ثانيةٍ،
  -- كنمطِ `reclaim_abandoned_outbox_claims`. و`skip locked` مقصودٌ: الطلبُ المتزامنُ
  -- على نفسِ الصفِّ **لا ينتظر** قفلاً على مسارٍ يوجب عليه العقدُ إقراراً سريعاً، بل
  -- يرى الصفَّ محجوزاً فيمضي بلا معالجةٍ ثانيةٍ.
  with candidate as (
    select r.bot, r.update_id
      from telegram_update_receipts r
     where r.bot = p_bot
       and r.update_id = p_update_id
       and r.status <> 'done'
       and (
         r.claimed_at is null
         or r.claimed_at < now() - make_interval(secs => p_claim_timeout_seconds)
       )
       for update skip locked
  ), taken as (
    update telegram_update_receipts r
       set status = 'claimed',
           attempts = r.attempts + 1,
           claim_token = gen_random_uuid(),
           claimed_at = now(),
           error_code = case when r.claimed_at is not null then 'CLAIM_ABANDONED' else null end
      from candidate c
     where r.bot = c.bot
       and r.update_id = c.update_id
    returning r.claim_token, r.attempts
  )
  select t.claim_token, t.attempts into v_token, v_attempts from taken t;

  if v_token is not null then
    return jsonb_build_object(
      'ok', true, 'outcome', 'reclaimed', 'claim_token', v_token, 'attempts', v_attempts
    );
  end if;

  select status into v_status
    from telegram_update_receipts
   where bot = p_bot and update_id = p_update_id;

  if v_status = 'done' then
    -- مكرَّرٌ حقيقيٌّ: عُولِج وخُتِم. لا إعادةَ معالجةٍ للأصل.
    return jsonb_build_object('ok', true, 'outcome', 'duplicate');
  end if;

  -- محجوزٌ حجزاً حيّاً بعمليةٍ أخرى (أو بنفسِ العمليةِ في طلبٍ متزامنٍ): لا معالجةَ
  -- ثانيةً، ولا ختمَ — فإن مات الحاجزُ استُرجِع الحجزُ عندَ إعادةِ تيليجرام.
  return jsonb_build_object('ok', true, 'outcome', 'in_progress');
end;
$$;

comment on function claim_telegram_update(text, bigint, integer) is
  'يودع إيصالَ استلامٍ أو يستأنف حجزَه، ذرّيّاً: outcome ∈ {claimed, reclaimed, duplicate, in_progress} (ADR 0054 §٥).';

-- ---------------------------------------------------------------------------
-- ٣) الختمُ: لصاحبِ الرمزِ وحدَه
-- ---------------------------------------------------------------------------

create or replace function finish_telegram_update(
  p_bot text,
  p_update_id bigint,
  p_claim_token uuid,
  p_status text,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_status is null or p_status not in ('done', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;
  if p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_CLAIM_TOKEN');
  end if;

  -- مطابقةُ الرمزِ شرطٌ في `where` لا فحصٌ قبلَها: حجزٌ استُرجِع من صاحبِه لا
  -- يستطيع ختمَ ما لم يعد له، فلا يُعلَن «مختومٌ» ما هو قيدَ المعالجةِ عندَ غيرِه.
  update telegram_update_receipts
     set status = p_status,
         claim_token = null,
         claimed_at = null,
         error_code = case when p_status = 'failed' then p_error_code else null end,
         completed_at = case when p_status = 'done' then now() else null end
   where bot = p_bot
     and update_id = p_update_id
     and claim_token = p_claim_token;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

comment on function finish_telegram_update(text, bigint, uuid, text, text) is
  'يختم إيصالَ استلامٍ لصاحبِ رمزِ الحجزِ وحدَه، ويُخفق بـNOT_CLAIMED_BY_CALLER لغيرِه (ADR 0054 §٥).';

-- ---------------------------------------------------------------------------
-- ٤) الصلاحيات — النمط القائم: لا شيء للعموم
-- ---------------------------------------------------------------------------

revoke all on table telegram_update_receipts from public;
revoke all on function claim_telegram_update(text, bigint, integer) from public;
revoke all on function finish_telegram_update(text, bigint, uuid, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table telegram_update_receipts from anon';
    execute 'revoke all on function claim_telegram_update(text, bigint, integer) from anon';
    execute 'revoke all on function finish_telegram_update(text, bigint, uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table telegram_update_receipts from authenticated';
    execute 'revoke all on function claim_telegram_update(text, bigint, integer) from authenticated';
    execute 'revoke all on function finish_telegram_update(text, bigint, uuid, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on table telegram_update_receipts to service_role';
    execute 'grant execute on function claim_telegram_update(text, bigint, integer) to service_role';
    execute 'grant execute on function finish_telegram_update(text, bigint, uuid, text, text) to service_role';
  end if;
end;
$$;

-- RLS مفعّلةٌ بلا سياسةٍ عن قصد، كنمطِ `job_heartbeats`: الوصولُ عبرَ اتصالِ الخدمةِ
-- المباشرِ (ADR 0006)، ولا واجهةَ عامّةً تقرأ هذا السجلَّ. والإقرارُ بعدمِ `city_id`
-- **لا يُسقِط RLS** — نصُّ الملحقِ الحاكمِ 2026-09-04 صريحٌ في ذلك.
alter table telegram_update_receipts enable row level security;
