-- migration-phase: validate
-- =============================================================================
-- `WR-34` — توثيقُ قيدَي نوعِ الرسالةِ (بالصورةِ والصوت) وحمولةِ الوسيطِ بعدَ إضافتِهما
-- `not valid` في `20261103150000_wr_34_chat_media.sql`. كلُّ صفٍّ قائمٍ `text` أو
-- `location` فيمرُّ القيدان، والتحقّقُ يأخذُ `SHARE UPDATE EXCLUSIVE` فلا يمنعُ الكتابة.
-- التراجع: لا شيءَ يُتراجَعُ عنه هنا — القيدُ الموثَّقُ يُحذَفُ مع هجرتِه الأمّ.
-- =============================================================================

alter table order_messages validate constraint order_messages_kind_check;
alter table order_messages validate constraint order_messages_media_payload_check;
