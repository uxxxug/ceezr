/**
 * الغرض: سلوكُ البوتِ داخلَ القروباتِ — لا يُجيبُ إلا على ما وُجِّهَ إليه.
 * الحالة: منفّذ فعلياً — 2026-10-02 (`BOT-GRP-01`).
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: محوّلا بوتَي السائقِ والعميلِ في البوّابة.
 *
 * ## العطبُ الذي يُعالجُه
 *
 * البوتُ مشرفٌ في قروباتِ الدعمِ والتصعيدِ والسائقينَ، والمشرفُ يرى **كلَّ** رسائلِ القروبِ
 * (لا يسري عليه وضعُ الخصوصيّةِ). وكانت كلُّ رسالةٍ عاديّةٍ، وكلُّ رسالةِ خدمةٍ («أُضيفَ عضوٌ»)،
 * وكلُّ أمرٍ موجَّهٍ لبوتٍ آخرَ، تمرُّ إلى الحوارِ فيردُّ «لم أفهم هذه الرسالة» أمامَ الجميعِ —
 * وأسوأُ من الضجيجِ: النصُّ الحرُّ في القروبِ كانَ يُقرأُ جوابَ خطوةٍ جاريةٍ في جلسةِ المرسِلِ الخاصّةِ.
 *
 * ## القاعدة
 *
 * في القروبِ يمرُّ إلى الحوارِ: ضغطاتُ الأزرارِ (بطاقاتُ الدعمِ والاستغاثةِ) والأوامرُ (`/answer` · `/activate`
 * · `/flag` …) وطلباتُ الانضمامِ. ولا يُرسَلُ في القروبِ ردُّ «لم أفهم» إطلاقاً — الأمرُ المجهولُ يُسكَتُ عنه.
 * المحادثةُ الخاصّةُ لا تتغيّرُ في شيءٍ.
 */

import { translate } from "../../shared/i18n/index.ts";
import type { BotReply, IncomingUpdate } from "./types.ts";

const UNKNOWN_COMMAND_KEY = "common.unknown_command";
const LANGUAGES = ["ar", "en", "ur"] as const;

/** محادثةُ قروبٍ: معرّفُ المحادثةِ غيرُ معرّفِ المرسِلِ. وطلبُ الانضمامِ موجَّهٌ للخاصِّ دائماً. */
export function isGroupUpdate(update: IncomingUpdate): boolean {
  if (update.kind === "join_request") return false;
  return update.from.chatId !== update.from.telegramUserId;
}

/** هل يمرُّ التحديثُ إلى الحوارِ؟ في الخاصِّ: كلُّه. في القروبِ: الأزرارُ والأوامرُ وحدَها. */
export function admitUpdate(update: IncomingUpdate): boolean {
  if (!isGroupUpdate(update)) return true;
  if (update.kind === "callback") return true;
  if (update.kind === "text") return update.text.trim().startsWith("/");
  return false;
}

const UNKNOWN_TEXTS: ReadonlySet<string> = new Set(
  LANGUAGES.map((language) => translate(language, UNKNOWN_COMMAND_KEY)),
);

/** يحذفُ ردَّ «لم أفهم» الموجَّهَ إلى القروبِ نفسِه — ويُبقي ما سواه كما هو. */
export function silenceUnknownInGroup(
  update: IncomingUpdate,
  replies: readonly BotReply[],
): readonly BotReply[] {
  if (!isGroupUpdate(update)) return replies;
  const groupChatId = update.from.chatId;
  return replies.filter(
    (reply) => !(reply.chatId === groupChatId && UNKNOWN_TEXTS.has(reply.text)),
  );
}
