/**
 * # سقوطُ حاجزِ البثِّ المدفوعِ مقيسٌ لا مفترَضٌ — `ح-7`
 *
 * الحاجزُ الأخضرُ على المستودعِ كما هوَ لا يُثبِتُ أنَّهُ يفحصُ شيئاً.
 * فلكلِّ قاعدةٍ ههنا خرقٌ **مزروعٌ** يجبُ أن يُسقِطَها.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GUARD_SCRIPT = "scripts/check-paid-broadcast-guard.ts";
const TEMP_DIR = "apps/__paid_broadcast_test__";
const TEMP_FILE = join(TEMP_DIR, "violation.ts");

describe("check-paid-broadcast-guard — السالبةُ المزروعةُ", () => {
  test("كتابةُ `allow_paid_broadcast` تُسقِطُ الحاجزَ", () => {
    // أنشئ ملفاً مؤقتاً يحوي النصَّ المحظورَ
    if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
    writeFileSync(TEMP_FILE, "export const x = { allow_paid_broadcast: true };\n");

    // شغِّل الحاجزَ وتوقَّعِ السقوطَ
    const result = Bun.spawnSync({
      cmd: ["bun", "run", GUARD_SCRIPT],
      stdout: "pipe",
      stderr: "pipe",
    });

    // نظِّف الملفَّ المؤقتَ فورًا
    rmSync(TEMP_DIR, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(stderr).toContain("no-allow-paid-broadcast");
    expect(stderr).toContain("allow_paid_broadcast");
  });

  test("لا وجودَ للنصِّ في المستودعِ كما هوَ — الحاجزُ أخضرُ", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", GUARD_SCRIPT],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(stdout).toContain("no paid broadcast in code");
  });
});
