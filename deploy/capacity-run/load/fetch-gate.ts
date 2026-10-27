/**
 * الغرض: بوابةُ `fetch` في مولّدِ الحمل (LOAD-01-GAP-PROBE-RUN3، 2026-10-27) — سيمافورٌ صريحٌ يُقاسُ
 *   فيه زمنُ الانتظارِ قبلَ الإرسال، بدلَ طابورِ Bun الداخليِّ غيرِ المرئيّ (حدُّ `fetch` الافتراضيُّ 256).
 * الحالة: أداةُ قياسٍ في المولّدِ وحدَه — لا كودَ منتجٍ ولا حدَّ نظامٍ محميٍّ.
 * ينتمي إلى: deploy/capacity-run/load
 *
 * الدلالة:
 * - السعةُ من `LOAD_GEN_FETCH_CAP` وقتَ أوّلِ استعمال. **غيرُ مضبوطةٍ ⇒ لا حدّ** (السلوكُ كما كان تمامًا:
 *   المسارُ السريعُ متزامنٌ بلا `await` إضافيّ)، ويبقى العدُّ وحدَه لقياسِ معدّلِ الإرسال.
 * - مضبوطةٌ ⇒ طابورُ FIFO: لا يُرسَلُ طلبٌ ما دامَ `cap` طلبًا جاريًا؛ الفتحةُ تُحرَّرُ بعدَ قراءةِ الجسم
 *   (كما يعدُّ Bun الطلبَ حتى انتهائِه). لا يُسقِطُ طلبًا ولا يُعيدُ ترتيبًا ولا يغيّرُ مهلة: إشارةُ الإلغاءِ نفسُها
 *   (المهلةُ تبدأُ قبلَ الانتظارِ كما كانت تبدأُ قبلَ طابورِ Bun) تُخرِجُ المنتظرَ بالخطأِ نفسِه.
 * - لا يُخفي تأخيرًا: `queueWaitMs` و`waitersAtInvoke` و`activeAtSend` و`demandAtInvoke` لكلِّ طلب،
 *   وعدّاداتٌ لكلِّ ثانيةٍ (`takeSample`) لمعدّلِ النداءِ والإرسالِ والإكمال.
 * - لا يرفعُ حدَّ Bun ولا يغيّرُه: السعةُ المسجّلةُ لـRUN3 هي 256 نفسُها.
 */

export interface SlotInfo {
  /** انتظارُ الفتحةِ بساعةِ هذهِ العمليّةِ الرتيبة (0 في المسارِ السريع). */
  readonly queueWaitMs: number;
  /** المنتظرونَ أمامَ هذا الطلبِ لحظةَ دخولِه البوابة (لا يشملُه). */
  readonly waitersAtInvoke: number;
  /** الطلباتُ الجاريةُ لحظةَ إرسالِ هذا الطلبِ (يشملُه) — ≤ cap حينَ تُضبط. */
  readonly activeAtSend: number;
  /** الطلبُ الكلّيُّ لحظةَ الدخول: الجاريةُ + المنتظرونَ + هذا. */
  readonly demandAtInvoke: number;
}

export interface GateSample {
  readonly cap: number | null;
  readonly invokes: number;
  readonly sends: number;
  readonly completions: number;
  readonly aborted: number;
  readonly activeNow: number;
  readonly activeMax: number;
  readonly waitersNow: number;
  readonly waitersMax: number;
  readonly waitSumMs: number;
  readonly waitMaxMs: number;
  readonly waitedSends: number;
}

interface Waiter {
  readonly enqueuedAt: number;
  readonly waitersAtInvoke: number;
  readonly demandAtInvoke: number;
  readonly resolve: (info: SlotInfo) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

export function parseFetchCap(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`LOAD_GEN_FETCH_CAP غيرُ صالح: ${raw} (عددٌ صحيحٌ 1..65535 أو غيرُ مضبوط)`);
  }
  return n;
}

