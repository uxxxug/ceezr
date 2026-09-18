/**
 * الغرض: منافذُ قراءةِ أصولِ المركبةِ — عقدُ ما تحتاجُه حالاتُ الاستخدامِ من
 *   **مُوقِّعِ روابطِ قراءةٍ** (`F12-06`).
 * الحالة: مبنيٌّ — البند `F12-06`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-vehicle-assets.ts`
 *   · `packages/infrastructure/storage/signed-read.ts`
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا يقولُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ بايتاً**: التوقيعُ وعدٌ بالقراءةِ لا قراءةٌ.
 *   ــ **لا يُقرِّرُ مساراً**: المسارُ من القاعدةِ.
 */

import type { ReadSignerFailure, ReadUrlSigner } from "../../infrastructure/storage/signed-read.ts";

/** عقدُ قارئِ أصولِ المركبةِ — يُوقِّعُ روابطَ قراءةٍ للشعارِ والباركودِ. */
export interface VehicleAssetReader {
  /** يُوقِّعُ رابطَ قراءةٍ لمسارِ كائنٍ واحدٍ. */
  signReadUrl(
    objectPath: string,
    ttlSeconds: number,
  ): Promise<
    | { ok: true; readUrl: string; expiresAtEpochMs: number }
    | { ok: false; reason: ReadSignerFailure }
  >;
}

/** محوِّلٌ من `ReadUrlSigner` إلى `VehicleAssetReader`. */
export class ReadUrlSignerAdapter implements VehicleAssetReader {
  constructor(private readonly signer: ReadUrlSigner) {}

  async signReadUrl(
    objectPath: string,
    ttlSeconds: number,
  ): Promise<
    | { ok: true; readUrl: string; expiresAtEpochMs: number }
    | { ok: false; reason: ReadSignerFailure }
  > {
    const result = await this.signer.signRead({ objectPath, ttlSeconds });
    if (!result.ok) return { ok: false, reason: result.error };
    return {
      ok: true,
      readUrl: result.value.readUrl,
      expiresAtEpochMs: result.value.expiresAtEpochMs,
    };
  }
}

/** قارئٌ غيرُ مُهيَّأٍ — يردُّ رفضاً مُصنَّفاً ولا يتظاهرُ بالنجاحِ. */
export class UnconfiguredAssetReader implements VehicleAssetReader {
  async signReadUrl(): Promise<{
    ok: false;
    reason: "SIGNER_NOT_CONFIGURED";
  }> {
    return { ok: false, reason: "SIGNER_NOT_CONFIGURED" };
  }
}
