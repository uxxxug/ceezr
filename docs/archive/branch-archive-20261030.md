# أرشيفُ الفروعِ — 2026-10-30

**تاريخيٌّ فقط.** حُذفت فروعُ التجاربِ والعملِ المنتهيةُ من `origin` في تنظيفِ 2026-10-30، بعدَ حفظِ كلٍّ منها وسمًا `archive/<الفرع>` على الـSHA نفسِه (AGENTS.md §5.6). الفروعُ المدموجةُ في `main` محفوظةٌ وسمًا كذلك لتبقى الإشاراتُ إليها في الوثائقِ قابلةً للتتبّع.

## الاسترجاع

```sh
git fetch origin 'refs/tags/archive/*:refs/tags/archive/*'
git push origin refs/tags/archive/<الفرع>:refs/heads/<الفرع>
```

## ما بقيَ

- `main`.
- فروعُ dependabot الثلاثة، ولها طلباتٌ مفتوحة (#672 و#673 و#674).

## الخريطة

| الفرع | الوسم | SHA | آخرُ إيداع | في `main` |
|---|---|---|---|---|
| `exp/load01-b22-gateway-request-10` | `archive/exp/load01-b22-gateway-request-10` | `59c8f3a7d026` | 2026-10-20 | لا |
| `exp/load01-b23-cpu4` | `archive/exp/load01-b23-cpu4` | `c5759c9fd4d6` | 2026-10-20 | لا |
| `exp/load01-b24-cpu4` | `archive/exp/load01-b24-cpu4` | `3925875ac965` | 2026-10-20 | لا |
| `exp/load01-b25-cpu4` | `archive/exp/load01-b25-cpu4` | `0d4a6238f73c` | 2026-10-20 | لا |
| `exp/load01-b26-session-limit` | `archive/exp/load01-b26-session-limit` | `a02f31856d53` | 2026-10-20 | لا |
| `exp/load01-b27-cand-fix` | `archive/exp/load01-b27-cand-fix` | `d89924c67be4` | 2026-10-21 | لا |
| `exp/load01-b27-onboarding` | `archive/exp/load01-b27-onboarding` | `2682c17117b7` | 2026-10-21 | لا |
| `exp/load01-b28-drainer-acq` | `archive/exp/load01-b28-drainer-acq` | `abd175d6aa9e` | 2026-10-21 | لا |
| `exp/load01-b28-ref-trace` | `archive/exp/load01-b28-ref-trace` | `45571268e75e` | 2026-10-21 | لا |
| `exp/load01-b29-n2` | `archive/exp/load01-b29-n2` | `011fbfcc8bba` | 2026-10-21 | لا |
| `exp/load01-b30-loc-sched` | `archive/exp/load01-b30-loc-sched` | `6b0e5d67ce14` | 2026-10-21 | لا |
| `exp/load01-b31-drainer` | `archive/exp/load01-b31-drainer` | `ed32f88479c1` | 2026-10-21 | لا |
| `exp/load01-b32-arm-c` | `archive/exp/load01-b32-arm-c` | `16c7ad70eeba` | 2026-10-22 | لا |
| `exp/load01-b32-arm-i` | `archive/exp/load01-b32-arm-i` | `a38db57a8080` | 2026-10-22 | لا |
| `exp/load01-b32-arm-p` | `archive/exp/load01-b32-arm-p` | `6dbbf8d66a6f` | 2026-10-22 | لا |
| `exp/load01-b32-gate` | `archive/exp/load01-b32-gate` | `c2c78d2373b4` | 2026-10-22 | لا |
| `exp/load01-b33-measure` | `archive/exp/load01-b33-measure` | `44146f7ca397` | 2026-10-22 | لا |
| `exp/load01-b33m-aa` | `archive/exp/load01-b33m-aa` | `da8b05302aee` | 2026-10-22 | لا |
| `exp/load01-b33m-arm-c` | `archive/exp/load01-b33m-arm-c` | `63b20aa296b5` | 2026-10-22 | لا |
| `exp/load01-b33m-idle` | `archive/exp/load01-b33m-idle` | `665bdda51de7` | 2026-10-22 | لا |
| `exp/load01-b33m-idle-v2` | `archive/exp/load01-b33m-idle-v2` | `6a1e1f3a1280` | 2026-10-22 | لا |
| `exp/load01-b33mdis` | `archive/exp/load01-b33mdis` | `d8e27621640f` | 2026-10-23 | لا |
| `exp/load01-b33mtick` | `archive/exp/load01-b33mtick` | `7eedbb2e3c21` | 2026-10-23 | لا |
| `exp/load01-boot-ab` | `archive/exp/load01-boot-ab` | `6d67d7d9e220` | 2026-10-25 | لا |
| `exp/load01-boot-b` | `archive/exp/load01-boot-b` | `ea022af6bd08` | 2026-10-25 | لا |
| `exp/load01-c1-ab` | `archive/exp/load01-c1-ab` | `10c5e388ac18` | 2026-10-25 | لا |
| `exp/load01-c2-contact-ab` | `archive/exp/load01-c2-contact-ab` | `8e1d8038466d` | 2026-10-26 | نعم |
| `exp/load01-c2-http-wait-probe` | `archive/exp/load01-c2-http-wait-probe` | `dee9fdbe1725` | 2026-10-26 | لا |
| `exp/load01-claim-single-trip` | `archive/exp/load01-claim-single-trip` | `c3bf0ede66d1` | 2026-10-28 | لا |
| `exp/load01-claim-split` | `archive/exp/load01-claim-split` | `86534c72ead6` | 2026-10-27 | لا |
| `exp/load01-claim-wait` | `archive/exp/load01-claim-wait` | `d47881d7746b` | 2026-10-28 | لا |
| `exp/load01-cpuprof` | `archive/exp/load01-cpuprof` | `f75c999caca8` | 2026-10-25 | لا |
| `exp/load01-gap-probe-run3` | `archive/exp/load01-gap-probe-run3` | `e27f2d07da9e` | 2026-10-27 | نعم |
| `exp/load01-harness-overhead` | `archive/exp/load01-harness-overhead` | `1c79ebc377c1` | 2026-10-27 | لا |
| `exp/load01-location-merged-read` | `archive/exp/load01-location-merged-read` | `30b9be98ae45` | 2026-10-27 | لا |
| `exp/load01-notice-trace` | `archive/exp/load01-notice-trace` | `28929538ed4d` | 2026-10-27 | لا |
| `exp/load01-notice-trace-run` | `archive/exp/load01-notice-trace-run` | `499fbb2a7e4c` | 2026-10-27 | لا |
| `exp/load01-notice-trace-run2` | `archive/exp/load01-notice-trace-run2` | `5930fa996f7a` | 2026-10-27 | لا |
| `exp/load01-notice-trace-run3` | `archive/exp/load01-notice-trace-run3` | `f3889c30c7d9` | 2026-10-27 | لا |
| `exp/load01-notice-trace-run4` | `archive/exp/load01-notice-trace-run4` | `ed3d2293ecc0` | 2026-10-27 | لا |
| `exp/load01-notice-trace-run5` | `archive/exp/load01-notice-trace-run5` | `eece293c2170` | 2026-10-27 | لا |
| `exp/load01-reg-ab` | `archive/exp/load01-reg-ab` | `50142cf99098` | 2026-10-25 | لا |
| `exp/load01-reply-idx-ab` | `archive/exp/load01-reply-idx-ab` | `6e3e3d6adfd1` | 2026-10-25 | لا |
| `exp/load01-single-trip-run1` | `archive/exp/load01-single-trip-run1` | `ee619aa7d229` | 2026-10-28 | لا |
| `exp/load01m-5city` | `archive/exp/load01m-5city-20261030` | `0d6963faf18c` | 2026-10-25 | لا |
| `fix/audit-hardening-v1` | `archive/fix/audit-hardening-v1` | `8a4375ac53b3` | 2026-10-27 | نعم |
| `fix/claim-skip-tests-and-rollback-ref` | `archive/fix/claim-skip-tests-and-rollback-ref` | `44ed1fc4c70d` | 2026-10-18 | نعم |
| `fix/load01-b20-drainer-prefetch` | `archive/fix/load01-b20-drainer-prefetch` | `ae1b72758e16` | 2026-10-19 | لا |
| `fix/review-corrections-3` | `archive/fix/review-corrections-3` | `bb830478f341` | 2026-10-18 | نعم |
| `load01c2-probe-arm-A` | `archive/load01c2-probe-arm-A` | `30c9dae6110b` | 2026-10-26 | لا |
| `load01c2-probe-arm-B` | `archive/load01c2-probe-arm-B` | `3697d7a08024` | 2026-10-26 | لا |
| `load01gap-probe-arm-A` | `archive/load01gap-probe-arm-A` | `3bead32764ab` | 2026-10-26 | لا |
| `load01gap-probe-arm-B` | `archive/load01gap-probe-arm-B` | `50efec83f6ca` | 2026-10-26 | لا |
| `load01gap-run3-arm-A` | `archive/load01gap-run3-arm-A` | `63bc7b0fbe42` | 2026-10-27 | لا |
| `load01m/code-with-fix` | `archive/load01m/code-with-fix` | `8b4736cffb1a` | 2026-10-23 | لا |
| `perf/load01-b21-session-bootstrap-merge` | `archive/perf/load01-b21-session-bootstrap-merge` | `1bf824150a11` | 2026-10-20 | لا |
| `sandbox/capacity-reliability-20261015` | `archive/sandbox/capacity-reliability-20261015` | `c0f19b790fae` | 2026-10-15 | لا |
| `work/load01-b25-limit-100` | `archive/work/load01-b25-limit-100` | `4e0db40091fb` | 2026-10-20 | لا |
| `work/load01-b27-drainer-claim-prefetch` | `archive/work/load01-b27-drainer-claim-prefetch` | `b16db863c1ac` | 2026-10-21 | لا |
| `work/load01-b28-drainer-single-tx` | `archive/work/load01-b28-drainer-single-tx` | `933ad2b92792` | 2026-10-21 | لا |
| `work/load01-b30-location-hold` | `archive/work/load01-b30-location-hold` | `d6c443dc10e1` | 2026-10-21 | لا |
| `work/load01-b31-drainer-claim-ahead` | `archive/work/load01-b31-drainer-claim-ahead` | `997b05d06210` | 2026-10-21 | لا |
| `work/load01-b31-sched-plus-drainer` | `archive/work/load01-b31-sched-plus-drainer` | `161890c82287` | 2026-10-21 | لا |
| `work/load01-p4-fixes` | `archive/work/load01-p4-fixes` | `16178a58d7e6` | 2026-10-18 | لا |
| `work/load01-throughput` | `archive/work/load01-throughput` | `a360d8dc6c54` | 2026-10-18 | لا |

المجموع: 65 فرعًا.
