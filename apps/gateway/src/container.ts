/**
 * الغرض: تركيب التبعيات: يحوّل مجموعة منافذ جاهزة إلى معالج تحديثات يفهمه مسار الـ webhook.
 *   هذا هو الموضع الوحيد الذي يعرف "من يُنفِّذ ماذا"، فلا يعرفه منطق الحوار.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts
 * ملاحظات مستقبلية: محوّلات Supabase تُمرَّر هنا عند وصول مفتاح الخدمة، بلا تعديل أي ملف آخر.
 */

import type { DriverBotDependencies } from "../../../packages/application/bots/driver-dialog.ts";
import type { RiderBotDependencies } from "../../../packages/application/bots/rider-dialog.ts";
import { createDriverBot, type TelegramSender } from "./bots/driver/index.ts";
import { createRiderBot } from "./bots/rider/index.ts";
import type { RawTelegramUpdate } from "./bots/shared/telegram-mapper.ts";
import type { BotKind, UpdateHandler } from "./routes/telegram-webhook.ts";

export interface BotWiring {
  readonly driver: { readonly deps: DriverBotDependencies; readonly sender: TelegramSender };
  readonly rider: { readonly deps: RiderBotDependencies; readonly sender: TelegramSender };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** يبني معالج التحديثات الحقيقي: كل بوت إلى محوّله، وما سواه يُرفض بلا ادّعاء معالجة. */
export function createUpdateHandler(wiring: BotWiring): UpdateHandler {
  const log = wiring.log ?? (() => {});
  const driverBot = createDriverBot(wiring.driver.deps, wiring.driver.sender, log);
  const riderBot = createRiderBot(wiring.rider.deps, wiring.rider.sender, log);

  const routes: Readonly<Record<BotKind, (raw: RawTelegramUpdate) => Promise<boolean>>> = {
    driver: (raw) => driverBot.handleUpdate(raw),
    rider: (raw) => riderBot.handleUpdate(raw),
  };

  return {
    handle: async (bot, update) => {
      if (typeof update !== "object" || update === null) return false;
      return routes[bot](update as RawTelegramUpdate);
    },
  };
}
