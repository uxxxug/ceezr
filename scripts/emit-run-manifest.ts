#!/usr/bin/env bun
/**
 * # باثقةُ بصمةِ التشغيل — `F9-05` · `OPS-007`
 *
 * **الغرض:** أن تُكتَبَ بصمةُ التشغيلِ في ملفٍّ JSON يقرؤُه الحاجزُ الساكنُ.
 * تُستدعى هذه في نهايةِ كلِّ وظيفةٍ في CI بـ`if: always()` — فحتى الإخفاقُ
 * يُنتِجُ بصمةً تقولُ «failure» لا صمتاً.
 *
 * **الحالة:** `F9-05` — مُنفَّذ.
 *
 * **ينتمي إلى:** البند `F9-05` · القسم 9.
 *
 * **ما لا يفعله هذا السكربتُ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يُنتِجُ بصمةً فقط.
 * - **لا يقرأُ قيمَ المتغيّراتِ البيئيّة.** بصمةُ المفاتيحِ فقط.
 * - **لا يحكمُ على نجاحٍ.** يُسجِّلُ ما جرى.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import type { RunManifest } from "./lib/run-manifest.ts";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "unknown";
  }
}

function probeDatabase(): "alive" | "dead" | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  try {
    execSync(`psql "${url}" -c "select 1" -t`, { timeout: 5000, stdio: "pipe" });
    return "alive";
  } catch {
    return "dead";
  }
}

function probeRedis(): "alive" | "dead" | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    execSync(`redis-cli -u "${url}" ping`, { timeout: 5000, stdio: "pipe" });
    return "alive";
  } catch {
    return "dead";
  }
}

function envKeyFingerprint(): string {
  const keys = Object.keys(process.env)
    .filter((k) => !k.startsWith("GITHUB_TOKEN") && !k.startsWith("ACTIONS_"))
    .sort();
  const hash = createHash("sha256");
  hash.update(keys.join(","));
  return hash.digest("hex").substring(0, 16);
}

function migrationFingerprint(): string {
  const dir = "supabase/migrations";
  if (!existsSync(dir)) return "none";
  const files = readdirSync(dir).sort();
  const hash = createHash("sha256");
  hash.update(files.join(","));
  return hash.digest("hex").substring(0, 16);
}

function main(): void {
  const job = process.env.JOB_NAME ?? "unknown";
  const output = process.argv[2] ?? "/tmp/run-manifest.json";

  const manifest: RunManifest = {
    job,
    runUrl: process.env.GITHUB_RUN_URL ?? "unknown",
    commitSha: process.env.GITHUB_SHA ?? sh("git rev-parse HEAD"),
    ref: process.env.GITHUB_REF ?? sh("git rev-parse --abbrev-ref HEAD"),
    event: process.env.GITHUB_EVENT_NAME ?? "unknown",
    verdict: process.env.CI_VERDICT === "failure" ? "failure" : "success",
    bunVersion: sh("bun --version"),
    nodeVersion: sh("node --version"),
    envKeyFingerprint: envKeyFingerprint(),
    dbProbe: probeDatabase(),
    redisProbe: probeRedis(),
    migrationFingerprint: migrationFingerprint(),
    knownLimits: "البصمةُ تُثبِتُ التشغيلَ لا صحّةَ السلوك — تحقُّقُ الحكمِ في الحاجزِ الساكن.",
    timestamp: new Date().toISOString(),
  };

  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`✓ بصمةُ التشغيلِ كُتِبَت في ${output}`);
  console.log(`  الوظيفة: ${manifest.job} · الحكم: ${manifest.verdict}`);
}

main();
