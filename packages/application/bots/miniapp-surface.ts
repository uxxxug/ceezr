/**
 * الغرض: طبقةُ البوتِ الخفيفةُ — تقرّرُ لكلِّ تحديثٍ هل يُخدَمُ في التطبيقِ المصغَّرِ (زرُّ
 *   «افتح وَصْلة» على الشاشةِ المقصودةِ) أم يبقى في المحادثةِ، وتبني ردَّ الدخولِ
 *   (`ADR 0213` · `DEC-22` · `ADR 0028` §٢–٣).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}
 *
 * ## ما يبقى في البوتِ — وما لا يبقى
 *
 * `ADR 0028` حصرَ البوتَ في: الدخولِ إلى التطبيقِ، والترحيبِ واللغةِ، والإشعاراتِ الحرجةِ،
 * ورسائلِ القروباتِ، وأوامرَ أساسيّةٍ. وهذا الملفُّ هو **موضعُ الإنفاذِ الوحيدُ** لذلك الحصرِ:
 *
 * - **سجلُّ الأوامرِ** (`COMMAND_HOMES`) يُسمّي لكلِّ أمرٍ موطنَه — التطبيقَ بشاشتِه، أو البوتَ
 *   بسببٍ مكتوبٍ. أمرٌ في قائمةِ البوتِ بلا موطنٍ مُعلَنٍ يُسقِطُ اختبارَ الشمولِ؛ فلا يبقى عملٌ
 *   في المحادثةِ بالسهوِ.
 * - **ما لا يُنقَلُ الآنَ عن قصدٍ** (القسم 19.3 من الخارطة: لا فقدانَ رحلاتٍ ولا عروضٍ ولا
 *   مدفوعاتٍ): القروباتُ وطلباتُ الانضمامِ، وأزرارُ الرسائلِ القائمةِ (`callback_query`) —
 *   عرضٌ مُرسَلٌ قبلَ التحويلِ يجبُ أن يبقى قابلاً للقبولِ —، والموقعُ الحيُّ ورقمُ الجوّالِ
 *   والصورُ (خطواتُ تسجيلِ السائقِ ومسارُ التتبّعِ الاحتياطيِّ)، وحوارٌ بدأ قبلَ التحويلِ
 *   (`step !== "idle"`) يُكمَلُ حيث بدأ.
 * - **كلُّ ما سوى ذلك** يُجابُ بزرِّ `web_app` يفتحُ الشاشةَ نفسَها في التطبيقِ.
 *
 * ## لماذا وضعٌ لا حذفٌ
 *
 * `legacy` يُبقي السلوكَ القديمَ حرفاً بحرفٍ — وهو مسارُ الرجوعِ (`docs/rollback.md`): تغييرُ
 * متغيّرِ بيئةٍ لا نشرُ كودٍ. والحوارُ القديمُ لا يُحذَفُ قبلَ إثباتاتِ 19.3؛ يصيرُ طبقةَ
 * توافقٍ يُنادى من هنا وحدَه.
 */

import { t } from "../../shared/i18n/index.ts";
import {
  type MiniAppAudience,
  type MiniAppTarget,
  miniAppUrl,
} from "../../shared/miniapp-link/index.ts";
import {
  allItemsFor,
  type BotAudience,
  COMMAND_CALLBACK_PREFIX,
  commandForMenuText,
} from "./main-menu.ts";
import type {
  ActiveOrderSummary,
  BotReply,
  DialogState,
  IncomingUpdate,
  Keyboard,
  SessionStore,
} from "./types.ts";

/** وضعُ سطحِ البوتِ — `BOT_SURFACE_MODE`. */
export type BotSurfaceMode = "legacy" | "miniapp";

export interface MiniAppSurfaceConfig {
  readonly mode: BotSurfaceMode;
  /** أصلُ التطبيقِ المصغَّرِ (`MINIAPP_URL`) — لازمٌ في وضعِ `miniapp`، والضبطُ يرفضُ غيابَه. */
  readonly miniAppUrl: string | null;
}

/** موطنُ أمرٍ: شاشةٌ في التطبيقِ، أو البوتُ بسببٍ مكتوبٍ، أو ردُّ الدخولِ نفسُه. */
export type CommandHome =
  | { readonly home: "entry" }
  | { readonly home: "miniapp"; readonly screen: MiniAppScreenIntent }
  | { readonly home: "bot"; readonly why: string };

