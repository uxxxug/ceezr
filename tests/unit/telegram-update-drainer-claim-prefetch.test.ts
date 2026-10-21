/**
 * الغرض: LOAD-01 (الدفعةُ 27) — شاهدُ فشلِ «سقفِ حلقةِ الالتقاطِ» في درينرِ تحديثاتِ تيليجرام، ثمّ
 *   حارسُ انحدارِ إصلاحِه (الالتقاطُ المسبَقُ المتداخلُ معَ تنفيذِ المسارات).
 *
 * المقيسُ (الدفعةُ 26، موجاتُ المرشّحِ الأربعُ عندَ 750، أثرُ `load-trace` لكلِّ وظيفة): طابورُ إثباتِ
 * الهاتفِ لم يفرغْ قطُّ (> 32 وظيفةً منتظرةً في كلِّ عيّنةٍ تقريبًا)، ومعَ ذلك لم يجرِ إلا ~22 من 32
 * مسارًا، وحلقةُ الالتقاطِ مشغولةٌ 95% من زمنِ الشوطِ برحلاتٍ متسلسلةٍ ~0.20ث تجلبُ 5.9 وظيفةً في
 * المتوسّطِ — لأنَّ الرحلةَ لا تطلبُ إلا عددَ المساراتِ الشاغرةِ لحظتَها، ولا تُطلَقُ إلا بعدَ نفادِ
 * المخزَّن. فسقفُ الإتمامِ ≈ 5.9 / 0.20 ≈ 29.5/ث (المقيسُ 28.7–31.3/ث) دونَ وصولٍ 31.6–34.4/ث، فتراكمَ
 * الطابورُ إلى ~16–17ث p50 وتجاوزَ مهلةَ المولّدِ (20ث) ⇒ `driver_onboarding_failed`.
 *
 * هذا الاختبارُ يُشغّلُ **الدرينرَ الحقيقيَّ** (`drainTelegramUpdateJobsOnce`) بطابورٍ زائفٍ زمنُ رحلتِه
 * وزمنُ معالجةِ الوظيفةِ بنسبةِ المقيسِ نفسِها (0.20 : 0.73، مُصغَّرةً ×0.2)، و32 مسارًا وبوتين وسقفِ شوطٍ
 * 100 بحالةٍ ممتدّةٍ — كما في البوّابة. والحكمُ على **إشغالِ المساراتِ أثناءَ التراكم** لا على 2xx.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  createDrainLaneState,
  drainTelegramUpdateJobsOnce,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type J = ClaimedTelegramUpdateJob;

/** نسبةُ المقيسِ (0.20ث رحلةُ التقاطٍ · 0.73ث معالجةُ وظيفةٍ) مُصغَّرةً ×0.2. */
const TRIP_MS = 40;
const JOB_MS = 146;
const LANES = 32;
const SWEEP_CAP = 100;
const JOBS = 480;

function job(bot: string, updateId: number, userId: number): J {
  return {
    bot,
    updateId,
    payload: { message: { from: { id: userId } } },
    claimToken: `t${updateId}`,
    attempts: 1,
    maxAttempts: 5,
  };
}

interface Harness {
  readonly queue: TelegramUpdateQueue;
  readonly trips: number[];
  readonly finished: number[];
  /** لحظةُ فراغِ الطابورِ في القاعدةِ (آخرُ وظيفةٍ التُقِطَت) — نهايةُ نافذةِ «التراكم». */
  backlogEndedAt: number | null;
  readonly held: Set<number>;
}

function slowQueue(jobs: J[]): Harness {
  const pending = [...jobs];
  const h: Harness = {
    queue: undefined as never,
    trips: [],
    finished: [],
    backlogEndedAt: null,
    held: new Set(),
  };
  const take = (bot: string, limit: number): J[] => {
    const out: J[] = [];
    for (let i = 0; i < pending.length && out.length < limit; ) {
      if ((pending[i] as J).bot === bot) out.push(pending.splice(i, 1)[0] as J);
      else i += 1;
    }
    return out;
  };
  const trip = () => new Promise((r) => setTimeout(r, TRIP_MS));
  (h as { queue: TelegramUpdateQueue }).queue = {
    claim: async () => {
      await trip();
      return { job: pending.shift() ?? null };
    },
    claimFor: async (bot) => {
      await trip();
      return { job: take(bot, 1)[0] ?? null };
    },
    claimBatchFor: async (bot: string, limit: number) => {
      await trip();
      const jobs = take(bot, limit);
      h.trips.push(jobs.length);
      for (const j of jobs) h.held.add(j.updateId);
      if (pending.length === 0 && h.backlogEndedAt === null) h.backlogEndedAt = performance.now();
      return { jobs };
    },
    renew: async (leases) => leases.length,
    finish: async (lease) => {
      h.held.delete(lease.updateId);
      h.finished.push(lease.updateId);
      return true;
    },
    abandon: async () => true,
  };
  return h;
}

