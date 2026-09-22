-- migration-phase: expand
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٤» — حرسٌ في TypeScript قبلَ `String(...)`: الدالّةُ
-- المساعِدةُ لإعلانِ التعذُّرِ من طبقةِ التطبيقِ.
--
-- **السياقُ:** الخطوةُ الثالثةُ (ساقُ «ب-٣») أضافت حرسًا في `claim_notification_delivery`
-- يُعلِنُ الصفَّ `undeliverable` حينَ يَغيبُ العنوانُ بعدَ حلِّهِ. لكنَّ الفرعَ `offer`
-- **لا يُحلَّ في SQL** — عنوانُهُ يُقرأُ في TypeScript من `users.telegram_id`. فالحرسُ
-- هناكَ لا يَلمَسُه. والخطوةُ الرابعةُ تُضيفُ الحرسَ في TypeScript قبلَ `String(...)`.
--
-- **هذه الهجرةُ:** تُنشِئُ دالّةً مساعِدةً `mark_notification_undeliverable` تُعالِجُ
-- إعلانَ التعذُّرِ من طبقةِ التطبيقِ — فلا يُعادُ استخدامُ `abandon_notification_delivery`
-- الذي يَضَعُ `dead` لا `undeliverable`، فيخلِطُ «لا قناةَ» بـ«فشلَ بعدَ جهدٍ».
--
-- **السابقةُ:** `abandon_notification_delivery(uuid, uuid, text)` في
-- `20260908050000_notification_outbox_dead_letter.sql` — نفسُ النمطِ لكنَّها تَضَعُ
-- `status = 'dead'`. وهذه تَضَعُ `status = 'undeliverable'` لتُفصِلَ عجزَ التسليمِ
-- عن فشلِ المحاولاتِ.
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
  select id, status, claim_token into v_row
    from notification_outbox
   where id = p_delivery_id
     and claim_token = p_claim_token
     and status = 'sending'
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
