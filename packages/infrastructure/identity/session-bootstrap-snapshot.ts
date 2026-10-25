/**
 * الغرض: محوّلُ `SessionBootstrapSnapshotReader` على PostgreSQL — صفُّ الحسابِ وسجلُّ
 *   الموافقاتِ **بعبارةٍ واحدةٍ وأخذةِ اتصالٍ واحدةٍ** من مجمَّعِ الطلبات (`LOAD-01`).
 * الحالة: منفّذ فعلياً — `LOAD-01`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` عبر حقنِ التبعياتِ فقط.
 *
 * العبارةُ هيَ العبارتانِ السابقتانِ حرفاً في معناهما:
 *   ــ الحسابُ: `role::text, is_blocked, language_code from users where telegram_id = $1`
 *      بانضمامٍ يساريٍّ إلى صفٍّ ثابتٍ، فغيابُ المستخدمِ صفٌّ بقيمٍ فارغةٍ لا صفرُ صفوفٍ.
 *   ــ الموافقاتُ: `list_user_consents($1)` نفسُها (`security definer`، ترتيبُها
 *      `accepted_at asc`) مجموعةً في `json_agg` **بترتيبِ الدالّةِ** (`with ordinality`).
 * والتحويلُ من الصفوفِ في `accountFromRow` و`consentsFromRows` — مصدرٌ واحدٌ لا نسخةٌ.
 *
 * ما لا يفعله عن قصدٍ: لا يكتبُ، ولا يقرأُ عموداً لم تكن تقرؤه العبارتانِ، ولا يُخزِّن.
 */

import type {
  SessionBootstrapSnapshot,
  SessionBootstrapSnapshotReader,
} from "../../application/identity/session-bootstrap.ts";
import { err, ok } from "../../shared/result/index.ts";
import { type ConsentRow, consentsFromRows } from "../consent/consent-store.ts";
import type { Sql } from "../db/client.ts";
import { accountFromRow, asTelegramId } from "./viewer-account.ts";

/** النصُّ مُصدَّرٌ كي يفحصَ اختبارُ التكاملِ خطّتَه وعددَ عباراتِه بلا نسخٍ. */
export const SESSION_BOOTSTRAP_SNAPSHOT_SQL = `select u.role::text as role, u.is_blocked, u.language_code,
       (select coalesce(json_agg(json_build_object('kind', c.kind, 'version', c.version, 'accepted_at', c.accepted_at) order by c.ord), '[]'::json)
          from list_user_consents($1::bigint) with ordinality as c(kind, version, accepted_at, ord)) as consents
  from (select 1) as one
  left join users u on u.telegram_id = $1::bigint`;

interface SnapshotRow {
  readonly role: string | null;
  readonly is_blocked: boolean | null;
  readonly language_code: string | null;
  readonly consents: unknown;
}

const FAILED: SessionBootstrapSnapshot = {
  account: err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" }),
  consents: err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
};

function isConsentRow(value: unknown): value is ConsentRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === "string" && typeof v.version === "string" && typeof v.accepted_at === "string"
  );
}

/** `json` يصلُ مُحلَّلاً من `postgres.js` عادةً؛ والنصُّ يُقبَلُ احتياطاً لا افتراضاً. */
function readConsentRows(value: unknown): readonly ConsentRow[] | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.every(isConsentRow) ? parsed : null;
}

export function createSessionBootstrapSnapshotReader(sql: Sql): SessionBootstrapSnapshotReader {
  return {
    read: async (telegramUserId: string): Promise<SessionBootstrapSnapshot> => {
      const telegramId = asTelegramId(telegramUserId);
      // كالمحوّلَينِ المنفردَينِ: معرّفٌ لا يطابقُ صفّاً لا يُرسَلُ إلى القاعدةِ أصلاً.
      if (telegramId === null) return { account: ok(null), consents: ok([]) };

      let rows: SnapshotRow[];
      try {
        rows = await sql.unsafe<SnapshotRow[]>(SESSION_BOOTSTRAP_SNAPSHOT_SQL, [telegramId]);
      } catch {
        return FAILED;
      }

      const row = rows[0];
      if (row === undefined) return FAILED;

      // `language_code` عمودٌ `not null`؛ فدورٌ بلا لغةٍ ليس صفّاً نعرفُه — خطأٌ لا قيمةٌ مُختلَقة.
      const account =
        row.role === null
          ? accountFromRow(undefined)
          : row.language_code === null
            ? FAILED.account
            : accountFromRow({
                role: row.role,
                is_blocked: row.is_blocked === true,
                language_code: row.language_code,
              });

      const consentRows = readConsentRows(row.consents);
      const consents = consentRows === null ? FAILED.consents : consentsFromRows(consentRows);

      return { account, consents };
    },
  };
}
