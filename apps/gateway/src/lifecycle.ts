/**
 * دورةُ حياةِ التصريفِ الرشيقِ — `F5-05` / `CAP-008`.
 *
 * المشكلةُ التي يحلُّها هذا الملفُّ: عند `SIGTERM` (إعادةُ نشرٍ على Render، أو إيقافٌ
 * يدويٌّ) كانت البوابةُ تُغلقُ مواردَها فوراً ولا تنتظرُ انتهاءَ الطلباتِ الجارية،
 * فيُقطعُ ما في الطريقِ من طلباتٍ وويبهوكاتٍ. هذا التصميمُ يفصلُ بين:
 *
 * 1. **الإعلان** عن بدءِ التصريفِ (`isDraining`) — فيرتدُّ `/ready` بـ`503` فوراً
 *    ليوقفَ المُوجِّهُ (`router`/`load balancer`) إرسالَ الجديدِ، **مع بقاءِ الخادمِ
 *    يستقبلُ** حتى يُجيبَ فحصُ الجاهزيةِ برسالةِ «مُصرِّف» لا برفضِ اتصالٍ.
 * 2. **التصريف** — انتظارُ انتهاءِ الطلباتِ الجاريةِ ضمنَ مهلةٍ محدودة، لا انتظارٌ
 *    أعمى إلى الأبد.
 * 3. **الإغلاق** — بعدَ فراغِ الجاري (أو انقضاءِ المهلة) تُغلقُ المواردُ ترتيبيّاً:
 *    العاملُ المدمجُ أوّلاً (حتى لا يُولّدَ مهامَّ جديدةً)، ثمّ القاعدةُ، ثمّ الخادمُ.
 *
 * مبادئُ التصميم:
 * - **الخروجُ ليسَ هنا.** هذه الوحدةُ تُعيدُ وعدًا ينحلُّ عندَ اكتمالِ التصريفِ؛
 *   استدعاءُ `process.exit` مسؤوليّةُ المنادي (نقطةُ الإقلاعِ) حتى يبقى الاختبارُ
 *   قادرًا على التحقّقِ من النتيجةِ دونَ قتلِ العمليّةِ.
 * - **حقنُ الوقتِ.** الساعةُ (`now`) والنومُ (`sleep`) مَحقونَتانِ، فيُختبرُ المنطقُ
 *   بمعزلٍ عن إشاراتِ النظامِ وزمنِ الانتظارِ الحقيقيِّ.
 * - **المُكوَّنُ لا عَلمَ له بالأنواعِ.** المواردُ تُمرَّرُ كمستدعياتٍ (`callbacks`)
 *   لا كمراجعَ مباشرة، فيبقى `lifecycle.ts` خالياً من استيرادِ الخادمِ والحاوية.
 */

export interface ShutdownResources {
  /** عددُ الطلباتِ الجاريةِ الآن — يُستقصى كلَّ دورةِ تصريف. */
  readonly inFlight: () => number;
  /** إغلاقٌ قَسريٌّ فوريٌّ لما تبقّى من جارٍ عند انقضاءِ المهلة (مثلًا `server.stop(true)`). */
  readonly forceClose: () => void;
  /** إغلاقٌ نظيفٌ ترتيبيٌّ للموارد: عاملٌ مدمج، قاعدة، خادم. */
  readonly close: () => Promise<void>;
}

export interface LifecycleOptions {
  readonly resources: ShutdownResources;
  /** أقصى مهلةٍ للانتظارِ حتى يفرغَ الجاري قبلَ الإغلاقِ القسريِّ (بالملّي ثانية). */
  readonly graceMs: number;
  /** مُسجِّلٌ اختياريٌّ — يُستقبلُ فيه سطرُ الإيقافِ بلا أيِّ اسمِ سرٍّ. */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** الساعةُ — مَحقونةٌ للاختبار. الافتراضُ `Date.now`. */
  readonly now?: () => number;
  /** النومُ — مَحقونٌ للاختبار. الافتراضُ `Bun.sleep`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** فاصلُ الاستطلاعِ أثناءَ انتظارِ التصريف (بالملّي ثانية). الافتراضُ `25`. */
  readonly pollIntervalMs?: number;
  /**
   * **نافذةُ الإعلانِ** — ما يُنتظرُ بعدَ رفعِ `isDraining` وقبلَ انتظارِ فراغِ
   * الجاري، ليرى المُوجّهُ حالةَ «مُصرّف» فيُوقِفَ إرسالَ الجديدِ **قبلَ أن يُغلَقَ
   * المقبسُ**. الافتراضُ `0` حفاظاً على سلوكِ من لا يطلبُها.
   *
   * **ولمَ لا تكفي الطلباتُ الجاريةُ وحدَها**: حينَ تأتي الإشارةُ ولا طلبَ جارٍ
   * — وهو الغالبُ في إعادةِ النشرِ — يصيرُ `drained` صحيحاً في الحالِ فيُغلَقُ الخادمُ
   * في دورةِ حدثٍ واحدةٍ، **فلا يرى المُوجّهُ `503 draining` أبداً** بل يرى رفضَ
   * اتصالٍ — وهو عينُ ما جاءَ `F5-05` يمنعُه. وإعلانٌ لا يراه أحدٌ ليسَ إعلاناً.
   */
  readonly announceMs?: number;
}