/**
 * الشاشةُ المقصودةُ كما يعرفُها السجلُّ. `active_ride` ليست شاشةً في الرابطِ: تُحَلُّ لحظةَ
 * الطلبِ إلى `ride_<orderId>` إن كان للراكبِ مشوارٌ جارٍ، وإلّا إلى السجلِّ.
 */
export type MiniAppScreenIntent =
  | "home"
  | "history"
  | "support"
  | "active_ride"
  | "offers"
  | "job"
  | "subscription";

const BOT_BASIC_SOS =
  "قناةُ طوارئَ مستقلّةٌ عن التطبيقِ — `ADR 0031` §٥: الطوارئُ لا تعتمدُ على سطحٍ واحدٍ.";
const BOT_BASIC_LANGUAGE =
  "لغةُ المحادثةِ نفسِها وإشعاراتِها — أمرٌ أساسيٌّ من أوامرِ البوتِ (`ADR 0028` §٢).";

/**
 * السجلُّ — مصدرُ الحقيقةِ الوحيدُ لـ«أين يُخدَمُ هذا الأمرُ». يشملُ كلَّ ما في
 * `allItemsFor(audience)` ومعَه `/start` و`/help` و`/app`؛ واختبارُ الشمولِ يُسقِطُ أيَّ أمرٍ
 * يُضافُ إلى القائمةِ بلا موطنٍ.
 */
export const COMMAND_HOMES: Readonly<Record<BotAudience, Readonly<Record<string, CommandHome>>>> = {
  rider: {
    "/start": { home: "entry" },
    "/help": { home: "entry" },
    "/app": { home: "entry" },
    "/ride": { home: "miniapp", screen: "home" },
    "/cancel": { home: "miniapp", screen: "active_ride" },
    "/status": { home: "miniapp", screen: "active_ride" },
    "/history": { home: "miniapp", screen: "history" },
    "/tickets": { home: "miniapp", screen: "support" },
    "/support": { home: "miniapp", screen: "support" },
    "/delivery": {
      home: "bot",
      why: "طلبُ التوصيلِ لا شاشةَ له في التطبيقِ بعدُ: `SR-04` تقتبسُ المشوارَ وحدَه.",
    },
    "/city": {
      home: "bot",
      why: "تغييرُ مدينةِ الراكبِ لا شاشةَ له في التطبيقِ بعدُ (`rider_change_city` RPC قائمةٌ).",
    },
    "/language": { home: "bot", why: BOT_BASIC_LANGUAGE },
    "/sos": { home: "bot", why: BOT_BASIC_SOS },
    "/rating": {
      home: "bot",
      why: "بطاقةُ السمعةِ لا شاشةَ لها في التطبيقِ بعدُ (`F16-01`).",
    },
  },
  driver: {
    "/start": { home: "entry" },
    "/help": { home: "entry" },
    "/app": { home: "entry" },
    "/trip": { home: "miniapp", screen: "job" },
    "/available": { home: "miniapp", screen: "offers" },
    "/unavailable": { home: "miniapp", screen: "offers" },
    "/finance": { home: "miniapp", screen: "subscription" },
    "/subscription": { home: "miniapp", screen: "subscription" },
    "/support": { home: "miniapp", screen: "support" },
    "/area": {
      home: "bot",
      why: "المنطقةُ المفضّلةُ لا شاشةَ لها في التطبيقِ بعدُ.",
    },
    "/city": {
      home: "bot",
      why: "تغييرُ مدينةِ السائقِ لا شاشةَ له في التطبيقِ بعدُ.",
    },
    "/language": { home: "bot", why: BOT_BASIC_LANGUAGE },
    "/sos": { home: "bot", why: BOT_BASIC_SOS },
    "/rating": {
      home: "bot",
      why: "بطاقةُ السمعةِ لا شاشةَ لها في التطبيقِ بعدُ (`F16-01`).",
    },
  },
};

