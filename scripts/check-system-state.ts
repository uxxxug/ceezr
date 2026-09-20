#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: وثيقةُ حالةِ النظامِ غيرُ متقادمةٍ
 *
 * **الغرض:** أن يستحيلَ أن تبقى `docs/SYSTEM_STATE.md` متقادمةً أكثرَ من
 * أربعةَ عشرَ يومًا. الوثيقةُ هي المرجعُ الحاكمُ لحالةِ المشروعِ الهندسية،
 * وحداثتُها شرطُ صحّةٍ لكلِّ من يقرأُها — سواءٌ في `main` أم في فرعٍ.
 *
 * **القاعدة:** تُقرأُ سطرُ «آخر تحديث» من الجدولِ العلويِّ، ويُستخرَجُ التاريخُ
 * بصيغةِ `YYYY-MM-DD`. إن كانَ التاريخُ أقدمَ من أربعةَ عشرَ يومًا من اليومِ،
 * يُسقِطُ الحاجزُ. وإن لم يُوجَدِ التاريخُ أصلاً، يُسقِطُ كذلك.
 *
 * **الحكمُ على رمزِ الخروجِ لا على النصِّ:** خروجٌ صفريٌّ = الوثيقةُ طازجةٌ.
 * خروجٌ واحدٌ = الوثيقةُ متقادمةٌ أو غيرُ قابلةٍ للقراءة.
 *
 * **ينتمي إلى:** حوكمةُ المستودعِ — ليست بندًا في خارطةِ الطريقِ.
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **وحداتُه النقيّة:** لا يقرأُ قرصًا متغيّرًا ولا شبكةً ولا ساعةً خارجيّةً —
 * يقرأُ ملفًّا ويُحلِّلُ نصًّا ويُقارنُ تاريخًا. **قابلٌ للحقنِ بالكامل**:
 * `today` و`fileContent` مدخلان لا يُقرآنِ من العالمِ الخارجيِّ مباشرةً.
 */
import { readFileSync } from "node:fs";

const MAX_STALENESS_DAYS = 14;

export interface SystemStateCheckInput {
  readonly fileContent: string;
  readonly today: Date;
}

export interface SystemStateCheckResult {
  readonly stale: boolean;
  readonly lastUpdated: string | null;
  readonly ageDays: number | null;
  readonly reason: string;
}

/**
 * استخراجُ تاريخِ «آخر تحديث» من محتوى وثيقةِ حالةِ النظامِ.
 *
 * يبحثُ عن سطرٍ يبدأُ بـ `| **آخر تحديث** |` ويستخرجُ منهُ أولَ تاريخٍ
 * بصيغةِ `YYYY-MM-DD`.
 */
export function extractLastUpdated(fileContent: string): string | null {
  const lines = fileContent.split("\n");
  for (const line of lines) {
    if (line.includes("آخر تحديث")) {
      const match = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1] ?? null;
    }
  }
  return null;
}

/**
 * حسابُ عددِ الأيّامِ بينَ تاريخينِ بصيغةِ `YYYY-MM-DD`.
 */
export function daysBetween(from: string, to: Date): number | null {
  const fromTime = Date.parse(from);
  if (Number.isNaN(fromTime)) return null;
  const diffMs = to.getTime() - fromTime;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * التحققُ من حداثةِ وثيقةِ حالةِ النظامِ.
 *
 * قواعدُ ثلاثٌ:
 * ١. إن لم يُوجَدِ التاريخُ ← سالب.
 * ٢. إن لم يُقَرأِ التاريخُ ← سالب.
 * ٣. إن كانَ التاريخُ أقدمَ من `MAX_STALENESS_DAYS` ← سالب.
 */
export function checkSystemStateFreshness(input: SystemStateCheckInput): SystemStateCheckResult {
  const lastUpdated = extractLastUpdated(input.fileContent);

  if (lastUpdated === null) {
    return {
      stale: true,
      lastUpdated: null,
      ageDays: null,
      reason:
        "لم يُعثَرْ على تاريخٍ بصيغةِ YYYY-MM-DD في سطرِ «آخر تحديث» — الوثيقةُ بلا تاريخٍ قابلٍ للقراءة",
    };
  }

  const ageDays = daysBetween(lastUpdated, input.today);

  if (ageDays === null) {
    return {
      stale: true,
      lastUpdated,
      ageDays: null,
      reason: `التاريخُ «${lastUpdated}» غيرُ قابلٍ للقراءةِ كتاريخٍ صالح`,
    };
  }

  if (ageDays > MAX_STALENESS_DAYS) {
    return {
      stale: true,
      lastUpdated,
      ageDays,
      reason: `الوثيقةُ متقادمةٌ: آخرُ تحديثٍ في ${lastUpdated} (قبلَ ${ageDays} يومًا — الحدُّ المسموحُ ${MAX_STALENESS_DAYS} يومًا)`,
    };
  }

  return {
    stale: false,
    lastUpdated,
    ageDays,
    reason: `الوثيقةُ طازجةٌ: آخرُ تحديثٍ في ${lastUpdated} (قبلَ ${ageDays} يومًا)`,
  };
}

// ═══ التشغيلُ من سطرِ الأوامرِ ═══
if (import.meta.main) {
  const fileContent = readFileSync("docs/SYSTEM_STATE.md", "utf-8");
  const result = checkSystemStateFreshness({ fileContent, today: new Date() });

  if (result.stale) {
    console.error(`✗ وثيقةُ حالةِ النظامِ متقادمةٌ: ${result.reason}`);
    process.exit(1);
  }

  console.log(`✓ وثيقةُ حالةِ النظامِ طازجةٌ: ${result.reason}`);
}
