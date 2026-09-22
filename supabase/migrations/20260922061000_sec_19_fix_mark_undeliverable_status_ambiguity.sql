-- migration-phase: expand
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٤» — إصلاحُ غموضِ `status` ونوعِ الإرجاعِ في
-- `mark_notification_undeliverable`.
--
-- **السياقُ:** الدالّةُ `mark_notification_undeliverable` التي أنشأها
-- `20260922060000` تُعيدُ `table(... status text ...)`، فصارَ مرجعُ
-- `status` في `where status = 'sending'` غامضاً بينَ العمودِ ومتغيّرِ PL/pgSQL
-- الداخليِّ. **قِيسَ هذا على PostgreSQL حقيقيٍّ** أثناءَ قياسِ الخطوةِ الخامسة:
-- `PostgresError: column reference "status" is ambiguous`.
--
-- **الإصلاحُ الثاني:** الدالّةُ تُعيدُ `table(...)` لكنَّ المحوّلَ `envelope()`
-- يتوقّعُ `jsonb` (كـ`abandon_notification_delivery`) — فالناتجُ المُركَّبُ لا
-- يُفكُّ إلى كائنٍ في `postgres`. فصارَ الإرجاعُ `jsonb`.
--
-- **الإصلاحُ:** تأهيلُ المراجعِ باسمِ الجدولِ المُستعارِ `n` وتغييرُ الإرجاعِ
-- إلى `jsonb`. ولا تغييرَ في عقدِ الدالّةِ المنطقيِّ — لا في الحالةِ ولا في
-- الأسبابِ.
-- =============================================================================

-- =====================================================================
-- السطحُ: المنحُ والدعمُ كـ`abandon_notification_delivery` سواءً بسواءٍ.
-- =====================================================================
drop function if exists mark_notification_undeliverable(uuid, uuid, text);
create or replace function mark_notification_undeliverable(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_reason text
) returns jsonb
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
    return jsonb_build_object('ok', false, 'delivery_id', p_delivery_id);
  end if;

  update notification_outbox
     set status = 'undeliverable',
         dead_reason = p_reason,
         died_at = now(),
         claim_token = null,
         claimed_at = null
   where id = p_delivery_id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', p_delivery_id,
    'status', 'undeliverable',
    'dead_reason', p_reason
  );
end;
$$;

comment on function mark_notification_undeliverable(uuid, uuid, text) is
  'SEC-19-ب-٤: يُعلِنُ صفَّ الصادرِ غيرَ قابلٍ للتسليمِ من طبقةِ التطبيقِ — '
  'يَفصِلُ عجزَ التسليمِ (undeliverable) عن فشلِ المحاولاتِ (dead). '
  'يَطلبُ معرِّفَ الصفِّ ورمزَ الحجزِ المطابِقَين ويُتحقَّقُ من حالةِ sending.';

-- =====================================================================
-- السطحُ: المنحُ والدعمُ كـ`abandon_notification_delivery` سواءً بسواءٍ.
--
--   **`drop` أسقطَ منحَ`service_role`** خلافاً لـ`create or replace`. الهجرةُ
--   الأصليّةُ `20260922060000` لا تُمنحُ صراحةً `service_role` (ولم تنقلها من
--   هجرةٍ سابقة)، لكنَّ هذا الخطِّ كان مفقوداً. أُعادُ المنحَ هنا كما يفعلُ
--   `abandon_notification_delivery`: السحبُ من `public` ثمَّ المنحُ لـ
--   `service_role`، فلا يُتركُ السطحُ مفتوحاً للعامِ ولا مقفولاً على
--   `postgres` وحده.
-- =====================================================================
revoke execute on function mark_notification_undeliverable(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function mark_notification_undeliverable(uuid, uuid, text)
  to service_role;
