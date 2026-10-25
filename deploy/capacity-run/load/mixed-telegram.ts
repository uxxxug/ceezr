#!/usr/bin/env bun
/**
 * LOAD-01M · الدورةُ الرابعة — مولّدُ حِملٍ مختلطٍ لبوتِ السائق (command · message · callback) يعملُ
 * **بجوارِ** miniapp-load (الذي يُنتجُ وظائفَ contact وحدَها)، فيصيرُ طابورُ telegram_update_jobs
 * مختلطًا وتُختبَرُ قيمةُ أولويّةِ contact. الحِملُ الموحَّدُ من contact وحدَه لا يصلحُ للحكمِ على أثرِ
 * الأولويّة (لا شيءَ يُقدَّمُ عليه).
 *
 * حلقةٌ مفتوحة (open loop) بجدولٍ حتميٍّ من بذرة: الذراعانِ A وB يتلقّيانِ تسلسلَ الأنواعِ والمحادثاتِ
 * والمواعيدِ نفسَه حرفيًّا. لا ينتظرُ المولّدُ الردّ؛ ويسجّلُ لكلِّ تحديثٍ موعدَه المخطَّطَ وإرسالَه الفعليَّ
 * وحالةَ HTTP في `MIXED_OUT` (JSONL)، فيُحكَمُ على صلاحيّةِ الموجةِ من تأخّرِه عن جدولِه.
 *
 * البيئة:
 *   GATEWAY_URL · TELEGRAM_WEBHOOK_SECRET
 *   MIXED_RATE      تحديثاتٌ/ث (إلزاميّ > 0)        MIXED_SEC   مدّةُ الإرسال (ث)
 *   MIXED_KINDS     أوزانُ الأنواع JSON (افتراضًا {"command":0.5,"message":0.5})
 *   MIXED_CHATS     عددُ المحادثاتِ المتناوبة (افتراضًا 3000؛ المحادثةُ الواحدةُ كلَّ CHATS/RATE ث)
 *   MIXED_CHAT_BASE أوّلُ معرّفِ محادثة (افتراضًا 900000000 — خارجَ نطاقاتِ wave.sh)
 *   MIXED_UPDATE_BASE أوّلُ update_id (افتراضًا 3000000000 — خارجَ نطاقِ nextUpdateId < 2e9)
 *   MIXED_SEED      بذرةُ الجدول (افتراضًا 1)        MIXED_INFLIGHT حدُّ الطلباتِ المعلّقة (افتراضًا 512)
 *   MIXED_OUT       ملفُّ السجلّ
 */
import { appendFileSync, writeFileSync } from "node:fs";

export type MixedKind = "command" | "message" | "callback";

export interface PlanItem {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: MixedKind;
  readonly chat: number;
  readonly updateId: number;
}

/** mulberry32 — مولّدٌ عشوائيٌّ حتميٌّ صغير (البذرةُ نفسُها ⇒ التسلسلُ نفسُه). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planMixed(opts: {
  rate: number;
  sec: number;
  kinds: Readonly<Record<string, number>>;
  chats: number;
  chatBase: number;
  updateBase: number;
  seed: number;
}): PlanItem[] {
  if (!(opts.rate > 0)) throw new Error("MIXED_RATE يجبُ أن يكونَ > 0");
  if (!(opts.chats >= 1)) throw new Error("MIXED_CHATS يجبُ أن يكونَ ≥ 1");
  const entries = Object.entries(opts.kinds).filter(([, w]) => w > 0);
  for (const [k] of entries)
    if (k !== "command" && k !== "message" && k !== "callback")
      throw new Error(`نوعٌ غيرُ مدعوم: ${k}`);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) throw new Error("MIXED_KINDS بلا وزنٍ موجب");
  const rand = rng(opts.seed);
  const n = Math.floor(opts.rate * opts.sec);
  const step = 1000 / opts.rate;
  const out: PlanItem[] = [];
  for (let i = 0; i < n; i++) {
    let r = rand() * total;
    let kind = entries[entries.length - 1]?.[0] as MixedKind;
    for (const [k, w] of entries) {
      if (r < w) {
        kind = k as MixedKind;
        break;
      }
      r -= w;
    }
    out.push({
      seq: i,
      atMs: Math.round(i * step),
      kind,
      chat: opts.chatBase + (i % opts.chats),
      updateId: opts.updateBase + i,
    });
  }
  return out;
}

/** تحديثُ تيليجرامَ لكلِّ نوع — يصنِّفُه telegramUpdateKind في البوّابةِ إلى النوعِ نفسِه. */
export function buildMixedUpdate(item: PlanItem, nowSec: number): Record<string, unknown> {
  const from = { id: item.chat, is_bot: false, first_name: "mix" };
  const chat = { id: item.chat, type: "private" };
  if (item.kind === "callback")
    return {
      update_id: item.updateId,
      callback_query: {
        id: `mix-${item.updateId}`,
        from,
        chat_instance: `mix-${item.chat}`,
        data: "noop",
        message: { message_id: 1, chat, date: nowSec, text: "x" },
      },
    };
  return {
    update_id: item.updateId,
    message: {
      message_id: item.seq + 1,
      chat,
      from,
      date: nowSec,
      text: item.kind === "command" ? "/start" : "مرحبا",
    },
  };
}

async function main(): Promise<void> {
  const base = process.env.GATEWAY_URL ?? "http://127.0.0.1:54300";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const out = process.env.MIXED_OUT ?? "mixed-sent.jsonl";
  const inflightCap = Number(process.env.MIXED_INFLIGHT ?? 512);
  const plan = planMixed({
    rate: Number(process.env.MIXED_RATE ?? 0),
    sec: Number(process.env.MIXED_SEC ?? 180),
    kinds: JSON.parse(process.env.MIXED_KINDS ?? '{"command":0.5,"message":0.5}') as Record<
      string,
      number
    >,
    chats: Number(process.env.MIXED_CHATS ?? 3000),
    chatBase: Number(process.env.MIXED_CHAT_BASE ?? 900_000_000),
    updateBase: Number(process.env.MIXED_UPDATE_BASE ?? 3_000_000_000),
    seed: Number(process.env.MIXED_SEED ?? 1),
  });
  const t0 = Date.now();
  writeFileSync(out, `${JSON.stringify({ k: "plan", n: plan.length, t0 })}\n`);
  let inflight = 0;
  const pending: Promise<void>[] = [];
  for (const item of plan) {
    const due = t0 + item.atMs;
    const wait = due - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    if (inflight >= inflightCap) {
      appendFileSync(
        out,
        `${JSON.stringify({ k: "skipped", seq: item.seq, kind: item.kind, plannedAt: due })}\n`,
      );
      continue;
    }
    inflight += 1;
    const sentAt = Date.now();
    const body = JSON.stringify(buildMixedUpdate(item, Math.floor(sentAt / 1000)));
    pending.push(
      fetch(`${base}/webhook/telegram/driver`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
        body,
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (r) => {
          await r.arrayBuffer();
          return r.status;
        })
        .catch(() => 0)
        .then((status) => {
          inflight -= 1;
          appendFileSync(
            out,
            `${JSON.stringify({ k: "sent", seq: item.seq, updateId: item.updateId, kind: item.kind, chat: item.chat, plannedAt: due, sentAt, ackMs: Date.now() - sentAt, status })}\n`,
          );
        }),
    );
  }
  await Promise.all(pending);
  appendFileSync(out, `${JSON.stringify({ k: "end", at: Date.now() })}\n`);
}

if (import.meta.main) await main();
