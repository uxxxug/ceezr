-- migration-phase: expand
-- ------------------------------------------------------------------------------
-- SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ وسجلِّ قرارٍ كاملٍ
--
-- الفجوةُ المُسمّاةُ: لا مسارَ استردادٍ إن فُقِدَ حسابُ تيليجرام — المستخدمُ
-- يفقدُ سجلَّه ورحلاتِه بلا بابٍ، والسائقُ يفقدُ اعتمادَه. والطلبُ يُربَطُ
-- بـ`requester_telegram_id` في `pdpl_data_subject_requests` لا بـ`users.id`،
-- فمن زالَ ربطُه بتيليجرامَ لا يصلُ إلى طلبه.
--
-- والعلاجُ: جدولُ `account_recovery_requests` يربطُ الطلبَ بـ`users.id` الداخليِّ
-- لا بـ`telegram_id`. المسؤولُ يحدِّدُ `target_user_id` صراحةً، والقرارُ
-- (approve/reject) يلزمُ سببًا من معجمٍ مغلقٍ. ولا يُربَطُ الحسابُ تلقائيًّا —
-- القرارُ يُسجَّلُ في `audit_log` (مَن راجعَ · السببُ · الوقتُ · المستخدمُ
-- المستهدَفُ). وإن قُدِّمَ `claimant_telegram_id` جديدٌ يُستعمَلُ بعدَ
-- الموافقةِ فقط.
--
-- رجوعٌ آمنٌ (rollback-safe): إضافةٌ محضةٌ — جدولٌ ودوالٌ جديدةٌ ولا عمودَ
-- يُحذَفُ ولا قيدَ يُشدَّدُ ولا دالّةَ قائمةً تُبدَّلُ. وإسقاطُها يُعيدُ الحالَ
-- كما كان. الحاكم: `ADR 0080` (سجلُّ أفعالِ التدقيقِ) · `ح-7` · `ح-8`.
-- ------------------------------------------------------------------------------

-- ── ١) معجمُ حالةِ الطلبِ ───────────────────────────────────────────────────

create type account_recovery_status as enum (
  'submitted',
  'approved',
  'rejected'
);

-- ── ٢) معجمُ أسبابِ القرارِ ──────────────────────────────────────────────────
-- سابقةُ `PD-021`: سببٌ إلزاميٌّ من معجمٍ مغلقٍ.

create type account_recovery_decision_reason as enum (
  'identity_verified',
  'identity_not_confirmed',
  'insufficient_evidence',
  'telegram_account_lost',
  'duplicate_account',
  'policy_violation',
  'user_request'
);

-- ── ٣) جدولُ طلباتِ الاستردادِ ─────────────────────────────────────────────

create table if not exists account_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),

  -- المستخدمُ المستهدَفُ بالاستردادِ — هويّةٌ داخليةٌ لا خارجيّةٌ
  target_user_id uuid not null references users(id),

  -- مُعرِّفُ تيليجرامَ الجديدُ إن وُجدَ — مقبضُ ممثّلٍ خارجيٍّ لا مفتاحُ ملكيّةٍ
  claimant_telegram_id text,

  -- ملخّصُ الأدلّةِ — غيرُ حسّاسٍ، لا يُخزَّنُ فيه نصٌّ خامٌّ
  evidence_summary text not null,

  status account_recovery_status not null default 'submitted',

  submitted_at timestamptz not null default now(),

  reviewed_by uuid references users(id),
  review_reason account_recovery_decision_reason,
  reviewed_at timestamptz,

  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index if not exists account_recovery_requests_status_idx
  on account_recovery_requests (city_id, status, submitted_at desc);

create index if not exists account_recovery_requests_target_idx
  on account_recovery_requests (target_user_id);

-- RLS: مفعّلةٌ ومرفوضةٌ افتراضياً لكلِّ الأدوارِ العامّةِ.
-- الوصولُ يتمُّ حصراً من الخادمِ بمفتاحِ service_role (يتجاوز RLS).
alter table account_recovery_requests enable row level security;

-- ── ٤) تقديمُ طلبِ استردادٍ ──────────────────────────────────────────────────

