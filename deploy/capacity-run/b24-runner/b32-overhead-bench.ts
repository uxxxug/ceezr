// قياسُ كلفةِ أداةِ الدفعة 32 (PLAN-b32 §9). يُشغَّلُ من جذرِ شجرةِ الذراع: bun deploy/capacity-run/b24-runner/b32-overhead-bench.ts
// على main (دون load-path-scope) استُعملَت نسخةٌ بلا withLoadPath؛ النتائجُ مدوّنةٌ في PLAN-b32.md §9.
/* biome-ignore-all lint/suspicious/noThenProperty: كائنُ استعلامٍ وهميٌّ قابلٌ للانتظار كـpostgres.js */
/* biome-ignore-all lint/suspicious/noExplicitAny: سكربتُ قياسٍ لمرّةٍ واحدة */
/* biome-ignore-all lint/style/noNonNullAssertion: الأثرُ مُفعَّلٌ قسرًا في القياس */

import { withLoadPath } from "../../../apps/gateway/src/background/load-path-scope.ts";
import { createLoadTrace } from "../../../apps/gateway/src/background/load-trace.ts";
import { withQueryDeadline } from "../../../packages/infrastructure/db/query-deadline.ts";

class Q extends Promise<unknown> {
  static override get [Symbol.species]() {
    return Promise;
  }
  declare r: (v: unknown) => void;
  s = false;
  constructor() {
    let r: (v: unknown) => void = () => {};
    super((res) => {
      r = res;
    });
    this.r = r;
  }
  handle() {
    if (!this.s) {
      this.s = true;
      queueMicrotask(() => this.r([]));
    }
    return Promise.resolve();
  }
  cancel() {
    return Promise.resolve();
  }
  override then<A, B>(a?: any, b?: any): Promise<A | B> {
    void this.handle();
    return super.then(a, b);
  }
}
const raw: any = (..._a: unknown[]) => new Q();
raw.options = { max: 5 };
const sql: any = withQueryDeadline(raw, { deadlineMs: 5000, slots: 5, label: "ceezr:b" });
const N = 200000;
async function run(_label: string, wrap: boolean) {
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    if (wrap) await withLoadPath("drainer:job:driver:contact", () => sql`select 1`);
    else await sql`select 1`;
  }
  return ((performance.now() - t0) * 1000) / N;
}
const base = await run("off", false);
const tr = createLoadTrace("/tmp/b32bench-trace")!;
const prev = await run("old-observer+scope", true);
await tr.stop();
console.log(
  JSON.stringify({
    N,
    us_per_query_trace_off: base.toFixed(2),
    us_per_query_trace_on_with_scope: prev.toFixed(2),
  }),
);
