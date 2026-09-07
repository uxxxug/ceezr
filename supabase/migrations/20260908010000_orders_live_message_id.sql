-- SCL-005: خريطة tripId → messageId مشتركة
-- يُضيف عمود live_message_id إلى جدول orders ليكون مرجعاً مشتركاً بين النسخ
-- بدلاً من خريطة داخل العملية (new Map<string, Broadcast>).

alter table orders
  add column if not exists live_message_id text;

comment on column orders.live_message_id is
  'SCL-005: معرّف رسالة البثّ الحيّ في تلغرام — مشترك بين النسخ بدلاً من خريطة داخل العملية. NULL = لا بثّ مفتوح.';
