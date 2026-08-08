-- =============================================================================
-- وَصْلة — قياس جدوى اقتراحات طبقة الذكاء الاصطناعي
--
-- القواعد الحاكمة المطبَّقة هنا حرفياً:
--   (0.4) كل جدول يحمل city_id  -> الجدولان يحملانه ولا يقبلان null
--   (0.3) لا قيمة تجارية في الكود -> لا رقم هنا؛ العتبات في platform_settings
--
-- ═══ لماذا هذان الجدولان موجودان أصلاً ═══
--
-- طبقة الذكاء الاصطناعي تكتب تجاربها في ملفات jsonl تحت runtime_agent/. وهذا
-- مقبول لما هو **قابل للفقد**: الذاكرة المتوسطة تُفقَد فيعود الوكيل أقلّ معرفة، لا
-- مكسوراً — وهو ما وُثِّق في ADR 0012 وقُبل على هذا الأساس.
--
-- لكن **قياس الجدوى ليس قابلاً للفقد**. هو الشيء الوحيد الذي من أجله نُفعِّل الطبقة
-- أصلاً، ويتراكم عبر أسابيع، وكل إعادة نشر على Render تمسح القرص. أن نقيس على
-- تخزينٍ يُمحى يعني أن نبدأ العدّ من الصفر كل جمعة ولا نبلغ عيّنةً ذات دلالة أبداً.
--
-- فالقاعدة الفاصلة: **ما يُقاس يُخزَّن في قاعدة البيانات، وما يُساعد على التخمين
-- يبقى في الملفات.** لذلك القرار ونتيجته هنا، والذاكرة القصيرة والمتوسطة هناك.
--
-- ═══ لماذا لا تكتب الطبقة في هذين الجدولين مباشرة ═══
--
-- لأن القسم صفر يمنعها من معرفة قاعدة البيانات أصلاً. الطبقة تُعيد DecisionResult
-- إلى من ناداها، ومن ناداها (طبقة التطبيق) هو من يكتب هنا. اتجاه الاعتماد لا ينكسر.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- الأنواع المعدودة
-- ----------------------------------------------------------------------------

-- الحكم على الاقتراح. مطابق لـ OUTCOME_VERDICTS في agent-core/schemas.ts.
-- «تُجوهل» ليست «رُفض»: الأولى تقول إن الاقتراح لم يُقرأ، والثانية إن قارئه رآه
-- خطأً. خلطهما يُضيّع أثمن تمييز في البيانات، وعلاج كلٍّ منهما مختلف تماماً.
do $$ begin
  create type agent_outcome_verdict as enum ('accepted', 'rejected', 'ignored');
exception when duplicate_object then null; end $$;

-- من أين جاء الحكم. يُخزَّن لأن ثقتنا في الأحكام ليست واحدة:
--   button   — نقرة إنسان قرأ الاقتراح. أوثقها، وهي وحدها تُميّز الرفض عن التجاهل.
--   manual   — توسيم لاحق من صاحب المشروع على دفعة مصدَّرة. موثوق وبطيء.
--   inferred — استنتاج آلي من مقارنة نصّ الحلّ بالاقتراح. الأضعف: يعرف أن الفعل
--              وافق الاقتراح، ولا يعرف هل قرأه صاحبه أم وافقه صدفةً.
-- بلا هذا العمود تختلط الثلاثة في رقمٍ واحد لا يُعرف كم منه ظنّ.
do $$ begin
  create type agent_outcome_source as enum ('button', 'manual', 'inferred');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1) agent_decisions — ما اقترحته الطبقة، سطرٌ لكل قرار
-- ----------------------------------------------------------------------------
create table if not exists agent_decisions (
  id                  uuid primary key default gen_random_uuid(),
  city_id             uuid not null references cities(id),
  -- المفتاح الرابط بين الطبقة والعالم الخارجي. فريد: قرارٌ واحد لكل أثر.
  trace_id            text not null unique,
  -- التذكرة التي وُلد عنها القرار. حذفها يحذفه: قياسٌ على تذكرة ممحوّة لا معنى له.
  ticket_id           uuid not null references support_tickets(id) on delete cascade,
  agent_id            text not null,
  classification      text,
  recommended_action  text,
  -- من 0 إلى 1. numeric لا float: القياس يُجمع ويُقارن، والفروق العائمة تُفسده.
  confidence          numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  -- سقف الصلاحية وقت القرار. يُخزَّن ليُثبَت لاحقاً أنه لم يتجاوز SUGGEST يوماً،
  -- فيكون في البيانات دليلٌ على القيد لا في التوثيق وحده.
  allowed_tool_level  text not null,
  -- هل نُشر فعلاً في قروب الدعم. قرارٌ لم يُنشر لا يُقاس عليه: لم يره أحد.
  published           boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists agent_decisions_city_created_idx
  on agent_decisions (city_id, created_at desc);
create index if not exists agent_decisions_ticket_idx
  on agent_decisions (ticket_id);

alter table agent_decisions enable row level security;

-- ----------------------------------------------------------------------------
-- 2) agent_outcomes — ما فعله البشر فعلاً بعد الاقتراح
-- ----------------------------------------------------------------------------
--
-- ليس قيداً فريداً على trace_id عمداً: الحكم يُصحَّح. نقرةُ موظّفٍ ثم توسيمٌ لاحق
-- من صاحب المشروع سطران، والقارئ يأخذ الأوثق مصدراً لا الأحدث زمناً — وهو ما
-- تفعله الدالة أدناه. حفظ التاريخ كلّه يجعل «كم مرّة أخطأ الاستنتاج الآلي» سؤالاً
-- له جواب في البيانات.
create table if not exists agent_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  city_id             uuid not null references cities(id),
  trace_id            text not null references agent_decisions(trace_id) on delete cascade,
  verdict             agent_outcome_verdict not null,
  source              agent_outcome_source not null,
  -- ما فعله الإنسان فعلاً بنصّه، إن عُرف. هو ما يُقرأ حين نسأل «لماذا رفضه».
  human_action        text,
  -- من نقر أو وسم. null للاستنتاج الآلي — ولا أحد ينتحل صفة إنسان.
  recorded_by_user_id uuid references users(id),
  recorded_at         timestamptz not null default now()
);