/** ما يقرّرُه السطحُ لتحديثٍ واحدٍ. */
export type SurfaceDecision =
  /** يُمرَّرُ إلى الحوارِ القديمِ بلا مساسٍ — **وبلا أيِّ انتظارٍ قبلَه** (انظر أدناه). */
  | { readonly kind: "legacy" }
  /**
   * نصٌّ حرٌّ في محادثةٍ خاصّةٍ: إن كان للمستخدمِ حوارٌ جارٍ فهو جوابُ خطوتِه (يُمرَّرُ)، وإلّا
   * فهو طرقٌ على البابِ (ردُّ الدخولِ). الفصلُ يحتاجُ قراءةَ الجلسةِ فلا يُحسَمُ هنا.
   */
  | { readonly kind: "free_text" }
  /**
   * ردُّ الدخولِ: ترحيبٌ وزرُّ التطبيقِ. `registrationDecides` للسائقِ في `/start`: غيرُ
   * المسجَّلِ يُمرَّرُ إلى التسجيلِ في المحادثةِ — إثباتُ ملكيّةِ الرقمِ ببطاقةِ جهةِ اتصالِ
   * تيليجرامَ وصورةُ المركبةِ معرّفُ ملفٍّ عندَ تيليجرامَ، ولا بديلَ لهما مبنيٌّ بعدُ.
   */
  | { readonly kind: "entry"; readonly command: string; readonly registrationDecides: boolean }
  /** أمرٌ موطنُه التطبيقُ: زرٌّ يفتحُ شاشتَه. */
  | { readonly kind: "open"; readonly command: string; readonly screen: MiniAppScreenIntent };

/** المحادثةُ الخاصّةُ وحدَها: معرّفُ المحادثةِ يساوي معرّفَ المرسِلِ. */
function isPrivateChat(update: IncomingUpdate): boolean {
  return update.from.chatId === update.from.telegramUserId;
}

/** يستخرجُ الأمرَ من نصٍّ أو زرِّ قائمةٍ أو زرِّ `cmd:` — أو `null`. */
export function commandOf(audience: BotAudience, update: IncomingUpdate): string | null {
  if (update.kind === "text") {
    const trimmed = update.text.trim();
    if (trimmed.startsWith("/")) {
      // `/start@WaslahBot payload` ⇒ `/start`
      const head = trimmed.split(/\s+/)[0] ?? trimmed;
      return (head.split("@")[0] ?? head).toLowerCase();
    }
    return commandForMenuText(audience, trimmed);
  }
  if (update.kind === "callback" && update.data.startsWith(`${COMMAND_CALLBACK_PREFIX}:`)) {
    return update.data.slice(COMMAND_CALLBACK_PREFIX.length + 1);
  }
  return null;
}

/**
 * القرارُ — دالّةٌ **متزامنةٌ خالصةٌ** بلا قراءةٍ.
 *
 * التزامنُ ليس تفصيلاً: `/sos` موطنُه البوتُ فقرارُه `legacy`، ويُمرَّرُ إلى الحوارِ قبلَ أيِّ
 * `await` في هذه الطبقةِ — فيبقى ما يحرسُه `check-sos-intake-isolation` (`ADR 0077`) صادقاً:
 * لا قراءةَ تسبقُ `trigger_sos` فتُسقِطُ الاستغاثةَ إن أخفقت.
 */
export function decideSurface(audience: BotAudience, update: IncomingUpdate): SurfaceDecision {
  if (!isPrivateChat(update)) return { kind: "legacy" };
  const command = commandOf(audience, update);
  if (command === null) {
    return update.kind === "text" ? { kind: "free_text" } : { kind: "legacy" };
  }
  const home = COMMAND_HOMES[audience][command];
  if (home === undefined || home.home === "bot") return { kind: "legacy" };
  if (home.home === "entry") {
    return {
      kind: "entry",
      command,
      registrationDecides: audience === "driver" && command === "/start",
    };
  }
  return { kind: "open", command, screen: home.screen };
}

/** هل يُعامَلُ النصُّ الحرُّ جوابَ خطوةٍ جاريةٍ؟ */
export function freeTextBelongsToDialog(state: DialogState): boolean {
  return state.step !== "idle";
}

/** يحوّلُ نيّةَ الشاشةِ إلى هدفِ رابطٍ. */
export function resolveTarget(
  audience: MiniAppAudience,
  screen: MiniAppScreenIntent,
  activeOrders: readonly ActiveOrderSummary[],
): MiniAppTarget {
  if (audience === "rider") {
    if (screen === "active_ride") {
      const ride = activeOrders.find((order) => order.service === "transport");
      return ride === undefined
        ? { audience, screen: "history" }
        : { audience, screen: "ride", id: String(ride.orderId) };
    }
    if (screen === "history" || screen === "support" || screen === "home") {
      return { audience, screen };
    }
    return { audience, screen: "home" };
  }
  if (
    screen === "job" ||
    screen === "subscription" ||
    screen === "support" ||
    screen === "offers"
  ) {
    return { audience, screen };
  }
  return { audience, screen: "offers" };
}

