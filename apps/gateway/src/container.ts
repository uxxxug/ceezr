/**
 * الغرض: تركيب التبعيات: يحوّل مجموعة منافذ جاهزة إلى معالج تحديثات يفهمه مسار الـ webhook،
 *   ويبني تلك المنافذ من محوّلات قاعدة البيانات الحقيقية عند الإقلاع.
 *   هذا هو الموضع الوحيد الذي يعرف "من يُنفِّذ ماذا"، فلا يعرفه منطق الحوار.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر على قاعدة حقيقية في tests/integration.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، apps/workers
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد هنا، بلا لمس أي منطق.
 */

import type { DriverBotDependencies } from "../../../packages/application/bots/driver-dialog.ts";
import type { RiderBotDependencies } from "../../../packages/application/bots/rider-dialog.ts";
import type { Keyboard } from "../../../packages/application/bots/types.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDispatchRpc,
  createDriverCandidateRepository,
  createOfferDecisionPort,
  createOfferRepository,
  createOfferWriter,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import {
  createDriverDirectory,
  createRiderDirectory,
} from "../../../packages/infrastructure/identity/directories.ts";
import {
  createTelegramDriverNotifier,
  type OutboundSender,
} from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import {
  createSubscriptionReader,
  createTrialRpc,
} from "../../../packages/infrastructure/subscription/subscription-adapters.ts";
import {
  createActiveOrderLookup,
  createOrderRepository,
  createOrderWriter,
} from "../../../packages/infrastructure/transport/order-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { systemClock } from "../../../packages/shared/kernel/index.ts";
import { createDriverBot, grammyTelegramSender, type TelegramSender } from "./bots/driver/index.ts";
import { createRiderBot } from "./bots/rider/index.ts";
import { toTelegramMarkup } from "./bots/shared/keyboards.ts";
import { createMemorySessionStore } from "./bots/shared/session.ts";
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

/** يجعل مُرسِل البوت صالحاً كمنفذ إخطار عام (يُستخدم لبثّ العروض على السائقين). */
export function asOutboundSender(sender: TelegramSender): OutboundSender {
  return {
    send: async (chatId, text, keyboard: Keyboard | null) => {
      try {
        await sender.sendMessage(chatId, text, toTelegramMarkup(keyboard));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface Container {
  readonly handler: UpdateHandler;
  readonly sql: Sql;
  close(): Promise<void>;
}

export interface ContainerOverrides {
  readonly driverSender?: TelegramSender;
  readonly riderSender?: TelegramSender;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * التركيب الحقيقي من الإعدادات: اتصال قاعدة واحد، ومحوّلات حقيقية لكل منفذ.
 * المُرسِلان قابلان للاستبدال ليُختبر المسار كاملاً بلا شبكة تلغرام.
 */
export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const sql = createSql({ connectionString: config.databaseUrl });
  const log = overrides.log ?? (() => {});

  const driverSender = overrides.driverSender ?? grammyTelegramSender(config.driverBotToken);
  const riderSender = overrides.riderSender ?? grammyTelegramSender(config.riderBotToken);

  const settings = createSettingsRepository(sql);
  const cities = createCityDirectory(sql);
  const drivers = createDriverDirectory(sql);
  const riders = createRiderDirectory(sql);
  const orders = createOrderRepository(sql);
  const orderWriter = createOrderWriter(sql);
  const offers = createOfferRepository(sql);
  const candidates = createDriverCandidateRepository(sql);

  const matching = {
    orders,
    offers,
    candidates,
    settings,
    offerWriter: createOfferWriter(sql),
    notifier: createTelegramDriverNotifier(sql, asOutboundSender(driverSender)),
    clock: systemClock,
  };

  const driverDeps: DriverBotDependencies = {
    sessions: createMemorySessionStore(systemClock),
    drivers,
    cities,
    settings,
    subscriptions: createSubscriptionReader(sql),
    trial: createTrialRpc(sql),
    dispatch: createDispatchRpc(sql),
    offers: createOfferDecisionPort(sql),
    clock: systemClock,
  };

  const riderDeps: RiderBotDependencies = {
    sessions: createMemorySessionStore(systemClock),
    riders,
    cities,
    orders: orderWriter,
    activeOrderOf: createActiveOrderLookup(sql),
    matching,
    clock: systemClock,
  };

  return {
    handler: createUpdateHandler({
      driver: { deps: driverDeps, sender: driverSender },
      rider: { deps: riderDeps, sender: riderSender },
      log,
    }),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