create index if not exists agent_outcomes_trace_idx
  on agent_outcomes (trace_id);
create index if not exists agent_outcomes_city_recorded_idx
  on agent_outcomes (city_id, recorded_at desc);

-- نقرة واحدة لكل موظّف على كل اقتراح: تمنع تكرار النقر من قلب النسبة.
create unique index if not exists agent_outcomes_one_click_per_actor_idx
  on agent_outcomes (trace_id, recorded_by_user_id)
  where source = 'button';

alter table agent_outcomes enable row level security;

-- ----------------------------------------------------------------------------
-- 3) record_agent_outcome — تسجيل حكم بأسبقية مصدر صريحة
-- ----------------------------------------------------------------------------
--
-- (0.5) عملية حرجة عبر RPC ذرّي: الأسبقية قرارٌ لا يجوز أن يختلف بين نداءين.
--
-- ═══ الأسبقية: button > manual > inferred ═══
--
-- المسألة ليست ترتيب الوصول بل من يُصدَّق. لو كتب الاستنتاج الآلي فوق نقرة موظّف
-- لصار القياس يقيس نفسه: الآلة تحكم على اقتراح الآلة. ولذلك:
--   • النقرة تعلو التوسيم، والتوسيم يعلو الاستنتاج.
--
-- ═══ ولماذا تُكتب الأحكام الأضعف ولا تُطرح ═══
--
-- الأسبقية **تُطبَّق عند القراءة لا عند الكتابة**: كل حكم يُسجَّل، و`agent_effectiveness`
-- وحدها تختار النافذ منها. وطرحُ الأضعف كان سيُتلف **أثمن إشارة في النظام كلّه**:
-- موضع اختلاف استنتاجنا الآلي عن حكم الإنسان. فبهذه الصفوف وحدها نعرف أن
-- `inferVerdict` يُخطئ وأين، وبدونها يبقى خطؤه غير مرئيّ إلى الأبد.
create or replace function record_agent_outcome(
  p_trace_id  text,
  p_verdict   text,
  p_source    text,
  p_action    text default null,
  p_actor_telegram_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_id  uuid;
  v_actor_id uuid;
  v_rank     int;
  v_best     int;
begin
  select city_id into v_city_id from agent_decisions where trace_id = p_trace_id;
  if v_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'DECISION_NOT_FOUND');
  end if;

  if p_source not in ('button', 'manual', 'inferred') then
    return jsonb_build_object('ok', false, 'error', 'BAD_SOURCE');
  end if;
  if p_verdict not in ('accepted', 'rejected', 'ignored') then
    return jsonb_build_object('ok', false, 'error', 'BAD_VERDICT');
  end if;

  -- الفاعل البشري: نقرةٌ بلا هوية لا تُقبل، فالنقرة قيمتها في أن إنساناً بعينه نقرها.
  if p_actor_telegram_id is not null then
    select id into v_actor_id from users where telegram_id = p_actor_telegram_id;
  end if;
  if p_source = 'button' and v_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND');
  end if;

  v_rank := case p_source when 'button' then 3 when 'manual' then 2 else 1 end;

  select coalesce(max(case source when 'button' then 3 when 'manual' then 2 else 1 end), 0)
    into v_best
    from agent_outcomes
   where trace_id = p_trace_id;

  insert into agent_outcomes (city_id, trace_id, verdict, source, human_action, recorded_by_user_id)
  values (v_city_id, p_trace_id, p_verdict::agent_outcome_verdict,
          p_source::agent_outcome_source, p_action, v_actor_id)
  on conflict do nothing;

  -- الفهرس الجزئي منع نقرةً مكررة من الموظّف نفسه على القرار نفسه.
  if not found then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'ALREADY_RECORDED');
  end if;

  -- `effective` يقول للمستدعي: سُجّل حكمك، لكنّ أوثق منه سبقه فلن يُحسَب في التقرير.
  return jsonb_build_object('ok', true, 'recorded', true, 'effective', v_rank >= v_best);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) agent_effectiveness — الحكم الواحد لكل قرار، جاهزاً للقياس
-- ----------------------------------------------------------------------------
--
-- منظور لا جدول: يُشتقّ كلّه ممّا سبق، وتعريف «الحكم المعتمد» يجب أن يكون في مكان
-- واحد. لو حسبته كل قارئ بنفسه لاختلفت الأرقام بين تقريرين وما عرفنا أيّهما الصحيح.
create or replace view agent_effectiveness as
select d.trace_id,
       d.city_id,
       d.ticket_id,
       d.classification,
       d.confidence,
       d.published,
       d.created_at,
       o.verdict,
       o.source as verdict_source,
       o.recorded_at
  from agent_decisions d
  left join lateral (
    select verdict, source, recorded_at
      from agent_outcomes
     where trace_id = d.trace_id
     -- الأوثق مصدراً أولاً، ثم الأحدث: تصحيحٌ لاحق من المصدر نفسه يفوز على سابقه.
     order by case source when 'button' then 3 when 'manual' then 2 else 1 end desc,
              recorded_at desc
     limit 1
  ) o on true;