/** زرُّ `web_app` واحدٌ يفتحُ الهدفَ. */
export function openAppKeyboard(
  config: MiniAppSurfaceConfig,
  label: string,
  target: MiniAppTarget | null,
): Keyboard {
  if (config.miniAppUrl === null) throw new Error("MINIAPP_URL_MISSING");
  return {
    kind: "inline",
    rows: [[{ label, webAppUrl: miniAppUrl(config.miniAppUrl, target) }]],
  };
}

/**
 * لوحةُ الردِّ الدائمةُ في وضعِ التطبيقِ: الأوامرُ الأساسيّةُ المقيمةُ في البوتِ وحدَها
 * (الطوارئُ واللغةُ). تحلُّ محلَّ القائمةِ الكبيرةِ القديمةِ على جهازِ المستخدمِ فلا يبقى
 * أمامَه زرٌّ لعملٍ انتقلَ، ونصّاها يُترجَمانِ إلى أمرَيهما بـ`commandForMenuText` القائمةِ.
 */
export function basicMenuKeyboard(language: string): Keyboard {
  const tr = t(language);
  return {
    kind: "reply",
    rows: [[tr("safety.menu_sos"), tr("menu.language")]],
    persistent: true,
  };
}

export interface EntryContext {
  readonly audience: BotAudience;
  readonly chatId: string;
  readonly language: string;
  /** للراكبِ غيرِ المسجَّلِ يُفتَحُ التطبيقُ على شاشةِ التسجيلِ. */
  readonly registered: boolean;
}

/** ردُّ الدخولِ: رسالةُ ترحيبٍ تستبدلُ القائمةَ، ثمَّ زرُّ التطبيقِ. */
export function entryReplies(
  config: MiniAppSurfaceConfig,
  context: EntryContext,
  command: string,
): readonly BotReply[] {
  const tr = t(context.language);
  const target: MiniAppTarget | null =
    context.audience === "rider" && !context.registered
      ? { audience: "rider", screen: "onboarding" }
      : null;
  const open = openAppKeyboard(config, tr("miniapp.open_button"), target);
  if (command === "/start" || command === "/help") {
    const intro =
      command === "/help"
        ? tr(
            context.audience === "driver"
              ? "miniapp.entry.help_driver"
              : "miniapp.entry.help_rider",
          )
        : tr(
            context.audience === "driver"
              ? "miniapp.entry.welcome_driver"
              : "miniapp.entry.welcome_rider",
          );
    return [
      { chatId: context.chatId, text: intro, keyboard: basicMenuKeyboard(context.language) },
      { chatId: context.chatId, text: tr("miniapp.entry.open_prompt"), keyboard: open },
    ];
  }
  return [{ chatId: context.chatId, text: tr("miniapp.entry.open_prompt"), keyboard: open }];
}

/** ردُّ أمرٍ انتقلَ: رسالةٌ واحدةٌ بزرٍّ يفتحُ شاشتَه. */
export function movedReplies(
  config: MiniAppSurfaceConfig,
  chatId: string,
  language: string,
  target: MiniAppTarget,
): readonly BotReply[] {
  const tr = t(language);
  return [
    {
      chatId,
      text: tr("miniapp.entry.moved"),
      keyboard: openAppKeyboard(config, tr("miniapp.open_button"), target),
    },
  ];
}

/**
 * أوامرُ `setMyCommands` في وضعِ التطبيقِ: `/start` و`/app` و`/help`، والأوامرُ التي ما زالَ
 * موطنُها البوتَ. الأوامرُ المنتقلةُ لا تُعلَنُ — وتبقى مفهومةً إن كُتِبَت (تُجابُ بزرِّ التطبيقِ).
 * والوصفُ مفتاحُ القائمةِ القائمُ نفسُه بلاحقةِ `.description` — لا نصَّ ثانياً يتباعد.
 */