/** يدفعُ أشواطًا متتاليةً بحالةٍ ممتدّةٍ كما يفعلُ `startTelegramUpdateDrainer` حتّى يفرغَ كلُّ شيء. */
async function drainAll(h: Harness, handler: unknown): Promise<void> {
  const state = createDrainLaneState();
  for (let sweeps = 0; sweeps < 1000; sweeps++) {
    const report = await drainTelegramUpdateJobsOnce(
      {
        queue: h.queue,
        handler: handler as never,
        maxJobsPerRun: SWEEP_CAP,
        lanes: LANES,
        fairBots: ["driver", "rider"],
      },
      state,
    );
    if (!report.truncated && report.claimed === 0 && state.inflight.size === 0) return;
  }
  throw new Error("الدرينرُ لم يفرغ");
}

/** إشغالٌ دقيقٌ: عدٌّ جارٍ مُعادُ البناءِ من أحداثِ البدءِ والانتهاء. */
function busyLanesDuring(starts: number[], ends: number[], from: number, until: number): number {
  const ev = [...starts.map((t) => [t, 1] as const), ...ends.map((t) => [t, -1] as const)].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  let cur = 0;
  let prev = from;
  let area = 0;
  for (const [t, d] of ev) {
    const tt = Math.min(Math.max(t, from), until);
    area += (tt - prev) * cur;
    prev = tt;
    cur += d;
  }
  area += (until - prev) * cur;
  return area / Math.max(1, until - from);
}

describe("LOAD-01 ب27 — سقفُ حلقةِ الالتقاطِ في درينرِ تيليجرام", () => {
  test("أثناءَ التراكمِ المستمرِّ تبقى المساراتُ ممتلئةً (≥ 85% من 32) — لا يحكمُها زمنُ رحلةِ الالتقاط", async () => {
    const jobs = Array.from({ length: JOBS }, (_, i) => job("driver", i + 1, 50_000 + i));
    const h = slowQueue(jobs);
    const starts: number[] = [];
    const ends: number[] = [];
    const handler = {
      handle: async () => {
        starts.push(performance.now());
        await new Promise((r) => setTimeout(r, JOB_MS));
        ends.push(performance.now());
        return true;
      },
    };
    await drainAll(h, handler);

    // الكلُّ أُنجِزَ مرّةً واحدةً بالضبط، ولا محجوزَ متروكٌ.
    expect(h.finished.length).toBe(JOBS);
    expect(new Set(h.finished).size).toBe(JOBS);
    expect(h.held.size).toBe(0);
    // لا دفعةَ تتجاوزُ نصيبَ البوتِ من المسارات (32 / بوتين).
    expect(Math.max(...h.trips)).toBeLessThanOrEqual(LANES / 2);

    const from = Math.min(...starts);
    const until = h.backlogEndedAt ?? Math.max(...ends);
    const busy = busyLanesDuring(starts, ends, from, until);
    // قبلَ الإصلاحِ (main 66528457): ~22/32 كما في المقيس. الحدُّ 0.85 × 32 = 27.2.
    expect(busy).toBeGreaterThanOrEqual(0.85 * LANES);
  }, 30_000);

  test("ترتيبُ المستخدمِ الواحدِ محفوظٌ معَ الالتقاطِ المسبَق، والإيجاراتُ المخزَّنةُ تُجدَّد", async () => {
    const jobs: J[] = [];
    let id = 0;
    for (let round = 0; round < 8; round++)
      for (let user = 0; user < 12; user++) jobs.push(job("driver", ++id, 7000 + user));
    const h = slowQueue(jobs);
    const handler = {
      handle: async () => {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
        return true;
      },
    };
    await drainAll(h, handler);
    expect(h.finished.length).toBe(jobs.length);
    expect(new Set(h.finished).size).toBe(jobs.length);
    // ترتيبُ الختمِ لكلِّ مستخدمٍ = ترتيبُ الإيداع.
    const byUser = new Map<number, number[]>();
    for (const u of h.finished) {
      const user = 7000 + ((u - 1) % 12);
      byUser.set(user, [...(byUser.get(user) ?? []), u]);
    }
    expect(byUser.size).toBe(12);
    for (const ids of byUser.values()) expect(ids).toEqual([...ids].sort((a, b) => a - b));
  }, 30_000);

  test("المخزَّنُ المسبَقُ لا يُتركُ محجوزًا عندَ قطعِ الشوطِ بسقفِه", async () => {
    const jobs = Array.from({ length: 250 }, (_, i) => job("driver", i + 1, 60_000 + i));
    const h = slowQueue(jobs);
    const state = createDrainLaneState();
    const report = await drainTelegramUpdateJobsOnce(
      {
        queue: h.queue,
        handler: { handle: async () => true } as never,
        maxJobsPerRun: SWEEP_CAP,
        lanes: LANES,
        fairBots: ["driver", "rider"],
      },
      state,
    );
    expect(report.truncated).toBe(true);
    expect(report.claimed).toBe(SWEEP_CAP);
    // ما التُقِطَ = ما عُدَّ في الشوط: لا وظيفةَ محجوزةٌ خارجَ حسابِ الشوطِ تنتظرُ انقضاءَ إيجارِها.
    await Promise.allSettled([...state.inflight]);
    expect(h.held.size).toBe(0);
    expect(h.finished.length).toBe(SWEEP_CAP);
  }, 30_000);
});
