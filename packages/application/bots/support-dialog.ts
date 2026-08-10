/**
 * الغرض: قسم الدعم المشترك بين بوت السائق وبوت العميل: فتح التذكرة، ونشر بطاقتها،
 *   وأزرار القروب. مشترك لأن السلوك واحد فعلاً، وتكراره في حوارين يعني تباعدهما بعد أوّل تعديل.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: driver-dialog، rider-dialog، apps/admin-dashboard (نفس حالات الاستخدام)
 * ملاحظات مستقبلية: مدّة حدّ التكرار ومدّة التفعيل تُقرآن من platform_settings داخل الدوال الذرّية.
 */

import {
  isSupportResolution,
  type SupportResolution,
  type SupportTicketType,
} from "../../domain/dispute/index.ts";
import { t } from "../../shared/i18n/index.ts";
import type {
  AgentMeasurementPort,
  ClaimDisputeDependencies,
  OpenDisputeDependencies,
  PostDisputeCardDependencies,
  PostTicketAdviceDependencies,
  ResolveDisputeDependencies,
} from "../dispute/index.ts";
import {
  claimDispute,
  inferAdviceOutcome,
  openSupportTicket,
  postDisputeCard,
  postTicketAdvice,
  recordAdviceFeedback,
  resolveDispute,
} from "../dispute/index.ts";
import type { BotReply, DialogState, Keyboard, Sender, SessionStore } from "./types.ts";
import { INITIAL_STATE } from "./types.ts";

export interface SupportDialogDependencies {
  readonly sessions: SessionStore;
  readonly open: OpenDisputeDependencies;
  readonly card: PostDisputeCardDependencies;
  readonly claims: ClaimDisputeDependencies;
  readonly resolutions: ResolveDisputeDependencies;
  /**
   * مستشار التذاكر — **اختياري عمداً**. غيابه هو الحالة الافتراضية وهو ما كان
   * عليه النظام قبل طبقة الذكاء الاصطناعي. راجع `dispute/ticket-advisor.ts`.
   */
  readonly advice?: PostTicketAdviceDependencies;
  /**
   * مخزن القياس — **اختياري بتبعيّة `advice`**. غيابه يعني أن الطبقة
   * معطّلة، فلا قرار يُقاس ولا زرّ يُنقَر ولا استنتاج يُجرى.
   */
  readonly measurement?: AgentMeasurementPort;
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/** ردّ خاصّ: أزرار القروب تصل بـ chatId القروب، والردّ التفصيلي عليه يكشفه للجميع. */
function privateReply(sender: Sender, text: string): BotReply {
  return { chatId: sender.telegramUserId, text, keyboard: null };
}

/** أوّل ثمانية أحرف من UUID تكفي للإشارة البشرية في القروب، والكامل في القاعدة. */
export function shortTicketId(ticketId: string): string {
  return ticketId.slice(0, 8);
}

/**
 * السائق يختار بين نوعين، والعميل لا يملك اشتراكاً فيذهب مباشرة لوصف النزاع.
 * سؤال العميل عن «مشكلة اشتراك» كان سيولّد تذاكر مرفوضة حتماً.
 */
export async function startSupportDialog(
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
  options: { readonly allowSubscriptionType: boolean },
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  if (!options.allowSubscriptionType) {
    const saved = await deps.sessions.save(sender.telegramUserId, {
      ...state,
      step: "awaiting_support_message",
      draftSupportType: "ride_dispute",
    });
    if (!saved.ok) return [reply(sender, tr("common.error_try_again"))];
    return [reply(sender, tr("support.ask_message"))];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_support_type",
    draftSupportType: null,
  });
  if (!saved.ok) return [reply(sender, tr("common.error_try_again"))];

  return [
    reply(sender, tr("support.choose_type"), {
      kind: "inline",
      rows: [
        [{ label: tr("support.type_subscription_button"), data: "sup:type:subscription" }],
        [{ label: tr("support.type_ride_button"), data: "sup:type:ride_dispute" }],
      ],
    }),
  ];
}