export function surfaceCommandsFor(
  audience: BotAudience,
  language: string,
): readonly { readonly command: string; readonly description: string }[] {
  const tr = t(language);
  const homes = COMMAND_HOMES[audience];
  const kept = allItemsFor(audience)
    .filter((item) => homes[item.command]?.home === "bot")
    .map((item) => ({
      command: item.command.slice(1),
      description: tr(`${item.key}.description`),
    }));
  return [
    { command: "start", description: tr("menu.start.description") },
    { command: "app", description: tr("miniapp.command.app.description") },
    ...kept,
    { command: "help", description: tr("menu.help.description") },
  ];
}

/**
 * ما تحتاجُه الطبقةُ الخفيفةُ من العالمِ — قراءاتٌ قائمةٌ في تبعيّاتِ الحوارِ نفسِها، لا منافذُ
 * جديدةٌ. كلُّ قراءةٍ تُخفِقُ (`null`) تُسقِطُ القرارَ إلى الحوارِ القديمِ: هو يعرفُ كيف يُجيبُ
 * عن العطلِ، والطبقةُ الخفيفةُ لا تخترعُ ردَّ عطلٍ ثانياً.
 */
export interface SurfacePorts {
  readonly sessions: SessionStore;
  readonly initialState: DialogState;
  /** `true`/`false` — أو `null` إن تعذّرت القراءةُ. */
  isRegistered(telegramUserId: string): Promise<boolean | null>;
  /** طلباتُ الراكبِ النشطةُ لحلِّ `active_ride` — للسائقِ لا تُنادى. */
  activeOrdersOf?(telegramUserId: string): Promise<readonly ActiveOrderSummary[] | null>;
  /** ما يجبُ أن يحدثَ عند كلِّ `/start` في أيِّ وضعٍ (ترقيةُ المسؤولِ الأوّلِ — `ADR 0212`). */
  onStart?(telegramUserId: string): Promise<void>;
}

/**
 * نقطةُ الدخولِ — تلفُّ الحوارَ القديمَ. في وضعِ `legacy` تُمرِّرُ كلَّ شيءٍ حرفاً.
 *
 * `legacy` دالّةٌ لا ردودٌ محسوبةٌ: لا يُحسَبُ الحوارُ القديمُ إلّا إن قرّرَ السطحُ ذلك، فلا
 * تُكتَبُ جلسةٌ ولا يُقرأُ دليلٌ لتحديثٍ خدمَه التطبيقُ.
 */
export async function handleSurfaceUpdate(
  audience: BotAudience,
  update: IncomingUpdate,
  config: MiniAppSurfaceConfig,
  ports: SurfacePorts,
  legacy: () => Promise<readonly BotReply[]>,
): Promise<readonly BotReply[]> {
  if (config.mode === "legacy" || config.miniAppUrl === null) return legacy();
  const decision = decideSurface(audience, update);
  // لا انتظارَ قبلَ هذا السطرِ — انظر `decideSurface`.
  if (decision.kind === "legacy") return legacy();

  const telegramUserId = update.from.telegramUserId;
  const stored = await ports.sessions.load(telegramUserId);
  if (!stored.ok) return legacy();
  const state = stored.value ?? ports.initialState;
  const language = state.language;

  if (decision.kind === "free_text") {
    if (freeTextBelongsToDialog(state)) return legacy();
    const registered = await ports.isRegistered(telegramUserId);
    if (registered === null) return legacy();
    return entryReplies(
      config,
      { audience, chatId: update.from.chatId, language, registered },
      "/app",
    );
  }

  if (decision.kind === "entry") {
    const registered = await ports.isRegistered(telegramUserId);
    if (registered === null) return legacy();
    if (decision.registrationDecides && !registered) return legacy();
    if (decision.command === "/start" && ports.onStart !== undefined) {
      await ports.onStart(telegramUserId);
    }
    return entryReplies(
      config,
      { audience, chatId: update.from.chatId, language, registered },
      decision.command,
    );
  }

  let active: readonly ActiveOrderSummary[] = [];
  if (audience === "rider" && decision.screen === "active_ride") {
    const read = (await ports.activeOrdersOf?.(telegramUserId)) ?? null;
    if (read === null) return legacy();
    // طلبُ توصيلٍ جارٍ بلا مشوارٍ: التوصيلُ لا شاشةَ له في التطبيقِ، فيُتابَعُ في المحادثةِ.
    if (read.length > 0 && !read.some((order) => order.service === "transport")) return legacy();
    active = read;
  }
  return movedReplies(
    config,
    update.from.chatId,
    language,
    resolveTarget(audience, decision.screen, active),
  );
}
