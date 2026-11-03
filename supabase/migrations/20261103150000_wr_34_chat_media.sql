-- migration-phase: expand
-- ============================================================================
-- الغرض: WR-34 — الصورُ والرسائلُ الصوتيّةُ في محادثةِ الطلبِ بينَ الراكبِ والسائق
--   (ADR 0305). يُضيفُ:
--   ١. جدولَ `order_chat_attachments`: صفٌّ لكلِّ ملفٍّ، مربوطٌ بالطلبِ والرافعِ
--      ومعرّفِ رسالةِ العميلِ، ثمَّ بالرسالةِ نفسِها عندَ إنشائِها. المسارُ في المخزنِ
--      من معرّفَين (`orders/<order>/<attachment>`) لا من اسمِ ملفٍّ، والدلوُ خاصٌّ
--      (`order-chat-media`) منفصلٌ عن `driver-documents`.
--   ٢. نوعَي رسالةٍ جديدَين `image` و`voice` في `order_messages` (قيدٌ NOT VALID هنا،
--      والتحقّقُ في `20261103150100`).
--   ٣. دوالَّ للبوّابةِ وحدَها (`service_role`): حجزُ مرفقٍ، وإنشاءُ رسالتِه ذرّيّاً،
--      وإسقاطُ المحجوزِ عندَ الفشل، وتفويضُ القراءة، وصفحةُ رسائلَ بالوسائط،
--      ومكنسةُ اليتيمِ والمنتهي للعامل.
-- الحالة: منفَّذ فعلياً — 2026-11-03.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/messaging/order-chat-store.ts` ·
--   `packages/infrastructure/messaging/chat-media-sweep-store.ts`
--
-- ## التوافق (لا يكسرُ الإصدارَ السابق)
--   - `list_order_messages(bigint, uuid, bigint, integer)` تُعادُ بالتوقيعِ والمردِّ
--     نفسِهما، ولا تُعيدُ لقارئِها القديمِ نوعاً لا يعرفُه: رسالةُ الصورةِ أو الصوتِ تظهرُ
--     له `kind = 'text'` بجسمِها الرمزيِّ (📷 / 🎤) و`payload = null`. فبوّابةٌ أقدمُ
--     (تراجعُ شيفرةٍ) تعرضُ رمزاً ولا تُسقِطُ المحادثةَ كلَّها بـ«مردٍّ مشوَّه».
--   - `post_order_message_kind` تُعادُ بالتوقيعِ نفسِه؛ فرعا `text`/`location` حرفيّاً كما
--     كانا، والفرعُ الجديدُ لا يُقبَلُ إلّا بمرفقٍ محجوزٍ للمُرسِلِ نفسِه على الطلبِ نفسِه.
--
-- ## سلامةُ البيانات
--   - جدولٌ جديدٌ فارغٌ؛ لا صفَّ قائمٌ يتغيّر. القيدان على `order_messages` NOT VALID
--     فلا مسحَ للجدولِ تحتَ قفلٍ هنا، والصفوفُ القائمةُ كلُّها `text`/`location` تَصِحُّ.
--   - حذفُ رسالةٍ (محوُ الحسابِ) يجعلُ `message_id = null` (`on delete set null`)
--     فيلتقطُ العاملُ الملفَّ ويحذفُه من المخزن — لا ملفَّ يبقى بلا رسالة.
--
-- ## التراجع (آمن)
--   1) شيفرةً: البوّابةُ السابقةُ تعملُ على هذا المخطَّطِ (انظر «التوافق»).
--   2) مخطَّطاً، بعدَ حذفِ كائناتِ الدلوِ أو قبولِ بقائِها:
--        update order_messages set kind = 'text', payload = null where kind in ('image','voice');
--        -- ثمَّ إعادةُ تعريفِ الدالّتَين من `20261013000500` وإعادةُ القيدِ القديم:
--        alter table order_messages drop constraint order_messages_kind_check;
--        alter table order_messages add constraint order_messages_kind_check
--          check (kind in ('text','location'));
--        alter table order_messages drop constraint if exists order_messages_media_payload_check;
--        drop function if exists reserve_order_chat_attachment(bigint, uuid, uuid, text, text, integer, integer, integer, integer);
--        drop function if exists discard_order_chat_attachment(uuid);
--        drop function if exists authorize_order_chat_attachment_read(bigint, uuid, uuid);
--        drop function if exists list_order_messages_page(bigint, uuid, bigint, bigint, integer);
--        drop function if exists claim_order_chat_media_sweep(integer);
--        drop function if exists complete_order_chat_media_sweep(uuid[]);
--        drop function if exists order_chat_own_message_json(uuid);
--        drop function if exists order_chat_media_quota();
--        drop table if exists order_chat_attachments;
--      والرسائلُ تبقى نصّاً رمزيّاً مقروءاً، فلا فقدَ لسجلِّ المحادثة.
-- ============================================================================

create table if not exists order_chat_attachments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  city_id            uuid not null references cities(id),
  uploader_user_id   uuid not null references users(id) on delete cascade,
  client_message_id  uuid not null,
  kind               text not null,
  mime_type          text not null,
  byte_size          integer not null,
  width              integer,
  height             integer,
  duration_ms        integer,
  object_path        text not null,
  status             text not null default 'pending',
  message_id         uuid references order_messages(id) on delete set null,
  created_at         timestamptz not null default now(),
  ready_at           timestamptz,
  deleted_at         timestamptz,
  constraint order_chat_attachments_kind_check check (kind in ('image', 'voice')),
  constraint order_chat_attachments_mime_check check (
    (kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (kind = 'voice' and mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg'))
  ),
  -- 5 MiB لكلٍّ من النوعَين (ADR 0305 §الحدود) — الحدُّ نفسُه في البوّابةِ والدلو.
  constraint order_chat_attachments_size_check check (byte_size between 1 and 5242880),
  constraint order_chat_attachments_image_dims_check check (
    kind <> 'image'
    or (width between 1 and 10000 and height between 1 and 10000)
  ),
  constraint order_chat_attachments_voice_duration_check check (
    kind <> 'voice' or duration_ms between 300 and 120000
  ),
  constraint order_chat_attachments_status_check check (status in ('pending', 'ready', 'deleted')),
  constraint order_chat_attachments_ready_check check (
    status <> 'ready' or ready_at is not null
  ),
  constraint order_chat_attachments_path_check check (
    object_path = 'orders/' || order_id::text || '/' || id::text
  ),
  constraint order_chat_attachments_path_key unique (object_path),
  constraint order_chat_attachments_message_key unique (message_id),
  constraint order_chat_attachments_client_key unique (order_id, uploader_user_id, client_message_id)
);

-- فهرسُ المكنسةِ (الحالةُ والعمر) في `20261103150200` بـ`concurrently`.

alter table order_chat_attachments enable row level security;
revoke all on table order_chat_attachments from public, anon, authenticated;

comment on table order_chat_attachments is
  'WR-34 (ADR 0305): ملفّاتُ محادثةِ الطلب (صورة/صوت). لا روابطَ عامّة؛ تُقرأُ برابطٍ موقَّعٍ قصيرٍ بعدَ authorize_order_chat_attachment_read. تُحذَفُ بعدَ نافذةِ القراءةِ (7 أيّامٍ من انتهاءِ الطلب) أو 30 يوماً من الرفعِ أيّهما أسبق.';

-- ── قيودُ الرسالة (NOT VALID هنا، والتحقّقُ في الهجرةِ التالية) ─────────────────
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'order_messages'::regclass and conname = 'order_messages_kind_check') then
    alter table order_messages drop constraint order_messages_kind_check;
  end if;
  alter table order_messages add constraint order_messages_kind_check
    check (kind in ('text', 'location', 'image', 'voice')) not valid;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'order_messages'::regclass
                    and conname = 'order_messages_media_payload_check') then
    alter table order_messages add constraint order_messages_media_payload_check
      check (
        kind not in ('image', 'voice')
        or (payload is not null and jsonb_typeof(payload -> 'attachment_id') = 'string')
      ) not valid;
  end if;
end;
$$;

-- ── الحدودُ في مصدرٍ واحدٍ للدوال ────────────────────────────────────────────────
create or replace function order_chat_media_quota()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 30 $$;

revoke all on function order_chat_media_quota() from public, anon, authenticated;

/**
 * رسالةٌ واحدةٌ بعينِ مُرسِلِها — مردُّ الإرسالِ والتكرار. داخليّةٌ (لا منحَ لأحد).
 */
create or replace function order_chat_own_message_json(p_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'seq', m.seq,
    'sender_role', m.sender_role,
    'mine', true,
    'client_message_id', m.client_message_id,
    'kind', m.kind,
    'payload', case when m.kind = 'location' then m.payload end,
    'body', m.body,
    'created_at', m.created_at,
    'attachment', case when a.id is null then null else jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'mime_type', a.mime_type, 'byte_size', a.byte_size,
      'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms,
      'available', a.status = 'ready'
    ) end
  )
  from order_messages m
  left join order_chat_attachments a on a.message_id = m.id
  where m.id = p_message_id
$$;

revoke all on function order_chat_own_message_json(uuid) from public, anon, authenticated;

/**
 * حجزُ مرفقٍ قبلَ رفعِ بايتاتِه — تُناديها البوّابةُ **بعدَ** فحصِ البايتاتِ وتنظيفِها.
 * - طرفُ المحادثةِ وحدَه، وفي نافذةِ الكتابة.
 * - إن وُجدَت رسالةٌ بالمعرّفِ نفسِه ⇒ `duplicate` بالرسالة: لا رفعَ ثانٍ (إعادةُ المحاولة).
 * - إن وُجدَ حجزٌ معلَّقٌ بالمعرّفِ نفسِه ⇒ يُعادُ هو بمسارِه (رفعٌ متجدّدٌ للمسارِ نفسِه).
 * - حصّةٌ لكلِّ مُرسِلٍ في الطلب (30) تحدُّ الإغراقَ والمخزن.
 */
create or replace function reserve_order_chat_attachment(
  p_telegram_id bigint,
  p_order_id uuid,
  p_client_message_id uuid,
  p_kind text,
  p_mime_type text,
  p_byte_size integer,
  p_width integer,
  p_height integer,
  p_duration_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_existing order_chat_attachments%rowtype;
  v_message order_messages%rowtype;
  v_id uuid;
  v_count integer;
begin
  if p_client_message_id is null then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_ID_INVALID');
  end if;
  if p_kind is null or p_kind not in ('image', 'voice')
     or p_byte_size is null or p_byte_size < 1 or p_byte_size > 5242880
     or (p_kind = 'image' and (p_mime_type is null
           or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
           or p_width is null or p_height is null
           or p_width not between 1 and 10000 or p_height not between 1 and 10000))
     or (p_kind = 'voice' and (p_mime_type is null
           or p_mime_type not in ('audio/webm', 'audio/mp4', 'audio/ogg')
           or p_duration_ms is null or p_duration_ms not between 300 and 120000)) then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_INVALID');
  end if;

  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;
  if not v_party.writable then
    return jsonb_build_object('ok', false, 'error', 'CHAT_CLOSED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order_chat:' || p_order_id::text, 0));

  select * into v_message from order_messages m
   where m.order_id = p_order_id
     and m.sender_user_id = v_party.user_id
     and m.client_message_id = p_client_message_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'status', 'duplicate', 'message', order_chat_own_message_json(v_message.id)
    );
  end if;

  select * into v_existing from order_chat_attachments a
   where a.order_id = p_order_id
     and a.uploader_user_id = v_party.user_id
     and a.client_message_id = p_client_message_id
   for update;
  if found then
    if v_existing.status <> 'pending' or v_existing.kind <> p_kind then
      return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_INVALID');
    end if;
    update order_chat_attachments
       set mime_type = p_mime_type,
           byte_size = p_byte_size,
           width = case when p_kind = 'image' then p_width end,
           height = case when p_kind = 'image' then p_height end,
           duration_ms = case when p_kind = 'voice' then p_duration_ms end,
           created_at = now()
     where id = v_existing.id;
    return jsonb_build_object(
      'ok', true, 'status', 'reserved',
      'attachment_id', v_existing.id, 'object_path', v_existing.object_path
    );
  end if;

  select count(*) into v_count from order_chat_attachments a
   where a.order_id = p_order_id
     and a.uploader_user_id = v_party.user_id
     and a.status <> 'deleted';
  if v_count >= order_chat_media_quota() then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_QUOTA');
  end if;

  v_id := gen_random_uuid();
  insert into order_chat_attachments (
    id, order_id, city_id, uploader_user_id, client_message_id, kind, mime_type, byte_size,
    width, height, duration_ms, object_path
  ) values (
    v_id, p_order_id, v_party.city_id, v_party.user_id, p_client_message_id, p_kind, p_mime_type,
    p_byte_size,
    case when p_kind = 'image' then p_width end,
    case when p_kind = 'image' then p_height end,
    case when p_kind = 'voice' then p_duration_ms end,
    'orders/' || p_order_id::text || '/' || v_id::text
  );

  return jsonb_build_object(
    'ok', true, 'status', 'reserved',
    'attachment_id', v_id, 'object_path', 'orders/' || p_order_id::text || '/' || v_id::text
  );
end;
$$;

revoke all on function reserve_order_chat_attachment(bigint, uuid, uuid, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function reserve_order_chat_attachment(bigint, uuid, uuid, text, text, integer, integer, integer, integer)
  to service_role;

/**
 * إسقاطُ حجزٍ معلَّقٍ بعدَ فشلِ الرفعِ أو الإنشاء — يُعيدُ المسارَ لتحذفَه البوّابةُ من
 * المخزن. لا يمسُّ مرفقاً صارَ رسالةً (`ready`).
 */
create or replace function discard_order_chat_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text;
begin
  delete from order_chat_attachments
   where id = p_attachment_id and status = 'pending'
  returning object_path into v_path;
  return jsonb_build_object('ok', true, 'discarded', v_path is not null, 'object_path', v_path);
end;
$$;

revoke all on function discard_order_chat_attachment(uuid) from public, anon, authenticated;
grant execute on function discard_order_chat_attachment(uuid) to service_role;

/**
 * الإرسالُ بنوعٍ — فرعا `text` و`location` كما في `20261013000500` حرفيّاً؛ وفرعا
 * `image`/`voice` يربطانِ مرفقاً محجوزاً **للمُرسِلِ نفسِه على الطلبِ نفسِه** بالرسالةِ في
 * المعاملةِ نفسِها، فلا رسالةَ بلا ملفٍّ ولا ملفَّ مربوطٌ برسالةِ طلبٍ آخر.
 */
create or replace function post_order_message_kind(
  p_telegram_id bigint,
  p_order_id uuid,
  p_client_message_id uuid,
  p_kind text,
  p_body text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_row order_messages%rowtype;
  v_status text := 'added';
  v_kind text := coalesce(p_kind, 'text');
  v_body text := p_body;
  v_payload jsonb := null;
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_label text;
  v_attachment_id uuid;
  v_attachment order_chat_attachments%rowtype;
begin
  if p_client_message_id is null then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_ID_INVALID');
  end if;

  if v_kind = 'text' then
    if v_body is null or length(btrim(v_body)) < 1 then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
    end if;
    if length(v_body) > 1000 then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_TOO_LONG');
    end if;
  elsif v_kind = 'location' then
    if p_payload is null
       or jsonb_typeof(p_payload -> 'lat') is distinct from 'number'
       or jsonb_typeof(p_payload -> 'lng') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
    end if;
    v_lat := (p_payload ->> 'lat')::numeric;
    v_lng := (p_payload ->> 'lng')::numeric;
    if v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
      return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
    end if;
    if jsonb_typeof(p_payload -> 'accuracy_m') = 'number' then
      v_accuracy := (p_payload ->> 'accuracy_m')::numeric;
      if v_accuracy < 0 or v_accuracy > 100000 then
        v_accuracy := null;
      end if;
    end if;
    if jsonb_typeof(p_payload -> 'label') = 'string' then
      v_label := nullif(btrim(p_payload ->> 'label'), '');
      if v_label is not null and length(v_label) > 120 then
        return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
      end if;
    end if;
    v_payload := jsonb_build_object(
      'lat', round(v_lat, 6),
      'lng', round(v_lng, 6),
      'accuracy_m', case when v_accuracy is null then null else round(v_accuracy, 1) end,
      'label', v_label
    );
    v_body := coalesce(v_label, round(v_lat, 6)::text || ',' || round(v_lng, 6)::text);
  elsif v_kind in ('image', 'voice') then
    if p_payload is null
       or jsonb_typeof(p_payload -> 'attachment_id') is distinct from 'string'
       or (p_payload ->> 'attachment_id') !~ '^[0-9a-fA-F-]{36}$' then
      return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_INVALID');
    end if;
    v_attachment_id := (p_payload ->> 'attachment_id')::uuid;
    -- جسمٌ رمزيٌّ محايدُ اللغة: يقرؤه عميلٌ أقدمُ نصّاً، ولا يُرسَلُ للترجمة (ليسَ `text`).
    v_body := case when v_kind = 'image' then '📷' else '🎤' end;
  else
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_KIND_INVALID');
  end if;

  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;
  if not v_party.writable then
    return jsonb_build_object('ok', false, 'error', 'CHAT_CLOSED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order_chat:' || p_order_id::text, 0));

  if v_attachment_id is not null then
    -- الرسالةُ موجودةٌ بالمعرّفِ نفسِه ⇒ تكرارٌ يُعادُ كما هو قبلَ فحصِ المرفق.
    select * into v_row from order_messages m
     where m.order_id = p_order_id
       and m.sender_user_id = v_party.user_id
       and m.client_message_id = p_client_message_id;
    if v_row.id is null then
      select * into v_attachment from order_chat_attachments a
       where a.id = v_attachment_id
         and a.order_id = p_order_id
         and a.uploader_user_id = v_party.user_id
         and a.client_message_id = p_client_message_id
         and a.kind = v_kind
         and a.status = 'pending'
       for update;
      if v_attachment.id is null then
        return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_INVALID');
      end if;
      -- لا يُحفَظُ في الرسالةِ مسارُ المخزن: المعرّفُ وحدَه، والمسارُ في صفِّ المرفق.
      v_payload := jsonb_build_object('attachment_id', v_attachment.id);
    end if;
  end if;

  if v_row.id is null then
    insert into order_messages (
      order_id, city_id, sender_user_id, sender_role, client_message_id, body, kind, payload
    )
    values (
      p_order_id, v_party.city_id, v_party.user_id, v_party.role, p_client_message_id, v_body,
      v_kind, v_payload
    )
    on conflict (order_id, sender_user_id, client_message_id) do nothing
    returning * into v_row;
  end if;

  if v_row.id is null or (v_attachment_id is not null and v_attachment.id is null) then
    v_status := 'duplicate';
    select * into v_row from order_messages m
     where m.order_id = p_order_id
       and m.sender_user_id = v_party.user_id
       and m.client_message_id = p_client_message_id;
  elsif v_attachment.id is not null then
    update order_chat_attachments
       set status = 'ready', message_id = v_row.id, ready_at = now()
     where id = v_attachment.id;
  end if;

  if v_status = 'added' and v_party.counterpart_user_id is not null then
    perform enqueue_order_chat_notice(
      p_order_id, v_party.city_id, v_party.counterpart_user_id, v_party.role, v_row.seq
    );
  end if;

  insert into order_message_reads (order_id, user_id, city_id, last_read_seq)
  values (p_order_id, v_party.user_id, v_party.city_id, v_row.seq)
  on conflict (order_id, user_id) do update
    set last_read_seq = greatest(order_message_reads.last_read_seq, excluded.last_read_seq),
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'message', order_chat_own_message_json(v_row.id)
  );
end;
$$;

revoke all on function post_order_message_kind(bigint, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function post_order_message_kind(bigint, uuid, uuid, text, text, jsonb)
  to service_role;

/**
 * تفويضُ قراءةِ ملفٍّ — طرفُ المحادثةِ في نافذتِها، والملفُّ من **هذا** الطلبِ ومربوطٌ
 * برسالةٍ قائمة. كلُّ رفضٍ واحدٌ (`ATTACHMENT_NOT_FOUND`) فلا يُستدَلُّ بالردِّ على وجودِ
 * ملفٍّ في طلبٍ آخر. والمسارُ يعودُ للبوّابةِ وحدَها لتوقِّعَ رابطاً قصيراً، ولا يصلُ العميل.
 */
create or replace function authorize_order_chat_attachment_read(
  p_telegram_id bigint,
  p_order_id uuid,
  p_attachment_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_attachment order_chat_attachments%rowtype;
begin
  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_NOT_FOUND');
  end if;

  select a.* into v_attachment
    from order_chat_attachments a
    join order_messages m on m.id = a.message_id and m.order_id = a.order_id
   where a.id = p_attachment_id
     and a.order_id = p_order_id
     and a.status = 'ready';
  if v_attachment.id is null then
    return jsonb_build_object('ok', false, 'error', 'ATTACHMENT_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'object_path', v_attachment.object_path,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size
  );
end;
$$;

revoke all on function authorize_order_chat_attachment_read(bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function authorize_order_chat_attachment_read(bigint, uuid, uuid) to service_role;

/**
 * صفحةُ رسائلَ بالوسائط — ثلاثةُ أنماط:
 *   - `p_before_seq` ⇒ أقدمُ صفحةٍ قبلَه (تحميلُ الأقدم).
 *   - `p_after_seq` = null ⇒ الذيلُ: آخرُ `p_limit` رسالة (الفتحُ الأوّل؛ لا أوّلُ 200).
 *   - غيرُ ذلك ⇒ ما بعدَ `p_after_seq` تصاعديّاً (التحديثُ التزايديّ).
 * وتُعيدُ `has_older` وسجلَّ المرفقِ لكلِّ وسيطٍ (بلا مسارٍ في المخزن).
 */
create or replace function list_order_messages_page(
  p_telegram_id bigint,
  p_order_id uuid,
  p_after_seq bigint,
  p_before_seq bigint,
  p_limit integer default 60
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_messages jsonb;
  v_min_seq bigint;
  v_has_older boolean := false;
  v_my_read bigint;
  v_their_read bigint;
  v_last_seq bigint;
  v_unread integer;
  v_counterpart_name text;
  v_counterpart_language text;
  v_my_language text;
begin
  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;

  with picked as (
    select * from (
      select m.* from order_messages m
       where m.order_id = p_order_id
         and p_before_seq is not null and m.seq < p_before_seq
       order by m.seq desc
       limit v_limit
    ) older
    union all
    select * from (
      select m.* from order_messages m
       where m.order_id = p_order_id
         and p_before_seq is null and p_after_seq is null
       order by m.seq desc
       limit v_limit
    ) tail
    union all
    select * from (
      select m.* from order_messages m
       where m.order_id = p_order_id
         and p_before_seq is null and p_after_seq is not null
         and m.seq > greatest(p_after_seq, 0)
       order by m.seq
       limit v_limit
    ) newer
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'seq', m.seq,
           'sender_role', m.sender_role,
           'mine', m.sender_user_id = v_party.user_id,
           'client_message_id', case when m.sender_user_id = v_party.user_id then m.client_message_id end,
           'kind', m.kind,
           'payload', case when m.kind = 'location' then m.payload end,
           'body', m.body,
           'created_at', m.created_at,
           'attachment', case when a.id is null then null else jsonb_build_object(
             'id', a.id, 'kind', a.kind, 'mime_type', a.mime_type, 'byte_size', a.byte_size,
             'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms,
             'available', a.status = 'ready'
           ) end
         ) order by m.seq), '[]'::jsonb),
         min(m.seq)
    into v_messages, v_min_seq
    from picked m
    left join order_chat_attachments a on a.message_id = m.id;

  if v_min_seq is not null then
    select exists (select 1 from order_messages o where o.order_id = p_order_id and o.seq < v_min_seq)
      into v_has_older;
  end if;

  select coalesce(max(seq), 0) into v_last_seq from order_messages where order_id = p_order_id;
  select coalesce(r.last_read_seq, 0) into v_my_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.user_id;
  select coalesce(r.last_read_seq, 0) into v_their_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.counterpart_user_id;
  select count(*) into v_unread from order_messages
   where order_id = p_order_id
     and sender_user_id <> v_party.user_id
     and seq > coalesce(v_my_read, 0);
  select nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), ''),
         nullif(btrim(coalesce(u.language_code, '')), '')
    into v_counterpart_name, v_counterpart_language
    from users u where u.id = v_party.counterpart_user_id;
  select nullif(btrim(coalesce(u.language_code, '')), '') into v_my_language
    from users u where u.id = v_party.user_id;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', p_order_id,
      'service', v_party.service,
      'status', v_party.order_status,
      'writable', v_party.writable
    ),
    'my_role', v_party.role,
    'my_language', v_my_language,
    'counterpart', jsonb_build_object(
      'role', case when v_party.role = 'rider' then 'driver' else 'rider' end,
      'first_name', v_counterpart_name,
      'language', v_counterpart_language
    ),
    'messages', v_messages,
    'has_older', v_has_older,
    'last_seq', v_last_seq,
    'my_last_read_seq', coalesce(v_my_read, 0),
    'counterpart_last_read_seq', coalesce(v_their_read, 0),
    'unread', v_unread
  );
end;
$$;

revoke all on function list_order_messages_page(bigint, uuid, bigint, bigint, integer)
  from public, anon, authenticated;
grant execute on function list_order_messages_page(bigint, uuid, bigint, bigint, integer) to service_role;

/**
 * القارئُ القديمُ (بوّابةٌ قبلَ WR-34) — التوقيعُ والمردُّ كما في `20261013000500`، إلّا أنَّ
 * الوسيطَ يُعرَضُ له `text` بجسمِه الرمزيِّ و`payload = null`: لا نوعَ لا يعرفُه فيُسقِطُ
 * المحادثةَ كلَّها، ولا معرّفَ مرفقٍ يتسرّب.
 */
create or replace function list_order_messages(
  p_telegram_id bigint,
  p_order_id uuid,
  p_after_seq bigint default 0,
  p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 200);
  v_after bigint := greatest(coalesce(p_after_seq, 0), 0);
  v_messages jsonb;
  v_my_read bigint;
  v_their_read bigint;
  v_last_seq bigint;
  v_unread integer;
  v_counterpart_name text;
  v_counterpart_language text;
  v_my_language text;
begin
  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'seq', m.seq,
           'sender_role', m.sender_role,
           'mine', m.sender_user_id = v_party.user_id,
           'client_message_id', case when m.sender_user_id = v_party.user_id then m.client_message_id end,
           'kind', case when m.kind in ('text', 'location') then m.kind else 'text' end,
           'payload', case when m.kind = 'location' then m.payload end,
           'body', m.body,
           'created_at', m.created_at
         ) order by m.seq), '[]'::jsonb)
    into v_messages
    from (
      select * from order_messages
       where order_id = p_order_id and seq > v_after
       order by seq
       limit v_limit
    ) m;

  select coalesce(max(seq), 0) into v_last_seq from order_messages where order_id = p_order_id;
  select coalesce(r.last_read_seq, 0) into v_my_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.user_id;
  select coalesce(r.last_read_seq, 0) into v_their_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.counterpart_user_id;
  select count(*) into v_unread from order_messages
   where order_id = p_order_id
     and sender_user_id <> v_party.user_id
     and seq > coalesce(v_my_read, 0);
  select nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), ''),
         nullif(btrim(coalesce(u.language_code, '')), '')
    into v_counterpart_name, v_counterpart_language
    from users u where u.id = v_party.counterpart_user_id;
  select nullif(btrim(coalesce(u.language_code, '')), '') into v_my_language
    from users u where u.id = v_party.user_id;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', p_order_id,
      'service', v_party.service,
      'status', v_party.order_status,
      'writable', v_party.writable
    ),
    'my_role', v_party.role,
    'my_language', v_my_language,
    'counterpart', jsonb_build_object(
      'role', case when v_party.role = 'rider' then 'driver' else 'rider' end,
      'first_name', v_counterpart_name,
      'language', v_counterpart_language
    ),
    'messages', v_messages,
    'last_seq', v_last_seq,
    'my_last_read_seq', coalesce(v_my_read, 0),
    'counterpart_last_read_seq', coalesce(v_their_read, 0),
    'unread', v_unread
  );
end;
$$;

revoke all on function list_order_messages(bigint, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function list_order_messages(bigint, uuid, bigint, integer) to service_role;

/**
 * مكنسةُ العامل — تُعيدُ ما يجبُ حذفُ ملفِّه من المخزن، ولا تُغيّرُ شيئاً (الحذفُ من
 * المخزنِ أوّلاً، ثمَّ `complete_order_chat_media_sweep`؛ فإن سقطَ العاملُ بينهما أُعيدَ
 * الالتقاطُ والحذفُ متكرّرٌ بلا ضرر):
 *   - `orphan_pending`: حجزٌ معلَّقٌ أقدمُ من 15 دقيقة (رفعٌ أو إنشاءٌ فشلَ ولم يُسقَط).
 *   - `message_gone`: ملفٌّ جاهزٌ حُذفَت رسالتُه (محوُ الحساب).
 *   - `retention`: انتهت نافذةُ القراءةِ (7 أيّامٍ من انتهاءِ الطلب)، أو مضى 30 يوماً
 *     على الرفعِ أيّاً كانت حالُ الطلب.
 */
create or replace function claim_order_chat_media_sweep(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'object_path', c.object_path, 'reason', c.reason
         )), '[]'::jsonb)
    from (
      select a.id, a.object_path,
             case
               when a.status = 'pending' then 'orphan_pending'
               when a.message_id is null then 'message_gone'
               else 'retention'
             end as reason
        from order_chat_attachments a
        left join orders o on o.id = a.order_id
       where (a.status = 'pending' and a.created_at < now() - interval '15 minutes')
          or (a.status = 'ready' and a.message_id is null)
          or (a.status = 'ready' and a.created_at < now() - interval '30 days')
          or (a.status = 'ready'
              and o.status in ('completed', 'cancelled', 'failed')
              and coalesce(o.completed_at, o.updated_at, o.created_at)
                    < now() - order_chat_read_window())
       order by a.created_at
       limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) c;
$$;

revoke all on function claim_order_chat_media_sweep(integer) from public, anon, authenticated;
grant execute on function claim_order_chat_media_sweep(integer) to service_role;

/**
 * إتمامُ المكنسةِ بعدَ حذفِ الملفّات: المعلَّقُ يُحذَفُ صفُّه، والجاهزُ يصيرُ `deleted`
 * ويبقى سجلُّه (الرسالةُ تقولُ «انتهت صلاحيةُ الملف» ولا تختفي من السجلّ).
 */
create or replace function complete_order_chat_media_sweep(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
  v_expired integer;
begin
  delete from order_chat_attachments where id = any(p_ids) and status = 'pending';
  get diagnostics v_removed = row_count;
  update order_chat_attachments
     set status = 'deleted', deleted_at = now()
   where id = any(p_ids) and status = 'ready';
  get diagnostics v_expired = row_count;
  return jsonb_build_object('ok', true, 'removed', v_removed, 'expired', v_expired);
end;
$$;

revoke all on function complete_order_chat_media_sweep(uuid[]) from public, anon, authenticated;
grant execute on function complete_order_chat_media_sweep(uuid[]) to service_role;
