#!/usr/bin/env bun
/**
 * الغرض: تهيئةُ **دلوِ وثائقِ السائقِ** في مخزنِ الكائناتِ تهيئةً مُكرَّرةً
 *   بلا أثرٍ (idempotent): دلوٌ خاصٌّ بحدِّ حجمٍ وأنواعِ محتوىً، **بلا سياسةِ
 *   وصولٍ عامّةٍ** — لا يقرأُه ولا يكتبُ فيه إلّا حاملُ مفتاحِ الخدمةِ.
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: scripts
 * يُستخدم من: يدُ المشغِّلِ عندَ تهيئةِ بيئةٍ جديدةٍ · وثيقةُ `RUNBOOK`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` (شعارُ المركبةِ وباركودُها) — دلوٌ ثانٍ
 *   بالمنطقِ نفسِه، فلا تُنسَخُ الشِفرةُ بل يُمرَّرُ اسمٌ آخرُ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ سكربتٌ ولا هجرةٌ
 *
 * `supabase/migrations` تُطبَّقُ في CI على **PostgreSQL عاديٍّ** لا مخطَّطَ
 * `storage` فيه. فهجرةٌ تكتبُ في `storage.buckets` **تُسقِطُ كلَّ جولةِ CI**
 * أو تُكتَبُ بـ`if exists` فتمرُّ بلا عملٍ وتكذِبُ. والدلوُ **مَورِدُ مزوِّدٍ**
 * لا مخطَّطُ تطبيقٍ، فمحلُّه سكربتُ تهيئةٍ يُقاسُ أثرُه بالقراءةِ بعدَه.
 *
 * ## وما لا يفعلُه — (`ح-5`)
 *
 *   ــ **لا يُنشئُ سياسةَ `anon`**: دلوُ الوثائقِ يُكتَبُ فيه بمفتاحِ الخدمةِ
 *      وحدَه، وسياسةٌ عامّةٌ تجعلُ المفتاحَ المنشورَ في الواجهةِ إذنَ رفعٍ.
 *   ــ **لا يحذفُ دلواً ولا كائناً**: الحذفُ فعلُ يدٍ واعيةٍ لا سكربتِ تهيئةٍ.
 *   ــ **لا يقيسُ التوقيعَ**: قياسُه في `tests/integration/` بمفتاحٍ حقيقيٍّ.
 */

import { SQL } from "bun";

const BUCKET = process.env.DRIVER_DOCUMENTS_BUCKET ?? "driver-documents";

/** أنواعُ المحتوى المسموحةُ على مستوى الدلوِ — **حاجزٌ ثانٍ** بعدَ القاعدةِ. */
const ALLOWED_MIME = ["image/jpeg", "image/png", "application/pdf"] as const;

/** خمسةُ ميغابايتٍ — يُطابِقُ `driver_document_max_bytes` في الإعداداتِ. */
const MAX_BYTES = 5_242_880;

/** تُمرَّرُ نصّاً حرفيّاً للمصفوفةِ: مُشغِّلُ `bun` يُرسِلُ المصفوفةَ مفصولةً بفاصلةٍ. */
const MIME_LITERAL = `{${ALLOWED_MIME.join(",")}}`;

async function main(): Promise<void> {
  const url = process.env.OBJECT_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "✖ لا مُتغيِّرَ `OBJECT_STORAGE_DATABASE_URL` ولا `DATABASE_URL`: التهيئةُ تحتاجُ وصلةً إلى قاعدةِ المزوِّدِ.",
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
      console.error(
        "✖ لا مخطَّطَ `storage` في هذه القاعدةِ: هذه قاعدةٌ عاديّةٌ لا مزوِّدُ تخزينٍ — ولا يُهيَّأُ ما لا يوجدُ.",
      );
      process.exit(3);
    }

    await sql`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (${BUCKET}, ${BUCKET}, false, ${MAX_BYTES}, ${MIME_LITERAL}::text[])
      on conflict (id) do update
        set public             = false,
            file_size_limit    = ${MAX_BYTES},
            allowed_mime_types = ${MIME_LITERAL}::text[]
    `;

    const [row] = await sql`
      select id, public, file_size_limit, allowed_mime_types
        from storage.buckets where id = ${BUCKET}
    `;
    const [{ policies }] = await sql`
      select count(*)::int as policies
        from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and qual like ${"%" + BUCKET + "%"}
    `;

    console.log(
      `✅ دلوُ الوثائقِ مُهيَّأٌ: \`${row.id}\` · عامٌّ؟ ${row.public} · حدُّ الحجمِ ${row.file_size_limit} · أنواعٌ ${JSON.stringify(row.allowed_mime_types)} · سياساتٌ تذكرُه ${policies}.`,
    );
    if (row.public !== false) {
      console.error("✖ الدلوُ عامٌّ — وثيقةُ سائقٍ لا تُقرأُ برابطٍ مكشوفٍ.");
      process.exit(4);
    }
  } finally {
    await sql.close();
  }
}

await main();