export async function handleSupportTypeChoice(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  // زرّ نوع شكوى قديم لا يجوز أن يعيد فتح حوار ألغاه المستخدم أو يقطع حواراً آخر.
  if (state.step !== "awaiting_support_type") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const type: SupportTicketType | null =
    raw === "subscription" ? "subscription" : raw === "ride_dispute" ? "ride_dispute" : null;
  if (type === null) return [reply(sender, tr("common.unknown_command"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_support_message",
    draftSupportType: type,
  });
  if (!saved.ok) return [reply(sender, tr("common.error_try_again"))];
  return [reply(sender, tr("support.ask_message"))];
}

/** ترجمة سبب رفض النصّ إلى رسالة تقول للمستخدم ما يفعله تالياً لا ما أخطأ فيه فقط. */
function rejectionMessage(rejection: string, tr: (key: string) => string): string {
  if (rejection === "too_short") return tr("support.message_too_short");
  if (rejection === "too_long") return tr("support.message_too_long");
  return tr("support.message_is_command");
}

function openFailureMessage(
  reason: string,
  retryAfterSeconds: number | null,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (reason) {
    case "COOLDOWN_ACTIVE":
      return tr("support.cooldown_active", {
        // ندوّر لأعلى: «انتظر 0 دقيقة» رسالة لا معنى لها
        minutes: Math.max(1, Math.ceil((retryAfterSeconds ?? 60) / 60)),
      });
    case "NOT_REGISTERED":
    case "USER_NOT_FOUND":
      return tr("support.not_registered");
    case "USER_BLOCKED":
      return tr("support.blocked");
    case "CITY_GROUP_MISSING":
      return tr("support.city_group_missing");
    case "NOT_A_DRIVER":
      return tr("support.subscription_driver_only");
    default:
      return tr("common.error_try_again");
  }
}

/**
 * استلام الشكوى: نصّاً أو صورةً بتعليق. الصورة بلا تعليق تُقبل بنصّ التعليق الفارغ
 * مستبدلاً بوصف ثابت لأن رفضها كان سيُجبر المستخدم على إعادة رفع الإيصال.
 */
export async function submitSupportMessage(
  input: {
    readonly message: string;
    readonly attachmentFileId: string | null;
  },
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const type = state.draftSupportType ?? "ride_dispute";

  const opened = await openSupportTicket(
    {
      telegramUserId: sender.telegramUserId,
      type,
      message: input.message,
      attachmentFileId: input.attachmentFileId,
    },
    deps.open,
  );
  if (!opened.ok) return [reply(sender, tr("common.error_try_again"))];

  const report = opened.value;
  if (report.rejection !== null) {
    // نصّ مرفوض: نُبقي الخطوة كما هي ليعيد الكتابة بلا إعادة فتح الحوار
    return [reply(sender, rejectionMessage(report.rejection, tr))];
  }
  if (report.opened === null) {
    const message = openFailureMessage(report.reason ?? "UNKNOWN", report.retryAfterSeconds, tr);
    await deps.sessions.save(sender.telegramUserId, { ...INITIAL_STATE, language: state.language });
    return [reply(sender, message)];
  }

  const ticketId = report.opened.ticketId;
  // النشر بعد الفتح لا معه: فشل النشر لا يجوز أن يُلغي تذكرة موجودة في القاعدة
  const posted = await postDisputeCard({ ticketId }, deps.card);
  const cleared = await deps.sessions.save(sender.telegramUserId, {
    ...INITIAL_STATE,
    language: state.language,
  });
  if (!cleared.ok) return [reply(sender, tr("common.error_try_again"))];

  if (!posted.ok || !posted.value.posted) {
    // التذكرة قائمة لكنها لم تظهر للفريق: لا نقول «وصلت» لأنها لم تصل
    return [reply(sender, tr("support.city_group_missing"))];
  }

  // ── نقطة الربط الوحيدة بطبقة الذكاء الاصطناعي (القسم ج) ──────────────────
  // **بعد** نشر البطاقة ونجاحه، و**قبل** ردّ المستخدم — ولا يؤثّر في أيّهما.
  // الردّ أدناه هو نفسه سواءٌ نُشر اقتراح أم لم يُنشر أم لم توجد الطبقة أصلاً.
  await adviseQuietly(ticketId, type, deps);

  return [reply(sender, tr("support.ticket_created", { ticket: shortTicketId(ticketId) }))];
}

/**
 * استدعاء المستشار بلا أي أثر على المسار. الغياب والفشل سواء: كلاهما «لا اقتراح».
 *
 * ⚠️ `try/catch` هنا ليس تهرّباً من الخطأ بل هو **حدّ الطبقة**: كل ما دون هذا
 * السطر تجربةٌ جديدة غير مثبتة، وكل ما فوقه مسارٌ يعمل منذ المرحلة 2.4. لا يجوز
 * لخطأ في الأولى أن يمسّ الثانية بحال.
 */
async function adviseQuietly(
  ticketId: string,
  type: SupportTicketType,
  deps: SupportDialogDependencies,
): Promise<void> {
  if (deps.advice === undefined) return;
  try {
    await postTicketAdvice({ ticketId, type }, deps.advice);
  } catch {
    // صامت عمداً: التسجيل يقع داخل الطبقة نفسها، وتذكرةٌ وصلت بلا اقتراح ليست عطلاً.
  }
}

/**
 * حكم الموظّف على الاقتراح — نقرةٌ تُسجّل ولا تفعل شيئاً أخرى.
 *
 * ⚠️ لا يمسّ تذكرةً ولا اشتراكاً ولا صلاحيةً. أقصى أثره صفّ في `agent_outcomes`،
 * وهذا هو الفرق بين زرّ تقييم وزرّ قرار.
 */
async function handleAdviceFeedback(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const [verdict, traceId] = parts;
  if (deps.measurement === undefined || traceId === undefined || traceId === "") {
    return [privateReply(sender, tr("common.unknown_command"))];
  }
  if (verdict !== "ok" && verdict !== "no") {
    return [privateReply(sender, tr("common.unknown_command"))];
  }

  const recorded = await recordAdviceFeedback(
    { traceId, helpful: verdict === "ok", actorTelegramId: sender.telegramUserId },
    deps.measurement,
  );
  if (!recorded.ok) return [privateReply(sender, tr("common.error_try_again"))];

  // الردّ خاصٌّ لا في القروب: رأي موظّف في اقتراح آلي لا يعني بقيّة الفريق،
  // وإعلانه للجميع يجعل التقييم موقفاً أمام الزملاء فيقلّ صدقه.
  return [privateReply(sender, tr("support.advice_feedback_thanks"))];
}

/**
 * استنتاج الحكم من فعل الموظّف بعد حسم التذكرة.
 *
 * ⚠️ صامت ولا يُفشل شيئاً: التذكرة حُسمت قبل أن يُستدعى، وقياسٌ فاته سطر أهون
 * من حسمٍ تعطّل. وهو يُهمَل تلقائياً إن سبقته نقرة إنسان — تفرضه القاعدة لا هذا الملف.
 */
async function measureQuietly(
  ticketId: string,
  resolution: SupportResolution,
  deps: SupportDialogDependencies,
): Promise<void> {
  if (deps.measurement === undefined) return;
  try {
    await inferAdviceOutcome({ ticketId, resolution }, deps.measurement);
  } catch {
    // صامت عمداً — كـ`adviseQuietly` حرفاً، وللسبب نفسه.
  }
}

/**
 * أزرار قروب الدعم. الردّ يذهب للقروب حين يفيد الفريق كلّه (من استلم، وماذا تقرّر)،
 * وللمحادثة الخاصة حين يخصّ الضاغط وحده (أنت غير مخوَّل).
 */
export async function handleSupportGroupAction(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const [action, ticketId] = parts;
  if (action === undefined || ticketId === undefined || ticketId === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  // يُلتقط قبل كل شيء: تقييم اقتراح لا فعل على تذكرة. وما بعده يفترض أن
  // `parts[1]` معرّف تذكرة — وهو هنا معرّف أثر، فخلطهما يفسد المسارين.
  if (action === "advice") return handleAdviceFeedback(parts.slice(1), sender, state, deps);

  if (action === "claim") {
    const claimed = await claimDispute(
      { ticketId, actorTelegramId: sender.telegramUserId },
      deps.claims,
    );
    if (!claimed.ok) return [reply(sender, tr("common.error_try_again"))];
    if (!claimed.value.claimed) {
      const reason = claimed.value.reason;
      if (reason === "TICKET_ALREADY_CLAIMED") {
        return [
          privateReply(
            sender,
            tr("support.already_claimed", { actor: claimed.value.claimedBy ?? "—" }),
          ),
        ];
      }
      if (reason === "TICKET_ALREADY_SETTLED") {
        return [privateReply(sender, tr("support.already_settled"))];
      }
      if (reason === "TICKET_NOT_FOUND") {
        return [privateReply(sender, tr("support.ticket_not_found"))];
      }
      return [privateReply(sender, tr("support.not_authorized"))];
    }
    return [reply(sender, tr("support.claimed_notice", { actor: sender.telegramUserId }))];
  }

  if (!isSupportResolution(action)) return [reply(sender, tr("common.unknown_command"))];

  const resolved = await resolveDispute(
    { ticketId, actorTelegramId: sender.telegramUserId, action },
    deps.resolutions,
  );
  if (!resolved.ok) return [reply(sender, tr("common.error_try_again"))];
  if (!resolved.value.resolved) {
    switch (resolved.value.reason) {
      case "TICKET_ALREADY_SETTLED":
        return [privateReply(sender, tr("support.already_settled"))];
      case "TICKET_NOT_FOUND":
        return [privateReply(sender, tr("support.ticket_not_found"))];
      case "TICKET_HAS_NO_DRIVER":
        return [privateReply(sender, tr("support.no_driver_on_ticket"))];
      case "ACTOR_NOT_AUTHORIZED":
      case "ACTOR_NOT_FOUND":
      case "ACTOR_BLOCKED":
        return [privateReply(sender, tr("support.not_authorized"))];
      default:
        return [privateReply(sender, tr("common.error_try_again"))];
    }
  }

  // بعد حسمٍ ناجح وحده: فعلٌ وقع فعلاً هو وحده ما يصلح للحكم على اقتراح.
  await measureQuietly(ticketId, action, deps);

  const key =
    action === "activate"
      ? "support.action_done_activate"
      : action === "terminate"
        ? "support.action_done_terminate"
        : "support.action_done_reject";
  return [reply(sender, tr(key, { ticket_short: shortTicketId(ticketId) }))];
}

/** `/activate <ticket_id>` — نفس مسار الزرّ حرفياً، لا فرع ثانٍ للمنطق. */
export async function handleActivateCommand(
  command: string,
  sender: Sender,
  state: DialogState,
  deps: SupportDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const ticketId = command.split(/\s+/)[1];
  if (ticketId === undefined || ticketId === "") {
    return [reply(sender, tr("support.activate_usage"))];
  }
  return handleSupportGroupAction(["activate", ticketId], sender, state, deps);
}