create or replace function submit_account_recovery_request(
  p_city_id              uuid,
  p_target_user_id        uuid,
  p_claimant_telegram_id  text,
  p_evidence_summary      text,
  p_created_by            uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target       users%rowtype;
  v_existing     bigint;
begin
  -- التحققُ من وجودِ المستخدمِ المستهدَفِ
  select * into v_target from users where id = p_target_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- لا يُنشَأُ طلبٌ على مستخدمٍ من مدينةٍ أخرى
  if v_target.city_id <> p_city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;

  -- ملخّصُ الأدلّةِ لا يكونُ فارغًا
  if p_evidence_summary is null or length(trim(p_evidence_summary)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_EVIDENCE_SUMMARY');
  end if;

  -- إن قُدِّمَ مُعرِّفُ تيليجرامَ الجديدُ، يُرفَضُ إن كانَ مستعمَلًا لحسابٍ آخرَ
  if p_claimant_telegram_id is not null and length(trim(p_claimant_telegram_id)) > 0 then
    select count(*) into v_existing
    from users
    where telegram_id::text = trim(p_claimant_telegram_id)
      and id <> p_target_user_id;
    if v_existing > 0 then
      return jsonb_build_object('ok', false, 'error', 'TELEGRAM_ID_IN_USE');
    end if;
  end if;

  insert into account_recovery_requests (
    city_id, target_user_id, claimant_telegram_id,
    evidence_summary, status, submitted_at, created_by, created_at
  ) values (
    p_city_id, p_target_user_id,
    case when p_claimant_telegram_id is not null and length(trim(p_claimant_telegram_id)) > 0
         then trim(p_claimant_telegram_id) else null end,
    p_evidence_summary,
    'submitted', now(), p_created_by, now()
  )
  returning id into v_existing;

  return jsonb_build_object('ok', true, 'request_id', v_existing::text);
end;
$$;

-- ── ٥) مراجعةُ طلبِ استردادٍ ───────────────────────────────────────────────

create or replace function review_account_recovery_request(
  p_request_id      uuid,
  p_actor_user_id   uuid,
  p_decision        account_recovery_status,
  p_review_reason   account_recovery_decision_reason
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   users%rowtype;
  v_request account_recovery_requests%rowtype;
  v_target  users%rowtype;
begin
  -- التحققُ من أنَّ المراجِعَ مسؤولٌ
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  -- القرارُ يجبُ أن يكونَ approve أو reject
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;

  -- السببُ إلزاميٌّ من معجمٍ مغلقٍ
  if p_review_reason is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REASON');
  end if;

  -- الطلبُ يجبُ أن يكونَ موجودًا وفي حالةِ submitted
  select * into v_request from account_recovery_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_FOUND');
  end if;

  if v_request.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_REVIEWED');
  end if;

  -- المستخدمُ المستهدَفُ يجبُ أن يكونَ موجودًا
  select * into v_target from users where id = v_request.target_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TARGET_USER_NOT_FOUND');
  end if;

  -- تحديثُ الطلبِ
  update account_recovery_requests set
    status = p_decision,
    reviewed_by = p_actor_user_id,
    review_reason = p_review_reason,
    reviewed_at = now()
  where id = p_request_id;

  -- كتابةُ سجلِّ التدقيقِ: مَن راجعَ · السببُ · الوقتُ · المستخدمُ المستهدَفُ
  if p_decision = 'approved' then
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (
      v_request.city_id,
      v_actor.id,
      'admin.account_recovery_approved',
      'user',
      v_target.id,
      jsonb_build_object(
        'reason', p_review_reason::text,
        'request_id', v_request.id::text,
        'claimant_telegram_id', v_request.claimant_telegram_id
      )
    );
  else
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (
      v_request.city_id,
      v_actor.id,
      'admin.account_recovery_rejected',
      'user',
      v_target.id,
      jsonb_build_object(
        'reason', p_review_reason::text,
        'request_id', v_request.id::text,
        'claimant_telegram_id', v_request.claimant_telegram_id
      )
    );
  end if;

  -- إن وُقِّعَ القرارُ بالموافقةِ وقُدِّمَ مُعرِّفٌ جديدٌ، يُحدَّثُ `telegram_id`
  if p_decision = 'approved' and v_request.claimant_telegram_id is not null then
    update users set telegram_id = v_request.claimant_telegram_id::bigint
    where id = v_target.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_decision::text,
    'target_user_id', v_target.id::text
  );
end;
$$;

-- ── ٦) قائمةُ الطلباتِ المعلَّقةِ ───────────────────────────────────────────

create or replace function list_pending_account_recovery_requests(
  p_actor_user_id  uuid,
  p_city_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   users%rowtype;
  v_result  jsonb;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id::text,
      'target_user_id', r.target_user_id::text,
      'claimant_telegram_id', r.claimant_telegram_id,
      'evidence_summary', r.evidence_summary,
      'submitted_at', r.submitted_at,
      'target_full_name', u.full_name,
      'target_telegram_id', u.telegram_id::text,
      'target_is_blocked', u.is_blocked
    )
    order by r.submitted_at desc
  ), '[]'::jsonb) into v_result
  from account_recovery_requests r
  join users u on u.id = r.target_user_id
  where r.city_id = p_city_id
    and r.status = 'submitted';

  return jsonb_build_object('ok', true, 'requests', v_result);
end;
$$;

-- ── ٧) سلبُ التنفيذِ من الأدوارِ العامّةِ ───────────────────────────────────
-- SEC-10 · ADR 0140: لا دالّةً تُنفَّذُ بلا سياسةٍ صريحةٍ.

revoke execute on function submit_account_recovery_request(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function review_account_recovery_request(uuid, uuid, account_recovery_status, account_recovery_decision_reason) from public, anon, authenticated;
revoke execute on function list_pending_account_recovery_requests(uuid, uuid) from public, anon, authenticated;
