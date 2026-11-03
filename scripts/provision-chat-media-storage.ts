#!/usr/bin/env bun
/**
 * الغرض: `WR-34` (ADR 0305) — تهيئةُ **دلوِ وسائطِ محادثةِ الطلب** (`order-chat-media`) تهيئةً
 *   مُكرَّرةً بلا أثر: دلوٌ خاصٌّ بحدِّ 5 MiB وستّةِ أنواعِ محتوى، **بلا سياسةِ وصولٍ عامّة**.
 *   لا يقرأُه ولا يكتبُ فيه إلّا حاملُ مفتاحِ الخدمة (البوّابةُ والعامل)، والقراءةُ للطرفَين
 *   برابطٍ موقَّعٍ قصيرٍ تُصدِرُه البوّابةُ بعدَ التفويض.
 * الحالة: منفَّذٌ فعليّاً — لم يُشغَّل على الإنتاج (قرارُ مالك).
 * ينتمي إلى: scripts
 * يُستخدم من: يدُ المشغِّلِ عندَ تفعيلِ `ORDER_CHAT_MEDIA` · `docs/adr/0305-…`.
 *
 * ## ما لا يفعلُه
 *   ــ لا يمسُّ دلوَ وثائقِ السائق (`DRIVER_DOCUMENTS_BUCKET`) ولا يقبلُ اسمَه: العزلُ باقٍ.
 *   ــ لا يُنشئُ سياسةَ `anon`/`authenticated`، ولا يحذفُ دلوًا ولا كائنًا (الحذفُ للعامل).
 *   ولماذا سكربتٌ لا هجرة: كأخيه `provision-object-storage.ts` — `storage` مخطَّطُ مزوِّد.
 */

import { SQL } from "bun";
import {
  CHAT_MEDIA_BUCKET_MAX_BYTES,
  CHAT_MEDIA_BUCKET_MIME,
  readChatMediaBucket,
} from "../packages/infrastructure/storage/chat-media-object-store.ts";

const MIME_LITERAL = `{${CHAT_MEDIA_BUCKET_MIME.join(",")}}`;

async function main(): Promise<void> {
  const bucket = readChatMediaBucket(process.env);
  if (bucket === null) {
    console.error("✖ اسمُ دلوِ المحادثةِ يطابقُ دلوَ وثائقِ السائق أو غيرُ صالح — العزلُ لا يُلغى.");
    process.exit(5);
  }
  const url = process.env.OBJECT_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "✖ لا `OBJECT_STORAGE_DATABASE_URL` ولا `DATABASE_URL`: التهيئةُ تحتاجُ قاعدةَ المزوِّد.",
    );
    process.exit(2);
  }
  const sql = new SQL(url);
  try {
    const [{ present }] = await sql`
      select count(*)::int as present
        from information_schema.tables
       where table_schema = 'storage' and table_name = 'buckets'
    `;
    if (present === 0) {
      console.error("✖ لا مخطَّطَ `storage` في هذه القاعدة — لا يُهيَّأُ ما لا يوجد.");
      process.exit(3);
    }
    await sql`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (${bucket}, ${bucket}, false, ${CHAT_MEDIA_BUCKET_MAX_BYTES}, ${MIME_LITERAL}::text[])
      on conflict (id) do update
        set public             = false,
            file_size_limit    = ${CHAT_MEDIA_BUCKET_MAX_BYTES},
            allowed_mime_types = ${MIME_LITERAL}::text[]
    `;
    const [row] = await sql`
      select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = ${bucket}
    `;
    const [{ policies }] = await sql`
      select count(*)::int as policies
        from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and (qual like ${`%${bucket}%`} or with_check like ${`%${bucket}%`})
    `;
    console.log(
      `✅ دلوُ وسائطِ المحادثةِ مُهيَّأ: \`${row.id}\` · عامّ؟ ${row.public} · الحدّ ${row.file_size_limit} · الأنواع ${JSON.stringify(row.allowed_mime_types)} · سياساتٌ تذكرُه ${policies}.`,
    );
    if (row.public !== false) {
      console.error("✖ الدلوُ عامّ — وسائطُ المحادثةِ لا تُقرأُ برابطٍ مكشوف.");
      process.exit(4);
    }
    if (policies > 0) {
      console.error("✖ سياسةٌ على `storage.objects` تذكرُ الدلو — لا وصولَ إلّا بمفتاحِ الخدمة.");
      process.exit(6);
    }
  } finally {
    await sql.close();
  }
}

await main();
