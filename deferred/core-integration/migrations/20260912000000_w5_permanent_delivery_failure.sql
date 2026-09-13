-- migration-phase: switch
-- =============================================================================
-- الغرض: تمييزُ **الإخفاقِ الدائمِ** عن الإخفاقِ العابرِ في تسليمِ أحداثِ MOVE
--    إلى CORE: يُصبِحُ للصفِّ موتٌ فوريٌّ لا يستهلكُ محاولاتٍ لا فائدةَ فيها.
-- الحالة: منفّذ فعلياً — 2026-09-12 · البند `W-5` (ناقلٌ).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/wasla/operational-job-repository.ts`
--    (`abandonDelivery`)، و`packages/application/wasla/fulfillment-lifecycle.ts`.
-- ملاحظات مستقبلية: لو أضافَ CORE رمزَ حالةٍ ثالثاً لا يقعُ في «أَعِدْ» ولا في
--    «مُتْ»، فالتصنيفُ في `packages/shared/config/core-event-transport.ts` هوَ
--    موضعُ التغييرِ، لا هذه الدالّةُ: الدالّةُ تُنفِّذُ حكماً لا تصدرُه.
--
-- ## لماذا هجرةٌ جديدةٌ لا تحريرُ الهجرةِ السابقةِ
--
-- `20260911100100` مُدفوعةٌ ومُطبَّقةٌ في CI وفي قواعدِ التطويرِ، وتحريرُ ملفِّ
-- هجرةٍ مُطبَّقةٍ يجعلُ التاريخَ كاذباً: قاعدةٌ طُبِّقَت عليها الصيغةُ القديمةُ لا
-- تعرفُ أنَّ الملفَّ تغيَّرَ، فيختلفُ مخطَّطانِ اسمُهما واحدٌ. فالتقدُّمُ بالإضافةِ.
--
-- ## ولماذا `drop` ثمَّ `create` لا وسيطٌ ذو قيمةٍ افتراضيّةٍ
--
-- إضافةُ وسيطٍ افتراضيٍّ في PostgreSQL تُنشِئُ **حِملاً زائداً** (overload) لا
-- تُبدِلُ الدالّةَ: تبقى ذاتُ الأربعِ وسائطَ قائمةً، فيصيرُ للنداءِ بأربعٍ معنىً
-- قديمٌ يتجاهلُ الدوامَ صامتاً. وبابٌ قديمٌ صامتٌ أسوأُ من بابٍ مُغلَقٍ صائحاً،
-- فتُحذَفُ الصيغةُ القديمةُ ويبقى بابٌ واحدٌ لا يُخطَأُ فيه.
--
-- ## وما حكمُ الدوامِ
--
-- عقدُ CORE المنقولُ في `docs/contracts/core/transport/outbound-delivery.md` يقسمُ
-- الردودَ: `2xx` تسليمٌ، و`5xx` والمهلةُ ورفضُ الاتّصالِ و`408` و`429` إعادةٌ
-- بتراجعٍ، و**سائرُ `4xx` موتٌ فوريٌّ** — لأنَّ مغلَّفاً يرفضُه CORE عقديّاً أو
-- صلاحيّةً لن يقبلَه بعدَ ثمانِ محاولاتٍ. وإعادتُه ثمانياً ليست حِرصاً بل تأخيرُ
-- خبرٍ سيّئٍ: الصفُّ الميّتُ ظاهرٌ في الجدولِ فوراً بسببِه مكتوباً.
-- =============================================================================

drop function if exists abandon_move_event_delivery(uuid, text, integer, integer);

create or replace function abandon_move_event_delivery(
  p_claim_token uuid,
  p_error text,
  -- الحدَّانِ مُعلَنانِ في الشيفرةِ ويُمرَّرانِ وسيطَينِ، فلا ثابتَ مدفونٌ ههنا.
  p_max_attempts integer,
  p_backoff_seconds integer,
  -- إخفاقٌ لا يُرجى منه نجاحٌ بإعادةٍ: يُميتُ الصفَّ ولو كانت المحاولةُ الأولى.
  p_permanent boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row move_event_outbox;
begin
  select * into v_row from move_event_outbox
    where claim_token = p_claim_token and delivered_at is null and dead_at is null
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_HELD');
  end if;

  if p_permanent or v_row.attempts >= p_max_attempts then
    update move_event_outbox
      set dead_at = now(), claim_token = null, claimed_at = null, last_error = p_error
      where id = v_row.id;
    return jsonb_build_object(
      'ok', true, 'dead', true, 'attempts', v_row.attempts, 'permanent', coalesce(p_permanent, false)
    );
  end if;

  update move_event_outbox
    set claim_token = null, claimed_at = null, last_error = p_error,
        next_attempt_at = now() + make_interval(secs => p_backoff_seconds * v_row.attempts)
    where id = v_row.id;
  return jsonb_build_object('ok', true, 'dead', false, 'attempts', v_row.attempts, 'permanent', false);
end $$;

revoke execute on function abandon_move_event_delivery(uuid, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function abandon_move_event_delivery(uuid, text, integer, integer, boolean) to service_role;
