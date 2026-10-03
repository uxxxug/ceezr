/**
 * الغرض: محوّل بوت العميل: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً.
 *   لا قرار عمل هنا: القرارات في packages/application/bots/rider-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/rider
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفّات المجاورة (request-ride, request-delivery, order-tracking,
 *   rating) معزولةٌ ومُستبدَلة لا محذوفة: طلب التوصيل منفَّذ في
 *   `packages/application/delivery/request-delivery.ts`، والتتبّع والتقييم في `rider-dialog.ts`
 *   و`rating-dialog.ts`، ولا يستورد أيًّا منها شيء. وترويسة كلٍّ منها تُحيل إلى موضع تنفيذها
 *   بالضبط، فلا يقرأ قارئٌ «غير منفَّذ» عن قدرةٍ منفَّذة.
 */

import {
  admitUpdate,
  silenceUnknownInGroup,
} from "../../../../../packages/application/bots/group-chat.ts";
import {
  handleSurfaceUpdate,
  type MiniAppSurfaceConfig,
  type SurfacePorts,
} from "../../../../../packages/application/bots/miniapp-surface.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../../../../packages/application/bots/rider-dialog.ts";
import { type BotReply, INITIAL_STATE } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import { toTelegramMarkup } from "../shared/keyboards.ts";
import type { LanguageHydration } from "../shared/language-middleware.ts";
import { SessionCasConflictError } from "../shared/session-revision.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export interface RiderBotAdapter {
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
}

/** `language` اختياري للسبب المشروح في محوّل السائق: المحوّل أوّل موضع تُعرف فيه الهوية. */
export function createRiderBot(
  deps: RiderBotDependencies,
  sender: TelegramSender,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
  language?: LanguageHydration,
  surface?: MiniAppSurfaceConfig,
): RiderBotAdapter {
  // الطبقةُ الخفيفةُ (`ADR 0213`) تقرأُ من تبعيّاتِ الحوارِ نفسِها — لا منفذَ جديدٌ.
  const ports: SurfacePorts = {
    sessions: deps.sessions,
    initialState: INITIAL_STATE,
    isRegistered: async (telegramUserId) => {
      const found = await deps.riders.findByTelegramId(telegramUserId);
      return found.ok ? found.value !== null : null;
    },
    // NEG-SELECT-01 — نصُّ من في محادثةِ تفاوضٍ مفتوحةٍ رسالةٌ للطرفِ الآخرِ: يمضي للحوارِ.
    inNegotiation: async (telegramUserId) => {
      const relay = deps.negotiation?.relay;
      if (relay === undefined) return false;
      const found = await deps.riders.findByTelegramId(telegramUserId);
      if (!found.ok) return null;
      if (found.value === null) return false;
      const parties = await relay.lookup.forRider(found.value.id);
      return parties.ok ? parties.value !== null : null;
    },
    activeOrdersOf: async (telegramUserId) => {
      const found = await deps.riders.findByTelegramId(telegramUserId);
      if (!found.ok) return null;
      if (found.value === null) return [];
      return deps.activeOrdersOf(found.value.id).catch(() => null);
    },
  };
  return {
    handleUpdate: async (raw) => {
      const incoming = toIncomingUpdate(raw);
      if (incoming === null) return true;
      // `BOT-GRP-01`: أوقِفْ مؤشّرَ التحميلِ على الزرِّ فوراً — إخفاقُه لا يمسُّ المعالجةَ.
      const callbackQueryId = raw.callback_query?.id;
      if (callbackQueryId !== undefined && sender.answerCallbackQuery !== undefined) {
        await sender.answerCallbackQuery(callbackQueryId).catch((error: unknown) => {
          log("bot.rider.answer_callback_failed", { detail: String(error) });
        });
      }
      // `BOT-GRP-01`: في القروبِ لا يمرُّ إلى الحوارِ إلا الأزرارُ والأوامرُ.
      if (!admitUpdate(incoming)) return true;

      // قبل الحوار لا بعده: الحوار يقرأ الجلسة في أوّل سطر. ويُعادُ كلُّه — ترطيبُ اللغة
      // ثم حسابُ الردود — عند تعارضِ مراجعةِ الجلسة (BUG-007): لا تُرسَلُ رسالةٌ قبلَ
      // أن تنجحَ الكتابةُ الشرطية. والحدُّ ثلاثٌ: من يفشلُ بعدَها عطلٌ لا تزامن.
      const MAX_CAS_RETRIES = 3;
      let replies: readonly BotReply[] = [];
      for (let attempt = 0; ; attempt++) {
        try {
          if (language !== undefined) await language.hydrate(incoming.from);
          replies =
            surface === undefined
              ? await handleRiderUpdate(incoming, deps)
              : await handleSurfaceUpdate("rider", incoming, surface, ports, () =>
                  handleRiderUpdate(incoming, deps),
                );
          break;
        } catch (error) {
          if (error instanceof SessionCasConflictError && attempt < MAX_CAS_RETRIES) {
            log("bot.session_revision_conflict", {
              attempt: attempt + 1,
              userId: error.telegramUserId,
            });
            continue;
          }
          log("bot.rider.dialog_unexpected_error", { detail: String(error) });
          return false;
        }
      }

      replies = silenceUnknownInGroup(incoming, replies);

      for (const reply of replies) {
        const markup = toTelegramMarkup(reply.keyboard);
        try {
          if (
            reply.editMessageId !== undefined &&
            reply.photoFileId === undefined &&
            sender.editMessageText !== undefined &&
            (await sender
              .editMessageText(reply.chatId, reply.editMessageId, reply.text, markup)
              .then(() => true)
              .catch((error: unknown) => {
                // رسالةٌ لا تُعدَّلُ (قديمةٌ أو مطابقةٌ) ليست إخفاقاً: تُرسَلُ جديدةً.
                log("bot.telegram_edit_failed", { detail: String(error) });
                return false;
              }))
          ) {
            continue;
          }
          if (reply.photoFileId === undefined) {
            await sender.sendMessage(reply.chatId, reply.text, markup);
          } else {
            await sender.sendPhoto(reply.chatId, reply.photoFileId, reply.text, markup);
          }
        } catch (error) {
          log("bot.telegram_send_failed", { detail: String(error) });
          return false;
        }
      }
      return true;
    },
  };
}