export class FetchGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private invokes = 0;
  private sends = 0;
  private completions = 0;
  private aborted = 0;
  private activeMax = 0;
  private waitersMax = 0;
  private waitSumMs = 0;
  private waitMaxMs = 0;
  private waitedSends = 0;

  constructor(
    readonly cap: number | null,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** الحالُ الآنيُّ (للاختبارِ والتسجيل). */
  get activeCount(): number {
    return this.active;
  }
  get waitingCount(): number {
    return this.waiters.length;
  }

  /**
   * فتحةٌ متزامنةٌ إن أمكنَ (لا حدّ، أو تحتَ السعةِ بلا منتظرين) — وإلّا null فيجبُ `acquire`.
   * المسارُ السريعُ لا يُدخلُ أيَّ قفزةِ مهامٍّ دقيقة، فيبقى سلوكُ «بلا حدّ» كما كانَ قبلَ البوابة.
   */
  tryAcquire(): SlotInfo | null {
    if (this.cap !== null && (this.active >= this.cap || this.waiters.length > 0)) return null;
    this.invokes += 1;
    const demandAtInvoke = this.active + this.waiters.length + 1;
    this.markSend(0);
    return { queueWaitMs: 0, waitersAtInvoke: 0, activeAtSend: this.active, demandAtInvoke };
  }

  /** انتظارُ فتحةٍ بترتيبِ الوصول؛ الإلغاءُ يُخرجُ المنتظرَ بسببِ الإشارةِ نفسِه. */
  acquire(signal?: AbortSignal): Promise<SlotInfo> {
    const fast = this.tryAcquire();
    if (fast !== null) return Promise.resolve(fast);
    if (signal?.aborted) {
      this.invokes += 1;
      this.aborted += 1;
      return Promise.reject(signal.reason);
    }
    this.invokes += 1;
    const waitersAtInvoke = this.waiters.length;
    const demandAtInvoke = this.active + waitersAtInvoke + 1;
    return new Promise<SlotInfo>((resolve, reject) => {
      const waiter: Waiter = {
        enqueuedAt: this.now(),
        waitersAtInvoke,
        demandAtInvoke,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          this.aborted += 1;
          reject(signal?.reason);
        },
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      if (this.waiters.length > this.waitersMax) this.waitersMax = this.waiters.length;
    });
  }

  /** تحريرُ فتحةٍ بعدَ انتهاءِ الطلب (الجسمُ مقروءٌ أو فشلٌ) — يُسلِّمُها لأقدمِ منتظر. */
  release(): void {
    if (this.active <= 0) throw new Error("FetchGate.release بلا فتحةٍ محجوزة");
    this.active -= 1;
    this.completions += 1;
    const next = this.waiters.shift();
    if (next === undefined) return;
    next.signal?.removeEventListener("abort", next.onAbort);
    const waited = this.now() - next.enqueuedAt;
    this.markSend(waited);
    next.resolve({
      queueWaitMs: waited,
      waitersAtInvoke: next.waitersAtInvoke,
      activeAtSend: this.active,
      demandAtInvoke: next.demandAtInvoke,
    });
  }

  /** عيّنةُ الفترةِ منذُ العيّنةِ السابقة (العدّاداتُ تُصفَّرُ، والحالُ الآنيُّ يبقى). */
  takeSample(): GateSample {
    const s: GateSample = {
      cap: this.cap,
      invokes: this.invokes,
      sends: this.sends,
      completions: this.completions,
      aborted: this.aborted,
      activeNow: this.active,
      activeMax: this.activeMax,
      waitersNow: this.waiters.length,
      waitersMax: this.waitersMax,
      waitSumMs: Math.round(this.waitSumMs * 100) / 100,
      waitMaxMs: Math.round(this.waitMaxMs * 100) / 100,
      waitedSends: this.waitedSends,
    };
    this.invokes = 0;
    this.sends = 0;
    this.completions = 0;
    this.aborted = 0;
    this.activeMax = this.active;
    this.waitersMax = this.waiters.length;
    this.waitSumMs = 0;
    this.waitMaxMs = 0;
    this.waitedSends = 0;
    return s;
  }

  private markSend(waited: number): void {
    this.active += 1;
    this.sends += 1;
    if (this.active > this.activeMax) this.activeMax = this.active;
    if (waited > 0) {
      this.waitedSends += 1;
      this.waitSumMs += waited;
      if (waited > this.waitMaxMs) this.waitMaxMs = waited;
    }
  }
}

let shared: { raw: string | undefined; gate: FetchGate } | null = null;

/** البوابةُ المشتركةُ لكلِّ `fetch` في عمليّةِ المولّد — تُبنى من البيئةِ وقتَ أوّلِ استعمال. */
export function fetchGate(): FetchGate {
  const raw = process.env.LOAD_GEN_FETCH_CAP;
  if (shared === null || shared.raw !== raw)
    shared = { raw, gate: new FetchGate(parseFetchCap(raw)) };
  return shared.gate;
}

/** للاختبارِ وحدَه: إسقاطُ البوابةِ المشتركةِ لتُبنى من البيئةِ مجدّدًا. */
export function resetFetchGateForTest(): void {
  shared = null;
}

/**
 * يحجزُ فتحةً، يُشغّلُ `fn` (الإرسالُ وقراءةُ الجسمِ كاملًا)، ثمَّ يحرّرُها دائمًا. خطأُ الإلغاءِ أثناءَ
 * الانتظارِ يمرُّ كما هو (لم تُحجزْ فتحةٌ فلا تحرير).
 */
export async function withFetchSlot<T>(
  signal: AbortSignal | undefined,
  fn: (slot: SlotInfo) => Promise<T>,
): Promise<T> {
  const gate = fetchGate();
  const slot = gate.tryAcquire() ?? (await gate.acquire(signal));
  try {
    return await fn(slot);
  } finally {
    gate.release();
  }
}
