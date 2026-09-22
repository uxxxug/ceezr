-- migration-phase: expand
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٤» — إصلاحُ غموضِ `status` في `mark_notification_undeliverable`.
--
-- **السياقُ:** الدالّةُ `mark_notification_undeliverable` التي أنشأها
-- `20260922060000` تُعيدُ `table(... status text ...)`، فصارَ مرجعُ
-- `status` في `where status = 'sending'` غامضاً بينَ العمودِ ومتغيّرِ PL/pgSQL
-- الداخليِّ. **قِيسَ هذا على PostgreSQL حقيقيٍّ** أثناءَ قياسِ الخطوةِ الخامسة:
-- `PostgresError: column reference "status" is ambiguous`.
--
-- **الإصلاحُ:** تأهيلُ المراجعِ باسمِ الجدولِ المُستعارِ `n`:
-- `from notification_outbox n` و`n.id`/`n.status`/`n.claim_token`.
-- ولا تغييرَ في عقدِ الدالّةِ — لا في الحالةِ ولا في الإرجاعِ.
-- =============================================================================

create or replace function mark_notification_undeliverable(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_reason text
) returns table(
  ok boolean,
  delivery_id uuid,
  status text,
  dead_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select n.id, n.status, n.claim_token into v_row
    from notification_outbox n
   where n.id = p_delivery_id
     and n.claim_token = p_claim_token
     and n.status = 'sending'
   for update;

  if not found then
    return query select false, p_delivery_id, null::text, null::text;
    return;
  end if;

  update notification_outbox
     set status = 'undeliverable',
         dead_reason = p_reason,
         died_at = now(),
         claim_token = null,
         claimed_at = null
   where id = p_delivery_id;

  return query select true, p_delivery_id, 'undeliverable'::text, p_reason;
end;
$$;

comment on function mark_notification_undeliverable(uuid, uuid, text) is
  'SEC-19-ب-٤: يُعلِنُ صفَّ الصادرِ غيرَ قابلٍ للتسليمِ من طبقةِ التطبيقِ — '
  'يَفصِلُ عجزَ التسليمِ (undeliverable) عن فشلِ المحاولاتِ (dead). '
  'يَطلبُ معرِّفَ الصفِّ ورمزَ الحجزِ المطابِقَين ويُتحقَّقُ من حالةِ sending.';

-- =====================================================================
-- السطحُ: المنحُ والدعمُ كـ`abandon_notification_delivery` سواءً بسواءٍ.
-- =====================================================================
revoke execute on function mark_notification_undeliverable(uuid, uuid, text) from public;