export interface ShutdownResult {
  readonly signal: string;
  readonly outcome: "drained" | "force_closed";
  readonly inFlightAtShutdown: number;
  readonly durationMs: number;
}

export interface Lifecycle {
  /** هل بدأ التصريفُ؟ يقرؤه `/ready` ليرتدَّ `503` فوراً. */
  readonly isDraining: () => boolean;
  /** يُطلَبُ عند الإشارة. مُكتفٍّ بذاتِهِ: النداءانِ المتزامنانِ يُعيدانِ النتيجةَ نفسَها. */
  readonly requestShutdown: (signal: string) => Promise<ShutdownResult>;
}

/**
 * ينشئُ دورةَ حياةِ التصريف. لا يلمسُ الخادمَ ولا القاعدةَ مباشرةً — كلُّ ذلك خلفَ
 * `ShutdownResources`. يبقى الخادمُ يستقبلُ أثناءَ التصريفِ حتى يُجيبَ `/ready`
 * برسالةِ «مُصرِّف»، ثمّ يُغلقُ بعدَ فراغِ الجاري أو انقضاءِ المهلة.
 */
export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const pollInterval = options.pollIntervalMs ?? 25;
  const announceMs = options.announceMs ?? 0;
  const log = options.log ?? (() => {});

  let draining = false;
  let inFlightAtShutdown = 0;
  let inflight: Promise<ShutdownResult> | null = null;

  return {
    isDraining: () => draining,

    requestShutdown: (signal: string): Promise<ShutdownResult> => {
      if (inflight !== null) return inflight;
      inflight = (async (): Promise<ShutdownResult> => {
        draining = true;
        const started = now();
        inFlightAtShutdown = options.resources.inFlight();
        log("request_shutdown_starting", {
          signal,
          inFlight: inFlightAtShutdown,
          graceMs: options.graceMs,
          announceMs,
        });

        // ٠ — **نافذةُ الإعلانِ**: رُفِعَ `isDraining` فوقَ، وهاهُنا يُمهَلُ المُوجّهُ
        // ليراه ويُوقِفَ إرسالَ الجديدِ قبلَ أن يُغلَقَ المقبسُ. وبدونِها، إن لم يكن جارٍ
        // أصلاً، يُغلَقُ الخادمُ في دورةِ حدثٍ واحدةٍ فلا يرى المُوجّهُ الإعلانَ أبداً.
        if (announceMs > 0) await sleep(announceMs);

        // ١ — انتظارُ فراغِ الجاري ضمنَ المهلة. الخادمُ ما زال يستقبلُ حتى يُجيبَ
        // `/ready` بـ«مُصرِّف»، فلا نُوقفُ الاستقبالَ هنا.
        // ويُقرأُ العدّادُ ثانيةً بعدَ نافذةِ الإعلانِ لأنَّ طلباً جارياً قد ينتهي خلالَها.
        let drained = options.resources.inFlight() === 0;
        while (!drained && now() - started < options.graceMs) {
          await sleep(pollInterval);
          drained = options.resources.inFlight() === 0;
        }

        // ٢ — إن لم يفرغْ الجاريُ، إغلاقٌ قسريٌّ لما تبقّى.
        if (!drained) {
          options.resources.forceClose();
        }

        // ٣ — إغلاقٌ نظيفٌ للمواردِ ترتيبيّاً. لا نُسقطُ النتيجةَ إن فشلَ الإغلاقُ.
        try {
          await options.resources.close();
        } catch (cause) {
          log("shutdown_close_failed", {
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        }

        return {
          signal,
          outcome: drained ? "drained" : "force_closed",
          inFlightAtShutdown,
          durationMs: now() - started,
        };
      })();

      return inflight;
    },
  };
}
