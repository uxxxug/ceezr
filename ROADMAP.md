# WASLA MOVE — Roadmap

**Repository:** `uxxxug/ceezr` (this repository is WASLA MOVE)
**Last updated:** 2026-09-12 (F2-01 welcome and consent record)
**Last milestone:** `F2-01` — the first product screen in this repository, with
consent stored as an append-only versioned row (`user_consents`, `city_id` not
null, RLS enabled, atomic RPCs), `GET`/`POST /v1/consents`, 31 dictionary keys in
three languages, and a new `check-consent-documents` guard in CI. Measured, not
verified: `F2-01` is **not** `[x]` and the `F2` gate (a real-device ride on video)
is untouched. Evidence: `docs/evidence/architecture/F2-01-CONSENT-20260912.md`.

> **Superseded status line (kept, additive — `ح-8`).** Until 2026-09-12 this
> header read: «Last updated: 2026-09-11 (W-1 boundary audit · OPS-011 CI
> repair) · Last milestone: `W-1` boundary audit landed as a machine-checked
> registry; first real CI verdict read and its two failures root-caused
> (`OPS-011`) (`scripts/lib/wasla-boundary-registry.ts` +
> `scripts/check-boundary-audit.ts`, ADR-0080). Still no application code, no
> migration and no CORE traffic.» The last sentence is what `F2-01` changed.

> **Correction (2026-09-11, additive — nothing below is deleted).** Earlier
> entries in this file record the canonical remotes under the `noor-seez`
> account. The live remotes are `uxxxug/ceezr` (this repository) and
> `uxxxug/wasla-core`; `noor-seez/ceezr` does not resolve. The consequence is
> recorded in "Done" below: the account-level Actions block is a property of
> the old account, so a real CI verdict is obtainable here. The original
> statements are kept in place as the record of what was believed when they
> were written.

## What this project is

WASLA MOVE is the field execution system of WASLA. It is a permanently
independent repository with its own code, data, tests, CI and releases.

```
MARKET creates the work.  MOVE executes the work.  CORE coordinates it.
```

| System | Repository | Role |
|---|---|---|
| WASLA CORE | `uxxxug/wasla-core` | shared operating layer and coordinator |
| WASLA MOVE | `uxxxug/ceezr` | this repository — field execution |
| WASLA MARKET | `skyosv10-art/wasla` | commerce |

No monorepo, no merged repositories, no shared runtime package, no
cross-database access between the three.

## Ownership boundary

**MOVE owns:** drivers and driver profiles, capabilities, eligibility,
availability, vehicles and vehicle qualification, fleets and fleet operations,
Operational Jobs, Rides, delivery execution, dispatch, matching, offers,
assignment, tracking and route/execution state, Proof of Delivery, safety and
SOS, driver and rider operational surfaces, operational admin functions.

**MOVE does not own:** identity, sessions, principals, roles and permissions,
organizations and tenancy, payments, wallets, ledger, settlement,
subscriptions and entitlements, reputation scoring, notification delivery,
channel abstraction, audit of shared concerns, fulfillment coordination
(all CORE) — nor merchants, stores, products, catalog, inventory, commercial
orders or marketplace search (all MARKET).

**Canonical model:** a Ride is a kind of Operational Job. A Delivery is a kind
of Operational Job. An Operational Job is never a Commercial Order.

## Current state of this repository (observed, not assumed)

- Bun workspace; `apps/`: `gateway`, `workers`, `miniapp`, `admin`,
  `admin-dashboard`. `packages/`: `domain`, `application`, `infrastructure`,
  `shared`, `maps`, `tracking`, `agent-core`.
- Supabase/PostgreSQL migrations under `supabase/`.
- One CI workflow: `.github/workflows/ci.yml`.
- Layered modular monolith: domain / application / infrastructure.

## Done

- [x] Roadmap established at the repository root.
- [x] Roadmap-freshness gate (`scripts/check-roadmap.mjs` +
      `.github/workflows/roadmap.yml`): a push that changes implementation and
      does not update this file fails CI.
- [ ] Gate proven on a live CI run — **not proven here**: GitHub Actions is
      currently blocked on this account with "The job was not started because
      recent account payments have failed or your spending limit needs to be
      increased." Every workflow run in this repository, including runs from
      before this change, fails at job start for that reason. The gate is
      proven on the MARKET repository, where Actions does run (see below).
      **Superseded 2026-09-11 (see the correction at the top):** that block
      belongs to the `noor-seez` account. On `uxxxug/ceezr` both workflows are
      active and the repository had zero runs of any kind, so the `W-1` push is
      the first push here that can produce a verdict. The verdict actually read
      after the push is recorded in
      `docs/evidence/architecture/W-1-20260911.md` — not inferred from a local
      green run.
- [x] **Roadmap-freshness gate proven on a real CI run** (added 2026-09-11,
      additive — the unchecked line above is kept as the historical record and
      is not deleted). Run `34617842960` on `66d733d` concluded `success`: the
      `W-1` push touched `scripts/`, `docs/` and `package.json` and did update
      this file, so the gate passed. Verdict read per job from the API.
- [x] **`W-1` — Boundary audit.** Every table in `supabase/migrations`
      classified `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE` with owner and
      rationale, plus a column-level layer for boundary breaches inside tables
      that stay. Source of truth is
      `scripts/lib/wasla-boundary-registry.ts`; `docs/wasla/boundary-audit.md`
      is generated from it; `scripts/check-boundary-audit.ts` fails CI if a
      table is unclassified, a registry entry is dead, a declared column does
      not exist, or the document diverges from the registry.
      Tally: `KEEP=14` · `REFACTOR=12` · `MOVE_TO_CORE=18` · `RETIRE=0` over 44
      tables. Decision: ADR-0080. Evidence:
      `docs/evidence/architecture/W-1-20260911.md`.
      **Classification is not permission to migrate:** zero rows moved, and
      "Migrated" below is still empty.

- [x] **`OPS-011` — Two stale integration assertions repaired** (test-side
      only; see `docs/ROADMAP-MASTER.md` §11-د). The first real CI run in this
      repository (`34617842924`) failed the real-database job on two assertions
      that predate the WASLA work and had never been executed here, because
      this repository had never run Actions and the integration suite
      self-skips without `TEST_DATABASE_URL`.
      (a) `tests/integration/driver-location-batch-persist.test.ts` case 9 sent
      `JSON.stringify(batch)` into a `::jsonb` slot; `postgres.js` serialises
      the value itself for a `jsonb` cast, so the payload was encoded twice and
      reached `persist_driver_location_batch` as a JSON *string* — the function
      correctly answered `BATCH_MUST_BE_ARRAY`, and the ADR-0076 fallback the
      case is named after was never exercised. A second, masked defect: the
      verdict field was spelled `quality` while the SQL reads `verdict`. Fixed
      with `sql.json(...)`, which is the same path the production adapter uses
      (`packages/infrastructure/geo/driver-location-batch-persistence.ts:73`).
      (b) `tests/integration/worker-service-separation.test.ts:238` asserted a
      free-form Arabic sentence that `F8-03` / ADR-0078 replaced with the
      structured log `{"event":"embedded_worker.disabled",...}`. The assertion
      now matches the dotted latin event code enforced by
      `scripts/check-structured-logging.ts` — stronger, not weaker; the
      governing `expect(beat).toBe(false)` is untouched.
      No function, migration, application file, gate, timeout or coverage floor
      was changed, and no test was skipped. Evidence:
      `docs/evidence/correctness/OPS-011-20260911.md`.
      **CI verdict, read per job from the API after the push** (`d550b93`, runs
      `34621144803` / `34621149899` / `34621144580`): the real-database job is
      now `success` with **638 pass / 11 skip / 0 fail** across 84 files, up
      from 636/11/2 — two more passes because the two failures became passes,
      not because a test was added. The e2e step, which never ran in the
      previous run because the job aborted before it, ran and passed (8 pass /
      0 fail), and both no-silent-skip gates exited `0`. `verify`,
      `chaos-multi-instance` and the roadmap-freshness workflow are `success`.
- [ ] **`real-redis` CI job cannot pass in this repository — environment
      blocker, not a code defect.** The job runs with `REQUIRE_REAL_REDIS=1`
      and `tests/support/real-redis.ts:52` refuses to proceed without a real
      Redis, which is exactly what `OPS-006` requires; the guard must not be
      weakened, silenced or reclassified as a skip. `UPSTASH_REDIS_REST_URL`
      and `UPSTASH_REDIS_REST_TOKEN` were configured on the old `noor-seez`
      repository and are absent from `uxxxug/ceezr`. Provisioning an Upstash
      account and setting repository secrets is outside the agent's authority.
      Set both secrets, re-run, then record the verdict.

Nothing else has been changed in this repository by the WASLA integration work.

## In progress

### Reservation `F3-05` — الأرباحُ والأداءُ: **لا مالَ يُخترَعُ، ولا ترتيبٌ يُهَدَّدُ بهِ** (opened 2026-09-15, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`4033ca1` فرعاً `feat/f3-05-driver-activity-transparency`.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F3-05` في §9.6 حرفاً: «`SD-06` + `SD-09` الأرباحُ والأداءُ بشفافيةٍ». ونصُّ `SD-06` في §9.5: «يومي/أسبوعي/شهري، عدد الرحلات، ساعات التواجد، جدول تفصيلي، **بلا وعود غير محسوبة**»، و`SD-09`: «نسبة القبول، نسبة الإلغاء، متوسط التقييم، **سلوكيات تُنقص الترتيب — بشفافية كاملة**». |
| **الحقيقةُ المُرَّةُ الأولى: لا مالَ في المخطَّطِ** | لا عمودَ أجرةٍ في `orders` ولا في `order_offers` — والمنصّةُ **لا تتوسّطُ نقداً** (`ADR 0039` §٤ · `DEC-11`). فالبندُ يُسمّى «الأرباحُ» ولكنَّ **الرقمَ المالِيَّ غيرُ موجودٍ ولا يُشتَقُّ**. والمخرَجُ الصادقُ: **طبقةٌ غائبةٌ بإعلانٍ** — كما فُعِلَ بـ«التقديرِ» في `F3-02` (`ADR 0117` §٣) — لا صفرٌ ولا «قريباً» ولا رقمٌ مضروبٌ في تعرفةٍ متخيَّلةٍ. **ووعدٌ غيرُ محسوبٍ هوَ بعينِه ما يمنعُه نصُّ البندِ.** |
| **الحقيقةُ المُرَّةُ الثانيةُ: لا سلوكَ يُنقِصُ الترتيبَ اليومَ** | معادلةُ الترتيبِ في `packages/domain/dispatch/entity.ts` ثلاثةُ عواملَ فحسبُ: قُربٌ · تقييمٌ مِعياريٌّ (بحدِّ ثقةٍ وقيمةٍ افتراضيّةٍ) · منطقةٌ مفضّلةٌ (وزنُها صفرٌ مبذوراً). **ولا نسبةَ قبولٍ ولا نسبةَ إلغاءٍ تدخلُ النقاطَ إطلاقاً.** فكتابةُ «هذهِ السلوكيّاتُ تُنقِصُ ترتيبَك» **كذبةٌ**، وشفافيّةٌ كامِلةٌ تعني: تُنشَرُ **العواملُ الفعليّةُ بأوزانِها المقروءةِ من إعدادِ المدينةِ**، ويُقالُ صريحاً إنَّ نسبتَي القبولِ والإلغاءِ **تُقاسانِ وتُعرَضانِ ولا تُؤثِّرانِ في الترتيبِ اليومَ**. |
| وما يمنعُ العرضَ فعلاً يُنشَرُ | أسبابُ الاستبعادِ العشرةُ المُنفَّذةُ (`rejectionReasonFor`): `BLOCKED` · `NOT_VERIFIED` · `NOT_AVAILABLE` · `NO_LOCATION` · `STALE_LOCATION` · `SERVICE_NOT_ENABLED` · `NO_LIVE_SUBSCRIPTION` · `OUT_OF_RADIUS` · `EXCLUDED_THIS_ROUND` · `CITY_MISMATCH`. **هذهِ هيَ «ما يُنقِصُ حظَّك» الحقيقيُّ** — مُنفَّذٌ ومُنفَذٌ آلياً، لا نصيحةٌ أخلاقيّةٌ. |
| مصدرُ كلِّ رقمٍ (القاعدة: أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ) | الرحلاتُ المُكتمِلةُ ⇐ `orders(assigned_driver_id, status='completed', completed_at)` · ساعاتُ التواجدِ ⇐ **أزواجُ** `attendance_log(driver_id, is_available, changed_at)` تُجمَعُ في الخادمِ بقصٍّ على نافذةِ المُدّةِ · العروضُ والقبولُ ⇐ `order_offers(status, responded_at)` · التقييمُ ⇐ `ratings(ratee_user_id, stars, is_flagged=false)` · الأوزانُ ⇐ `platform_settings`. **ولا عمودَ مُجمَّعَ يُخزَّنُ**: لا كاتبَ ثانياً لحقيقةٍ مُشتقّةٍ. |
| النِسَبُ تُنشَرُ بمقامِها | كلُّ نسبةٍ `{numerator, denominator, rate}` و**`rate = null` عندَ مقامٍ صفرٍ** — لا `0%` تُقرأُ إخفاقاً ولا `100%` من عرضٍ واحدٍ. وكذا التقييمُ: `{average, count}` معَ `count` منشوراً دائماً، ودونَ حدِّ الثقةِ يُنشَرُ `average` **وَسْمُهُ** `BELOW_TRUST_THRESHOLD` بالحدِّ نفسِه المقروءِ من الإعدادِ. |
| النافذةُ حقيقةُ خادمٍ | `day`/`week`/`month` تُحسَبُ **في الخادمِ** بمنطقةِ زمنِ المدينةِ، ويُنشَرُ `window {from, to}` معَ `server_time` — **ولا حسابَ تواريخَ في العميلِ** ولا `expires_at` ولا ساعةَ جهازٍ في حكمٍ. |
| النطاقُ المحجوزُ | `supabase/migrations/20260915140000_f3_05_driver_activity_summary.sql` (جديدةٌ: `driver_activity_summary(uuid,text,timestamptz)` و`driver_activity_entries(uuid,text,int)` منزوعتَي التنفيذِ عن `anon`/`authenticated`) · `packages/domain/driver/activity.ts` (جديدٌ: النِسَبُ والوُسومُ دوالَّ نقيّةً) · `packages/infrastructure/driver/driver-activity-store.ts` (جديدٌ) · `apps/gateway/src/routes/driver-activity.ts` (جديدٌ: `GET /v1/driver/activity`) وتركيبُه · `apps/miniapp/src/surfaces/driver/activity/*` (جديدٌ) وتركيبُه في `DriverRoot.tsx` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `apps/miniapp/src/styles/global.css` (كتلةٌ جديدةٌ `dac`) · `scripts/lib/driver-activity-contract.ts` و`scripts/check-driver-activity-contract.ts` وخطوتُه في `verify`/`ci` و`.github/workflows/ci.yml` · `tests/unit/*` · `tests/integration/driver-activity.test.ts` · `scripts/lib/skip-registry.ts` و`tests/unit/skip-audit.test.ts` (أرضيّاتٌ بالزيادةِ) · `scripts/lib/rollback-registry.ts` · `docs/adr/0120-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | معادلةُ الترتيبِ نفسُها (**تُقرأُ ولا تُعدَّلُ**) · `order_offers` وكاتبُها `claim_ride` · `ledger_entries` و`payment_transactions` و`subscription_*` (الاشتراكُ بندٌ آخرُ `F3-06`) · `driver_active_job` وبثُّ الموقعِ (`F3-04`) · سطحُ الراكبِ · لوحةُ الإدارةِ |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`) ولا سائقَ حقيقيَّ: **صدقُ الأرقامِ يُقاسُ على بياناتٍ مبذورةٍ في محرِّكٍ حقيقيٍّ**، لا على سلوكِ سائقٍ في الشارعِ. ولا يُدَّعى أنَّ السائقَ سيفهمُ الشفافيّةَ أو يرضاها — ذلكَ قياسٌ ميدانيٌّ مُؤجَّلٌ. و`مَقيس` و`مُثبَت` لا يُدَّعيانِ، و`[x]` لا تُكتَبُ قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-4`). |

### Reservation `F3-04` — بثُّ الموقعِ التكيّفيُّ: **نبضةٌ لها سببٌ منشورٌ، لا مؤقّتٌ في العميلِ** (opened 2026-09-15, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`51ae56f` فرعاً `feat/f3-04-adaptive-location-broadcast`،
وحُكمُ CI على ذاكَ الالتزامِ **أخضرُ في الشغلتَينِ** (`34936675739` و
`34936675716`) — قُرِئَ من GitHub قبلَ القطعِ لا بعدَه.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F3-04` في §9.6 حرفاً: «بثُّ الموقعِ التكيّفيُّ من الواجهةِ عبرَ `LocationManager`». والكلمةُ الحاكمةُ **«التكيّفيُّ»**: نبضةٌ تتغيّرُ بحالِ السائقِ، لا مؤقّتٌ ثابتٌ يُشعِلُ بطاريّةً ويكتبُ صفوفاً بلا سببٍ. |
| التبعيّةُ المُستوفاةُ | **المستقبِلُ قائمٌ ومُدمَجٌ**: `POST /v1/driver/location` (`F4-01`) بحدِّ معدَّلٍ وحدِّ حجمٍ و`parseDriverFix` و`updateDriverLocation` — يُجيبُ `{accepted, verdict, recordedAtMs, dispatchable}` أو `FIX_REJECTED{findings}` أو `{accepted:false, reason:"STALE"}`. **فلا يُبنى مستقبِلٌ ثانٍ**، ولا تُعدَّلُ حكومتُه. و`tg/location.ts` (`F1-02`) غلافٌ رقيقٌ كتبَ في رأسِه أنَّ سياسةَ البثِّ **`F3-04` وليست فيه** — الحدُّ مُستَلَمٌ لا مُختَرَعٌ. |
| مصدرُ الحقيقةِ للنبضةِ (القاعدة: أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ) | **الخادمُ يُنشِرُ النبضةَ، والعميلُ يُطيعُ**. فتُوسَّعُ حمولةُ `GET /v1/driver/job` القائمةُ بكتلةٍ `location_broadcast: {reason, interval_seconds}` — لا مسارٌ جديدٌ ولا نداءٌ ثانٍ: الشاشةُ تقرأُ المَهمّةَ أصلاً. **وثلاثُ مُدَدٍ تُقرأُ من `platform_settings`** بمدينةٍ (`location_broadcast_seconds_available`/`_matched`/`_on_trip`) لا من ثوابتَ في شيفرةٍ، فتُضبَطُ بلا نشرِ حزمةٍ. |
| والغيابُ يُنشَرُ غياباً | `interval_seconds = null` **يعني «لا تبثَّ»** لا «بُثَّ صفراً» (`ADR 0023`): لا جلسةَ، أو ليسَ سائقاً، أو غيرَ متاحٍ ولا مَهمّةَ له، أو **إعدادُ مدينةٍ غائبٌ**. وفشلٌ مغلقٌ ههنا صادقٌ: نبضةٌ بمُدّةٍ مُخترَعةٍ في العميلِ أسوأُ من سكونٍ مُعلَنٍ. |
| القرارُ دالّةٌ نقيّةٌ تُقاسُ | `nextBroadcastDecision({policy, nowMs, lastAcceptedAtMs, lastAttemptAtMs, consecutiveFailures, access})` ⇒ `SEND` أو `WAIT{delayMs}` أو `STOP{why}` — **بلا ساعةٍ داخليّةٍ ولا مؤقّتٍ ولا شبكةٍ**: الزمنُ مُعطىً والحكمُ مقروءٌ. فتُقاسُ كلُّ فروعِه باختبارِ وحدةٍ لا بمُهلٍ. |
| التراجعُ عندَ الفشلِ | تضاعُفٌ مُقيَّدٌ (`interval × 2^failures` بسقفٍ) وسقوطٌ إلى السكونِ عندَ رفضٍ لا تُصلِحُه إعادةٌ (`DRIVER_NOT_REGISTERED` · `SESSION_*`). و`FIX_REJECTED` **ليسَ عطلَ شبكةٍ**: إصلاحةٌ رُفِضَت لجودتِها فلا تُعادُ بذاتِها. و`STALE` **ليسَ فشلاً** (`accepted:false` وحالُ القاعدةِ سليمٌ) فلا يُضاعِفُ تراجُعاً. |
| الإذنُ حالٌ تُعرَضُ لا تُفترَضُ | حالاتُ `locationAccess()` الأربعُ تُقرأُ كما هيَ؛ ومنعُ الإذنِ **يُقالُ للسائقِ بنصٍّ** ويُفتَحُ له لوحُ الإعداداتِ، ولا يُزعَمُ بثٌّ ولا يُستبدَلُ موضعٌ بمركزِ مدينةٍ. |
| وما لا يُبنى ههنا | لا تتبُّعَ حيَّ للراكبِ (`ADR 0035` §٤ · عائقُ `F2-06` يبقى) · ولا خريطةَ · ولا عملٌ في الخلفيّةِ بعدَ إغلاقِ المصغَّرِ (مستحيلٌ تقنيّاً في Mini App، ويُعلَنُ لا يُوارى) · ولا `Idempotency-Key` على مسارِ الموقعِ (إصلاحةٌ مكرَّرةٌ تُصفّى بـ`STALE`). |
| النطاقُ المحجوزُ | `supabase/migrations/20260915120000_f3_04_location_broadcast_policy.sql` (جديدةٌ: بذرُ الإعداداتِ الثلاثةِ + `create or replace driver_active_job` بكتلةِ البثِّ) · `packages/domain/driver/location-broadcast.ts` (جديدٌ: القرارُ النقيُّ) · `packages/domain/driver/driver-job.ts` و`packages/infrastructure/driver/driver-job-store.ts` و`apps/gateway/src/routes/driver-job.ts` (حملُ الكتلةِ الجديدةِ **إضافةً**) · `apps/miniapp/src/surfaces/driver/location/*` (جديدٌ) وتركيبُه في `DriverRoot.tsx` و`job-contract.ts` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `apps/miniapp/src/styles/global.css` (كتلةٌ جديدةٌ) · `scripts/lib/location-broadcast-contract.ts` و`scripts/check-location-broadcast-contract.ts` وخطوتُه في `verify`/`ci` و`.github/workflows/ci.yml` · `tests/unit/*` · `tests/integration/driver-location-broadcast.test.ts` · `scripts/lib/skip-registry.ts` و`tests/unit/skip-audit.test.ts` (أرضيّاتٌ بالزيادةِ) · `docs/adr/0119-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | جسمُ `updateDriverLocation` وحكومةُ `F4-01` (تُنادى ولا تُعدَّلُ) · `driver_mark_arrived`/`start_ride`/`complete_ride` · سطحُ الراكبِ · الأرباحُ (`F3-05`) والاشتراكُ (`F3-06`) · مزوّدُ خرائطَ · حدُّ المعدَّلِ في البوّابةِ |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`) ولا جهازَ حقيقيَّ: **صدقُ الموقعِ ميدانيّاً لا يُقاسُ ههنا** ولا استهلاكُ بطاريّةٍ. المقيسُ: أنَّ النبضةَ **لا تُخترَعُ في العميلِ**، وأنَّ كلَّ فرعِ قرارٍ مقروءٌ باختبارٍ، وأنَّ الخادمَ يُنشِرُها من إعدادِ مدينةٍ. و`مَقيس` و`مُثبَت` لا يُدَّعيانِ، و`[x]` لا تُكتَبُ قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-4`). |

### Reservation `F3-03` — الرحلةُ النشطةُ للسائقِ: **طَورٌ لا يُخترَعُ**، ولكلِّ انتقالٍ كاتبُه القائمُ (opened 2026-09-15, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`88f3473` فرعاً `feat/f3-03-driver-active-ride`، وحُكمُ CI على
ذاكَ الالتزامِ **أخضرُ في الشغلتَينِ** (`34929312604` و`34929312642`) — قُرِئَ من
GitHub قبلَ القطعِ لا بعدَه، كي لا يُحمَلَ أحمرُ سابقٌ على هذا العملِ ولا يُخفى به.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F3-03` — `SD-05` في §9.6 حرفاً: «ملاحةٌ إلى نقطةِ الالتقاطِ ثمَّ الوجهةِ، أزرارُ المراحلِ (وصلتُ / بدأتُ الرحلةَ / أنهيتُ)، بياناتُ الراكبِ المسموحةُ، SOS، الإبلاغُ عن مشكلةٍ»، وفعلُه الأساسيُّ **«زرُّ المرحلةِ الحاليّةِ»**. |
| التبعيّةُ المُستوفاةُ | `F3-02` مُنفَّذٌ `[~]` ومُدمَجٌ في `main` (`88f3473`): القبولُ يُنتِجُ طلباً `matched` مُسنَداً إلى السائقِ — **وهوَ مدخلُ هذا البندِ**. وثلاثةُ ملفّاتٍ من `F3-02` كتبَت صريحاً أنَّ `SD-05` **يُضافُ منفذاً وطريقاً ومحوّلاً** ولا يُوسَّعُ جوابُ القبولِ: الحدُّ مُستَلَمٌ لا مُختَرَعٌ. |
| الكاتبُ الواحدُ لكلِّ انتقالٍ (القاعدة 0.6) | **`start_ride(uuid, bigint)` و`complete_ride(uuid, bigint)` قائمتانِ** منذُ `20260807170000`/`20260808120000`: تقفلانِ الصفَّ `for update`، وتكتبانِ `audit_log`، وتُعيدانِ الطرفَينِ. فـ`driver_start_ride`/`driver_complete_ride` **تُفوِّضانِ إليهما ولا تنسخانِ ذرّيّةً** — و`update orders set status` **لا يُكتَبُ في هذه الهجرةِ لهذَينِ الطَورَينِ ألبتّةَ**. |
| الطَورُ الوحيدُ الذي **لا كاتبَ لهُ** | «وصلتُ». `orders` فيها `matched_at` و`started_at` و`completed_at` **ولا `arrived_at`** — وهذا **عائقٌ مُعلَنٌ في `F2-06`** بنصِّه (وفي §25 بتاريخِ 2026-09-13). فيُضافُ العمودُ ههنا وكاتبُه `driver_mark_arrived`، **ويُقفَلُ بذلكَ أحدُ عائقَي `F2-06`** تصحيحاً **بالإضافةِ** لا بمحوٍ (`ح-8`) — والعائقُ الثاني (لا تتبُّعَ حيَّ · `ADR 0035` §٤) **يبقى كما هوَ ولا يُدَّعى إغلاقُه**. |
| ولماذا لا يُشتَقُّ الطَورُ من قُربِ مسافةٍ | «قاربَ السائقُ» ليسَ «وصلَ». ورسمُ مرحلةٍ لم تحدثْ كذبٌ على الراكبِ، **وقد نصَّت هجرةُ `F2-06` على هذا المنعِ بحرفِه**. فالطَورُ **ختمُ فعلِ إنسانٍ** في عمودٍ، لا استنتاجُ SQL من `st_distance`. |
| العقودُ | خمسةٌ **جديدةٌ** لا يَذكرُها §10: `GET /v1/driver/job` · `POST /v1/driver/job/arrived` · `POST /v1/driver/job/start` · `POST /v1/driver/job/complete` — وتُسجَّلُ بالإضافةِ في §10.2 من `docs/ROADMAP-MASTER.md`. **ولا `PATCH /orders/:id`**: السائقُ لا يملكُ صفَّ الطلبِ، يملكُ مَهمّةً أُسنِدَت إليه. |
| المِلكيّةُ قيدُ استعلامٍ لا فحصُ طبقةٍ (القاعدة 0.5) | كلُّ دالّةٍ تشترطُ `assigned_driver_id = v_driver.id` **في `where`**، ومَهمّةُ غيرِه تُرَدُّ بالرمزِ الذي يُرَدُّ به معرِّفٌ معدومٌ (`JOB_NOT_FOUND`) — فلا يُكشَفُ وجودُ صفٍّ لمَن لا يملكُه. |
| «بياناتُ الراكبِ المسموحةُ» — حدُّها مكتوبٌ | يُنشَرُ **الاسمُ الأوّلُ** وحدَه ولغةُ الخطابِ وملاحظتُه ونقطتاه. **ولا رقمَ هاتفٍ** (`F2-06` منعَه: الاتصالُ المُقنَّعُ غيرُ مبنيٍّ، وعرضُ رقمٍ خاصٍّ قرارُ خصوصيّةٍ لا قرارُ واجهةٍ) **ولا معرِّفَ تلغرامَ للراكبِ في حمولةِ السلكِ**. |
| SOS والإبلاغُ عن مشكلةٍ | **بابانِ قائمانِ يُوصَلانِ ولا يُبنَيانِ من جديدٍ**: `sos_surface_state` (`F2-10` `[x]`) و`support` (`F2-12`). وإن لم يَقبَلْ بابٌ قائمٌ دورَ السائقِ فـ**لا زرَّ رماديَّ يُرسَمُ**: غيابٌ مُصرَّحٌ في الشاشةِ وسطرٌ في الدليلِ — فوعدُ سلامةٍ كاذبٌ أخطرُ من غيابٍ مُعلَنٍ. |
| الملاحةُ | **رابطُ ملاحةٍ خارجيٌّ لا خريطةٌ مدمَجةٌ**: لا مزوّدَ خرائطَ في حزمةِ التطبيقِ المصغَّرِ (`ADR 0007`)، وحاجزُ `check-egress-boundary` (`W-6`) يمنعُ مضيفاً غيرَ مُعلَنٍ. فنصفُ البندِ المرئيُّ (خريطةٌ ملءَ الشاشةِ) **غيرُ مُدَّعىً** ويُسجَّلُ دَيناً مُعلَنًا. |
| النطاقُ المحجوزُ | `supabase/migrations/20260915030000_f3_03_driver_active_job.sql` (جديدةٌ) · `packages/domain/driver/driver-job.ts` · `packages/application/driver/driver-job.ts` و`job-ports.ts` · `packages/infrastructure/driver/driver-job-store.ts` · `packages/infrastructure/db/schema-contract.ts` (تسجيلُ الجديدِ لا تعديلُ القديمِ) · `apps/gateway/src/routes/driver-job.ts` وتركيبُها في `container.ts`/`server.ts`/`index.ts` · `apps/miniapp/src/surfaces/driver/job/*` وتركيبُها في `DriverRoot.tsx` و`OfferDetailScreen` · `apps/miniapp/src/styles/global.css` (أصنافٌ جديدةٌ) · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `scripts/check-driver-job-contract.ts` و`scripts/lib/driver-job-contract.ts` وخطوتُه في `verify`/`ci` و`.github/workflows/ci.yml` · `tests/integration/driver-job.test.ts` · `tests/unit/check-driver-job-contract.test.ts` · `docs/adr/0118-*` · `docs/evidence/architecture/F3-03-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | جسمُ `start_ride`/`complete_ride`/`claim_ride` (تُنادى ولا تُعدَّلُ) · ملفّاتُ `F3-02` (تُقرأُ ولا تُعدَّلُ إلّا مدخلَ الشاشةِ) · `F3-04` بثُّ الموقعِ · الأجرةُ والدفعُ (مُجمَّدانِ · `ADR 0039` §٤ · `م13-7` · `DEC-11`) · مزوّدُ خرائطَ · التقييمُ (`F2-07`) |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`)، فما يُبنى ههنا **لم يفتحْه سائقٌ حقيقيٌّ**. و`مَقيس` و`مُثبَت` **لا يُدَّعيانِ**، و`[x]` **لا تُكتَبُ قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ على `main`** (`ح-4`). وبوّابةُ `F3` **غيرُ مُدَّعاةٍ**. |

### Reservation `F2-03` — اختيارُ الوجهةِ: بحثٌ نصّيٌّ ودبّوسٌ ومنطقةُ خدمةٍ تُفحَصُ في القاعدةِ (opened 2026-09-13, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`2c7c6a7` فرعاً `feat/f2-03-destination-selection`، وحُكمُ CI
على ذاكَ الالتزامِ **أخضرُ** في الشغلتَينِ (`34739865218` و`34739865251`) — قُرِئَ
قبلَ القطعِ لا بعدَه، كي لا يُحمَلَ أحمرُ سابقٌ على هذا العملِ ولا يُخفى به.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-03` — `SR-03` في §9.5 حرفاً: «بحثٌ نصّيٌّ + اختيارٌ من الخريطةِ + دبّوسٌ قابلٌ للسحبِ معَ تأكيدِ العنوانِ + موقعي الحاليُّ»، وفعلُه الأساسيُّ «تأكيدُ الوجهةِ». لا شيءَ منه قائمٌ على `main`، فهذا بناءٌ لا قراءةٌ. |
| التبعيّةُ المُستوفاةُ | `F2-02` مُغلَقٌ `[x]`، و`place-kinds.ts` نفسُه أحالَ فحصَ «هل النقطةُ داخلَ المدينةِ» إلى هذا البندِ نصّاً. فالحدُّ مُستَلَمٌ لا مُختَرَعٌ. |
| العقودُ | عقدانِ **جديدانِ** لا يَذكرُهما §10 ولا §10.1: `GET /v1/destinations/search` و`POST /v1/destinations/resolve`. ويُسجَّلانِ بالإضافةِ في §10.2 من `docs/ROADMAP-MASTER.md` — الطريقُ الذي صمَّمَته §10.1 لشاشةٍ بلا نقطةٍ تخدمُها، لا بمسِّ جدولِ §10. |
| لماذا لا مزوّدَ عناوينَ خارجيّاً | `O-7` منتَجٌ **مستقلٌّ**، وحاجزُ `check-egress-boundary` (`W-6`) يمنعُ مضيفاً غيرَ مُعلَنٍ. فالبحثُ النصّيُّ يُخدَمُ من بياناتٍ يملكُها المستودَعُ: أماكنُ المستخدمِ المحفوظةُ، ووجهاتُه الأخيرةُ، ودليلُ معالمَ (`destination_landmarks`) مملوكٌ ههنا لمدينةٍ مُفعَّلةٍ. ومزوّدُ ترميزٍ جغرافيٍّ خارجيٌّ يبقى **طبقةً غائبةً مُعلَنةً** لا ثغرةً صامتةً. |
| لماذا التطبيعُ العربيُّ في القاعدةِ | «جده» و«جدّة» و«جدة» مدخلُ مستخدمٍ واحدٌ في ثلاثِ صورٍ. فلو طُبِّعَ في الشِّفرةِ وحدَها لَبَقِيَ الفهرسُ على النصِّ الخامِّ ولَمَسَحَ البحثُ الجدولَ كلَّه. فالتطبيعُ دالّةٌ `immutable` في القاعدةِ، وعمودٌ مُولَّدٌ منها، وفهرسٌ عليه؛ ونسخةُ النطاقِ في `packages/domain/destinations` تُطابِقُها **جدولَ حروفٍ بجدولِ حروفٍ** بحاجزٍ، وتُطابِقُها **مخرَجاً بمخرَجٍ** على قاعدةٍ حقيقيّةٍ في اختبارِ التكاملِ. |
| الحدُّ المُعلَنُ للدبّوسِ | لا مزوّدَ خرائطَ في حزمةِ التطبيقِ المصغَّرِ (`ADR 0007` · حدُّ `F2-02` الأوّلُ). فالدبّوسُ **هندسةٌ حقيقيّةٌ** — نقطةٌ تُعدَّلُ وتُفحَصُ في القاعدةِ ضدَّ منطقةِ الخدمةِ — و**أساسُه المرئيُّ غائبٌ**، ولا يُرسَمُ مستطيلٌ يُوهِمُ خريطةً. فنصفُ البندِ المرئيُّ **غيرُ مُدَّعىً** ويُسجَّلُ دَيناً مُعلَنًا، لا يُطوى بصمتٍ. |
| «موقعي الحاليُّ» | يُقرأُ من غلافِ `tg/location.ts` القائمِ (`F1-02`) بحالاتِه الثلاثِ كما هيَ: مُتاحٌ · مرفوضٌ · غيرُ مُهيَّأٍ. ولا يُزعَمُ موقعٌ عندَ الرفضِ، ولا يُستبدَلُ بمركزِ مدينةٍ صامتاً. |
| النطاقُ المحجوزُ | `supabase/migrations/20260913170000..170300` · `packages/domain/destinations/*` · `packages/application/destinations/*` · `packages/infrastructure/destinations/*` · `apps/gateway/src/routes/destinations.ts` وتركيبُها في `server.ts` و`index.ts` · `apps/miniapp/src/surfaces/rider/destination/*` وتركيبُها في `RiderRoot.tsx` و`HomeScreen` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `scripts/check-destination-contract.ts` · `packages/shared/config/retention-policy.ts` و`scripts/lib/wasla-boundary-registry.ts` و`packages/infrastructure/db/schema-contract.ts` (تسجيلُ الجديدِ لا تعديلُ القديمِ) · الاختباراتُ · `docs/adr/0102-*` · `docs/evidence/architecture/F2-03-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | ملفّاتُ `F2-01` و`F2-02` (تُقرأُ ولا تُعدَّلُ إلّا تركيبَ الشاشةِ) · التسعيرُ وعرضُ السعرِ (`F2-04`) وإنشاءُ الرحلةِ (`F2-05`) · اختيارُ مزوّدِ خرائطَ · جدولُ `orders` · النصوصُ الحرفيّةُ الباقيةُ في `apps/miniapp` (دَينٌ مُعلَنٌ) |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`: حسابُ Render بلا خدمةٍ)، فما يُغلَقُ ههنا **لم يفتحْه مستخدمٌ حقيقيٌّ**. وبوابةُ `F2` (رحلةٌ كاملةٌ على جهازٍ حقيقيٍّ مسجَّلةٌ بالفيديو) **غيرُ مُدَّعاةٍ**، و`مَقيس` و`مُثبَت` لا يُدَّعيانِ. |

### Reservation `OPS-019` — شرطٌ مسبقٌ **مُستعارٌ** في سبعةِ ملفّاتِ تكاملٍ: أخضرُ رهنُ ترتيبِ التشغيلِ (opened 2026-09-15, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ. اكتُشِفَ وقتَ قراءةِ الحالةِ الفعليّةِ بجولةٍ
محلّيّةٍ كاملةٍ على PostgreSQL حقيقيٍّ، لا من تقريرٍ ولا من رسالةٍ سابقةٍ.

| الحقلُ | القيمةُ |
|---|---|
| المقيسُ | سبعةُ ملفّاتٍ تفتحُ خطّافَ `beforeAll` باستعلامِ `select … from cities c join city_service_areas … where c.is_active order by c.code limit 1` ثمَّ **تُوكِّدُ وجودَ صفٍّ**: `quote` · `active-ride` · `ride-request` · `ride-summary` · `ride-history` · `ride-share` · `rider-support-intake`. وبذرةُ الهجراتِ تُنشئُ مدنَ الإطلاقِ الخمسَ **معطَّلةً** (`is_active = false` · `F2-05`)، فالاستعلامُ **لا يجدُ شيئاً على قاعدةٍ نظيفةٍ**. |
| الأثرُ الحقيقيُّ | خضرةُ هذهِ الملفّاتِ **مُستعارةٌ** من ملفٍّ آخرَ يُفعِّلُ مدينةً ولا يُرجِعُها — لا من صحّةِ ما تقيسُ. وقِيسَ الأثرُ لا فُرِضَ: في الجولةِ المحلّيّةِ الكاملةِ أخفقَ `quote` بالسببِ عينِه بعدَ أن أعادَ `five-cities-launch` المدنَ إلى التعطيلِ في `afterAll` الخاصِّ به. فتبديلُ ترتيبِ الملفّاتِ — أو تشغيلُ ملفٍّ منفرداً، أو تمزيقُ الجولةِ على متوازياتٍ — يقلبُ الحكمَ بلا تغييرِ سطرٍ. وهذا **أخضرُ زائفٌ قائمٌ** في `تكامل على PostgreSQL حقيقي` اليومَ. |
| العلاجُ الجذريُّ | كلُّ ملفٍّ **يصنعُ شرطَه ويردُّه**: يختارُ مدينتَه بالرمزِ صراحةً، ويُفعِّلُها **مستوفياً** قيدَ `cities_active_requires_groups` لا مُخفِّفاً له، ويحترمُ الدليلَ الفريدَ على `city_service_areas (city_id) WHERE is_active`، ثمَّ يعيدُ ما بدَّلَه وحدَه في `afterAll`. والنمطُ المرجعيُّ قائمٌ في المستودَعِ سلفاً: `account-data-rights.test.ts` (يصنعُ مدينتَه) و`five-cities-launch.test.ts` (يردُّ خطَّ الأساسِ)، و`driver-documents.test.ts` بعدَ إصلاحِ هذا الفرعِ. |
| الإنفاذُ الآليُّ (**الشرطُ الأقوى**) | حاجزٌ ساكنٌ جديدٌ يمنعُ **عودةَ** النمطِ: أيُّ ملفِّ تكاملٍ يقرأُ `cities … where … is_active` بلا تفعيلٍ صريحٍ في الملفِّ نفسِه **يُسقِطُ البناءَ**، بحالاتٍ سالبةٍ مزروعةٍ لكلِّ قاعدةٍ (`ح-7`). فالإصلاحُ بلا حاجزٍ يعودُ في أوّلِ ملفٍّ قادمٍ. |
| النطاقُ المحجوزُ | خطّافا `beforeAll`/`afterAll` في السبعةِ وحدَها · `scripts/check-integration-city-precondition.ts` (جديدٌ) وخطوتُه المسمّاةُ في `verify` و`ci` · `tests/unit/` للحالاتِ السالبةِ · سطرُ سجلٍّ في `ROADMAP.md` · `ADR` جديدٌ لا مُعدَّلٌ (`ح-6`) |
| ما لا يُمَسُّ | لا توكيدَ أعمالٍ واحدٌ يُحذَفُ أو يُخفَّفُ · لا `skip` يُضافُ · لا قيدَ قاعدةٍ يُرخى · لا هجرةَ تُكتَبُ · لا بذرةَ تُبدَّلُ لتُفعِّلَ مدينةً افتراضاً (فذاكَ يُخفي العطبَ ويخالفُ `F2-05`) · لا شيفرةَ تطبيقٍ |
| ما لا يُدَّعى | ليسَ عطباً في المنتَجِ ولا في منطقِ أيِّ بندٍ؛ عطبُ **صدقِ قياسٍ** (الأولويّةُ ١ في تفويضِ المالكِ). وحتّى يُغلَقَ، لا تُقرأُ خضرةُ السبعةِ إثباتاً لِما تدّعي قياسَه. |

#### تصحيحٌ بالإضافةِ (`ح-8`) — النطاقُ المقيسُ **تسعةٌ وأربعونَ** لا سبعةٌ (2026-09-15)

الحجزُ أعلاهُ يبقى كما كُتِبَ ولا يُمحى. وهذا تصحيحُهُ بعدَ القياسِ: أوّلُ ما
بُنِيَ في الفرعِ `fix/ops-019-integration-city-precondition` كانَ **الحاجزَ**
نفسَهُ، فقرأَ المستودعَ فأعطى رقماً غيرَ الذي حُجِزَ.

| الحقلُ | ما حُجِزَ | ما قِيسَ |
|---|---|---|
| ملفّاتٌ **تستعيرُ** الشرطَ (القاعدةُ ١) | ٧ | **٨** — والثامنُ `destinations.test.ts`، وقد فاتَ الحجزَ لأنَّهُ لا يُفعِّلُ مدينةً أصلاً فلم يظهرْ في جولةِ الإخفاقِ |
| ملفّاتٌ **تُفعِّلُ ولا تردُّ** (القاعدةُ ٢) | لم تُحجَزْ | **٣٨** — وهيَ **مصدرُ** الخضرةِ المُستعارةِ لا ضحيَّتُها، فمن لم يُردَّ شرطُهُ ورَّثَهُ |
| أشكالُ التفعيلِ المختلفةُ في المستودعِ | لم تُقَسْ | **٩** أشكالٍ متمايزةٍ — بعضُها بـ`coalesce` وبعضُها يفرضُ، وبعضُها بالرمزِ وبعضُها بالمعرِّفِ |
| مجموعُ الخروقِ | — | **٣٩** خرقاً في ٩٦ ملفّاً |

وإعلانُ الافتراقِ ههنا شرطٌ قبلَ أيِّ تعديلٍ زائدٍ على النطاقِ المحجوزِ: النطاقُ
الفعليُّ صارَ **ستّةً وأربعينَ** ملفَّ تكاملٍ (٨ مُستعيرةٌ + ٣٨ تاركةٌ، بتقاطعٍ)،
ومعينٌ واحدٌ في `tests/support/active-city.ts` بدلَ سطرِ تفعيلٍ في كلِّ ملفٍّ —
لأنَّ ستّاً وأربعينَ نسخةً من عقدٍ واحدٍ تخالفُ الأولويّةَ الثانيةَ في الملحقِ
الحاكمِ (أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ).

##### الحكمُ — ما قِيسَ عندَ الإغلاقِ

| المقيسُ | قبلَ | بعدَ |
|---|---|---|
| السبعةُ منفردةً من خطِّ أساسٍ نظيفٍ | `0 pass · 1 fail` لكلِّ واحدٍ بالرسالةِ `تعذّر الزرعُ: لا مدينةَ مفعَّلةً لها منطقةُ خدمةٍ مفعَّلةٌ` (تحقُّقٌ بـ`git stash`) | تنجحُ كلُّها: ٢١ · ٢٠ · ٢٢ · ٣١ · ٣١ · ٢١ · ١٦، و`driver-documents` ٢٧ |
| خطُّ الأساسِ بعدَ كلِّ ملفٍّ | `JED` متروكةٌ **مفعَّلةً** بقروباتٍ غيرِ فارغةٍ | `is_active = false` وأعمدةُ القروباتِ الثلاثةُ `null` — مقروءةٌ من القاعدةِ بعدَ كلِّ تشغيلٍ |
| خروقُ الحاجزِ على المستودعِ | ٣٩ | **صفرٌ** في ٩٦ ملفّاً |
| حالاتُ الوحدةِ السالبةُ (`ح-7`) | لا حاجزَ ولا حالةَ | **٢٠ pass** — لكلِّ قاعدةٍ من الخمسِ حالةُ سقوطٍ وحالةُ قبولٍ، ثمَّ حكمٌ على المستودعِ كما هوَ |
| حزمةُ التكاملِ كاملةً محليّاً | **`main` نفسُهُ**: `868 pass · 11 fail` | الفرعُ: `892 pass · 5 fail` |

والسطرُ الأخيرُ هوَ الحاكمُ في نفي الانحدارِ، ولم يُستنتَجْ: الحزمةُ شُغِّلَت على
`main` في البيئةِ عينِها (PostgreSQL 18 · Redis محليٌّ) **قبلَ** تشغيلِها على
الفرعِ. فالخمسةُ الباقيةُ **تُخفِقُ على `main` كذلكَ** ولا تُنسَبُ إلى هذا
البندِ: `safe-migration-runner` (`F7-07`، مهلةُ خطّافٍ)، و`CAP-003` ×٢ (مهلةُ
`truncate`)، و`hot-query-index-plans` (`F7-02`، مُخطِّطُ PG18 يختارُ فهرساً
بديلاً بتكلفةٍ ٨٤٢ مقابلَ ١٢٥٩ فلا ينحدرُ إلى `Seq Scan`)، وإخفاقٌ بلا اسمٍ عندَ
١٢٠ ثانيةً. **ولا يُضعَّفُ توكيدٌ واحدٌ منها لأجلِ خضرةٍ**، وحكمُها CI لا الجهازُ
المحليُّ.

##### وما لا يُدَّعى عندَ الإغلاقِ

الحاجزُ **فحصٌ لفظيٌّ لا تحليلُ تدفُّقٍ**: لا يُثبِتُ أنَّ `where id = ${cityId}`
يعني صفَّ البذرةِ لا صفّاً أنشأهُ الملفُّ، فيُعفى الملفُّ الذي يملكُ صفوفَ مدنِهِ
من القاعدةِ ٢ (`city-settings-inheritance.test.ts` برمزَي `ZY1`/`ZY2`). وحدودُ
المُدَّعى كلُّها مكتوبةٌ في `ADR 0116` §٤، ولا يُقرأُ سكوتُ الحاجزِ عن شرطٍ
مسبقٍ آخرَ (مركبةٌ · اشتراكٌ · توافرٌ) طُهراً لهُ.

### Reservation `OPS-020` — حاجزانِ يحكُمانِ تفعيلَ المدينةِ في الاختباراتِ بسجلَّي استثناءاتٍ منفصلَينِ (opened 2026-09-15, before any file was edited)

اكتُشِفَ **أثناءَ** تنفيذِ `OPS-019` لا قبلَهُ، فيُسجَّلُ ويُحجَزُ نطاقُهُ ولا
يُمَسُّ في ذلكَ الفرعِ — لأنَّ خلطَ إصلاحٍ بتوحيدٍ في فرعٍ واحدٍ يُذهِبُ صدقَ
القياسِ على كلَيهِما.

| الحقلُ | القيمةُ |
|---|---|
| المقيسُ | `scripts/check-test-city-activation.ts` (قائمٌ، في سلسلةِ `ci`) يفرضُ ضبطَ القروباتِ الثلاثةِ في **نفسِ عبارةِ** التفعيلِ، ويمسحُ `tests/integration` و`tests/e2e` و`tests/unit` (٣٣٤ ملفّاً)، وسجلُّ استثناءاتِهِ `INTENTIONAL_BARE_ACTIVATION`. و`scripts/check-integration-city-precondition.ts` (`OPS-019`) يفرضُ عقداً أوسعَ على `tests/integration` وحدَهُ بسجلِّ `EXEMPTIONS` مستقلٍّ. فحكمانِ على موضوعٍ واحدٍ بسجلَّينِ. |
| الأثرُ الحقيقيُّ | قِيسَ لا فُرِضَ: حالاتُ `OPS-019` السالبةُ نصوصٌ **مُصنَّعةٌ** تُمرَّرُ إلى حَكَمٍ في الذاكرةِ، فقرأَها الحاجزُ القديمُ شِفرةً حقيقيّةً وأسقطَ البناءَ — إنذارٌ كاذبٌ كانَ سيُبطِلُ برهانَ `ح-7` على الحاجزِ الجديدِ. وأُغلِقَ في `OPS-019` باستثناءٍ مُعلَنٍ بسببِهِ، وذاكَ **علاجُ عرضٍ** مقصودٌ ومُعلَنٌ لا جذرٍ. ويومَ يُضافُ عمودٌ رابعٌ إلى قيدِ التفعيلِ يُعدَّلُ حاجزانِ أو يُنسى أحدُهما. |
| العلاجُ الجذريُّ | حَكَمٌ نقيٌّ **واحدٌ** لعقدِ تفعيلِ المدينةِ في الاختباراتِ، بسجلِّ استثناءاتٍ واحدٍ يحملُ سبباً ومالكاً لكلِّ مُدخلٍ، تُستدعيه خطوةٌ واحدةٌ مُسمّاةٌ. ويُصحَّحُ بالإضافةِ (`ح-8`): تُنقَلُ قاعدةُ «القروباتُ في نفسِ العبارةِ» إلى `scripts/lib/city-precondition-audit.ts` قاعدةً سادسةً بحالاتِها السالبةِ، ويصيرُ الحاجزُ القديمُ نداءً للحَكَمِ الموحَّدِ لا منطقاً ثانياً. |
| الإنفاذُ الآليُّ | حالةٌ سالبةٌ في `tests/unit/` لكلِّ قاعدةٍ منقولةٍ، وقاعدةٌ تُسقِطُ البناءَ على **سجلِّ استثناءاتٍ ثانٍ** يظهرُ في المستودعِ مستقبلاً. |
| النطاقُ المحجوزُ | `scripts/lib/city-precondition-audit.ts` · `scripts/check-test-city-activation.ts` · `scripts/check-integration-city-precondition.ts` · `tests/unit/` لحالاتِهما · خطواتُ `verify` وسلسلةُ `ci` · سطرُ سجلٍّ في `ROADMAP.md` · `ADR` جديدٌ لا مُعدَّلٌ (`ح-6`) |
| ما لا يُمَسُّ | لا توكيدَ في الحاجزِ القديمِ يُحذَفُ — تُنقَلُ قواعدُهُ كما هيَ ويبقى استثناءُ `pilot-city-activation` بسببِهِ · لا نطاقَ مسحٍ يُضيَّقُ (`tests/e2e` و`tests/unit` يبقيانِ محروسَينِ) · لا اختبارَ تكاملٍ يُعدَّلُ |
| ما لا يُدَّعى | ليسَ عطباً في المنتَجِ ولا خضرةً زائفةً قائمةً؛ تكرارٌ في **مصدرِ الحقيقةِ** يخالفُ الأولويّةَ الثانيةَ في الملحقِ الحاكمِ، وكلفتُهُ مستقبليّةٌ لا حاليّةٌ. |

### Reservation `OPS-018` — رابطٌ رمزيٌّ لـ`node_modules` مُتتبَّعٌ في الفهرسِ بمسارٍ مطلَقٍ ميِّتٍ (opened 2026-09-13, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ. اكتُشِفَ وقتَ قراءةِ الحالةِ الفعليّةِ لا من تقريرٍ.

| الحقلُ | القيمةُ |
|---|---|
| المقيسُ | `git ls-files -s node_modules` يُعيدُ `120000 bc2686f …` — أي أنَّ `node_modules` **رابطٌ رمزيٌّ مُتتبَّعٌ** هدفُه `/home/user/workspace/move/node_modules`، مسارٌ مطلَقٌ لبيئةٍ لا وجودَ لها عندَ أيِّ مستنسِخٍ آخرَ. و`.gitignore:1` يحملُ `node_modules/` فعلاً، فالملفُّ دخلَ الفهرسَ رغمَ التجاهلِ (إضافةٌ قسريّةٌ أو سابقةٌ له). |
| الأثرُ الحقيقيُّ | استنساخٌ نظيفٌ يُنتِجُ رابطاً مقطوعاً في موضعِ مجلَّدِ التبعيّاتِ، فيرى `bun install` مساراً موجوداً وغيرَ قابلٍ للقراءةِ. وقِيسَ ههنا: أوّلُ تنصيبٍ في بيئةٍ نظيفةٍ لم يكتملْ حتّى أُزيلَ الرابطُ. و CI لا يكشفُه لأنَّ خطوةَ التنصيبِ فيه تسبقُها بيئةٌ مُهيَّأةٌ. |
| العلاجُ الجذريُّ | إخراجُ المسارِ من **الفهرسِ** وحدَه (`git rm --cached`) وإبقاءُ التجاهلِ كما هوَ. لا مسَّ لـ`.gitignore` ولا لسيرِ عملٍ ولا لأمرِ تنصيبٍ. |
| النطاقُ المحجوزُ | فهرسُ git للمسارِ `node_modules` · سطرُ سجلٍّ في `ROADMAP.md` و§25 |
| ما لا يُدَّعى | ليسَ عيبَ زمنِ تشغيلٍ ولا أثراً على سلوكِ المنتَجِ؛ عيبُ نظافةِ مستودَعٍ يُعيقُ أوّلَ تنصيبٍ عندَ كلِّ قادمٍ جديدٍ. |

### Reservation `F2-04` (نصفٌ مشروعٌ) — الخدمةُ والمدّةُ بمصدرِها، والأجرةُ مُجمَّدةٌ لا مُؤجَّلةٌ (opened 2026-09-13, before any file was edited)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ §25. مقطوعٌ من `main`@`73e1dc7` فرعاً
`feat/f2-04-quote-duration-and-services`، وحكمُ CI على ذاكَ الالتزامِ **أخضرُ**
(`34744519700` · `34744519692`) — قُرِئَ قبلَ القطعِ.

**والحاجزُ السياديُّ يُعلَنُ أوّلاً لا آخِراً:** نصُّ `F2-04` يقولُ «التسعيرُ»،
و**التسعيرُ مُجمَّدٌ بقرارٍ قائمٍ**: [`ADR 0039`](docs/adr/0039-fare-mechanism-is-blocked-pending-regulatory-decision.md)
§٤ يحجبُ آليةَ الأجرةِ على `DEC-11`، و§٦ منهُ يقولُ حرفاً إنَّ أيَّ تحليلٍ
داخليٍّ — **بشريٍّ أو آليٍّ** — لا يُقبَلُ سنداً لإغلاقِه، ونصُّ المالكِ فيهِ:
«**وليس قراراً يمكن للمهندسِ أو للـAI تخمينُه**». وملحقُ `م13-7` يُجمِّدُ معَها
**الهياكلَ التمهيديّةَ**: لا عمودَ ولا ترحيلَ ولا حقلَ عرضٍ «جاهزاً للأجرةِ».

**فلا يُبنى محرِّكُ أجرةٍ ههنا، ولا حقلٌ فارغٌ لها، ولا وسيلةُ دفعٍ.** وهذا
**حاجزٌ مُعلَنٌ لا التزامٌ يُخفَّفُ**: البندُ **لا يُقلَبُ `[x]`** بهذا العملِ، بل
`[~]` بنصفِه المشروعِ، ونصفُه المحجوبُ يبقى مكتوباً باسمِه.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-04` — `SR-04` في §9.5. **المشروعُ منه**: «المدّةُ التقديريّةُ **ومصدرُها** (مسارٌ حقيقيٌّ أو «غير متوفر» — **لا تخمين**، `ADR 0024`)» وبطاقاتُ الخدماتِ وملاحظاتُ السائقِ. **والمحجوبُ**: «السعرُ التقديريُّ» و«وسيلةُ الدفعِ» (`ADR 0039` · `م13-7`). |
| التبعيّةُ المُستوفاةُ | `F2-03` مُغلَقٌ ومدموجٌ (`73e1dc7`)، و`resolve_destination` قائمةٌ تُقرأُ لا تُعادُ كتابتُها. و`packages/domain/eta` منفَّذةٌ سلفاً بسبعةِ أسبابِ امتناعٍ. |
| العقدُ | `POST /v1/rides/quote` — مذكورٌ في §10 بنصِّه «تسعيرٌ ومدّةٌ (أو «غير متوفر»)». **ويُبنى بشقِّ المدّةِ وحدَه**، ويُسجَّلُ حدُّه في §10.2. |
| لماذا الحكمُ في القاعدةِ | طرفا الرحلةِ يُفحَصانِ ضدَّ منطقةِ الخدمةِ، والمسافةُ الجيوديسيّةُ تُقاسُ بـ`st_distance` على `geography`، ووجودُ سائقٍ قادرٍ في المدينةِ يُسألُ عنه في عبارةٍ واحدةٍ — قراءةٌ واحدةٌ ذرّيّةٌ بدلَ ثلاثِ رحلاتٍ ذهاباً وإياباً تتناقضُ بينها (القاعدة 0.5). |
| لماذا رمزانِ لا رمزٌ | «نقطةُ انطلاقي خارجَ الخدمةِ» و«وجهتي خارجَ الخدمةِ» جوابانِ مختلفانِ للراكبِ تماماً؛ وجمعُهما في رمزٍ واحدٍ يجعلُ الشاشةَ تكذبُ في نصفِ الحالاتِ. |
| لماذا المسافةُ موسومةٌ أبداً | `ADR 0024` قاسَ نسبةَ الالتفافِ 1.12–2.83 على 15 زوجاً حقيقيّاً. فمسافةٌ مستقيمةٌ تُعرَضُ بلا وسمٍ **كذبٌ بنسبةِ 183٪ في أسوأِ زوجٍ**. فالوسمُ `STRAIGHT_LINE` جزءٌ من القيمةِ لا زينةٌ، ولا معاملَ التفافٍ ولا سرعةَ ثابتةً. |
| المدّةُ | من `estimateArrival` القائمةِ ← `packages/domain/eta`. وبلا مزوِّدِ توجيهٍ مضبوطٍ تعودُ `NOT_CONFIGURED` **امتناعاً مُصنَّفاً صادقاً**، لا صفراً ولا تخميناً. واستضافةُ OSRM **مهمّةُ مشغِّلٍ** مكتوبةٌ في `ADR 0024`، ولا يملكُها الوكيلُ. |
| الحاجزُ الجديدُ | `scripts/check-quote-contract.ts` — **يُنفِذُ التجميدَ آلةً لا نيّةً**: لفظُ أجرةٍ أو وسيلةِ دفعٍ في شريحةِ الراكبِ يُسقِطُ CI، بتخصيصٍ مُعلَنٍ لاشتراكِ السائقِ (`ADR 0027`). وهذا أوّلُ إنفاذٍ آليٍّ لـ`ADR 0039` §٤ بعدَ شهرٍ من كونِه نصّاً يُقرأُ. |
| النطاقُ المحجوزُ | `supabase/migrations/20260913190000..190100` · `packages/domain/quote/*` · `packages/application/quote/*` · `packages/infrastructure/quote/*` · `apps/gateway/src/routes/quote.ts` وتركيبُها · `apps/miniapp/src/surfaces/rider/quote/*` وتركيبُها في `RiderRoot.tsx` و`DestinationScreen` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `scripts/check-quote-contract.ts` · السجلّاتُ الأربعةُ (تسجيلُ الجديدِ لا تعديلُ القديمِ) · الاختباراتُ · `docs/adr/0103-*` · `docs/evidence/architecture/F2-04-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **الأجرةُ ووسيلةُ الدفعِ وأيُّ فرضيةِ تسويةٍ** (مُجمَّدةٌ) · إنشاءُ الرحلةِ (`F2-05`) · `orders` · استضافةُ مزوِّدِ توجيهٍ · ملفّاتُ `F2-01`/`F2-02`/`F2-03` (تُقرأُ ولا تُعدَّلُ إلّا تركيبَ الشاشةِ) · `UX-021` |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`) فما يُغلَقُ ههنا **لم يفتحْه مستخدمٌ حقيقيٌّ**؛ وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**؛ ولا `مَقيس` ولا `مُثبَت` (`ح-5`)؛ و**البندُ `[~]` لا `[x]`**؛ و**المدّةُ ستعودُ ممتنعةً في كلِّ بيئةٍ لا مزوِّدَ فيها** — وهذا هوَ الصدقُ لا العيبُ. |

### `F2-04` — ما نُفِّذَ فعلاً، وما بقيَ محجوباً باسمِه (added 2026-09-13, after the work, additively)

هذا القسمُ **زيادةٌ على الحجزِ أعلاه ولا يمحوهُ ولا يُعدِّلُه** (`ح-1`). والحجزُ
وُضِعَ قبلَ أوّلِ تعديلٍ، وهذا يُقرأُ بعدَه: ما صارَ في المستودَعِ فعلاً.

**النصفُ المشروعُ — مُنفَّذٌ:**

| الطبقةُ | ما بُنيَ |
|---|---|
| المخطَّطُ | `20260913190000_f2_04_ride_quote_judgement.sql` (طورُ `expand`): `city_served_services(p_city_id uuid)` و`quote_ride(p_telegram_id bigint, 4× double precision) returns jsonb` — كلتاهما `stable` · `security invoker` · `set search_path = public` · و`revoke execute` عن `public` و`anon` و`authenticated`. طُبِّقَت **جولتَينِ** على قاعدةٍ مُدارةٍ حقيقيّةٍ بلا خطأٍ. |
| النطاقُ | `packages/domain/quote/distance-kind.ts` (الوسمُ **جزءٌ من النوعِ** لا حقلٌ اختياريٌّ، وسقفُ العرضِ يُفحَصُ **بعدَ** التقريبِ) · `service-offer.ts` (بطاقةٌ لكلِّ خدمةٍ بحالتِها وسببِ غيابِها). |
| التطبيقُ والبِنيةُ | `packages/application/quote/{ports.ts,quote-ride.ts}` · `packages/infrastructure/quote/quote-store.ts` — يردُّ رمزَ رفضٍ غيرَ معروفٍ أو صنفَ مسافةٍ غيرَ `STRAIGHT_LINE` **عطباً** لا يُمرِّرُه. |
| الحدُّ | `POST /v1/quote/ride` بحدٍّ `512` بايتاً (`413`)، ورفضٌ بـ`200` و`accepted:false`، وأعطابٌ بـ`401`/`400`/`404`/`503`، **والهويّةُ من الرمزِ الموقَّعِ لا من الطلبِ** — مقيسٌ بتوكيدٍ يُرسِلُ معرّفاً كاذباً في الجسمِ وترويسةً كاذبةً فلا يُقرَأانِ. |
| السطحُ | `apps/miniapp/src/surfaces/rider/quote/*` و37 مفتاحاً × 3 لغاتٍ (129 لكلٍّ) — **بلا حرفٍ عربيٍّ واحدٍ في الشِّفرةِ** (§9.11). |
| الحاجزُ | `scripts/check-quote-contract.ts` بثمانِ قواعدَ، مُسجَّلٌ **خطوتَينِ مُسمّاتَينِ** في `ci.yml` وفي سلسلةِ `ci`، وله حالةٌ سالبةٌ **لكلِّ قاعدةٍ**. |

**ما بقيَ محجوباً، مكتوباً باسمِه لا مُجمَّلاً:** السعرُ التقديريُّ · وسيلةُ الدفعِ
· وأيُّ خانةٍ أو عمودٍ أو رايةٍ تُمهِّدُ لهما (`ADR 0039` §٤ على `DEC-11` ·
`م13-7` · `ADR 0103`). **ولذا البندُ `[~]` لا `[x]`.**

**وما بقيَ غيرَ مقيسٍ لا محجوباً:** المدّةُ تعودُ `NOT_CONFIGURED` في **كلِّ**
بيئةٍ اليومَ، لأنَّ استضافةَ محرِّكِ توجيهٍ **عملُ مشغِّلٍ** (`ADR 0024`) لا يملكُه
الوكيلُ. وملاحظةُ السائقِ **أُخرِجَت إلى `F2-05`**: حقلُ إدخالٍ لا يُحفَظُ في صفٍّ
كذبٌ على الراكبِ، والحفظُ يحتاجُ طلباً لا يُنشئُه هذا البندُ.

**ودرسٌ مقيسٌ يُسجَّلُ:** كانَت نسخةٌ قديمةٌ من `quote_ride` مُطبَّقةً على قاعدةِ
الاختبارِ بمفاتيحِ حمولةٍ أخرى (`refusal` بدلَ `error`)، فمرَّت قياساتٌ سابقةٌ على
دالّةٍ **ليسَت هيَ الملفَّ**. كُشِفَ ذلكَ بتشغيلِ حُزمةِ التكاملِ نفسِها، وعُولِجَ
بإعادةِ تطبيقِ الهجرةِ قبلَ القياسِ. والدرسُ: **الأخضرُ على محرِّكٍ لا يُعرَفُ
إصدارُه ليسَ قياساً** — ولذا تُعادُ الهجرةُ ثمَّ يُقاسُ.

### `UX-021` — لا يزالُ مفتوحاً، ولم يُصلَحْ في `F2-04` عن قصدٍ

أصنافُ `.rh__*` في سطحِ `F2-02` بلا قواعدِ عرضٍ مقابلةٍ. **والعلاجُ الجذريُّ ليسَ
كتابةَ القواعدِ الناقصةِ** — فذاكَ يُعالِجُ العَرَضَ ويُبقي البابَ مفتوحاً لكلِّ
سطحٍ قادمٍ — بل **حاجزٌ يُقابِلُ أصنافَ JSX بمُحدِّداتِ CSS** ويُسقِطُ CI على كلِّ
صنفٍ بلا قاعدةٍ. وذاكَ زيادةٌ مستقلّةٌ لها حجزُها، لأنَّ خلطَها بـ`F2-04` يُفقِدُ
كلَّ واحدةٍ قياسَها المستقلَّ.

### حجزُ نطاقِ `F2-05` — `SR-05` إنشاءُ الرحلةِ ذرّيّاً، وشاشةُ بحثٍ لا تكذبُ (فُتِحَ 2026-09-13 قبلَ أوّلِ تعديلِ ملفٍّ)

حُجِزَ قبلَ أوّلِ تعديلٍ وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
الحاكمُ: `SR-05` (§«البحثُ عن سائقٍ»: مؤقّتٌ شفّافٌ · **عددُ السائقينَ
المُخطَرينَ فعلاً** · شرحُ ما يحدثُ · إلغاءٌ بلا عقوبةٍ قبلَ الإسنادِ) ·
`ARCH-006` (كلُّ أمرٍ خارجيٍّ مُعرَّفٌ بمفتاحِ تكرارٍ) · `ADR 0023` (الإسنادُ
مُعادُ الدخولِ، **والصمتُ ليسَ رفضاً**) · `ADR 0017` (طزاجةُ موقعِ السائقِ) ·
القاعدةُ 0.5 (الذرّيّةُ والحكمُ في المحرِّكِ لا في التطبيقِ).

**الحالةُ الفعليّةُ المقروءةُ من `main`@`f952b04` لا من تقريرٍ** — وهيَ سببُ هذا
الحجزِ: جدولُ `orders` قائمٌ منذُ المرحلةِ 2.1 بحالةٍ ابتدائيّةٍ `searching`،
**والإنشاءُ اليومَ `insert into orders` مكشوفٌ** في
`packages/infrastructure/transport/order-adapters.ts` — **بلا مفتاحِ تكرارٍ
ألبتّةَ، وبلا حكمِ حدِّ خدمةٍ، وبلا منعِ طلبَينِ نشطَينِ لراكبٍ واحدٍ**. أي أنَّ
ضغطتَينِ على زرٍّ واحدٍ، أو إعادةَ محاولةٍ من شبكةٍ متقطِّعةٍ، **تُنشئانِ رحلتَينِ
حقيقيّتَينِ** وتُخطِرانِ السائقينَ مرّتَينِ. **وهذا عطبٌ قائمٌ لا نقصُ ميزةٍ.**
و`packages/application/transport/request-ride.ts` **هيكلٌ فارغٌ** يُصدِّرُ
`export {}` ويقولُ عن نفسِه ذلكَ — فلا يُقرأُ تنفيذاً.

**النطاقُ المحجوزُ، بستِّ زياداتٍ مُرقَّمةٍ لا تُدمَجُ في واحدةٍ:**

| # | الزيادةُ | ما تمسُّه | ما يُقاسُ عليها |
|---|---|---|---|
| `R-1` | **الذرّيّةُ في المحرِّكِ**: دالّةُ `request_ride` تحكمُ في معاملةٍ واحدةٍ: تحقُّقُ الإحداثيّاتِ · استنباطُ المدينةِ من صفِّ صاحبِ الحسابِ · حدُّ الخدمةِ للطرفَينِ برمزَينِ مستقلَّينِ · **منعُ طلبٍ نشطٍ ثانٍ** · إنشاءُ الصفِّ | هجرةٌ جديدةٌ في `supabase/migrations/` طَورُها `expand` | **إعادةُ النداءِ بالمفتاحِ نفسِه تُعيدُ المعرّفَ الأوّلَ وعددُ الصفوفِ يزيدُ واحداً لا اثنَينِ** — مقيساً على قاعدةٍ حقيقيّةٍ |
| `R-2` | **مفتاحُ التكرارِ قيداً لا اتّفاقاً**: عمودٌ ودليلٌ فريدٌ يجعلُ التكرارَ **مستحيلاً في المخطَّطِ** لا مفحوصاً في الشِّفرةِ، مع نطاقِه (صاحبُ الحسابِ) ومُهلَتِه | الهجرةُ نفسُها · `scripts/lib/rollback-registry.ts` إن لزمَ | **سباقٌ مزروعٌ**: نداءانِ متزامنانِ بالمفتاحِ نفسِه ⇒ صفٌّ واحدٌ ورمزٌ واحدٌ، لا استثناءٌ مكشوفٌ |
| `R-3` | **قراءةُ حالةِ البحثِ صادقةً**: دالّةٌ تُرجِعُ الحالةَ والدورةَ **وعددَ من أُخطِرَ فعلاً** — مُحتسَباً من صفوفِ `order_offers` لا من نيّةٍ ولا من عميلٍ — وقابليّةَ الإلغاءِ | الهجرةُ نفسُها | **نُزِعَ صفُّ عرضٍ فتغيَّرَ العددُ**: العددُ مشتقٌّ من الجدولِ لا ثابتٌ |
| `R-4` | **الطبقاتُ والنقطتانِ**: مَنفذٌ وحالةُ استخدامٍ ومُحوِّلٌ، و`POST /v1/rides` تقرأُ `Idempotency-Key` **ترويسةً إلزاميّةً**، و`GET /v1/rides/:id/search` قراءةً | `packages/{domain,application,infrastructure}/transport/*` · `apps/gateway/src/routes/rides.ts` (جديدٌ) · تركيبُ الخادمِ | **طلبٌ بلا ترويسةِ مفتاحٍ يُرَدُّ برمزٍ مُعلَنٍ**، والهويّةُ من الرمزِ الموقَّعِ لا من الجسمِ |
| `R-5` | **شاشةُ بحثٍ لا تكذبُ**: مؤقّتٌ يقيسُ **من ختمِ الإنشاءِ** لا من فتحِ الشاشةِ · عددٌ مُخطَرٌ فعليٌّ · شرحُ ما يحدثُ · **إلغاءٌ بلا عقوبةٍ قبلَ الإسنادِ** يختفي بعدَه | `apps/miniapp/src/surfaces/rider/search/*` · `styles/global.css` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` | **صفرُ مُخطَرينَ نصٌّ صريحٌ** لا خانةٌ فارغةٌ ولا دوّارٌ أبديٌّ (`ADR 0023`: الصمتُ ليسَ رفضاً) |
| `R-6` | **الإنفاذُ آليّاً**: حاجزٌ يمنعَ العودةَ إلى إنشاءٍ بلا مفتاحٍ، ويمنعُ عدّاً مُخترَعاً، ويمنعُ أجرةً أو عقوبةَ إلغاءٍ (`ADR 0039` §٤ · `م13-7` · `ADR 0103`) | `scripts/check-ride-request-contract.ts` (جديدٌ) · `.github/workflows/ci.yml` خطوتَينِ مُسمّاتَينِ · `package.json` | **حالةٌ سالبةٌ لكلِّ قاعدةٍ** تزرعُ افتراقَها فتُقاسُ إسقاطُها — لا «صفرُ مخالفاتٍ» على المستودَعِ كما هوَ (`ح-5`) |

**ما هوَ خارجَ هذا الحجزِ صراحةً:** لا أجرةَ ولا وسيلةَ دفعٍ ولا **عقوبةَ إلغاءٍ**
ولا خانةً محجوزةً لأيٍّ منها (`ADR 0039` §٤ على `DEC-11` · `م13-7` يُجمِّدُ حتّى
الهياكلَ التمهيديّةَ) · ولا **منطقَ إسنادٍ ولا ترتيبَ سائقينَ ولا بثَّ دوراتٍ**
(ذاكَ `F3` وله آلةُ حالاتِه) · ولا قبولَ سائقٍ ولا `F2-06` (الرحلةُ النشطةُ
وSOS) · ولا `UX-021` (علاجُه الجذريُّ حاجزٌ يُقابِلُ أصنافَ JSX بمُحدِّداتِ CSS،
زيادةٌ مستقلّةٌ لها حجزُها) · ولا يُمَسُّ نصُّ بندٍ ولا معيارُ قبولٍ (`ح-1`) ولا
يُرقَّمُ شيءٌ من جديدٍ (`ح-2`) ولا يُضعَّفُ حاجزٌ ولا يُصنَّفُ اختبارٌ تخطّياً بلا
سببٍ مُسجَّلٍ (`ح-7`).

**وملاحظةُ السائقِ** (`SR-04`: «ملاحظاتٌ للسائقِ») **تُبنى ههنا** لا في `F2-04`:
عمودُ `notes` قائمٌ في `orders` منذُ المرحلةِ 2.1، **فحقلُ إدخالٍ في شاشةِ
الاقتباسِ لا يُحفَظُ كذبٌ** — ويُحفَظُ الآنَ معَ الأمرِ الذي يكتبُ الصفَّ.

**تحقُّقٌ من عدمِ تعارضٍ، قِيسَ قبلَ إنشاءِ الفرعِ:** لا فرعَ بعيدٌ يحملُ `f2-05`
ولا طلبَ سحبٍ مفتوحٌ ألبتّةَ (`gh pr list --state open` ⇒ لا شيءَ)، وآخرُ
مدموجٍ `#23`. و`main` عندَ `f952b04`.

#### إغلاقُ `F2-05` — ما نُفِّذَ من الزياداتِ الستِّ، وما زادَ عليها حاجزٌ أسقطَه (2026-09-13)

الزياداتُ الستُّ `R-1`…`R-6` **نُفِّذَت كلُّها**، والدليلُ المُفصَّلُ في
`docs/evidence/architecture/F2-05-CLOSURE-20260913.md` والقرارُ في
`docs/adr/0104-*`. **وزادَ على الحجزِ أمرٌ لم يكنْ فيه**، ويُسجَّلُ ههنا لأنَّه
**حاجزٌ أسقطَ العملَ**: `scripts/check-system-screens-policy.ts` رفضَ شاشةَ
البحثِ بموضعَيْ `setInterval` (استقصاءٌ كلَّ خمسِ ثوانٍ · عقربُ ثوانٍ كلَّ
ثانيةٍ) — **ولا استقصاءَ دوريّاً في التطبيقِ المصغَّرِ** (`ADR 0035` §٤ · القسم
9.7 · `F1-07`).

**فعُولِجَ في الجذرِ بتغييرِ التصميمِ لا بتعطيلِ الحاجزِ ولا باستثنائِه ولا
بتحويلِ المؤقّتِ إلى `setTimeout` مُتسلسِلٍ يُخفيه**: القراءةُ تُطلَبُ بزرٍّ ظاهرٍ
ما دامَ البحثُ جارياً، والمدّةُ تُقرأُ لحظةَ الرسمِ، **وأُعلِنَ للراكبِ نصّاً أنَّ
الرقمَ لقطةٌ لا بثٌّ**. **والحاجزُ زِيدَ**: قاعدةٌ حاديةَ عشرةَ في
`check-ride-request-contract.ts` تُسقِطُ البناءَ إن خلَت الشاشةُ من زرِّ قراءةٍ
أو من إعلانِ اللقطةِ — فالمنعُ وحدَه كانَ يسمحُ بعددٍ جامدٍ بلا بابِ سؤالٍ.

**وما بقيَ خارجاً يبقى خارجاً**: لا أجرةَ ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ ·
ولا بثَّ ولا إسنادَ (`F3`) · ولا نقلَ فوريَّ · ولا `F2-06` · و`UX-021` مفتوحٌ.
**والبندُ `[~]` لا `[x]`** (`ح-4`).

### حجزُ نطاقِ `UX-021` — صنفٌ في العرضِ بلا قاعدةٍ في النمطِ: علاجٌ في الجذرِ بحاجزٍ لا بترقيعِ سطحٍ (فُتِحَ 2026-09-13 قبلَ أوّلِ تعديلِ ملفٍّ)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`2f611ea` فرعاً `fix/ux-021-css-class-coverage`، وحُكمُ CI على
ذاكَ الالتزامِ **أخضرُ** في وظائفِه الأربعِ (الشغلةُ `34766282338`) — قُرِئَ من
الواجهةِ البرمجيّةِ وظيفةً وظيفةً لا من نصِّ السجلِّ.

| الحقلُ | المُعلَنُ |
|---|---|
| البندُ | `UX-021` — الاكتشافُ المُسجَّلُ في `ROADMAP.md` و§25 و`ADR 0102` §6: شاشةُ `F2-02` تُصدِرُ أصنافَ `.rh__*` ولا يُقابِلُها مُحدِّدٌ في `apps/miniapp/src/styles/global.css`، **فالسطحُ يُعرَضُ بأنماطِ المتصفِّحِ الافتراضيّةِ**. ونصُّ الاكتشافِ نفسُه يقولُ إنَّ العلاجَ الجذريَّ **حاجزٌ يقابِلُ أصنافَ العرضِ بمُحدِّداتِ النمطِ** — «وإلّا تكرَّرَ الخرقُ في كلِّ سطحٍ قادمٍ». |
| لمَ الآنَ ولمَ قبلَ `F2-06` | لأنَّ البندَ التاليَ `SR-06` سطحٌ ثالثٌ، **وبناؤه بلا هذا الحاجزِ يُنتِجُ الخرقَ نفسَه مرّةً ثالثةً**؛ والدَّينُ الذي يُنتِجُ نفسَه في كلِّ زيادةٍ يُسدَّدُ قبلَ الزيادةِ لا بعدَها. وهوَ كذلكَ **أوّلُ بندٍ في المستودعِ مقياسُه تجربةُ المستخدمِ المرئيّةُ**: راكبٌ يفتحُ الرئيسةَ اليومَ يرى قائمةً عاريةً بأنماطِ متصفِّحٍ، لا سطحاً. |
| التبعيّةُ المُستوفاةُ | لا تبعيّةَ: `F2-02` مدموجٌ (`2c7c6a7`)، و`F2-05` مدموجٌ (`2f611ea`)، والملفُّ المُعدَّلُ (`global.css`) ليسَ في نطاقٍ محجوزٍ لأحدٍ، ولا فرعَ بعيدٌ ولا طلبَ سحبٍ مفتوحٌ يحملُ `ux-021` (مقيسٌ قبلَ إنشاءِ الفرعِ: `gh pr list --state open` ⇒ لا شيءَ · `git branch -r` ⇒ لا شيءَ). |
| القياسُ الابتدائيُّ (قبلَ أيِّ تعديلٍ) | 82 مُحدِّدَ صنفٍ في `global.css` · 18 صنفاً يُصدِرُه العرضُ **بلا قاعدةٍ** (17 منها `.rh*` من سطحِ `F2-02`، و`.rd__map` من سطحِ `F2-03`) · 4 قواعدَ **بلا إصدارٍ** (`.qt__pending-item` · `.rs__stopped` · `.app-frame*` تُقاسُ بعدَ تصحيحِ المُستخرِجِ). |
| الحكمُ السياديُّ المُحتَرَمُ | `ح-1` و`ح-2`: **لا مُحدِّدَ يُمحى**. فالقاعدةُ المكتوبةُ التي زالَ مُصدِرُها — مثلَ `.rs__stopped` التي أحلَّها `ADR 0035` §٤ بـ`.rs__snapshot` ونصُّ الملفِّ يقولُ «والمُحدِّدُ الأوّلُ يبقى مكتوباً ولا يُمحى» — **تُسجَّلُ في سجلٍّ مُعلَنٍ بسببٍ ومالكٍ**، لا تُحذَفُ ولا تُسكَتُ بقائمةِ استثناءٍ بلا بيانٍ. |
| النطاقُ المحجوزُ | `scripts/lib/css-class-coverage.ts` (جديدٌ — المُستخرِجُ والقرارُ النقيُّ) · `scripts/check-css-class-coverage.ts` (جديدٌ — الحاجزُ) · `tests/unit/check-css-class-coverage.test.ts` (جديدٌ — سقوطُ الحاجزِ بافتراقٍ مزروعٍ لكلِّ قاعدةٍ) · `apps/miniapp/src/styles/global.css` (**إضافةُ** قواعدِ `.rh*` و`.rd__map`) · `apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx` (سطرٌ واحدٌ: الصنفُ المقصودُ للملاحظةِ المُعلَنةِ) · `package.json` و`.github/workflows/ci.yml` (**إضافةٌ** لا تعديلٌ: خطوتانِ في `verify`) · `docs/adr/0105-*` · `docs/evidence/architecture/UX-021-*` · `docs/ROADMAP-MASTER.md` (صفُّ §25 وحدَه) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **بنيةُ شاشةِ `F2-02` ومنطقُها** (`HomeScreen.tsx` · `home-view.ts`): لا عنصرَ يُضافُ ولا يُحذَفُ ولا يُعادُ ترتيبُه — الأصنافُ المُصدَرةُ تُقرأُ كما هيَ ويُكتَبُ لها نمطُها · `F2-06` وكلُّ سطحٍ لم يُبنَ · الثمانيةُ والأربعونَ نصّاً الصريحةُ وحاجزُ §9.11 الغائبُ · مزوِّدُ الخرائطِ · أيُّ قاعدةٍ في `global.css` قائمةٌ اليومَ (تُقرأُ ولا تُعدَّلُ) · أيُّ هجرةٍ أو مسارٍ أو دالّةِ قاعدةٍ. |
| سقفُ الادّعاءِ | يُقلَبُ `UX-021` مُغلَقاً **إن وإنْ فقط** حكمَ CI أخضرَ بوظائفِه الأربعِ، وما يُدَّعى حينَها **مقيسٌ نصّاً**: لا صنفٌ يُصدِرُه العرضُ بلا قاعدةٍ، ولا قاعدةٌ بلا مُصدِرٍ إلّا مُسجَّلةً بسببٍ، ولا تعبيرَ صنفٍ في العرضِ يُبنى من مصدرٍ لا يَراهُ الحاجزُ. **ولا يُدَّعى** أنَّ السطحَ «جميلٌ» ولا أنَّه جُرِّبَ عندَ راكبٍ: لا نشرَ حيَّ (`ADR 0099`)، ولا بوّابةَ `F2` (`ح-5`)، ولا حاجزَ يحكمُ في الجمالِ — يحكمُ في **وجودِ النمطِ** لا في ذوقِه. |

### Reservation `F2-06` — the active ride, honest about what it cannot yet see (recorded 2026-09-13, before the first edit)

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-06` — `SR-06` في §9.5: «خريطةٌ ملءَ الشاشةِ، بطاقةُ السائقِ (الاسمُ، الصورةُ، التقييمُ، اللوحةُ، نوعُ المركبةِ، الباركودُ)، ETA حقيقيّةٌ، مراحلُ الرحلةِ، **زرُّ SOS ثابتٌ**، **زرُّ مشاركةِ الرحلةِ**، اتصالٌ/رسالةٌ، إلغاءٌ بسياسةٍ معروضةٍ». |
| التبعيّةُ المُستوفاةُ | `F2-05` مدموجٌ (`2f611ea`): `orders` تُنشَأُ بمفتاحِ تكرارٍ، و`readRideSearch` قائمٌ، و`cancelRide` قائمٌ. والإسنادُ **موجودٌ فعلاً في القاعدةِ** قبلَ `F3`: `claim_ride` (هجرةُ 2026-08-06) تضعُ `status='matched'` و`assigned_driver_id` — فحالةُ «رحلةٌ لها سائقٌ» **ليسَت مُتخيَّلةً**، وهيَ ما يُقرأُ ههنا. |
| النطاقُ المحجوزُ | هجرةُ دالّةِ لقطةٍ واحدةٍ · `packages/domain/transport/active-ride.ts` · `packages/application/transport/read-active-ride.ts` (+ منفذٌ) · `packages/infrastructure/transport/active-ride-store.ts` · `GET /v1/rides/:id` في `apps/gateway/src/routes/rides.ts` · `apps/miniapp/src/surfaces/rider/active/*` · `RiderRoot.tsx` (مسارُ الشاشةِ) · `global.css` (كتلةُ `ar`) · `i18n/miniapp/{ar,en,ur}.json` · `scripts/check-active-ride-contract.ts` + حالاتُه السالبةُ. |
| النطاقُ **غيرُ** المحجوزِ | **الأجرةُ ووسيلةُ الدفعِ وعقوبةُ الإلغاءِ** (مُجمَّدةٌ: `ADR 0039` §٤ · `م13-7`) · **رابطُ المشاركةِ** (`F2-09` يملكُه، والرمزُ له جدولٌ ودالّةٌ ومُصدِرٌ في حوارِ البوتِ) · **مسارُ SOS** (`F2-10` + `F8-05` يملكانِه، وله ميزانيّةُ §7: p99 ≤ 500ms بلا خدمةٍ خارجيّةٍ) · **الإنهاءُ والتقييمُ** (`F2-07`) · **البثُّ والإسنادُ** (`F3`) · مسارُ السائقِ. |
| لماذا الحكمُ في القاعدةِ | الملكيّةُ (**هل هذهِ رحلةُ هذا الراكبِ؟**) والحداثةُ (**كم عُمرُ نقطةِ السائقِ؟**) و«هل يُعرَضُ سائقٌ أصلاً؟» ثلاثةُ أسئلةٍ تُجابُ **في استفسارٍ واحدٍ** بدالّةٍ تأخذُ `p_user_id`؛ فلا يعودُ التطبيقُ يقرأُ صفّاً ثمَّ يقرِّرُ، ولا يُسرَّبُ صفٌّ إلى طبقةٍ تنسى الشرطَ. |
| لماذا عُمرُ النقطةِ يُنشَرُ رقماً | `BUG-001` **قائمٌ**: كتابةُ `drivers.last_location` **غيرُ محروسةٍ بترتيبٍ**، فالنقطةُ قد تكونُ من إصلاحةٍ أقدمَ. ونقطةٌ تُرسَمُ على خريطةٍ بلا عُمرٍ **شاهدٌ كاذبٌ على حداثتِها**. فيُنشَرُ `positionAgeSeconds`، **ويُحجَبُ الموقعُ حجباً مُصنَّفاً** إذا تجاوزَ حدَّاً مُعلَناً، ويُكتَبُ للراكبِ «آخرُ موقعٍ قبلَ كذا» لا نقطةٌ تتظاهرُ بالآنِ. |
| ETA | من `estimateArrival` القائمةِ (`packages/domain/eta`) **لا من تقديرٍ جديدٍ**، فمصدرُ حقيقةٍ واحدٌ. وبلا مزوِّدِ توجيهٍ مضبوطٍ تعودُ `NOT_CONFIGURED` **امتناعاً مُصنَّفاً يُعرَضُ نصّاً** — لا صفراً ولا شَرطةً. |
| الحاجزُ الجديدُ | `scripts/check-active-ride-contract.ts`: (١) لا لفظَ أجرةٍ أو دفعٍ أو عقوبةٍ في شريحةِ الشاشةِ ولا في مفاتيحِها · (٢) لا حقلَ سائقٍ يُنشَرُ في حالةٍ لا سائقَ فيها · (٣) لا موقعَ يُعرَضُ بلا عُمرِه · (٤) مفاتيحُ النصِّ الثلاثةُ (`ar`/`en`/`ur`) متطابقةُ المجموعةِ · (٥) لا زرَّ يُرسَمُ لمسارٍ غيرِ مبنيٍّ. **ولكلِّ قاعدةٍ حالةُ سقوطٍ مزروعةٌ** (`ح-7`). |
| ما **لا** يُبنى ههنا ويُسمّى باسمِه | **زرُّ SOS** و**زرُّ المشاركةِ** و**الاتصالُ/الرسالةُ** (رقمٌ مقنَّعٌ غيرُ مبنيٍّ، وعرضُ رقمٍ خاصٍّ للطرفِ الآخرِ قرارُ خصوصيّةٍ لا واجهةٍ) و**الباركودُ** (لا مُصدِرَ له في القاعدةِ) و**صورةُ السائقِ** (لا عمودَ لها). فالزرُّ الذي لا مسارَ له **لا يُرسَمُ معطوباً ولا مُعطَّلاً**: يُذكَرُ في هذا الحجزِ وفي الدليلِ وينتظرُ بندَه. |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`) فما يُغلَقُ ههنا **لم يفتحْه راكبٌ حقيقيٌّ**؛ وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**؛ **ولا `[x]` بل `[~]`** ما بقيَ SOS والمشاركةُ والاتصالُ والباركودُ في نصِّ البندِ غيرَ مبنيّةٍ؛ ولا `مَقيس` ولا `مُثبَت` (`ح-5`). |

## `UX-021` closed at the root — a guard, not a patched surface (added 2026-09-13, after the work, additively)

هذا القسمُ **زيادةٌ على الحجزِ أعلاه ولا يمحوهُ ولا يُعدِّلُه** (`ح-1`)، ويُقرأُ
مع قسمِ الاكتشافِ في آخرِ هذا الملفِّ: ذاكَ سجَّلَ الدَّينَ، وهذا يقولُ كيفَ سُدِّدَ.

**ما بُنيَ:** `scripts/lib/css-class-coverage.ts` (القرارُ النقيُّ: مُستخرِجُ
**صدورِ** مُحدِّداتِ CSS دونَ الإعلاناتِ، وماسحُ تعبيرِ `className` يقرأُ النصوصَ
والقوالبَ والإحلالاتَ المتداخلةَ، وسجلُّ القواعدِ الباقيةِ) ·
`scripts/check-css-class-coverage.ts` (الحاجزُ: قراءةُ قرصٍ ومناداةُ حكمٍ) ·
`tests/unit/check-css-class-coverage.test.ts` (**20** حالةً، لكلِّ قاعدةٍ افتراقٌ
مزروعٌ) · **18 قاعدةَ `.rh*` و`.rd__map` إضافةً** في `global.css` · خطوتانِ
مُسمّاتانِ في `verify` وحلقةٌ في سلسلةِ `ci`. والقرارُ: `ADR 0105`. والدليلُ:
`docs/evidence/architecture/UX-021-CLOSURE-20260913.md`.

**وبنيةُ `HomeScreen.tsx` لم تُمَسَّ بحرفٍ**: لا عنصرَ أُضيفَ ولا حُذِفَ ولا
أُعيدَ ترتيبُه — الأصنافُ قُرِئَت كما هيَ وكُتِبَ لها نمطُها.

**تصحيحانِ إضافيّانِ لأرقامِ الحجزِ (`ح-8`، والنصُّ الأوّلُ يبقى مكتوباً):**

| ما كُتِبَ في الحجزِ | ما قاسَهُ الحاجزُ | سببُ الفارقِ |
|---|---|---|
| «18 صنفاً بلا قاعدةٍ، 17 منها `.rh*`» | **19**، 18 منها `.rh*` | المِسبارُ الأوّلُ الساذجُ لم يقرأْ فرعَ الشرطِ داخلَ الإحلالِ، فسقطَ منه `.rh__service--on` |
| «4 قواعدَ بلا إصدارٍ» | **2** (`.rs__stopped` · `.qt__pending-item`) | `.app-frame*` **تُصدَرُ فعلاً**؛ ظهورُها كانَ خطأَ المُستخرِجِ لا نقصاً في الشِّفرةِ |

**وانحرافٌ مُعلَنٌ عن النطاقِ المحجوزِ — بتضييقِه لا بتوسيعِه:** الحجزُ ذكرَ
سطراً واحداً في `QuoteScreen.tsx` على فرضِ أنَّ `.qt__pending-item` قاعدةٌ نُسِيَ
وصلُها. والتاريخُ نقضَ الفرضَ: كانَت تُصدَرُ في `F2-04` لنصِّ «طلبُ الرحلةِ لم
يُبنَ بعدُ»، ثمَّ **بُنيَ الطلبُ** في `F2-05` فرُفِعَ السطرُ لأنَّ عرضَ نصٍّ
نُقِضَ كذبٌ. **فوصلُها بعنصرٍ آخرَ لإخضرارِ حاجزٍ اختراعُ استعمالٍ** — وهوَ أسوأُ
من حُمرةٍ صادقةٍ — فسُجِّلَت قاعدةً باقيةً بسببٍ ومالكٍ وما أحلَّها،
**والملفُّ لم يُعدَّلْ**.

**وسقفُ الادّعاءِ يُكرَّرُ لا يُختصَرُ:** المقيسُ **وجودُ** قاعدةِ نمطٍ لكلِّ صنفٍ
يُصدَرُ — **لا جمالٌ ولا تناسبٌ ولا وصولٌ مقيسٌ**. مساحةُ اللمسِ ≥44×44 والتمييزُ
بحدٍّ وتعبئةٍ معاً **كُتِبَا** وفقَ `UX-10` **ولم يُقاسا** بأداةِ وصولٍ. ولا نشرَ
حيَّ (`ADR 0099`): **لم يفتحْ راكبٌ هذه الشاشةَ**، وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**.

### Reservation `S-1` — the goal is independence, not integration (opened 2026-09-13, before any file was edited)

حُجِزَ قبلَ أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
الحاكمُ: تعليمةُ المالكِ `O-7` أدناه · `ADR 0094`.

**النطاقُ المحجوزُ، بأربعِ زياداتٍ مُرقَّمةٍ، لا تُدمَجُ في واحدةٍ:**

| # | الزيادةُ | ما تمسُّه | ما يُقاسُ عليها |
|---|---|---|---|
| `S-1` | توثيقُ الهدفِ النافذِ وحُكمِه على كلِّ تبعيّةٍ وحاجزٍ | `ROADMAP.md` · `docs/adr/0094-*` · `docs/ROADMAP-MASTER.md` §25 و§26 · `docs/SYSTEM_STATE.md` · `README.md` · `docs/evidence/architecture/S-1-*` | لا شيءَ يُقلَبُ `[x]`؛ الحكمُ أنَّ CI لم يتغيَّرْ حالُه بوثيقةٍ |
| `S-2` | إغلاقُ `O-1` في جذرِه: `operational_jobs` يحملُ `city_id` مُستَلَماً، وجدولا مرورِ `CORE` يُنقَلانِ إلى تأجيلٍ غيرِ مُطبَّقٍ | `supabase/migrations/2026091110*` · `packages/*/wasla/*` · `scripts/check-core-contract-parity.ts` · `scripts/lib/rollback-registry.ts` · اختباراتُها | خطوةُ `city_id` في `verify` تُقرَأُ **خضراءَ عندَ CI** لا محلّيّاً |
| `S-3` | إغلاقُ `O-2` في جذرِه: Redis حقيقيٌّ مُستضافٌ في الشغلةِ بلا سِرِّ مالكٍ | `.github/workflows/ci.yml` (وظيفةُ Redis وحدَها) | وظيفةُ «تكامل على Redis حقيقي» تُقرَأُ **خضراءَ عندَ CI**، والحاجزُ كما هوَ |
| `S-4` | ضبطُ الميزانِ: أدلّةٌ خامّةٌ إلى `docs/evidence/archive/`، وتجاربُ `bench/`/`probe/` إلى مسارٍ جانبيٍّ، وحاجزٌ يمنعُ عودتَهما | `docs/evidence/**` · `bench/**` · `probe/**` · `scripts/check-docs-budget.ts` (جديدٌ) · `package.json` | الحاجزُ الجديدُ يُقاسُ بخرقٍ مزروعٍ لا بالمستودَعِ كما هوَ |
| `S-5` | **حجزٌ خامسٌ زِيدَ 2026-09-13 بعدَ إتمامِ الأربعِ**، بتعليمةِ المالكِ «هيّئ قاعدةَ البياناتِ لهذا الهدفِ»: تهيئةُ قاعدةٍ حقيقيّةٍ بالمُطبِّقِ المُعتمَدِ (`ADR 0068`) حتّى آخرِ هجرةٍ، ثمَّ **قياسُ ما كانَ يُتخطَّى** بها | القاعدةُ الخارجيّةُ (حالةٌ لا ملفّاتٌ) · `ROADMAP.md` · `docs/adr/0098-*` (جديدٌ) · `docs/evidence/architecture/S-5-*` · `docs/SYSTEM_STATE.md` | العددُ المقيسُ من حالاتِ التكاملِ التي **نجحَت على قاعدةٍ حقيقيّةٍ** — لا وجودُ الهجرةِ ولا خُطّةُ تطبيقٍ |

**ما هوَ خارجَ هذا الحجزِ صراحةً:** لا يُمَسُّ نصُّ بندٍ ولا معيارُ قبولٍ
(`ح-1`)، ولا يُحذَفُ بندٌ ولا دليلٌ ولا هجرةٌ ولا عقدٌ منقولٌ (`ح-2`)، ولا
يُضعَّفُ حاجزٌ ولا يُصنَّفُ اختبارٌ تخطياً (`ح-7`)، ولا يُمَسُّ `B-1`/`B-2`/`B-4`.

**تحقُّقٌ من عدمِ تعارضٍ، قِيسَ قبلَ إنشاءِ الفرعِ:** لا فرعَ ولا طلبَ سحبٍ قائمٌ
يحملُ `S-1`…`S-4` ولا يمسُّ خطوةَ `city_id` ولا وظيفةَ Redis. أحدَ عشرَ فرعاً
قديماً على الأصلِ مدموجةٌ أو متروكةٌ، وثلاثةَ عشرَ طلبَ سحبٍ كلُّها `MERGED`.

#### تصحيحٌ بالإضافةِ على مسارِ `S-2` — سُجِّلَ 2026-09-13 بعدَ قياسِ الجذرِ

جدولُ الحجزِ أعلاه **يبقى بنصِّه** (`ح-1` · `ح-8`)، وفيهِ عن `S-2`:
«`operational_jobs` يحملُ `city_id` مُستَلَماً». وقياسُ الجذرِ أبطلَ ذلكَ
المسارَ، فلا مصدرَ مدينةٍ في الجدولِ ألبتّةَ: مفاتيحُه معرّفاتٌ مُعتِمةٌ من
`CORE` (`fulfillment_id` · `organization_id`)، وجدولُ المنتجِ المدينيُّ هوَ
`orders` (`city_id uuid not null references cities(id)`). فعمودٌ يُضافُ إليهِ
عمودٌ **مختلَقٌ** يُنتِجُ خُضرةً كاذبةً.

**المسارُ المُنفَّذُ بدلاً منه:** إخراجُ تكاملِ `CORE` بكاملِه من مسارِ التطبيقِ
إلى `deferred/core-integration/` — ستُّ هجراتٍ واختبارا تكاملٍ، بـ`git mv` لا
بحذفٍ — مع حاجزٍ يُقفِلُ المنطقةَ، وتفريقٍ مُعلَنٍ بينَ الهجرةِ **المُطبَّقةِ**
والهجرةِ **المُعلَنةِ** يقرأُ كلُّ حاجزٍ ما يخصُّه. الحاكمُ:
`docs/adr/0095-deferred-area-for-core-integration.md`. ولا حاجزَ ضُعِّفَ، ولا
استثناءَ `city_id` وُسِّعَ، ولا صفَّ تصنيفٍ حُذِفَ.

#### تنفيذُ `S-3` — سُجِّلَ 2026-09-13

جدولُ الحجزِ أعلاه يقولُ عن `S-3`: «Redis حقيقيٌّ مُستضافٌ في الشغلةِ بلا سِرِّ
مالكٍ»، وهذا **ما نُفِّذَ بعينِه** — لا تصحيحَ ههنا. سببُ الأحمرِ الدائمِ في
وظيفةِ Redis أنَّ نقطتَها قُرِئَت من سِرَّينِ غيرِ مضبوطَينِ في المستودعِ، فسقطَت
في كلِّ جريةٍ عندَ `assertRealRedisWhenRequired` ولم تُقَسْ أربعٌ وعشرونَ حالةً
حقيقيّةً قطُّ.

فصارَت الوظيفةُ تملكُ خادمَها: `redis:7-alpine` + قشرةُ REST تُنطِقُه بروتوكولَ
Upstash الذي يتكلّمُه كودُ الإنتاجِ. والحاجزُ `tests/support/real-redis.ts` **لم
يُمَسَّ بحرفٍ**؛ إنّما استُوفيَ شرطُه. وزِيدَ حاجزٌ
`scripts/check-real-redis-runner.ts` يقيسُ اتّفاقَ المنفذِ والرمزِ ووصلَ القشرةِ
بالخادمِ، فلا تعودُ الوظيفةُ صامتاً إلى نقطةٍ بلا خادمٍ. الحاكمُ:
`docs/adr/0096-self-hosted-real-redis-in-ci.md`.

#### تنفيذُ `S-4` — سُجِّلَ 2026-09-13

جدولُ الحجزِ أعلاه يقولُ عن `S-4`: «أدلّةٌ خامّةٌ إلى `docs/evidence/archive/`،
وتجاربُ `bench/`/`probe/` إلى مسارٍ جانبيٍّ، وحاجزٌ يمنعُ عودتَهما». ونُفِّذَ
ذلكَ، **وتُصحَّحُ ههنا فرضيّةٌ في نصِّ الحجزِ بالإضافةِ لا بالمحوِ (`ح-8`)**:

**التصحيحُ الأوّلُ — حجمُ التوثيقِ.** كانَ المفترَضُ أنَّ التوثيقَ أكبرُ من
الكودِ. والمقيسُ: `docs/` **63 389** سطراً مقابلَ **115 189** سطرَ كودٍ مُطبَّقٍ
— نسبةٌ 0.55. فالخللُ **توزيعٌ ومسارٌ**: 15 وثيقةً كلٌّ منها فوقَ 400 سطرٍ، و48
مُخرَجاً خامّاً وسطَ ما يُقرَأُ، و14 400 سطرٍ من تجاربَ ميدانيّةٍ في مسارِ
البناءِ. وعلى هذا بُنيَ الحاجزُ: **سقّاطةٌ** تمنعُ النموَّ، لا سقفٌ يُرغِمُ على
تخفيفِ نفسِه.

**التصحيحُ الثانيَ — الأدلّةُ الخامّةُ.** من 48 مُخرَجاً، **7** فقط لا يُشيرُ
إليها ملفٌّ واحدٌ فنُقِلَت إلى الأرشيفِ. والباقيةُ 41 مُشارٌ إليها من وثائقِ سجلٍّ
وصفوفِ §25، ونقلُها يكسرُ إشاراتٍ مُلتزَمةً؛ فجُمِّدَت في خطِّ الأساسِ **دَيناً
مُعلَناً** في §7 من الدليلِ، ولم تُحذَف (`ح-2`).

**وما زادَ على نصِّ الحجزِ:** ستُّ ملفّاتِ اختبارِ `bench` نُقِلَت معَ التجاربِ،
لأنَّ `check-deferred-area` يمنعُ استيرادَ الشجرةِ الحيّةِ من `deferred/`؛
و`tsconfig.json` صارَ يُدرِجُ `deferred/**/*.ts` فدخلَ المؤجَّلُ كلُّه في فحصِ
الأنواعِ — **77 حالةً تُقاسُ · 0 تفشلُ**، ولا حالةَ صُنِّفَت تخطّياً بالنقلِ.
**وثالثاً — أمسكَ الحاجزُ مُنشِئَه:** أوّلُ جريةٍ له سقطَت على نموِّ
`docs/ROADMAP-MASTER.md` بصفِّ §25 لهذا البندِ. فأُعلِنَ سِجِلّانِ سياديّانِ
(`ROADMAP-MASTER` و`SYSTEM_STATE`) مُستثنيانِ من **السقّاطةِ** وحدَها لأنَّ §25
و`ح-8` يُوجِبانِ الزيادةَ فيهما — لا من قاعدةِ النسبةِ، وسطورُهما تُحسَبُ في
المجموعِ. الحاكمُ: `docs/adr/0097-docs-budget-ratchet-and-field-experiment-quarantine.md`،
والدليلُ: `docs/evidence/architecture/S-4-DOCS-BUDGET-20260913.md`.

#### تنفيذُ `S-5` — سُجِّلَ 2026-09-13

جدولُ الحجزِ أعلاه يقولُ عن `S-5`: «تهيئةُ قاعدةٍ حقيقيّةٍ بالمُطبِّقِ المُعتمَدِ
حتّى آخرِ هجرةٍ، ثمَّ قياسُ ما كانَ يُتخطَّى بها». وقعَ ذلكَ على القاعدةِ التي
سلَّمَها المالكُ (PostgreSQL 17.6 + PostGIS، مُجمَّعٌ في `ap-southeast-2`):

- **آخرُ هجرةٍ مُطبَّقةٍ استُنتِجَت من المخطَّطِ** لا من سجلٍّ ولا من دعوى — إذ
  القاعدةُ بلا سجلِّ هجراتٍ بقرارِ `ADR 0068` — فقُوبِلَ كلُّ `create table` في
  ستٍّ وتسعينَ هجرةً بما تقرأُه `information_schema`، فبانَ الحدُّ
  `20260909110000`.
- **طُبِّقَت الاثنتا عشرةَ الباقيةُ بـ`scripts/migrate.ts --from`** وحدَه، لا
  بـ`psql` عارياً ولا بلوحةِ مُزوِّدٍ؛ فصارَت جداولُ `public` **68** بعدَ **46**،
  وتحقَّقَ وجودُ الأربعةِ الناقصةِ بالاسمِ.
- **الاسترجاعُ قِيسَ**: أُعيدَ الأمرُ نفسُه على القاعدةِ نفسِها فنجحَ كلُّه —
  أوّلُ قياسٍ لاسترجاعِ ما بعدَ خطِّ التقادُمِ على قاعدةٍ مُدارةٍ خارجَ CI.
- **ما كانَ يُتخطَّى صارَ مقيساً جزئيّاً**: `397` حالةَ تكاملٍ نجحَت على محرِّكٍ
  حقيقيٍّ (من `617` في `85` ملفّاً)، و`212` من `220` ساقطةً سقطَت **على مهلةِ
  الحالةِ** لا على حكمٍ، والسببُ رقمٌ لا انطباعٌ: `select 1` من هذا المحلِّ
  **197 مِلّي ثانيةً** وسطاً.
- **ولم تُرفَعْ مهلةٌ، ولم يُصنَّفْ ساقطٌ تخطّياً، ولم يُمَسَّ حاجزٌ ولا اختبارٌ.**
  سلطةُ الحكمِ تبقى وظيفةَ «تكامل على PostgreSQL حقيقي» في CI حيثُ الخادمُ في
  الشغلةِ نفسِها. ودورُ هذه القاعدةِ: تهيئةٌ وجهوزيّةُ نشرٍ ومحلُّ تجربةٍ للمنتجِ.

الحاكمُ: `docs/adr/0098-external-database-readiness-and-the-limit-of-measuring-from-here.md`،
والدليلُ: `docs/evidence/architecture/S-5-DB-READINESS-20260913.md`.

#### تحقيقُ المهلةِ — سُجِّلَ 2026-09-13 (`ADR 0099`)

أمرَ المالكُ بحسمِ سببِ الـ212 مهلةً قبلَ الانتقالِ إلى `F2-01`. فقِيسَت
**فرضيّةُ السؤالِ أوّلاً فبطَلَت**: وظيفةُ CI لا تتّصلُ بـSupabase أصلاً، بل
بخادمِ خدمةٍ في المُشغِّلِ نفسِه (`ci.yml:452,460,499,504,561`)، فالمهلةُ لم
تُخرَقْ في CI ولا مرّةً؛ وإنّما في محلِّ تنفيذِ الوكيلِ (مقيسٌ: Virginia) نحوَ
مُجمَّعٍ في `ap-southeast-2`. وتفكيكُ الزمنِ حسمَ الأمرَ: `select 1` = 198.0ms،
و`pg_sleep(0.5)` = 701.2ms (ثابتٌ 201.2ms)، وعشرةٌ متسلسلةً = 2108.8ms، وعشرةٌ
**في ذهابٍ واحدٍ** = 198.1ms، والتنفيذُ داخلَ الخادمِ = 0.005ms ⇒ الكلفةُ **ذهابُ
شبكةٍ واحدٌ** لا بطءُ محرِّكٍ. **فلم تُرفَعْ مهلةٌ ولا حالةَ صُنِّفَت تخطّياً**
لأنَّ شرطَ الرفعِ («خصوصيّةُ بيئةِ CI») لم يقعْ. وسُجِّلَ البطءُ البنيويُّ شرطَ
**منتجٍ**: قاعدةُ إنتاجٍ تخدمُ السعوديّةَ لا تكونُ في `ap-southeast-2` بل
`eu-central-1` أو `me-south-1` (`render.yaml:25`)، وتقليلُ الاستعلاماتِ
المتسلسلةِ في المسارِ الواحدِ عملٌ مُرقَّمٌ. والقياسُ من داخلِ خدمةِ Render لا
موضوعَ لهُ اليومَ: ثلاثةُ مُضيفاتٍ تُرَدُّ `404` بترويسةِ
`x-render-routing: no-server` — حاجزٌ مُعلَنٌ. وأُلحِقَ بالمستودَعِ ما يُعيدُ
القياسَ في أيِّ محلٍّ: `scripts/measure-db-rtt.ts` وشغلةٌ **يدويّةٌ**
`.github/workflows/db-rtt-diagnostic.yml` (لا بوّابةٌ ولا سِرَّ فيها).

### Reservation `F2-01` — the welcome and consent record, the first product screen in the repository (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `F2-01` — «SR-01 الترحيب والموافقات بختم زمني مسجَّل» (`docs/ROADMAP-MASTER.md` §9.5). This is the **first** item of `F2`, and `F2` is `0/12`: the three role surfaces delivered by `F1-05` are deliberately empty states and no product screen exists yet. |
| Why this item is executable today | It needs **no** open owner decision. `O-1` blocks three `W-` tables that lack `city_id`; the consent record is anchored to `users`, which already carries `city_id not null` since the `2026-08-06` core schema, so rule 0.4 is satisfiable without CORE's geography. `O-2`, `O-3`, `O-4`, `O-6` are about Redis secrets, CORE credentials and CORE read access, none of which this screen touches. Its dependencies `F1-03`, `F1-04`, `F1-05`, `F1-07`, `F1-08` are all delivered, and `GET /v1/me` with `resolveViewer` already provides object-level session identity. |
| Branch | `feat/f2-01-welcome-and-consents`, cut from `main`@`d71c8b7` |
| The contradiction this item walks into, named before it is resolved | §9.5 `SR-01` lists «طلب إذن الموقع» as part of the welcome screen. §9.12 states «كل إذن يُطلب في لحظة الحاجة لا مقدماً». These cannot both be honoured: asking for location on the welcome screen **is** asking ahead of need, since nothing on that screen uses a location. Per `ح-1` the §9.5 text stays exactly as written; the resolution is recorded in a new ADR and §9.12 wins, because it is the clause that carries a regulatory obligation (§16) while §9.5 is a screen inventory. The welcome screen therefore records **consent to documents** and does **not** request the location permission. |
| The rule this increment obeys and cannot yet enforce | §9.11 requires that no string be written inside a component and that a CI gate forbid hardcoded text. **That gate does not exist**, and `apps/miniapp` currently carries 46 user-facing Arabic literals outside any dictionary (measured, in `state-text.ts`, `SystemScreen.tsx`, `client.ts`, `sink.ts` and the three `F1-05` surfaces). This increment routes **its own** text through `packages/shared/i18n` in all three languages, and does **not** add a repository-wide gate it would immediately have to exempt six files from — an exempted gate is a gate that does not judge. The 46 literals and the missing §9.11 gate are recorded below as a finding, and are a separate increment. |
| Scope reserved | `packages/domain/consent/` (new — declared consent documents and the pure decision: is onboarding satisfied, and is a submitted consent admissible) · `packages/application/consent/` (new — the record-consent use case with a persistence port, idempotent per user and document version) · `apps/gateway/src/routes/consents.ts` (new — `GET /v1/consents`, `POST /v1/consents`) · `apps/gateway/src/server.ts` (**additive** composition only) · one new migration under `supabase/migrations/` (a `user_consents` table carrying `city_id`, RLS enabled at creation, and an atomic RPC per rule 0.5) · `apps/miniapp/src/surfaces/rider/` (new welcome screen, composed **into** `RiderRoot` without removing its empty state for the not-yet-built `F2-02`…) · `packages/shared/i18n/{ar,en,ur}.json` (**additive** keys only) · `scripts/check-consent-documents.ts` (new guard) · `package.json`, `.github/workflows/ci.yml` (**additive**, the new guard placed **before** the red `city_id` step so it receives a verdict) · new tests under `tests/unit/`, `tests/integration/` and `apps/miniapp/src/**` · `docs/adr/0092-*`, `docs/adr/0093-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/evidence/` |
| Scope **not** reserved and not touched | The 46 hardcoded literals and the §9.11 gate (finding below, separate increment) · `scripts/check-migrations.ts` and rule 0.4 (`O-1`, owner) · the real-Redis test (`O-2`) · every vendored contract byte and `PROVENANCE.md` (`DEP-CORE-005`) · `scripts/check-core-contract-parity.ts` · the existing `F1` screens' text · `docs/adr/0001`…`0091` (`ح-6`) · the twelve stale branches · `F2-02`…`F2-12`, which are **not** started here and whose absence the welcome screen must state honestly rather than imply |
| Claim ceiling | This increment may **not** mark `F2-01` `[x]`, and may **not** claim the `F2` gate. The `F2` gate requires «رحلة كاملة من البداية إلى النهاية بلا لمس محادثة البوت، على جهاز حقيقي، مسجَّلة بالفيديو» — one screen out of twelve cannot approach that, and no real device is reachable from here. `ح-4` additionally wants three consecutive green CI rounds, which is unreachable while `O-1` keeps `verify` red at `city_id`. What may be claimed once CI has judged it: a consent cannot be recorded without naming a declared document version, the record is idempotent and carries `city_id`, the screen states what does not exist yet, and its text lives in the dictionaries in all three languages. |

#### Outcome of reservation `F2-01`, and two corrections to the reservation text above (2026-09-12, additive — nothing above is deleted)

**Correction 1 — the literal count.** The reservation above says `apps/miniapp`
carries **46** user-facing Arabic literals outside any dictionary. Re-measured at
the end of the increment with comments stripped and only quoted literals
containing an Arabic character counted, across `apps/miniapp/src/**/*.{ts,tsx}`
excluding tests and excluding the new `welcome/` files, the number is **48 in 7
files**. The earlier figure is left in place as the record of what was measured
when the scope was reserved; the difference is a measurement difference, not a
regression introduced here — the new `F2-01` files contain **zero** such
literals. The §9.11 CI gate still does **not** exist and is still a separate
increment.

**Correction 2 — one registry cascade was not foreseen.** The reserved scope
lists the new guard, the migration and the surfaces, but not the six repository
registries that a new table and a new skipped test file invalidate. All six were
failing guards, each was a real failure rather than noise, and each was closed by
**classifying** rather than exempting: `scripts/lib/skip-registry.ts` (+1 entry,
`TEST_DATABASE_URL`-gated, critical path chosen from the existing closed list
without widening it), `tests/unit/skip-audit.test.ts` (pinned 86/770 → 87/778),
`packages/shared/config/retention-policy.ts` (`auditUnboundedUntilCompliance`),
`scripts/lib/wasla-boundary-registry.ts` (`CORE` / `MOVE_TO_CORE`),
`scripts/lib/wasla-migration-matrix.ts` (`READ_THROUGH_CORE`, wave 5) plus the
regenerated `docs/migration/matrix.md`, `docs/wasla/boundary-audit.md`,
`docs/wasla/blockers.md` and `docs/wasla/cutover-plan.md`, and
`tests/unit/check-migration-matrix.test.ts` (pinned 47 → 48, raised by hand on
purpose: reading the count from the inventory would make the assertion true by
construction). `packages/infrastructure/db/schema-contract.ts` was regenerated
for the two new functions. **No CORE file was touched**; the cross-repository
consequence is registered as `DEP-CORE-008` below.

**What was built.** Four layers plus a guard: a declared consent-document
registry and a pure admissibility/onboarding decision in `packages/domain/consent/`;
a `record-consent` use case stamping the server clock and re-reading the store
after the write in `packages/application/consent/`; migration
`20260912210000_f2_01_user_consents.sql` creating `user_consents` with
`city_id not null references cities(id)`, a unique `(user_id, kind, version)`,
RLS enabled with a `service_role`-only policy and two atomic RPCs;
`GET`/`POST /v1/consents` in `apps/gateway/src/routes/consents.ts` with a 1024-byte
body limit; 31 dictionary keys in `ar`/`en`/`ur`; the rider welcome screen; and
`scripts/check-consent-documents.ts` wired into both `bun run ci` and CI **before**
the known-red `city_id` step so it actually receives a verdict.

**Measured, locally, not a CI verdict.** `bun test tests/unit apps` → 3166 pass ·
0 fail · 11239 expects · 209 files. `tests/integration/user-consents.test.ts`
against real PostgreSQL 18.6 → 8 pass · 0 fail · 26 expects. `lint`, `typecheck`
clean. Mini-app first load 71.1 KB gzip of a 180.0 KB budget, 6 first-paint
requests of 6 (§9.9). Every `scripts/check-*` in the `ci` chain green **except**
`check-migrations`, which stays red on the inherited rule-0.4 violations owned by
`O-1` and was neither weakened nor exempted. Full record:
`docs/evidence/architecture/F2-01-CONSENT-20260912.md`.

**Not claimed.** `F2-01` is **not** `[x]` and the `F2` gate is **not** approached:
that gate is a complete ride on a real device recorded on video. RLS is measured
as *enabled*, not as *enforced* — the test connection is the database owner, and
the test says so in its own text. The legal wording of the two documents is not
owner-approved; what exists is the versioning-and-timestamp mechanism. `ح-4`'s
three consecutive green CI rounds are unreachable while `O-1` keeps `verify` red.

**A deliberate, declared deviation.** §10 asks every command to carry an
`Idempotency-Key`. This route does not require one: idempotency is structural via
the unique `(user_id, kind, version)` key, so a repeat returns `already_recorded`
with the **original** timestamp. Recorded in ADR-0092, with the §9.5-versus-§9.12
permission contradiction resolved in ADR-0093 (the welcome screen states that
location will be asked for later and never calls `navigator.geolocation`; the
§9.5 text is unchanged per `ح-1`).

#### CI verdict ledger — branch `feat/f2-01-welcome-and-consents` (additive, newest last · `ح-8`)

**Round 1 — `56de922`, run `34718507883`.**

| Job | Verdict |
|---|---|
| `verify` | ❌ at step **25** `منع أي جدول بلا city_id` — the inherited sovereign block (`O-1`). Steps 1–24 all passed, **including the two new `F2-01` guard steps 23 and 24**, and including `منع الأرقام التجارية المرمَّزة` so the new block-scoped exception was judged by CI and not only locally. |
| `تكامل على PostgreSQL حقيقي` | ❌ at step **11** — **a real defect from this branch**, root-caused below. |
| `تكامل على Redis حقيقي` | ❌ `O-2`, inherited from `main`. |
| `فوضى متعدد المثيلات (F5-06)` | ✅ |
| `Roadmap freshness` | ✅ |

**The defect, and why local green was not a verdict.** In PostgreSQL `execute` is
granted to `public` the moment a function is created, and both new RPCs are
`security definer`. So any `anon` key holder could write a consent in any
`telegram_id`'s name and read anyone's consents, bypassing RLS entirely — a
security defect, not a test defect. It was caught by
`tests/integration/database-privilege-surface.test.ts:91` and
`tests/integration/security/adversarial-security.test.ts:352`, two **repository-wide**
integration files that enumerate every function in the schema. Locally only the
new consent file had been run, so nothing looked at the privilege surface. Fixed
at the source by adding `revoke execute … from public, anon, authenticated` to
the migration itself — the pattern every other function here already follows, so
the defect was an omission against an existing pattern, not a new judgement call.
No test was edited, no file exempted, nothing moved up a layer. The obligation
was then **tightened**: a ninth assertion in `tests/integration/user-consents.test.ts`
reads `has_function_privilege` for both functions by name and requires they exist
first so it cannot pass on an empty list (skip registry 8 → 9, pinned audit
778 → 779, both additive).

**Round 2 — `f89fc24`, run `34719006943`.**

| Job | Verdict |
|---|---|
| `verify` | ❌ at the inherited `city_id` step only (`O-1`) |
| `تكامل على PostgreSQL حقيقي` | ✅ — **the branch defect is gone from CI's own verdict** |
| `تكامل على Redis حقيقي` | ❌ `O-2`, inherited |
| `فوضى متعدد المثيلات (F5-06)` | ✅ |
| `Roadmap freshness` | ❌ — **a second real defect from this branch**: the fix commit changed `scripts/lib/skip-registry.ts` and the migration without touching `ROADMAP.md` in the same cycle, which `scripts/check-roadmap.mjs` forbids as a hard rule. The guard was right; this ledger section is the fix, and it is also what the standing instruction to keep a per-branch CI ledger here asks for. |

So after round 2 the only red owned by this branch was the missing ledger entry,
and the rest is `O-1` and `O-2` — two declared sovereign blocks whose owner is
not the repository executor. Still **no** `[x]` for `F2-01` and no `F2` gate
claim.

**Round 3 — `b42945e`.** `Roadmap freshness` ✅, `verify` ❌ at the inherited
`city_id` step only, `فوضى متعدد المثيلات` ✅, Redis ❌ `O-2`. The real-PostgreSQL
job was run **twice on this identical commit** (GitHub scheduled one run for the
push and one for the pull request): run `34719289623` **passed**, run
`34719287936` **failed**, both on byte-identical code.

**Finding `OPS-017` — an intermittent failure that is not this branch's, recorded
rather than absorbed.** The failing assertion is
`tests/integration/location-race-conditions.test.ts:387`
(«ساعتانِ متباعدتانِ…»), `Expected: 3, Received: 2` — the **last published**
sequence on the second driver's channel versus that session row's
`last_sequence`. This is the same shape of obligation that `OPS-016` already
diagnosed and repaired at line 210 of this same file: the sequence is assigned
inside one `update`, while publication happens after the transaction closes and
outside any lock, so an assertion tying *what has been observed on the bus* to
*what the row now holds* is sensitive to interleaving. **That is a hypothesis,
not a proven diagnosis, and it is written here as a hypothesis.** What is
measured: the file is untouched by this branch (`F2-01` touches no tracking,
session or location code — `git diff` confirms it); the identical commit both
passed and failed in CI; and six consecutive local runs against real PostgreSQL
18.6 were green (`4 pass · 0 fail` each). No assertion was weakened, no test was
skipped, no owner was invented, and `OPS-017` is **not** claimed fixed. Repairing
it is a separate increment against this file, and doing it inside `F2-01` would
be editing code outside the reserved scope.

**Round 4 — `4c2ce36`, runs `34719612525` and `34719610983` (both on the same
commit).** `Roadmap freshness` ✅ · `تكامل على PostgreSQL حقيقي` ✅ **in both
runs** · `فوضى متعدد المثيلات (F5-06)` ✅ · `verify` ❌ at step **25**
`منع أي جدول بلا city_id` and nothing else · Redis ❌ at step **8**
`اختبارات الجلسات على Redis حقيقي`. Both remaining failures are the two declared
sovereign blocks inherited from `main` (`O-1`, `O-2`), read step-by-step from
CI's own job API rather than inferred. **No red on this branch is owned by this
branch.** Merged on that verdict under the owner's standing merge instruction.
`ح-4` is still not satisfied — three consecutive fully green rounds are
unreachable while `O-1` and `O-2` are open — so `F2-01` stays unmarked.


### Reservation `F2-01` (closure node) — the claim ceiling is lifted by the removal of its cause, not by preference (opened 2026-09-13, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25. **Nothing of `F2-01` is rebuilt here.**

| Field | Value |
|---|---|
| Item | `F2-01` — closure node only: read the acceptance text against the code that already exists on `main`, measure what was skipped on 2026-09-12, then flip the symbol if and only if CI rules green. |
| Branch | `feat/f2-01-closure`, cut from `main`@`9b7b54f` |
| Why the ceiling above no longer holds | The ceiling recorded on 2026-09-12 rested on two named causes: `O-1` kept `verify` red at `city_id`, and `O-2` kept the Redis job red — so three consecutive fully green rounds were unreachable. **Both are closed**: `O-1` by `S-2` and `O-2` by `S-3`, and `main` then ruled green in runs `34732986162`, `34734205137` and `34734666105` with all four jobs. The second cause was that `tests/integration/user-consents.test.ts` was `describeIf`-skipped for want of a real database; `S-5` migrated one to the last migration, and the file now runs. |
| What is measured here | The nine integration cases against the real managed database (9/9, 9.97s) and the 54 unit cases of the item. This raises «consent with a recorded timestamp» from **tested** to **verified** by the §1.4 ladder — and no further. |
| Scope reserved | `tests/unit/gateway-graceful-shutdown.test.ts` (test harness only) · `docs/adr/0100-*` (new) · `docs/evidence/architecture/F2-01-CLOSURE-20260913.md` (new) · `docs/ROADMAP-MASTER.md` (§9.5 symbol + one §25 row) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` |
| Scope **not** reserved | Every byte of `F2-01`'s own implementation — migration, routes, domain, application, screen, dictionaries, guard: **not touched**, because the item is being read, not rebuilt · `apps/gateway/src/index.ts` and all production code · the 48 hardcoded literals and the missing §9.11 gate · `F2-02`…`F2-12` · the `F2` gate itself |
| The red this node inherited and owns | Run `34734754215` on `9b7b54f` — a **docs-only** tree — failed `verify` at step 8: one case in `gateway-graceful-shutdown` timed out at 40s because the spawned gateway died of `EADDRINUSE` on port 33096. The port was computed from `process.pid`, which prevents collisions inside the file and not with any other occupant on the runner. Repaired at the root in `ADR 0100`: the port is asked of the system (`port: 0`), retried up to four times **on `EADDRINUSE` only**, and the wait stops the moment the child exits. **No timeout raised, no assertion weakened, no case skipped, no production code touched.** |
| Claim ceiling of this node | The `F2` gate is **not** claimed — it requires a full end-to-end trip on a real device, recorded on video, and one item of twelve cannot approach it. No live deployment exists (Render holds no service, measured in `ADR 0099`), so no real user has opened this screen. `مَقيس` and `مُثبَت` are **not** claimed. |

#### Outcome `F2-01` (closure node) — recorded 2026-09-13

The acceptance text of `SR-01` reads, per item, against code already on `main`:
the three-line explanation and the `ابدأ` action live in the dictionaries
(`welcome.line.1..3`, `welcome.start`) in `ar`/`en`/`ur`; the language picker is
`WelcomeScreen.tsx`'s `languagePicker` with `aria-pressed` and a derived `dir`;
the timestamped consent is `user_consents` plus `record_user_consent`, stamping
the **server** clock; and the location permission is excluded by published
decision `ADR 0093` (§9.12 beats a screen inventory in §9.5) — declared, not
silenced, and the item text is untouched (`ح-1`).

Measured locally: integration **9 pass · 0 fail · 28 assertions · 9.97s**
against the real database; unit **54 pass · 0 fail · 293 assertions**; the
repaired shutdown file **3 pass · 0 fail · 15.11s**. Evidence:
`docs/evidence/architecture/F2-01-CLOSURE-20260913.md`, which keeps the
2026-09-12 evidence file intact beside it (`ح-8`: corrections are additive).


**Follow-up on the same root cause (recorded, not hidden).** One of the two CI
runs on `be67f25` went red in `تكامل على PostgreSQL حقيقي` step 11 while the
other run on the **same tree** was green — a race, not a logic fault. The log
names it: `Failed to start server. Is port 46602 in use?` in
`tests/integration/admin-service-separation.test.ts`, whose port was computed
`39_000 + (pid % 1_000) * 10 + 1` — the identical falsified argument in a second
place. `reserveFreePort` therefore moved to `tests/support/free-port.ts`, both
files import it, and `spawnService` retries four times **on port conflict only**
while reading the child's `exitCode` each poll. Measured after the repair
against the real managed database: **3 pass · 0 fail · 6.85s** (the failing case
alone used to burn 30086.45ms of timeout). No timeout raised, no assertion
weakened, no case skipped, no production code touched. `ADR 0100` addendum.


### Reservation `F2-02` — the rider home surface, its two saved-place endpoints and its recent destinations (opened 2026-09-13, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25. Cut from `main`@`82a493d` as `feat/f2-02-home`.

| Field | Value |
|---|---|
| Item | `F2-02` — `SR-02`: mini map with my location, an «إلى أين؟» field, saved places (home/work), the last 3 destinations, service chips, and the city status strip. Nothing of it exists on `main` today, so this is a build, not a reading. |
| Contracts it must serve | `GET /v1/me/places` · `POST /v1/me/places` · `GET /v1/me/recent-destinations` (§9.8 lists all three against `SR-02`). |
| Increment 1 (this push) | Schema only: `saved_places` + three functions + privilege revocation, and the four indexes each in its own `index`-phase file because `create index concurrently` cannot run inside the applier's transaction. |
| Why no table for recent destinations | «Last 3 destinations» is not new data — it is a **read** of `orders.dropoff`/`dropoff_label`, which exist since the base schema. A second table would become a second source of truth that drifts silently on every cancellation or correction and needs a synchroniser nobody owns. Saved places get a table because they are a **user's decision**, not a transaction's trace. |
| Measured on the real managed database | Migrations applied in order (`5930ms` + four concurrent indexes), then the three functions exercised: `home` twice ⇒ `created` then `updated` with the label and point replaced and **no second row**; `other` ⇒ `created` (open list by design, `SR-12` owns its management); `list_saved_places` returns home first then the rest; two orders whose labels differ only by surrounding whitespace fold into **one** recent destination; an unknown telegram id ⇒ `USER_NOT_FOUND` with no row created (`ADR 0035`). |
| Scope reserved | `supabase/migrations/20260913050000..050400` · `packages/domain/places/*` · `packages/application/places/*` · `packages/infrastructure/places/*` · `apps/gateway/src/routes/me-places.ts` and its mounting · `apps/miniapp/src/surfaces/rider/home/*` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (new keys only) · `scripts/check-place-kinds.ts` · tests for the above · `docs/adr/0101-*` · `docs/evidence/architecture/F2-02-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| Scope **not** reserved | `F2-01`'s files · the pricing, quote and ride-creation contracts (`F2-04`, `F2-05`) · map provider selection (`MAP_PROVIDER` stays as configured; the mini map must degrade honestly when it is `none`) · the 48 hardcoded literals and the missing §9.11 gate · any change to `orders` |
| Increment 2 (this push) | The three layers and the three endpoints: `packages/domain/places/place-kinds.ts` (kind list, singleton kinds, label and coordinate admission), `packages/application/places/{ports,manage-places}.ts`, `packages/infrastructure/places/places-store.ts`, `apps/gateway/src/routes/me-places.ts` mounted optionally in `server.ts` and composed in `index.ts`, the guard `scripts/check-place-kinds.ts` with two named CI steps, twelve i18n keys × three languages, and 22 unit tests (11 route + 11 guard) that all pass locally. |
| Why a guard and not a comment | The kind list lives in three places at once — the domain module, the `check` constraint, and the partial unique index's `where`. A kind in the code but not the constraint is a button that always fails; a kind in the constraint but not the code is a write surface nobody reads; a singleton kind missing from the index's `where` means the screen shows one card while the table holds many rows, and the first one the user saved becomes unreachable. The guard compares all three set-by-set, and its own negative tests seed each divergence rather than asserting the repository passes today. |
| Increment 3 (this push) | The integration test on the real managed PostgreSQL (`tests/integration/me-places.test.ts`, 13 tests · 51 assertions, all pass: foreign key, RLS, the four indexes, created-then-updated with no second row, the unique index refusing a second home through **direct insert** that bypasses the function, the open `other` list, declared ordering, blank-label and unknown-kind refused **by the constraint** not by code, `USER_NOT_FOUND` with no row created, the city inferred from the owner's row, recent destinations derived from `orders` with duplicates folded and the limit honoured, no second table for them, and `execute` revoked from `public`/`anon`/`authenticated`), and the `SR-02` surface itself: `apps/miniapp/src/surfaces/rider/home/{places-api.ts,home-view.ts,HomeScreen.tsx}` mounted in `RiderRoot` after the welcome screen, plus 15 tests (9 pure view + 6 first-output). Six further i18n keys × three languages (49 total) for the title, the continue action, retry, and the three refusal texts. |
| The mini map degrades honestly | The mini app bundle has **no map provider**: `packages/maps` renders dashboard pages **in the server** (`ADR 0007`), so there is nothing to mount client-side. The screen therefore says `rider.home.map.unavailable` and draws **no** grey rectangle that would imply a located user. `mapProvider` is a prop so wiring a real provider later is an argument change, not a rewrite. Device geolocation is not requested and «my location» is not claimed. |
| What the empty state became | `RiderRoot`'s `EmptyState` («لا شيء يُعرَض بعد») is no longer rendered because `SR-02` now exists; its honesty is **carried over** into the screen as three explicit keys — places empty, no recent destinations, map unavailable — rather than deleted into a blank area. The original wording is preserved in a comment per rule `ح-1`. |
| Increment 4 (this push) — a real red, fixed at its root | The first CI verdict on increments 1-2 was **red in `verify` step 8**, and the cause was the new table itself, not the tests: `saved_places` was absent from the two registries every table must appear in — `packages/shared/config/retention-policy.ts` (`F7-06`) and `scripts/lib/wasla-boundary-registry.ts` (`W-1`), the latter also feeding the migration matrix and the cutover plan. Four unit cases failed and they were **right to fail**: a table with no retention class and no boundary disposition is a table nobody has decided anything about. Fixed by deciding: retention `lifecycle-bound-no-timer` (a place the user typed is not log data; account deletion carries it away through the migration's own `on delete cascade`), boundary `CORE` / `MOVE_TO_CORE` with `READ_THROUGH_CORE` in wave 5 alongside `users`, and the three generated documents regenerated from the registries with `--write`. The manual ratchet in `tests/unit/check-migration-matrix.test.ts` was raised 48 → 49 **by hand**, which is exactly what its own comment demands of every new table. **No guard was disabled, no assertion softened, no case skipped.** Full local unit suite afterwards: **2921 pass · 0 fail · 10490 assertions**. |
| Increment 5 (this push) | `ADR 0101` published, the closure evidence file written, and a **second real red fixed at its root**: with step 8 green the `verify` job reached step 44, `scripts/check-schema-contract.ts`, which reported the three new functions missing from `packages/infrastructure/db/schema-contract.ts` — the contract the readiness probe reads. Regenerated with `--write` (98 functions · 25 tables). The earlier runs never reached this step because a job stops at its first failing step, which is exactly why a per-step verdict is read rather than a job-level one. |
| Increment 6 (this push) | Third real red fixed at its root: `verify` step 53 (`check-skip-classification`, `OPS-009`) reported the new integration file as an unclassified skip. It passes locally only because `TEST_DATABASE_URL` is set here, so nothing is skipped; in `verify` there is no database, the suite skips, and the guard rightly refuses an unowned skip. Registered with reason, activation condition, owner and critical path (identity/session/authorization — a saved place is read and written by its owner's session alone), and the deliberate manual counter in `tests/unit/skip-audit.test.ts` raised 87→88 files / 779→792 cases, both **measured by the guard's own output**, not added up in the head. Local suite: 2921 pass · 0 fail · 10492 assertions. |
| Increment 7 (closure) | All four CI jobs green on `3e36a8b` (run `34738858390`), read per job and per step from the API. Governance closure written: the `[x]` flip at the `F2-02` row, ONE §25 ledger row, the closing section in `docs/SYSTEM_STATE.md`, and the CI verdict table in the evidence file filled from real per-step verdicts — including the two reds that were never even reached in the earlier runs because a job halts at its first failing step. |
| Claim ceiling, declared up front | **No live deployment exists** (the Render account holds no service, measured in `ADR 0099`), so whatever closes here **has not been opened by a real user** — this sentence belongs in the closure report too, per the owner's standing instruction. The `F2` gate is not claimed. `مَقيس` and `مُثبَت` are not claimed. |


### Reservation `DEP-CORE-005` — a mechanical freshness comparator for the vendored CORE contracts (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `DEP-CORE-005` — «No mutual repository access, so vendored contract freshness cannot be verified automatically». The `W-5` third increment proved the cost of this gap: `core.fulfillment.cancelled.v1` had been stale since CORE's tenant-scope cycle and nothing in this repository could notice, so MOVE was rejecting every cancellation CORE published. |
| Branch | `feat/dep-core-005-contract-freshness`, cut from `main`@`1d361ea` |
| What is **already** enforced and is therefore **not** rebuilt here | `scripts/check-core-contract-parity.ts` already compares MOVE's runtime declaration against the vendored schemas **semantically**, not textually: equal `required` sets regardless of order, equal property name sets, every executed keyword (`type`, `format`, `enum`, `minLength`, `minimum`, `pattern`) equal per field, `additionalProperties: false` asserted on every schema, orphans rejected in both directions, and any schema keyword the validator does not execute is a failure rather than a silent pass. `scripts/check-vendored-contract-integrity.ts` already recomputes every `sha256` so a vendored file cannot be edited after copying. Neither is re-implemented, re-organised or weakened by this increment. |
| What is therefore genuinely missing | Both existing guards are **internal**: they prove MOVE agrees with the copy it holds, and that the copy was not touched. Neither can see CORE. The missing third comparison is `vendored bytes` versus `CORE's current bytes`, and it is missing for two separate reasons, only one of which is an owner matter: (a) the provenance is **prose**, so no machine can tell which CORE path and commit each vendored file came from — that is fixable here and is fixed here; (b) `uxxxug/wasla-core` is a **private** repository and the CI token of `uxxxug/ceezr` cannot read it, so the comparison cannot run inside `verify` — that needs an owner grant and is registered as `O-6`. |
| Scope reserved | `scripts/lib/vendored-contract-pins.ts` (new — one parser for the provenance record, imported by both the integrity guard and the new comparator, so the pin has **one** reader not two) · `scripts/check-vendored-contract-pins.ts` (new guard, offline, CI-enforceable) · `scripts/check-core-contract-freshness.ts` (new comparator, runs wherever a CORE checkout is readable, **never** in a mode that can pass without one) · `scripts/lib/schema-semantic-diff.ts` (new — semantic differ for JSON Schema and YAML, with breaking-versus-additive classification) · `scripts/check-vendored-contract-integrity.ts` (imports the shared parser; behaviour and exports unchanged) · `docs/contracts/core/PROVENANCE.md` (**additive**: a machine-readable pin block per vendored file; every existing line, fingerprint and section is kept) · `package.json` (two new scripts, added to the `ci` chain) · `.github/workflows/ci.yml` (the pin guard as a named step placed **before** the red `city_id` step, so it actually receives a CI verdict) · `.github/workflows/core-contract-freshness.yml` (new, `workflow_dispatch` only — no schedule, no secret, no automatic run) · new tests under `tests/unit/` · `docs/adr/0090-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/evidence/architecture/` |
| Scope **not** reserved and not touched | `scripts/check-core-contract-parity.ts` (already does its job; touching it would be reorganisation) · the vendored contract **bytes** themselves — the three files re-vendored by open pull request #11 belong to that reservation and are not re-vendored here · `scripts/check-migrations.ts`, rule 0.4, `domain-ingress.ts`, `MASTER_DIRECTIVE.md` (`O-1`, owner) · the real-Redis test and its attestation guard (`O-2`, owner) · `packages/domain/wasla/event-envelope.ts` (reserved by #11) · every migration · `ADR 0084`…`0089` (`ح-6`) · the twelve stale branches and both open pull requests |
| Dependencies checked before opening | `DEP-CORE-005` is the item itself and **stays open** after this increment: the comparator exists and is mechanical, but the comparison it performs cannot be executed by CI until `O-6` is granted, and a check that CI cannot run is not an enforced gate. `O-1`, `O-2`, `O-3`, `O-4`, `DEP-CORE-006`, `DEP-CORE-007` are untouched. A new owner decision `O-6` is registered for read access to CORE's contract directory from this repository's CI. |
| Conflicting work checked | 2026-09-12: #1–#9 merged; **#10 open** (`feat/w9-cutover-plan-readonly-rehearsal`) touching `ci.yml`, `package.json`, `scripts/check-blocker-registry.ts` and cutover files; **#11 open** (`feat/w5-recontract-cancellation-tenant-scope`) touching the three vendored files, `PROVENANCE.md`, `event-envelope.ts`, `scripts/lib/wasla-blockers.ts`. Overlap with this increment is confined to append-only regions of `ROADMAP.md`, `docs/SYSTEM_STATE.md`, `PROVENANCE.md`, `package.json` and `ci.yml`; **no file is edited in the same region by two branches**, and no vendored byte is changed here. |
| Claim ceiling | this increment may **not** mark `DEP-CORE-005` closed and may **not** mark any `W-` item `[x]`. What may be claimed once CI has judged it: the provenance is machine-readable and guarded, and a mechanical comparator exists whose verdict on the real CORE repository has been read and recorded. Freshness itself remains **unverified by CI** while `O-6` is open, and the comparator is required to say so rather than exit green. |

### Reservation `W-5` (third increment) — the cancellation contract drifted at CORE and MOVE would reject every cancellation (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-5` — the CORE↔MOVE event boundary (third increment: the vendored cancellation contract is stale and the drift is **breaking**, not cosmetic) |
| Branch | `feat/w5-recontract-cancellation-tenant-scope`, cut from `main`@`1d361ea` |
| Measured defect | Byte-compared all six vendored schemas in `docs/contracts/core/` against `uxxxug/wasla-core`@`0edb7af` (2026-09-12). Five match exactly. `core.fulfillment.cancelled.v1.schema.json` does **not**: ours is `sha256 ed540b6b…`, CORE's is `sha256 cd9d8369…`. CORE's 2026-09-12 tenant-scope cycle (`acd93c8`, closing CORE blocker `CORE:B-23`, on top of `7cadc54` and `be9b89d`) added a **required** `organization_id`, added `captured_minor` and `financial_decision_required`, and added `partially_captured` to the `settlement_state` enum. MOVE's `PAYLOAD_SPECS["core.fulfillment.cancelled.v1"]` has none of them. `validateObject` records «حقلٌ زائدٌ لا في العقدِ» for any property outside the declaration, and `consume` validates **before** inbox ingestion and returns `{kind:"contract"}`, so **MOVE would reject every cancellation CORE now publishes** and leave the fulfillment un-cancelled with no operational job stopped. This is the user-visible failure mode of item 6 of the integration review (cancellation and the new cancellation event) and it is entirely MOVE-owned: it needs re-vendoring and a declaration update, not a CORE change. |
| Second measured drift (same scope) | `docs/contracts/core/transport/core-v1.yaml` (`4c6cfc16…` vs CORE `5401ab4c…`) and `docs/contracts/core/transport/outbound-delivery.md` (`eec712a9…` vs CORE `21e55afc…`) are also stale. Their drift is **not** breaking: CORE added explicit `429`+`retry-after` rate limiting to every route, a capture/refund/void redesign, plans and subscriptions, and the lease-versus-backoff paragraph (`CORE:B-22`, `CORE:B-24`, `CORE:B-25`). `classifyCoreSubmitStatus` already reads `429` as `retry` (`CORE_EVENT_RETRYABLE_CLIENT_STATUSES`), so no MOVE behaviour is wrong today — but a vendored copy that is silently behind its source is a false evidence source, so it is re-vendored in the same increment. |
| Third measured defect (same scope) | `node_modules` is **tracked in `main`** as a symlink blob (`120000 bc2686f3`) pointing at the absolute path `/home/user/workspace/move/node_modules`. Verified in the `origin/main` tree and via the GitHub contents API. `.gitignore` lists `node_modules/`, so this was committed against the repository's own rule; it leaks one machine's layout into the tree and makes a fresh clone carry a dangling link. Removed from tracking here; no file content is deleted. |
| Fourth measured defect (found **while** executing this increment — recorded additively, not back-dated) | Writing CORE's own blocker identifiers into `ROADMAP.md` as provenance for the re-vendoring (`CORE:B-23` for the tenant-scope cycle, `CORE:B-22`/`CORE:B-24`/`CORE:B-25` for the transport cycle, `CORE:B-20` for the pending money decision) turned `scripts/check-blocker-registry.ts` red with «`ROADMAP.md` يذكرُ `CORE:B-23` ولا صفَّ له». Measured, not reasoned: `bun test tests/unit/check-blocker-registry.test.ts` failed three cases. The cause is in the guard, not in the citation: `mentionedBlockerIds` matched `B-\d+` with no notion of **who owns** the identifier, so every honest quotation of CORE's own work read as a MOVE blocker missing a row. Both escapes available before the fix are defects — writing a row for a CORE blocker in MOVE's table is a false ownership claim whose status would then be hand-driven and drift from its owner, and adding a per-identifier exemption makes the exemption list a manual routine that grows with every quotation until the guard means nothing. Fixed at the root in `scripts/lib/wasla-blockers.ts`: a namespaced mention (`CORE:`/`MARKET:` — **two named repositories only**, not an open prefix) is dropped from the scan before it runs, because a blocker we do not own has no state here to read. The guard's own rule is unchanged and **not** relaxed: every identifier that is ours still needs a row, and the two new cases in `tests/unit/wasla-blockers.test.ts` measure exactly that — `CORE:B-23` without a row passes, bare `CORE:B-23` without a row still fails. |
| Scope reserved | `docs/contracts/core/core.fulfillment.cancelled.v1.schema.json` (re-vendored **byte-for-byte**, never authored here) · `docs/contracts/core/transport/core-v1.yaml` and `transport/outbound-delivery.md` (same) · `docs/contracts/core/PROVENANCE.md` (new provenance rows and new fingerprints, **additively**; the superseded rows stay readable) · `packages/domain/wasla/event-envelope.ts` (`FieldSpec` gains the `boolean` type the new contract uses; the cancellation declaration is brought to the contract) · `tests/unit/core-contract-parity.test.ts` and `tests/integration/wasla-fulfillment-lifecycle.test.ts` (**added** cases; no existing case weakened) · `docs/adr/0089-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `.gitignore`/index entry for `node_modules` · `scripts/lib/wasla-blockers.ts` and `tests/unit/wasla-blockers.test.ts` (**added** to this reservation on 2026-09-12 when the fourth defect above was measured; the guard script `scripts/check-blocker-registry.ts` itself is **not** edited, so the overlap with open pull request #10 stays nil) |
| Scope **not** reserved and not touched | anything in `uxxxug/wasla-core` or MARKET — a drift found at CORE is recorded as a dependency, never edited · `scripts/check-migrations.ts` and rule 0.4 and the `city_id` guard (`O-1`, owner) · the real-Redis test and the Upstash secrets (`O-2`, owner) · `MASTER_DIRECTIVE` · `ADR 0084`/`0085`/`0086`/`0087`/`0088` (`ح-6`: published, never edited) · every migration file · the twelve stale branches and every open pull request |
| Dependencies checked before opening | `DEP-CORE-005` (no automated proof that a vendored copy is still current) is exactly what let this drift sit unseen, and it stays **open**: this increment re-vendors by hand from a read of CORE at a named commit, it does not build the mutual-access freshness check. `DEP-CORE-006` (`O-1`) and `O-2`, `O-3`, `O-4` are untouched and stay red as recorded. A new dependency is registered for CORE blocker `CORE:B-20`: while `financial_decision_required` is true nobody outside CORE has decided what happens to money already moved, so MOVE must make **no** financial claim — which it does not, having no financial surface at all. |
| Conflicting work checked | 2026-09-12: pull requests #1–#9 are merged; **#10 is open** (`feat/w9-cutover-plan-readonly-rehearsal`) and touches `ROADMAP.md`, `docs/SYSTEM_STATE.md`, `docs/ROADMAP-MASTER.md`, `package.json`, `.github/workflows/ci.yml`, `scripts/check-blocker-registry.ts` — it touches **no** contract, no schema, and not `event-envelope.ts`, so the only overlap is additive text in two documents. No `origin/*` ref contains `financial_decision_required`, `captured_minor`, or `partially_captured`. |
| Claim ceiling | this item may **not** be marked `[x]` and this increment does not raise the ceiling. `ح-4` needs a read CI verdict and rule 0.4 keeps `verify` red for `O-1`; `ح-5` still bars a production-proof claim, and `DEP-CORE-007` still leaves MOVE with no real CORE environment to exchange a cancellation with. What **is** claimed here is narrow and measurable: MOVE's declaration equals CORE's published cancellation contract byte-for-byte at a named commit, and a cancellation carrying the new fields is accepted instead of rejected. |

### Reservation `W-8` (second increment) — unforgeable CORE attestation and one readable blocker registry (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-8` — reconciliation and dry-run tooling for the job and identity migrations (second increment: close a hole the first increment left in its own refusal mechanism) |
| Branch | `feat/w8-attestation-and-blocker-registry`, cut from `main`@`bf4687e` |
| Measured hole | `deriveReconciliation` returns `RECONCILED` whenever a caller hands it a `CoreSide`. `CoreAttestation` is a **plain interface of three strings**, so any caller — a script, a test, a future adapter — can hand-write `{ readVia, closedDependency, measuredAt }` and obtain a green reconciliation while `DEP-CORE-007` is still open. Guard check ٦ only forbids the `RECONCILED` **literal** in production code; it cannot see a value derived at run time. So today the refusal rests on nobody trying, which is not a mechanism. Second measured hole: blocker identifiers (`DEP-CORE-001`…`007`, `O-1`, `O-2`, `B-1`…`B-5`) appear as bare string literals across at least 11 TypeScript files with no single readable source, so a typo, a silently renamed blocker, or a locally invented id reads as governance. |
| Scope reserved | `scripts/lib/wasla-blockers.ts` (new — the single machine-readable blocker registry) · `scripts/lib/wasla-migration-dry-run.ts` (attestation becomes issuable only through one factory that reads the registry) · `scripts/check-blocker-registry.ts` (new guard) · `scripts/check-migration-dry-run.ts` (added checks only; **no existing check weakened**) · `docs/wasla/blockers.md` (new, generated) · `tests/unit/wasla-blockers.test.ts` (new) · `tests/unit/check-blocker-registry.test.ts` (new) · `tests/unit/check-migration-dry-run.test.ts` (added cases only) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify`, one step **before** the red `city_id` step) · `docs/adr/0087-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-8-attestation-20260912.md` (new) |
| Scope **not** reserved and not touched | `scripts/migrate.ts` (ADR-0068) · every migration file · `scripts/lib/wasla-migration-matrix.ts` (read-only single source) · `ADR 0085` and `ADR 0084` (`ح-6`: published, never edited) · the `city_id` guard and rule 0.4 · the real-Redis test and Upstash secrets · `MASTER_DIRECTIVE` · every payment rule · any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-007` (no shared CORE environment) is precisely what makes the hole reachable and stays **open**; this branch does not close it, it makes a green reconciliation **impossible to construct** while it is open. `B-1`/`B-2`/`B-3` block running any wave and are untouched. `O-1` and `O-2` are unrelated to this scope and are left red as recorded. |
| Conflicting work checked | no open pull request (checked 2026-09-12). No branch among the 38 `origin/*` refs carries `wasla-blockers`, `check-blocker-registry`, or `issueCoreAttestation`; the only files mentioning `CoreAttestation` are this item's own first-increment artifacts. |
| Claim ceiling | this item may **not** be marked `[x]`, and this increment does not raise the ceiling: `DEP-CORE-007` still leaves MOVE with no CORE side to reconcile, so **no reconciliation is completed** — the improvement is that a false green stops being possible rather than merely unattempted. `ح-4` still requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`, and `ح-5` still bars any production-proof claim. |

### Reservation `W-9` (first increment, **inside** `B-5`) — cutover step ledger with declared inverses and a read-only rehearsal that refuses by construction (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-9` — cutover and rollback rehearsal. Blocked by `B-5`. |
| Branch | `feat/w9-cutover-plan-readonly-rehearsal`, cut from `main`@`1d361ea` |
| What is **not** attempted | no rehearsal is performed, no wave is executed, no row is written, and `B-5` is **not** worked around. The already-recorded status of this item (2026-09-12) stands: `B-5`, `B-3`, `DEP-CORE-007` and `B-1` are all open, and a rehearsal whose target does not exist would rehearse nothing. |
| What **is** done inside those bounds | today the refusal to rehearse lives only in **prose** in this file. Prose is not a mechanism: nothing stops a later script, adapter or report from asserting "cutover rehearsed" while the four blockers are open, and nothing declares — machine-readably — what a step's **inverse** even is. So: derive a cutover step ledger from the existing migration matrix (no new source of truth), make every step declare its inverse rollback step and its read-only verification probe or fail the build, and make the rehearsal executor **refuse by construction** using the `W-8` blocker registry rather than by convention. |
| Scope reserved | `scripts/lib/wasla-cutover-plan.ts` (new — derived, not authored) · `scripts/check-cutover-plan.ts` (new guard) · `scripts/rehearse-cutover.ts` (new — read-only executor) · `docs/wasla/cutover-plan.md` (new, generated) · `tests/unit/wasla-cutover-plan.test.ts` (new) · `tests/unit/check-cutover-plan.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (one `verify` step **before** the red `city_id` step, and one step in the real-PostgreSQL job **after** the safe applier) · `docs/adr/0088-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-9-cutover-plan-20260912.md` (new) |
| Scope **not** reserved and not touched | `scripts/lib/wasla-migration-matrix.ts` (read-only single source) · `scripts/lib/rollback-registry.ts` and `scripts/lib/rollback-audit.ts` and `scripts/rollback-schema-drill.ts` (`OPS-010`, measured and merged — reused, never edited) · `scripts/migrate.ts` (ADR-0068) · every migration file · `ADR 0047`, `0085`, `0087` (`ح-6`) · the `city_id` guard and rule 0.4 · the real-Redis test and Upstash secrets · `MASTER_DIRECTIVE` · any file in CORE or MARKET |
| Dependencies checked before opening | `B-5` (no production release approval) — **open**, and this increment neither closes it nor rehearses around it; it makes the refusal enforced instead of narrated. `B-3` (no CORE environment) · `DEP-CORE-007` (no shared CORE environment) · `B-1` (production inventory unknown) — all open and all read from the registry by the executor's refusal. `B-2`, `DEP-CORE-002`, `DEP-CORE-003`, `DEP-CORE-004` gate individual waves through the matrix's own `entryCondition` text. `O-1` and `O-2` are unrelated and left red. |
| Conflicting work checked | zero open pull requests at `1d361ea`; no remote ref carries `cutover` (checked 2026-09-12). |
| Claim ceiling | `W-9` may **not** be marked `[x]`, and its state stays **قيد التنسيق — blocked**. Nothing here is a rehearsal, and the executor is built so that it **cannot** report one while the four blockers are open. `ح-4` still requires a read CI verdict, and `ح-5` still bars any production-proof claim. |

### Outcome `W-9` (first increment, inside `B-5`) — recorded 2026-09-12

Evidence: `docs/evidence/architecture/W-9-cutover-plan-20260912.md` · decision:
`docs/adr/0088-cutover-plan-derived-and-rehearsal-refused-by-construction.md`.

- **What changed.** The cutover step ledger is now **derived** from
  `WASLA_MIGRATION_MATRIX` (30 steps, waves 1–6; wave 0 touches no row), so there
  is no second source of truth to drift. Every step declares its **inverse**, a
  **read-only probe**, its phase, a total order, and the blocker ids that gate
  it. Rollback order is the exact reverse of cutover order, and
  `requiresDataRestore` is derived from the phase rather than written by hand.
- **The refusal moved from prose into code.** `rehearseReadOnly` reads the four
  rehearsal gates (`B-5`, `B-3`, `DEP-CORE-007`, `B-1`) from the `W-8` blocker
  registry. While any is open, no value other than `REFUSED` can be constructed,
  there is no override flag, and an **unknown** id reads as **open** — ignorance
  is not permission. No state in the type represents a completed cutover: the
  best case is `READ_ONLY_PROBED` with `rehearsalCompleted: false` declared in the
  value itself.
- **Inability is measured on a real database.** `scripts/rehearse-cutover.ts`
  opens a `read only` transaction, runs probes, then runs a write that is
  **expected to be rejected** and fails if it succeeds. It runs in the
  real-PostgreSQL CI job after the safe applier, alongside the `OPS-010` drill —
  whose files are **reused and never edited** (`ح-6`).
- **Root cause fixed, not silenced.** The read-only validator rejected the
  legitimate `telegram_update_jobs` probe because the table name contains
  "update". The gate was **not** weakened and the tables were **not** exempted:
  the matcher was corrected to whole-token matching, with the reason written in
  the source, and both directions measured (3 accepted, 13 rejected).
- **What is not claimed.** No rehearsal was performed, no wave executed, no row
  written, no rollback exercised. Inverses are **declared**, not proven —
  proving them needs `B-3`/`DEP-CORE-007` and a readable environment (`ح-5`). No
  duration or freeze window is estimated, because `B-1` is open and volumes are
  unknown. `B-5` stays open, `W-9` stays **قيد التنسيق — blocked**, and the item
  is **not** marked `[x]` (`ح-1`, `ح-4`).
- **Read CI verdict** (commit `6f34a99`, PR `#10`, runs 34676145855 `push` and
  34676147401 `pull_request`, read per job **and per step**): the new `verify`
  guard step 19 is **success** — placed **before** the red `city_id` step 20, so
  it carries a verdict instead of reading `skipped` — and the new real-PostgreSQL
  rehearsal step 8 is **success**, with CI itself printing the refusal and the
  rejected write. `تكامل على PostgreSQL حقيقي` and `F5-06` are **success**, and
  `Roadmap freshness` is **success**. The remaining red is exactly `O-1`
  (`city_id`) and `O-2` (Redis secrets), unchanged and untouched, and the
  `OPS-010` drill (step 10) stayed green without being edited. The ladder for
  this increment reads **مُنفَّذ ← مُختبَر ← مُتحقَّق منه**; the item itself stays
  blocked.

### Outcome `W-8` (second increment) — recorded 2026-09-12

Evidence: `docs/evidence/architecture/W-8-attestation-20260912.md` · decision:
`docs/adr/0087-blocker-registry-and-unforgeable-attestation.md`.

- **What changed.** `CoreAttestation` now carries a module-private `unique
  symbol` brand, so no file other than `scripts/lib/wasla-migration-dry-run.ts`
  can name the field. `issueCoreAttestation` is the only producer and refuses an
  **open** dependency, an **unknown** id, and a placeholder or blank
  `readVia`/`measuredAt`. `deriveReconciliation` re-checks the brand at run time,
  so a forged attestation yields `UNVERIFIABLE` — not `RECONCILED`, and not
  `DIVERGED` either, because claiming divergence is also claiming knowledge.
- **The hole was measured, not inferred.** This item's own test used to
  hand-write an attestation naming `DEP-CORE-007` — which is **open** — and
  obtained `RECONCILED`. `tsc` then failed on three existing lines the moment
  the brand was added; that failure is the proof.
- **One readable source.** `scripts/lib/wasla-blockers.ts` parses the three
  tables in this file into 16 blockers (15 open). It stores no state, so there
  is no second source of truth (rule 0.6), and `blockerStatus` **throws** on an
  unknown id instead of answering "closed".
- **New guard** `scripts/check-blocker-registry.ts`, 8 checks, wired into the
  `ci` chain and into `verify` **before** the red `city_id` step.
- **Deviation from the reservation, recorded.**
  `scripts/check-migration-dry-run.ts` was reserved but **not modified**: all
  new checks live in a separate guard so a CI read can tell which guard failed.
  The touched scope is narrower than the reserved scope. No existing check was
  weakened.
- **Not claimed.** No reconciliation happened, no CORE read happened,
  `DEP-CORE-007` stays open, `O-1` and `O-2` stay red and untouched, and `W-8`
  is **not** marked `[x]` (`ح-1`, `ح-4`).

### CI verdict for `W-8` (second increment) — read 2026-09-12 at `acf3027`

Read per job **and per step**, from the API, for three runs on the same sha —
not assumed (`ح-8`). Full record:
`docs/evidence/architecture/W-8-attestation-20260912.md` §حكمُ CI.

- `Roadmap freshness` (`34674941364`) **success**. `CI` on `push`
  (`34674941330`) and on `pull_request` #9 (`34674965765`) both **failure**,
  with identical job results: `تكامل على PostgreSQL حقيقي` success ·
  `فوضى متعدد المثيلات (F5-06)` success · `verify` failure ·
  `تكامل على Redis حقيقي` failure.
- In `verify`: Lint, Typecheck and Test all **success**; the three existing
  guards (`W-2`, egress, dry-run) **success**; and step 18, the **new blocker
  registry guard, `success`** — it actually ran and returned a verdict rather
  than reading `skipped`. Step 19, the `city_id` gate, is **failure** (`O-1`,
  rule 0.4, root cause in CORE) and steps 20–54 are `skipped` behind it, which
  is exactly why step 18 was placed **before** it.
- Redis job fails at step 8 (`O-2`, missing Upstash secrets). No test was
  changed and no secret was added.
- Therefore: `منفّذ · مختبَر · متحقَّق منه` for the guard and the issuer only.
  **Not** `مُثبَت`, and `W-8` is still **not** `[x]` — `verify` stays red for
  `O-1`, `DEP-CORE-007` stays open, and `ح-5` bars any production claim.

### Reservation `W-6` (second increment) — runtime egress gate (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25. This is a **second increment on the same item**,
not a new item, and it closes a limit the first increment declared about itself.

| Field | Value |
|---|---|
| Item | `W-6` — remove any direct commercial coupling with MARKET; all cross-system traffic goes through CORE APIs or events |
| Branch | `feat/w6-runtime-egress-gate`, cut from `main`@`227cb4d` |
| What this increment closes | the first increment recorded, in its own "not claimed" section: **"No runtime egress blocking exists. The guard fails at build time."** A build-time guard reads the code; it does not stand between the process and the network. So a call built at runtime, or a client pointed at a host other than the one it declares, passes the build and still leaves the machine. |
| Scope reserved | `packages/shared/wasla/egress-registry.ts` (**moved** from `scripts/lib/wasla-egress-registry.ts`, so build-time guard and runtime gate read **one** source) · `packages/infrastructure/egress/egress-gate.ts` (new, the runtime gate) · `scripts/check-egress-boundary.ts` (new checks; no existing check weakened) · the four server-side call sites that reach the network (`packages/infrastructure/wasla/core-event-shipper.ts` · `packages/infrastructure/backup/google-drive-adapter.ts` · `packages/infrastructure/financial/moyasar-provider.ts` · `packages/infrastructure/financial/tap-provider.ts`) · `tests/unit/egress-gate.test.ts` (new) · `tests/unit/check-egress-boundary.test.ts` · `docs/wasla/egress-boundary.md` (regenerated, never hand-edited) · `docs/adr/0086-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-6-runtime-20260912.md` (new) |
| Scope **not** reserved and not touched | `docs/adr/0084-*` (published — `ح-6`) · the `city_id` gate and rule 0.4 · the real-Redis job and `tests/support/real-redis.ts` · `MASTER_DIRECTIVE` · every payment **business** rule (only the transport line changes) · the browser-side `fetch` in the miniapp, the tracking page and the admin layout (they run in the user's browser, not in this process) · any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-004` still blocks the **channel-handover** half and is untouched by this increment. `DEP-CORE-002` still owns the two payment providers (`W-7`); this increment does not remove them, it puts them behind the gate and leaves their declared debt exactly as it is. `O-1` and `O-2` are unrelated to this scope and are **not** worked around: `verify` stays red at the `city_id` step and the Redis job stays red for missing secrets. |
| Conflicting work checked | zero open pull requests at `227cb4d`, and no local or remote ref carries an `infrastructure/egress` or `egress-gate` path (scanned every `refs/remotes/origin/*` ref on 2026-09-12) |
| Claim ceiling | this item still may **not** be marked `[x]`. `DEP-CORE-004` leaves the channel half open, and `ح-4` needs a read CI verdict while rule 0.4 keeps `verify` red. What this increment may claim, and no more: **an outbound call from this process is denied at runtime unless it is declared, and it is bound to the destination that declares it.** The gate cannot know MARKET's domain (`DEP-CORE-005`) — it enforces declaration, not domain identity, exactly as `ADR 0084` does. |

### `W-6` second increment — measured outcome (recorded 2026-09-12, local only until CI rules)

Additive record. It corrects the reservation above **by addition**, not by rewriting it (`ح-8`).

| Field | Value |
|---|---|
| Decision | `ADR 0086` — runtime egress gate; complements `ADR 0084`, revokes nothing |
| Where the gate landed | `packages/shared/wasla/egress-gate.ts` — **not** `packages/infrastructure/egress/` as reserved. Measured reason: one caller is `packages/maps`, which may not import from `infrastructure` (guarded layer boundary), so the reserved location forced a choice between breaking a boundary and leaving a destination outside the gate. It moved to `shared` — the lowest layer everyone imports, and where the registry itself now lives. |
| Call sites wired | **nine files** for **eleven** gated destinations, not the four named in the reservation. The reservation listed only the bare-`fetch` sites; measuring the whole registry showed six more destinations reaching the network through an injected or library transport (telegram, metrics, three translation providers, OSRM, Upstash). Leaving them out would have made the gate optional. |
| Registry call sites corrected | `telegram-bot-api` → `telegram-client.ts` (where grammY's transport is built) and `upstash-redis-rest` → `packages/infrastructure/redis/upstash.ts` (the gateway file is a re-export). Recorded, not silently changed. |
| Static guard | checks ١١ (stale scan exemption), ١٢ (no bare `fetch` in server code outside the gate; three browser sites declared with reasons, each required to exist **and** actually contain a `fetch`), ١٣ (every `gated` destination's call site must import the gate and name its own id). No check ١..١٠ was weakened, silenced or removed. |
| Startup guard | `assertEgressEnvironment(process.env)` in `apps/gateway/src/index.ts`, after config load and **before** container build; the ordering is asserted by a test, not described in prose. |
| Local measurement (not a verdict — `ح-8`) | `bun test` 3035 pass · 829 skip · 0 fail · 10666 `expect()` · 3864 tests · 288 files (`main` measured 3008 pass; **+27** new cases: 17 gate, 10 guard) · `biome check .` 1114 files, no fixes · typecheck clean · `check:egress-boundary`, `check:migration-matrix`, `check:migration-dry-run`, `check-skip-classification`, `check-adr-numbering` all pass |
| Still not claimable | `[x]` on `W-6` (channel half blocked by `DEP-CORE-004`; `ح-4` needs a CI verdict and rule 0.4 keeps `verify` red) · any network-layer enforcement (needs a proxy/firewall the repository does not own — `B-1`/`B-5`) · that a configured host really is CORE (`DEP-CORE-005`) |
| Untouched, deliberately | `ADR 0084` · the `city_id` gate and rule 0.4 · the real-Redis job and its test · `MASTER_DIRECTIVE` · every payment business rule · `O-1` and `O-2`, which stay open and are not worked around; no secret was added to the repository |

### `W-6` second increment — CI verdict, read per job and per step (recorded 2026-09-12)

Branch `feat/w6-runtime-egress-gate`@`9669dbf`, PR [#8](https://github.com/uxxxug/ceezr/pull/8),
runs `34673628192` (push) and `34673661270` (pull request), Roadmap freshness `34673628196` `success`.

| Job | Conclusion (identical in both runs) |
|---|---|
| PostgreSQL integration | **success** |
| multi-instance chaos (F5-06) | **success** |
| `verify` | **failure** — at step 18 only |
| real-Redis integration | **failure** — step 8 (`O-2`) |

In `verify`: Lint, Typecheck and Test **success** (the 27 new cases run inside Test) ·
step 15 (`W-2` guard) **success** · **step 16 — the egress boundary guard, which runs
the new checks ١١/١٢/١٣ — success** · step 17 (`W-8` guard) **success** ·
step 18 (`city_id`) **failure** · steps 19–54 **skipped**.

The two reds are the same owner blockers already red on `main`@`227cb4d`, at the same job
and the same step: `O-1` (`DEP-CORE-006`, rule 0.4, root cause in CORE) and `O-2` (Upstash
secrets). **This increment added no red, weakened no gate, silenced no step and classified
none as skipped.** The run is not claimed green, and no item is marked `[x]` (`ح-4`).

### Reservation `W-6` — egress boundary (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-6` — remove any direct commercial coupling with MARKET; all cross-system traffic goes through CORE APIs or events |
| Branch | `feat/w6-egress-boundary`, cut from `main`@`0c25ca0` |
| Scope reserved | `scripts/lib/wasla-egress-registry.ts` (new) · `scripts/check-egress-boundary.ts` (new) · `docs/wasla/egress-boundary.md` (new, generated) · `tests/unit/check-egress-boundary.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0084-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-6-20260912.md` (new) |
| Scope **not** reserved and not touched | every payment provider adapter, the Telegram wrapper layer, the CORE shipper, every existing guard, every migration, and any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-004` (no Telegram channel adapter in CORE) blocks the **channel-handover** half of this item and cannot be closed from this repository. `DEP-CORE-002` blocks removing the two payment providers, which is item `W-7`'s scope, not this one. Neither blocks declaring the egress surface and gating it, which is what this branch does. `O-1` and `O-2` are unrelated to this scope. |
| Conflicting work checked | no open pull request, and no branch on `origin` carries a `check-egress-boundary` guard or a `docs/wasla/egress-boundary.md` path (checked against every `origin/*` ref on 2026-09-12; the only match for the string was `packages/agent-core/evaluation/regressionChecks.ts`, an unrelated false positive) |
| Claim ceiling | this item may **not** be marked `[x]`. Two reasons, both recorded before any code was written: `DEP-CORE-004` leaves the channel half open, and `ح-4` requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`. What this branch may claim is narrower than the item: the egress surface becomes **declared and gated**, so a direct MOVE↔MARKET destination fails the build instead of being merely absent today. |

### Reservation `W-8` — dry-run and reconciliation tooling (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-8` — reconciliation and dry-run tooling for the job and identity migrations |
| Branch | `feat/w8-migration-dry-run-and-reconcile`, cut from `main`@`0c25ca0` |
| Scope reserved | `scripts/lib/wasla-migration-dry-run.ts` (new) · `scripts/check-migration-dry-run.ts` (new) · `scripts/wasla-migration-dry-run.ts` (new, the runnable tool) · `docs/migration/dry-run-and-reconciliation.md` (new, generated) · `tests/unit/check-migration-dry-run.test.ts` (new) · `tests/integration/migration-dry-run-read-only.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0085-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-8-20260912.md` (new) |
| Scope **not** reserved and not touched | `scripts/migrate.ts` (the single lawful applier, ADR-0068) · every migration file · `scripts/lib/wasla-migration-matrix.ts` and `scripts/lib/wasla-boundary-registry.ts` (read-only inputs, single sources of truth) · every existing guard · any file in CORE or MARKET |
| Dependencies checked before opening | `B-1` (production inventory unknown), `B-2` (identity-merge policy), `B-3` (no CORE environment) and `DEP-CORE-007` (no shared CORE environment) all block **running** a wave against real systems. None of them blocks building the tooling and proving its safety invariant, which is what this branch does. What they do block is any claim of a completed reconciliation — and that is enforced, not merely noted. |
| Conflicting work checked | no branch on `origin` (34 refs) carries a dry-run or reconciliation path, and the only pre-existing `reconcile*` files are unrelated domain use cases (`packages/application/financial/reconcile-pending-payments.ts`, `packages/application/subscription/*`, `packages/application/enterprise-integration/reconcile-integration-state.ts`). The one open pull request is [#4](https://github.com/uxxxug/ceezr/pull/4) (`W-6`), which touches no file in this scope. |
| Claim ceiling | this item may **not** be marked `[x]`. The tooling can be built and its safety invariant measured on a real PostgreSQL, but **no reconciliation can be completed** while `DEP-CORE-007` leaves MOVE with no real CORE source to reconcile against, and `ح-4` requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`. What this branch may claim: a dry-run that **provably cannot write**, and a reconciler that **provably cannot report a false green**. |

### Reservation `W-2` — migration matrix (opened 2026-09-12, before any file was edited; artifacts landed, see the `W-2` status section below)

Recorded **before** the first edit so that no second executor opens the same
scope, per the reservation rule in `docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-2` — migration matrix per entity, published in `docs/migration/` |
| Branch | `feat/w2-migration-matrix`, cut from `main`@`8d031c2` |
| Scope reserved | `scripts/lib/wasla-migration-matrix.ts` (new) · `scripts/check-migration-matrix.ts` (new) · `docs/migration/matrix.md` (new, generated) · `tests/unit/check-migration-matrix.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0083-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-2-20260912.md` (new) |
| Scope **not** reserved and not touched | every existing migration, every existing guard, `scripts/check-migrations.ts`, `scripts/lib/wasla-boundary-registry.ts`, the `real-redis` job, and any file in CORE or MARKET |
| Dependencies checked before opening | `W-1` is done and its registry is the single source of truth this item reads. `B-1` (production inventory unknown) and `DEP-CORE-003` (no CORE geography change event) block **execution** of any wave in the matrix, not the authoring of the matrix itself — so the plan is deliverable and no wave may be marked executed. `O-1` and `O-2` are unrelated to this scope. |
| Conflicting work checked | no open pull request, and no branch on `origin` carries a `docs/migration/` path or a `check-migration-matrix` guard (checked against every `origin/*` ref on 2026-09-12) |
| Claim ceiling | this item may **not** be marked `[x]`: `ح-4` requires a read CI verdict, and rule 0.4 keeps `verify` red for `O-1`, so the matrix lands as a plan with its own gate and nothing is claimed executed. "Migrated" stays empty. |

## Remaining, in dependency order

Item ids `W-1` … `W-9` are stable and are the ids used in commits, ADRs,
evidence files and the execution log in `docs/ROADMAP-MASTER.md` §25.

1. `W-1` — **done, see "Done" above.** Boundary audit: inventory every
   identity, session, role, payment, wallet, subscription, reputation and
   notification concern currently living in this repository, and mark each
   `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE`.
2. `W-2` — Migration matrix per entity, published in `docs/migration/`.
3. `W-3` — Adopt the CORE identity contract: authenticate against CORE, stop
   treating a Telegram account as the user. Blocked by `B-2` and `B-3`.
4. `W-4` — Canonical Operational Job model, distinct from any legacy order
   table.
5. `W-5` — Consume `core.fulfillment.created`; produce `move.job.completed`
   through a transactional outbox with the canonical event envelope. Blocked by
   `DEP-CORE-001` (CORE exposes no network ingress for `move.job.*`).
6. `W-6` — Remove any direct commercial coupling with MARKET; all cross-system
   traffic goes through CORE APIs or events.
7. `W-7` — Hand payment, wallet, ledger and subscription concerns to CORE;
   keep only operational references. Blocked by `DEP-CORE-002` (dispatch reads
   subscription entitlement on the hot path).
8. `W-8` — Reconciliation and dry-run tooling for the job and identity
   migrations.
9. `W-9` — Cutover and rollback rehearsal. Blocked by `B-5`.

## Dependencies on CORE (recorded here, fixed by the CORE agent)

This repository never edits CORE or MARKET. Detail and rationale in
`docs/wasla/boundary-audit.md` §6.

| # | Dependency | Blocks |
|---|---|---|
| `DEP-CORE-001` | CORE has no network ingress for `move.job.accepted` / `move.job.rejected` / `move.job.completed`; they are consumed only on an in-process local bus | `W-5` |
| `DEP-CORE-002` | No cheap entitlement read for a hot path — dispatch checks driver subscription on every broadcast round | `W-7` |
| `DEP-CORE-003` | CORE geography reference emits no change event to refresh the `cities` projection in MOVE | `W-1` disposition execution, `W-2` |
| `DEP-CORE-004` | No Telegram channel adapter in CORE, while every operational surface in MOVE is on Telegram | `W-6` |

## Status of items 4 and 5, recorded 2026-09-11 (additive; item text unchanged)

Branch `feat/w4-w5-operational-job-and-core-lifecycle`, from `main`@`30e024e`.
Governing decision: `docs/adr/0081-operational-job-and-core-event-boundary.md`.
Evidence: `docs/evidence/architecture/W-4-W-5-20260911.md`.

Delivered and measured:

- `operational_jobs`: canonical operational job, unique per `fulfillment_id`, with
  opaque CORE/MARKET references (no foreign key to `orders` or to any legacy
  table). Five states, five transitions, each transition a single database
  function that asserts its source state in the same `where`; seven check
  constraints that make a fabricated terminal state impossible.
- `core_event_inbox` keyed by `event_id` (redelivery returns `applied: false`),
  and `move_event_outbox` holding the ten envelope fields as columns with a
  unique `dedup_key` of `move.job.<type>:<fulfillment_id>`. Events are enqueued
  inside the state-change transaction, not after it.
- CORE contracts vendored verbatim from CORE@`511624b` into
  `docs/contracts/core/` with sha256 provenance, plus a new CI gate
  `check:core-contract-parity` that diffs the vendored schema against the
  emitted envelope, the state machine and both migrations.
- `move_event_outbox` is declared as a durable queue in the `F6-06` backpressure
  registry with all six limits homed in `packages/shared/config/move-event-outbox.ts`
  as code constants (the queue has no `city_id`, so per-city settings rows would
  mean reading a limit from an arbitrary city). The claim and abandon functions
  carry no default values; the adapter passes the declared constants.
- Each of the three partial indexes lives in its own `-- migration-phase: index`
  migration using `create index concurrently`, as `CAP-007` forbids both a
  blocking index and a concurrent index inside a transaction.
- Measured: 37 unit cases (128 expectations) and 33 integration cases on a real
  PostgreSQL 18.6, zero failures, covering all ten required behaviours
  (intake, accept, reject, complete, fail, cancel, no success before its
  precondition, no pending state after exit, idempotency on retry, envelope
  parity with CORE).

Not delivered, and why:

- No network transport to CORE. `MoveEventShipper` is a port with no production
  adapter, because `DEP-CORE-001` (no CORE ingress endpoint for `move.job.*`)
  is still open.
- The two migrations are **not** merge-ready: `scripts/check-migrations.ts`
  fails with three sovereign-rule-0.4 violations (`city_id`) for
  `operational_jobs`, `core_event_inbox` and `move_event_outbox`. The gate is
  correct and was not weakened, exempted, frozen or bypassed. See `DEP-CORE-006`
  below and ADR-0081 for the rejected alternatives.

Neither item 4 nor item 5 is claimed as complete.

## Status of item 5 transport, recorded 2026-09-12 (additive; item text unchanged)

Governing decision: `docs/adr/0082-core-event-transport-both-directions.md`.
Evidence: `docs/evidence/architecture/W-5-TRANSPORT-20260912.md`.

`DEP-CORE-001` is **closed**: CORE now exposes a network ingress that accepts
`move.job.*` (CORE `d2c38e3`, read at CORE@`1231817757446560a0ecd061bd9c4f3a2a1c9fe4`).
The transport contract was vendored verbatim into `docs/contracts/core/transport/`
with sha256 provenance, and both directions are now implemented and measured:

- Outbound: `packages/infrastructure/wasla/core-event-shipper.ts` posts the
  envelope to `POST {CORE_EVENTS_BASE_URL}/v1/events` with a bearer token and an
  `AbortController` timeout. Status classification lives in one place
  (`classifyCoreSubmitStatus`) and `check:core-contract-parity` now parses CORE's
  own retry table out of the vendored document and compares every row against
  that function, so a change on CORE's side breaks our gate instead of producing
  retries that can never succeed.
- Permanent failures die on attempt 1. New migration
  `20260912000000_w5_permanent_delivery_failure.sql` replaces
  `abandon_move_event_delivery` with a five-argument version taking
  `p_permanent boolean default false`; the verdict is enforced in the database,
  not in code that can crash between reading the response and writing the row.
  Declared in `scripts/lib/rollback-registry.ts` (`code-only`, does not break the
  previous release: a four-argument call resolves to the default `false`).
- Inbound: `apps/gateway/src/routes/core-event-intake.ts` serves
  `/webhook/core-events`. It bounds the body, computes HMAC-SHA256 over the exact
  received bytes and compares with `timingSafeEqual` **before** parsing, and maps
  every outcome onto the status class CORE reads as retry or as death. A missing
  or too-short secret returns `503` and never weakens verification; in
  `apps/gateway/src/index.ts` the route is not mounted at all without the secret,
  so absence reads as `404` rather than as a false accept.
- Idempotency stays in the database only (`core_event_inbox` keyed by `event_id`).
  No in-process dedup cache, which would be a second source of truth that fails
  on the first second instance or restart.
- Draining is a bounded worker job: `shipDueMoveEvents` plus `ship-move-events`
  every 15 s, registered only when `CORE_EVENTS_BASE_URL` and
  `CORE_EVENTS_BEARER_TOKEN` are present, with the absence logged once.

A false piece of evidence was found and fixed at its source: `biome` had
reformatted two schemas that `PROVENANCE.md` claims are byte-for-byte copies, so
two recorded sha256 fingerprints were wrong while the claim stayed in the file.
The bytes were restored from CORE@`511624b`, `docs/contracts` is now excluded
from the formatter, and a new gate `check:vendored-contract-integrity` recomputes
every fingerprint on every run and fails on a changed byte, a vendored file with
no fingerprint, or a fingerprint with no file. The gate itself is measured
against planted breaches in `tests/unit/check-vendored-contract-integrity.test.ts`.

Measured locally: 2614 unit cases (0 fail), 7 new integration cases wiring the
real shipper and the real intake route to a real PostgreSQL 18.6 (0 fail), 35
lifecycle integration cases (0 fail). Local green is not a verdict (`ح-8`); see
the CI verdict table.

Still not claimed as complete. `check-migrations.ts` still fails with the three
sovereign-rule-0.4 violations (`DEP-CORE-006` / `O-1`), and no delivery to a real
CORE environment has been measured (`DEP-CORE-007`).

## Status of item `W-2`, recorded 2026-09-12 (additive; item text unchanged)

The item text above is untouched (`ح-1`). This section records what exists at
this commit and, just as importantly, what is **not** claimed.

### What was built

`W-2` asked for a migration matrix per entity, published in `docs/migration/`.
It was built as a **checked registry**, not a hand-written document — the same
shape as `W-1`, and for the same reason: a plan that lives only in a document
goes stale **without a single wrong line**, and a plan believed to be current is
more dangerous than a missing one.

| Artifact | Path |
|---|---|
| Registry (single source of truth) | `scripts/lib/wasla-migration-matrix.ts` |
| CI guard, 10 checks | `scripts/check-migration-matrix.ts` |
| Generated document | `docs/migration/matrix.md` |
| Negative unit tests, 27 cases | `tests/unit/check-migration-matrix.test.ts` |
| Architecture decision | `docs/adr/0083-migration-matrix-registry.md` |
| Evidence | `docs/evidence/architecture/W-2-20260912.md` |

Coverage: 7 closed mechanisms · 7 waves · one entry for each of the 47 inventory
tables · 7 column plans matching `WASLA_COLUMN_CONCERNS` one-for-one. Disposition
and owner are **read from the `W-1` registry, never restated** — no second source
of truth for a disposition that could drift silently.

### What is explicitly NOT claimed

- **No row was migrated.** "Migrated" and "Retired" below both still read
  "Nothing." The guard's tenth check couples the two: any entry claiming
  execution while "Migrated" is empty fails `verify`. Every entry carries
  `executed: false` literally.
- **No wave is executable today.** Row counts, duplicate identities and live job
  counts are unknown (`B-1`); identity-merge policy is unresolved (`B-2`); no
  CORE integration environment exists (`B-3`). Waves 2, 3 and 5 additionally
  depend on `DEP-CORE-003`, `DEP-CORE-002` and `DEP-CORE-004` — all of which are
  CORE-side and out of this repository's scope.
- **The matrix does not authorise anything.** It is a plan with a gate, and the
  gate measures completeness, consistency and truthfulness of the claim — not
  the correctness of a chosen mechanism, which stays an architectural judgement
  reviewed by reading (ADR-0083 §6).
- **`W-2` is not marked `[x]`.** `ح-4` requires a read CI verdict, and `verify`
  is red on main for sovereign rule 0.4 (`O-1`, an owner decision). Grading:
  **مُختبَر** for the guard (27 negative cases pass locally), **مُنفَّذ** for the
  matrix itself. Not مُتحقَّق منه and not مَقيس.

## Status of item `W-6`, recorded 2026-09-12 (additive; item text unchanged)

The item text above is untouched (`ح-1`). This section records what exists at
this commit and what is **not** claimed.

### What was measured before anything was written

`W-6` asks that no direct commercial coupling with MARKET exist and that all
cross-system traffic go through CORE. The repository was measured first, and the
finding was not what the item's wording implies:

- **The condition already holds.** Not one host in production code resolves to
  MARKET. The `packages/{domain,application,infrastructure}/marketplace/*` files
  are **not** commercial coupling — each is an inert eight-line placeholder
  (`export {}` plus a header comment).
- **But it holds by accident, not by enforcement.** No line in the repository
  fails if someone adds `fetch("https://<market>/v1/orders")` tomorrow. The
  requirement was a rule in a document, and a document does not fail a build.
- **MARKET's domain is unknown to this repository** (`DEP-CORE-005`: no mutual
  access). So enforcement cannot rest on matching a domain name.

### What was built

A **closed registry** of egress destinations in
`scripts/lib/wasla-egress-registry.ts` — a single source of truth with fifteen
declared destinations — gated by `scripts/check-egress-boundary.ts` in `verify`.

The logic is **inverted relative to a blocklist**: the question is not "is this
host forbidden?" but "is this host **declared**?". An undeclared host fails the
build whatever its name; declaring one requires a `system` field; and
`system: "MARKET"` is rejected outright. A blocklist was rejected because a list
of domains this repository does not know is a guard with nothing behind it.

Three governing checks and seven consistency checks. Twenty-eight negative tests
in `tests/unit/check-egress-boundary.test.ts` seed each breach and assert the
guard fails. `docs/wasla/egress-boundary.md` is generated from the registry and
fenced by generation markers; editing it by hand fails the build (rule 0.6).
Decision: `docs/adr/0084-egress-boundary-registry.md`.

### Two claims the guard itself corrected

Recorded because they are evidence the checks bind on their author:

- Four host exemptions (`example.com` and siblings) were written from inference.
  The comment-stripped scan then measured that **none of them appears** in
  production code — all four were in explanatory prose. All were deleted, and a
  check now forbids a dead exemption, because an unused exemption is an open hole
  with nothing on the other side of it.
- Three declared call-site paths were written from inference. Check 8 rejected
  them as non-existent files; they were corrected by measurement.

### What is explicitly NOT claimed

- **The item is not fulfilled and is not marked `[x]`.** `W-6` has two halves.
  The *egress* half — the surface is declared, and a direct MOVE↔MARKET
  destination now fails the build — is delivered. The *channel-handover* half
  cannot be done from this repository: `DEP-CORE-004` records that CORE exposes
  no Telegram channel adapter, so the channel cannot be moved behind CORE.
- **No runtime egress blocking exists.** The guard fails at build time. An
  operator who points `CORE_EVENTS_BASE_URL` at a different host is not caught
  by it; only the documentation of the key is measured, never its value.
- **The scan is lexical, not a dataflow analysis.** It runs two passes over
  comment-stripped production code, which is what caught the dynamically built
  `api.deepl.com`, but a host assembled from scattered fragments at runtime can
  still escape it. All limits are declared in ADR 0084 §"الحدودُ المُعلَنةُ".
- **The two direct commercial integrations remain.** `api.moyasar.com` and
  `api.tap.company` are called directly from MOVE. They are not a `W-6` breach —
  MARKET is not a party — but they are declared debt: the class
  `COMMERCIAL_PENDING_HANDOVER` forces a `handover` field naming `W-7` as the
  removing item and `DEP-CORE-002` as the blocker, and the guard verifies both
  ids are actually declared in this file.
- Grading: **مُختبَر** for the guard (28 negative cases pass locally),
  **مُنفَّذ** for the registry. Not مُتحقَّق منه and not مَقيس — `ح-4` needs a
  read CI verdict and `verify` stays red for `O-1`.

## CI verdicts on branch `feat/w6-egress-boundary` (additive)

Local green is not a verdict (`ح-8`). Read from the GitHub Actions API after the
push, per job **and per step**, not summarised.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
|---|---|---|---|---|---|
| `9f3b848` (push `34666026785`) | `failure` | `success` | `failure` | `success` | `success` (`34666026757`) |
| `9f3b848` (PR [#4](https://github.com/uxxxug/ceezr/pull/4), run `34666029771`) | `failure` | `success` | `failure` | `success` | — |

**The one thing this item measures.** The `verify` job log was read step by step:

| Step | Verdict | Name |
|---|---|---|
| 15 | `success` | migration matrix guard (`W-2`) |
| **16** | **`success`** | **egress boundary guard (`W-6`) — the step this item adds** |
| 17 | `failure` | no table without `city_id` (sovereign rule 0.4) |
| 18–30 | `skipped` | everything after the red step, **including step 25, the `W-1` guard** |

So the new guard **ran and passed at CI**, not only locally. And step 25 being
`skipped` is the read proof that placing the step before the red gate was not
cosmetic ordering: had it gone after, this item's guard would be `skipped` too
and would carry **no verdict at all**, while being reported as delivered.

**Rule 0.4 was not weakened, silenced, reclassified as a skip, or deferred.** It
is the very next step, it failed with the same message it fails with on `main`,
and the job's `conclusion` stayed `failure`.

**Both reds precede this item and do not come from it.** Both are red on `main`
at `0c25ca0` with the same job and the same step: `O-1` (rule 0.4, root cause in
CORE, `DEP-CORE-006`) and `O-2` (missing Upstash secrets — the real-Redis job
fails at step 8, "session tests on real Redis"). Both are owner decisions.

**The run is not claimed green, and `W-6` is not marked `[x]` (`ح-4`).** What is
now proven beyond local measurement is narrower than the item and stated as such:
the egress surface is declared and gated at CI. Grading:
**مُنفَّذ · مُختبَر · مُتحقَّق منه (the guard alone)**.

## CI verdicts on branch `feat/w8-migration-dry-run-and-reconcile` (additive)

Read per job **and per step** from the API at `c80201c` (run `34668335278`;
Roadmap-freshness run `34668335236` = `success`). `verify` **failure** ·
`تكامل على PostgreSQL حقيقي` **success** · `فوضى متعدد المثيلات (F5-06)`
**success** · `تكامل على Redis حقيقي` **failure** at step 8.

In `verify`: Lint, Typecheck and Test all `success`; step 15 (`W-2` matrix guard)
`success`; **step 16 — the `W-8` guard — `success`**; step 17 (`city_id`)
**failure**; steps 18–30 all `skipped`. So the item's guard was measured and
passed, and the only red after it is the rule-0.4 gate, i.e. `O-1`
(`DEP-CORE-006`) — **prior to this item, not caused by it** — plus the Redis job
red for `O-2`. Both are red on `main` at `0c25ca0` in the same job and the same
step. Placing the step **before** `city_id` is what gave it a verdict at all;
everything after read `skipped`.

Every step of the PostgreSQL job is green, including step 10, which runs this
item's integration test, and step 12, which fails if integration tests are
skipped silently — so the test **ran** and was not silently skipped.

**Two reds in the first push, each measured rather than assumed (additive).** At
`fd35b34` (run `34667308032`), `verify` was red at step 8 Test and the PostgreSQL
job was red. The first was **a real defect of mine**: the pinned skip-registry
count test (85 files / 764 cases) failed because I added the 86th entry — which
`check-skip-classification` requires for the new integration test — **after** my
last full test run and pushed without re-measuring. The guard did exactly its
job: it stopped the registry growing silently. Counts raised to 86 / 770, both
**printed by that guard**, not invented; the earlier description kept. The
second was **not from this item, and that was measured**:
`tests/integration/admin-service-separation.test.ts` failed to boot a gateway on
port `46432` — a file this item does not touch — and **re-running the same job on
the same commit read `success`**, so the failure is not reproducible; that job is
green on `main`. The fragility is recorded rather than buried: that test derives
its port from `process.pid % 1000` inside a ten-port window, which reduces
collisions without preventing them, and its teardown kills the process without
waiting for the port to be released. **Declared debt outside this item's
reservation**, to be fixed under its own item — nothing was weakened, nothing
classified as a skip, and the re-run was to measure reproducibility, not to hide
a red.

## Status of item `W-8`, recorded 2026-09-12 (additive; item text unchanged)

Item text is untouched (`ح-1`). This section records measured state only.

**Built.** `scripts/lib/wasla-migration-dry-run.ts` (single source: 6 probes, the
closed reconciliation vocabulary, `deriveReconciliation`, a schema reader) ·
`scripts/wasla-migration-dry-run.ts` (the runnable tool) ·
`scripts/check-migration-dry-run.ts` (7-check guard, `--write` generator) ·
`docs/migration/dry-run-and-reconciliation.md` (generated between markers) ·
`tests/unit/check-migration-dry-run.test.ts` (42 tests, mostly negative) ·
`tests/integration/migration-dry-run-read-only.test.ts` (6 tests on a real
PostgreSQL) · ADR 0085 · guard wired into `ci` and into `verify` **before** the
red `city_id` step.

**Two invariants, both enforced rather than promised.** The dry-run **cannot
write**: every probe runs inside `BEGIN TRANSACTION READ ONLY ISOLATION LEVEL
REPEATABLE READ` on a **reserved** connection, so the engine itself rejects any
write with `25006`, and the transaction is rolled back regardless. The reconciler
**cannot emit a false green**: `RECONCILED` is unconstructible without a
`CoreAttestation`, `DIVERGED` likewise, and `coreRows` stays absent rather than
becoming `0`. While `DEP-CORE-007` is recorded open in this file, writing
`RECONCILED` in the tool's code **fails `verify`**; when it closes, that check
lapses on its own with no edit.

**A real measurement caught a real defect, recorded not erased.** The
real-database test failed on its first run with `UNSAFE_TRANSACTION`. The root
cause was not the library but the tool: on an unreserved pool, `READ ONLY` opens
on one connection while the probe runs on another — the invariant was declared
and the behaviour contradicted it. Neither review, types, unit tests nor `biome`
caught it; only measurement on a real engine did. Fixed at the cause by
reserving one connection, **without disabling the library's protection, without
weakening the test, and without classifying anything as a skip** — plus a new
guard check and a negative test so it cannot return silently. Third time a guard
or measurement has failed on its own author here; the first two were in `W-6`.

**Measured locally.** `bun test` → **2968 pass · 829 skip · 0 fail** · 10538
`expect()` across 3797 tests in 286 files. `biome check .` → 1109 files, no
fixes. `typecheck` passed. Real PostgreSQL → **6 pass · 0 fail** · 48 `expect()`,
including the write attempt failing with `25006`. Ran end to end: wave 1 measured
`users` = 2 rows, the rest 0; wave 6 measured `orders` = 0; wave 3 **refused with
exit 2** as out of scope. Every reconciliation row `UNVERIFIABLE`.

**Not claimed.** No `[x]`. No wave executed (`B-1`, `B-2`, `B-3` are owner
decisions and the tool prints entry conditions without evaluating them). No
reconciliation completed (`DEP-CORE-007`). The read-only invariant was measured
on a **test** database, not a production-like one (`ح-5`) — the property belongs
to the engine so it is expected to carry over, but expectation is not
measurement. Numbers above are **not** production counts (`B-1` unread).
Grading: **مُنفَّذ · مُختبَر · مَقيس** (the read-only invariant alone) — **not**
`مُثبَت`.

## CI verdicts on branch `feat/w2-migration-matrix` (additive)

Local green is not a verdict (`ح-8`). Filled in from the GitHub Actions API after
the push, per job, not summarised.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
|---|---|---|---|---|---|
| `a587923` (push `34664552923`) | `failure` | `success` | `failure` | `success` | `success` |
| `a587923` (PR [#3](https://github.com/uxxxug/ceezr/pull/3), run `34664586565`) | `failure` | `success` | `failure` | `success` | — |

**What this item actually measures.** The job log was read step by step, not as a
rolled-up conclusion. In both runs:

| Step | Name | Conclusion |
|---|---|---|
| 15 | مصفوفةُ الهجرةِ شاملةٌ ومتماسكةٌ ولا تدّعي تنفيذاً (W-2 / ADR 0083) | **`success`** |
| 16 | منع أي جدول بلا `city_id` في المخططات | **`failure`** |
| 24 | جردُ حدودِ WASLA (W-1) | `skipped` |

The `W-2` guard is therefore **proven at CI, not only locally**. Step 24 being
`skipped` is the read evidence that moving the step ahead of the red one was not
cosmetic: without the move this item's guard would have been `skipped` too — no
verdict at all — and "implemented" would have been claimed for a gate that never
ran.

The rule-0.4 gate was **not weakened**: it fails at step 16 with the same message
it fails with on `main`, and the job conclusion stays `failure`. Both reds are
pre-existing on `main` (run `34661342014` at `8d031c2`) — same jobs, same failing
steps, no regression introduced here. `O-1` and `O-2` are owner decisions.

The run is **not** claimed to be green.

## CI verdicts on branch `feat/w4-w5-operational-job-and-core-lifecycle` (additive)

Local green is not a verdict (governance `ح-8`). Each push below is followed by
the per-job conclusion actually read from the GitHub Actions API.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
| --- | --- | --- | --- | --- | --- |
| `b4a58f2` (run `34628804244`) | fail — `check-migrations` rule 0.4 (`DEP-CORE-006`) | fail — 4 cases | fail — `O-2` secrets absent | pass | pass |
| `def9a20` (run `34629792395`) | fail — same sovereign blocker | fail — 2 cases | fail — `O-2` | pass | fail — commit touched `supabase/` without a roadmap change |
| `4f93c24` (run `34632270113`) | fail — same sovereign blocker (`check-migrations`, three rule-0.4 lines, read from the job log) | **pass** | fail — `O-2` | pass | pass |
| `7bf983b` (run `34655832337`) | fail — `check-business-constants` rejected `type RejectStatus = 400 \| 401 \| 415 \| 422 \| 503;` (HTTP status literals read as a subscription price), read from the job log; the sovereign rule-0.4 blocker was never reached in this run | **pass** | fail — `O-2` | pass | pass |
| `54dcf29` (run `34656430731`) | fail — **only** `check-migrations` rule 0.4, three lines read from the job log (`operational_jobs`, `core_event_inbox`, `move_event_outbox`): the `DEP-CORE-006` / `O-1` blocker and nothing else | **pass** | fail — `O-2` | pass | pass |
| `1fa9efa` (run `34657798076`, merge of `origin/main` after PR #1 landed) | fail — **only** `check-migrations` rule 0.4, same three lines (`DEP-CORE-006` / `O-1`) | **pass** | fail — `O-2` | pass | pass |
| `1fa9efa` (run `34657801218`, same commit, second trigger) | fail — same sovereign blocker | fail — **1 case**: `location-race-conditions.test.ts:210` expected sequence `> 5`, received `4` — the same commit passed this job in run `34657798076`, so the job is order-dependent, not the code (`OPS-016`) | fail — `O-2` | pass | pass |
| `e2b33a5` (runs `34658811488` and `34658815106`) | fail — **only** `check-migrations` rule 0.4, the same three lines (`DEP-CORE-006` / `O-1`), read from the job log | **pass in both runs** (`OPS-016` fixed; the flake is gone) | fail — `O-2` | pass | pass |
| `7a03ed3` — **the merge commit on `main`** (run `34659597153`) | fail — **only** `check-migrations` rule 0.4, the same three lines, read from the job log | **pass** | fail — `O-2` | pass | pass |

Root causes found and fixed at their source, none by weakening a test:

- **This branch's own defect.** `create function` grants `execute` to `public` by
  default; the eleven new `security definer` functions were therefore executable
  by `anon` and `authenticated`, which
  `tests/integration/database-privilege-surface.test.ts` and `hostile-surface`
  correctly rejected. Both W-4/W-5 migrations now `revoke execute … from public,
  anon, authenticated` and `grant … to service_role`, as every earlier service
  function in this repository does. Fixed in `def9a20`.
- **`OPS-012` — an inverted witness in `worker-service-separation.test.ts`.** The
  test asserted the free-text line `«العامل المدمج غير مُفعَّل»`, which `F8-03`
  replaced with the event code `embedded_worker.disabled`; the phrase survives
  only as a source comment, so the assertion passed when the gateway *crashed*
  (Bun prints the source excerpt, comment included) and failed when the gateway
  started cleanly. It now asserts the emitted event code.
- **`OPS-016` — an order-dependent witness in `location-race-conditions.test.ts`.**
  The same commit `1fa9efa` passed the real-PostgreSQL job in one run and failed
  it in the other, on one assertion: published sequences had to be strictly
  increasing **in delivery order**. The sequence is allocated inside a single
  `update` in `session-repository.ts`, but the event is published *after* that
  transaction commits, in `live-tracking.ts`, outside any lock — so of two
  concurrent fixes the holder of sequence 5 may publish before the holder of 4.
  Nothing in `ADR 0053` promises delivery order; the *number* is the order, and
  the consumer sorts by it. The assertion therefore measured the scheduler, which
  the test's own docblock forbids. The witness is now order-independent (no
  sequence issued twice, measured on the set) and was **strengthened** in
  exchange: device stamps are checked in *sequence* order, and the highest
  published sequence must equal the row's `last_sequence`. The test was run ten
  times in a row locally with zero failures. No production code changed, no
  assertion was removed, and no skip was added.
- **`OPS-014` — the business-constant guard could not see a status-code union.**
  `scripts/check-business-constants.ts` forbids the literals `250`, `400` and `45`
  outside `platform_settings`, and exempts HTTP status codes — but its exemption
  only recognised response-call shapes (`c.json(...)`, `new Response(...)`,
  `status: <ddd>`, `rejected(c, "CODE", <ddd>)`). The new intake route constrains
  its reject codes with a type (`type RejectStatus = 400 | 401 | 415 | 422 | 503`)
  instead of an open `number`, so CI read `400` as a hardcoded subscription price
  and failed `verify` before it ever reached the known sovereign blocker. Fixed by
  making the guard **more precise, not more permissive**: a second narrow
  exemption matches only a whole line that is a type alias whose name ends in
  `Status` assigned a union of three-digit numbers. A price
  (`const subscriptionPrice = 400`), a mixed union (`400 | 45`), a `type Price`
  and a status alias followed by a price on the same line all still fail, and
  each of those cases is asserted in `tests/unit/check-business-constants.test.ts`.
  This defect is this branch's own, and it is recorded rather than hidden: the
  route keeps its typed status codes, the guard keeps its teeth.
- **`OPS-015` — the new integration file was an unclassified skip.**
  `check-skip-classification` (`OPS-009`) failed because
  `tests/integration/wasla-core-transport.test.ts` gates on `TEST_DATABASE_URL`
  without a registry entry. Registered in `scripts/lib/skip-registry.ts` with
  reason, activation, owner and critical path, and the lifecycle entry's measured
  count was raised from 33 to 35. The pinned totals in
  `tests/unit/skip-audit.test.ts` were raised to the numbers the gate itself
  prints (85 files, 764 cases) with the previous note kept, not deleted.
- **`OPS-013` — two real defects in `driver-location-batch-persist.test.ts`
  case 9.** (a) The payload was bound as `${JSON.stringify(batch)}::jsonb`, so
  postgres.js re-serialised the string once the parameter type was known and the
  function received a JSON string, answering `BATCH_MUST_BE_ARRAY`; it now uses
  `sql.json(...)` exactly as the production adapter does — a hazard already
  documented in `broadcast-adapters.ts` and `payment-adapters.ts`. (b) The payload
  named the field `quality`, while `jsonb_to_recordset` reads `verdict`, so the
  row was silently rejected (`applied: 0`) and the intended case (a payload
  missing only `observed_at_ms`) was never actually measured. Both fixed; the
  case now passes on a real database for the first time.

## Cross-repository dependencies on CORE, recorded 2026-09-11

Recorded here only. No change is made to CORE or MARKET from this repository.

| # | What is missing in CORE | What it blocks here |
|---|---|---|
| DEP-CORE-001 | ~~No network ingress that accepts `move.job.*` events~~ — **CLOSED** by CORE `d2c38e3`, read at CORE@`1231817` on 2026-09-12 | Was blocking outbox delivery for item 5; the production shipper now exists |
| DEP-CORE-002 | No cheap entitlement read | Item 7 (payment/wallet/subscription handover) |
| DEP-CORE-003 | No city/geography change event | Item 1 execution and item 2 |
| DEP-CORE-004 | No Telegram channel adapter | Item 6 |
| DEP-CORE-005 | No mutual repository access, so vendored contract freshness cannot be verified automatically | Contract parity stays a manually compared sha256 fingerprint |
| DEP-CORE-006 | `core.fulfillment.created` carries no city or geography, and `organization_id` / `order_reference` are opaque here | Landing the item 4 and 5 schema under sovereign rule 0.4; also driver assignment later, since drivers are city-bound |
| DEP-CORE-007 | No shared CORE environment and no service credential for MOVE, so no delivery to a real CORE can be measured | Item 5 can only be measured against CORE's written contract, never against CORE itself |
| DEP-CORE-008 | No consent surface: CORE owns identity (`users` is `MOVE_TO_CORE`, wave 5) but publishes no way to record or read a user's acceptance of the platform's terms and privacy policy with a versioned, timestamped record | `F2-01`'s `user_consents` has to live in MOVE today, which means the same person would consent twice if MARKET ever asks. The boundary registry records it `MOVE_TO_CORE` and the migration matrix gives it a plan; both are blocked on this |

## Owner instruction O-5, recorded 2026-09-12 (merge ordered with a red sovereign gate)

On 2026-09-12 the repository owner instructed, verbatim: «قم دمج كل شي إلى
المستودع ، وقم بإصلاح الدمج السابق ، وقم بدمج طلب الدمج الموجود في المستودع».
This entry was written **before** the merge was performed, so that the merge is
never read as a green verdict. The merge landed on 2026-09-12 as merge commit
`7a03ed3`, and the verdict actually read on `main` afterwards (run
`34659597153`) is the last row of the table above: `verify` still fails on the
same three rule-0.4 lines and nothing else, real PostgreSQL passes, real Redis
still fails on `O-2`, chaos and roadmap-freshness pass. So the gate was neither
satisfied nor silenced by merging — it fails on `main` exactly as it failed on
the branch. The state of the gates at the time
of the instruction is recorded below verbatim.

- **What is red at the time of this instruction, and why.** `verify` failed on exactly one gate:
  `check-migrations`, sovereign rule 0.4, three lines — `operational_jobs`,
  `core_event_inbox`, `move_event_outbox` carry no `city_id`. They cannot carry a
  truthful one: `core.fulfillment.created` from CORE contains no city and no
  geography (`DEP-CORE-006`), so a `city_id` here would be invented, not
  received. The real-Redis job failed on `O-2` (Upstash secrets are not present
  in this repository's Actions secrets). Both were declared blockers before this
  instruction, not discovered by it.
- **What is *not* done to make it green.** The gate is not disabled, not
  weakened, not skipped, and no exemption is added to
  `scripts/check-migrations.ts`. No test is relaxed. `check-migrations` will keep
  failing for these three tables until `DEP-CORE-006` closes or the owner publishes a
  governing appendix to rule 0.4. Nothing in this repository may be read as
  «مَقيس» or «مُثبَت» on the strength of a merge (`ح-4` · `ح-5`).
- **What closes it.** Either CORE adds city/geography to
  `core.fulfillment.created` (then the three tables take a received `city_id`),
  or the owner publishes a narrow, written appendix to rule 0.4 naming exactly
  these three tables and the reason. Until one of the two happens, `O-1` stays
  open.

## Status of `DEP-CORE-005`, recorded 2026-09-12 (additive; the dependency row text is unchanged and the item stays open)

`ADR 0090` · evidence `docs/evidence/architecture/DEP-CORE-005-20260912.md` ·
branch `feat/dep-core-005-contract-freshness` from `main`@`1d361ea`.

**The dependency row above is left exactly as written and `DEP-CORE-005` remains
open.** What changed is that half of it — the half this repository owns — is now
mechanised, and the other half is now named as an owner decision instead of
being left implicit in prose.

| Question | Answer, measured |
|---|---|
| What was actually missing | Two existing guards already compared, and both are internal. `scripts/check-core-contract-parity.ts` compares MOVE's runtime declaration against the vendored copy **semantically** (required sets both ways, every executed keyword per field, `additionalProperties: false`, orphans both directions, unsupported keywords rejected). `scripts/check-vendored-contract-integrity.ts` recomputes every `sha256` so the copy cannot be edited after landing. Neither can see CORE. The missing comparison was `our bytes` versus `CORE's bytes today` |
| Why no machine could do it before | The provenance was **prose**: a table saying «الالتزامُ `511624b`» and «مسارُ المصدرِ `contracts/events/`». That is enough for a human comparing by hand and useless to a program — nothing tied a specific vendored file to its path at the owner and the commit it was copied at. What cannot be parsed cannot be compared |
| What was added | A machine-readable `pin` line per vendored file inside `PROVENANCE.md` itself (additive; every prior table, fingerprint and section kept, and the hash deliberately **not** duplicated into the pin line so no second source of truth is created) · one shared reader (`scripts/lib/vendored-contract-pins.ts`) which the existing integrity guard now imports instead of its own regex · an offline guard (`scripts/check-vendored-contract-pins.ts`) · a semantic differ (`scripts/lib/schema-semantic-diff.ts`) · the comparator (`scripts/check-core-contract-freshness.ts`) |
| Where the comparator reads CORE from | A **local checkout** passed as `--from-dir=` / `CORE_CONTRACTS_REPO_DIR`, read with `git show`. No token, no HTTP call, no deployment environment, and no secret added to the repository |
| What it refuses to do | Pass when it has no CORE source. Exit codes are `0` all-current, `1` measured drift, `3` **«غيرُ قابلٍ للتحقُّقِ»** — and in the `3` case it prints no freshness claim at all. A check that goes green when it cannot find its source teaches the reader that freshness is proven when it was never measured |
| What CI now judges | The **pin** guard and the comparator's own seeded-breach tests, both inserted in `verify` **before** the red `منع أي جدول بلا city_id` step — everything after that step is skipped while `O-1` stands, so a guard placed after it would have the appearance of enforcement and none of the substance |
| What CI still cannot judge | Freshness itself. `uxxxug/wasla-core` is private and this repository's Actions token cannot read it — registered as **`O-6`**. The comparator therefore lives in `.github/workflows/core-contract-freshness.yml`, `workflow_dispatch` only: no `schedule`, because a job that fails every day for lack of access is noise that teaches people to ignore it |
| Measured verdict on the real CORE (head `9e6a636`, 2026-09-12T12:49:25Z) | exit `1`; **3 of 8** vendored contracts **stale**. `core.fulfillment.cancelled.v1`: `required.organization_id` now required (**breaks the consumer** — the `W-5` fault itself, this time found mechanically), three new properties under `additionalProperties: false`, and `partially_captured` added to a closed enum. `transport/core-v1.yaml`: 52 structural changes (429 `RateLimited`, `rate_limited` error code, `/metrics`, notification schemas). `transport/outbound-delivery.md`: 82 lines added, 3 removed — reported as **text, with the comparator stating it does not claim semantic equivalence**. The other 5 match CORE's head byte for byte |
| What is deliberately **not** done here | The three stale files are **not** re-vendored on this branch: they belong to open pull request `#11`, and re-vendoring contract bytes on two branches creates a conflict in a contract, not in prose |
| Claim ceiling, restated | `DEP-CORE-005` **stays open**, no `W-` item gains `[x]`, and `ح-4` is not satisfied by anything here. `PROVENANCE.md`'s existing sentence «**ولا يُدَّعى أنَّ التقادمَ محروسٌ آليّاً في CI**» remains true word for word: the comparator exists, is parsed, is tested, and has been run against the real CORE — and CI still does not judge by it |
| What closes it | `O-6` granted → a second `actions/checkout` for CORE → the comparator moved into `verify` as a named step before the red one. Only then |

## Second increment on `DEP-CORE-005`, recorded 2026-09-12 (additive; the item stays open)

`ADR 0091` · same branch and same reservation · `scripts/check-vendored-pin-follows-bytes.ts`.

The first increment gave every vendored contract a machine-readable `pin`. Running
the comparator then exposed a hole in the first increment itself, measured rather
than imagined: **a re-vendoring that updates the bytes and the fingerprint and
forgets the pin passes all three guards.** Parity cannot see CORE; integrity
compares the fingerprint to the file and they agree; the pins guard compares the
file to the pin by **existence, not by content**.

This is not hypothetical. Pull request `#11` re-vendors three contracts
(`core.fulfillment.cancelled.v1`, `transport/core-v1.yaml`,
`transport/outbound-delivery.md`) and this branch's pins name the commits those
files sit at on `main` — i.e. the pre-re-vendoring commits. Whichever merges
second must update the pin, and until now nothing in the repository forced it:
human memory, not a gate. A lying pin then corrupts the comparator's verdict in
both directions — it can read a faithful copy as «edited by us», and it can read
a stale contract as «current» when CORE happened not to touch that file between
the two commits.

| Question | Answer |
|---|---|
| Rule enforced | If a vendored file's bytes change in the pushed range, its `pin` line must change in the same range |
| Where it is judged | `.github/workflows/roadmap.yml` — the only workflow that owns a range (`fetch-depth: 0`, and the push event supplies a base). Range resolution: push base first, then merge-base with `main`; if neither resolves it exits **3** and names why, so an unresolvable range is never read as a pass |
| Where its own failure is measured | `verify`, named step, on a seeded two-commit git repository — no network, no history, no CORE. Placed **before** the red `city_id` step like the other two |
| Why the source hash is still not written into the pin line | `ADR 0090` rejected duplicating the fingerprint there, and a published ADR is not reopened (`ح-6`). The judgement is on **simultaneity within a range**, not on a duplicated value |
| Measured | `14 pass · 0 fail · 27 expect()`; run on this branch's own range it reports no vendored file changed, which is true — this branch only appends to `PROVENANCE.md` |
| What it does not catch | A pin written falsely in the same commit as the bytes. That needs CORE's bytes, i.e. the comparator and `O-6`. This closes **forgetting**, which is the path actually taken; it does not claim to close deliberate misstatement |
| Claim ceiling | `DEP-CORE-005` **stays open**. This guards the honesty of the provenance, not the freshness of the contract |

## CI verdicts on branch `feat/dep-core-005-contract-freshness` (additive)

Read step by step from the run itself, not from a local run and not from a badge.
Commit `4497f75` · runs `34696954715` (push) and `34696957397` (pull request) ·
pull request `#12`.

| Job | Verdict |
|---|---|
| `Roadmap freshness` (run `34696954710`) | **success** |
| `تكامل على PostgreSQL حقيقي` | **success** |
| `فوضى متعدد المثيلات (F5-06)` | **success** |
| `verify` | **failure** at step **21** `منع أي جدول بلا city_id في المخططات` |
| `تكامل على Redis حقيقي` | **failure** at step **8** `اختبارات الجلسات على Redis حقيقي` |

Both runs (push and pull request) give the identical four-job verdict.

### The two new steps were judged, and they passed

They were deliberately placed **before** the red step, because steps 22–57 are
skipped in every run while `O-1` stands.

| # | Step | Verdict |
|---|---|---|
| 19 | `سندُ العقودِ المنقولةِ مُفكَّكٌ — لا ملفَّ بلا مصدرٍ ولا سندَ لمعدومٍ (DEP-CORE-005)` | **success** |
| 20 | `سقوطُ مُقابِلِ الطزاجةِ مقيسٌ بخرقٍ مزروعٍ لا بنسخةٍ من CORE (DEP-CORE-005)` | **success** — `25 pass · 0 fail · 55 expect()` |

Step 19 printed, in CI, on a runner with no access to CORE:

```
تثبيتُ مصدرِ العقودِ المنقولةِ: 8 ملفّاً، كلٌّ مُثبَّتٌ إلى uxxxug/wasla-core عندَ 1231817 · 511624b.
وهذا تثبيتٌ لا طزاجةٌ: قراءةُ CORE محجوبةٌ بـ`O-6`، والمُقابِلُ `scripts/check-core-contract-freshness.ts` يُشغَّلُ حيثُ يُقرأُ مستودَعُ CORE.
```

So CI itself now states the boundary: it can prove the provenance is complete and
machine-readable, and it says in the same breath that this is a pin and not a
freshness proof. That sentence is the guard's own output, not documentation about
it.

Steps 1–18 success · 19 and 20 success · 21 failure · 22–57 skipped · step 9
(`تفاصيل الإخفاق في تعليقٍ مقروء`) skipped as it only runs on pull-request events
in that position.

### Neither red step was touched by this branch, and both are the same reds as before

`verify` step 21, verbatim:

```
❌ مخالفات في المخططات:
  - [20260911100000_w4_operational_jobs.sql] operational_jobs: لا يحمل عمود city_id (القاعدة 0.4)
  - [20260911100100_w5_core_inbox_move_outbox.sql] core_event_inbox: لا يحمل عمود city_id (القاعدة 0.4)
  - [20260911100100_w5_core_inbox_move_outbox.sql] move_event_outbox: لا يحمل عمود city_id (القاعدة 0.4)
```

That is `O-1` exactly as registered: three WASLA boundary tables have no city
column, rule 0.4 forbids that, and neither answer available to this repository is
an agent's to pick — CORE must expose city/geography (`DEP-CORE-006`) or the owner
must name these three tables in a recorded appendix to rule 0.4. Weakening the
guard to make the branch green is the one thing forbidden outright.

`تكامل على Redis حقيقي` step 8, verbatim:

```
env:
  UPSTASH_REDIS_REST_URL:
  UPSTASH_REDIS_REST_TOKEN:
  REQUIRE_REAL_REDIS: 1
error: REQUIRE_REAL_REDIS=1 ولا UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN في البيئةِ — وظيفةٌ وُجدت لتُشغِّل على Redis حقيقيٍّ لا تُقرَأ خضراءَ وهي لم تُخاطِبه.
```

That is `O-2`: the two Actions secrets are absent, so the job refuses to report
green for a run that never spoke to Redis. The failure is the guard working, and
it is an absent owner-provided resource, not a defect in code on this branch.

### Verdicts at `65ca31c` (second increment), read the same way

Runs `34697770745` (`Roadmap freshness`), `34697770772` (push CI),
`34697772063` (pull-request CI).

| Job | Verdict |
|---|---|
| `Roadmap freshness` | **success** — including the new step 6 `A re-vendored contract carries its pin (DEP-CORE-005)` |
| `verify` | **failure**, unchanged, at step **22** `منع أي جدول بلا city_id` — the step number moved from 21 to 22 because the new guard step was inserted before it |
| `تكامل على PostgreSQL حقيقي` · `فوضى متعدد المثيلات` | **success** |
| `تكامل على Redis حقيقي` | **failure**, unchanged, at the secrets step (`O-2`) |

All three `DEP-CORE-005` steps in `verify` were judged and passed: **19** pins,
**20** freshness-comparator seeded breach, **21** pin-follows-bytes seeded breach.
Steps 23–58 remain skipped behind the red one.

The range guard printed, in CI, with a real push range:

```
env:
  BASE_SHA: ea4c29b5cb4ef1c4731ac252b1872b08f5548d0a
  HEAD_SHA: 65ca31c9330eeaa468802fb2e8c3627c469f7217
سندُ العقودِ يتبعُ بايتاتِها: لا ملفَّ منقولاً تغيَّرَ في ea4c29b..65ca31c — فلا سندَ يلزمُ تحديثُه.
```

which is the true statement for this range: this branch appends to
`PROVENANCE.md` and re-vendors no bytes. The guard will have something to judge
the moment pull request `#11` or a future re-vendoring pushes changed contract
bytes — which is exactly the event it exists for.

### What this verdict does and does not license

It licenses exactly one claim: **the provenance of the vendored contracts is now
machine-readable and CI enforces it, and the freshness comparator's own failure
behaviour is measured by CI against a seeded breach.** It licenses nothing about
freshness, which CI still cannot measure (`O-6`), and it licenses no `[x]` and no
`VERIFIED` anywhere — `ح-4` asks for three consecutive green runs and `verify` is
red at step 21 for a reason no agent may remove.

## Merging the three open pull requests, by owner instruction, 2026-09-12 (additive)

`#10`, `#12`, `#11` merged in that order — **not** alphabetical and not by age:
`#12` carries the pin machinery, so merging it before `#11` means `#11`'s
re-vendoring is **judged** by the new guard instead of grandfathered past it.

| Conflict | How it was resolved |
|---|---|
| `.github/workflows/ci.yml` | Both sides added a step in the same place. **Both kept**, `W-9`'s cutover step and the three `DEP-CORE-005` steps, all four still **before** the red `city_id` step — a step after it reads `skipped` and carries no verdict |
| `package.json` (`ci` chain) | One chain carrying **both** additions (`check-cutover-plan.ts` and `check-vendored-contract-pins.ts`). Neither dropped |
| `docs/SYSTEM_STATE.md` · `ROADMAP.md` | Two whole sections and two whole reservation blocks collided because each was appended at the same anchor. **Both kept in full**, nothing summarised away (`ح-8`) |
| `docs/contracts/core/PROVENANCE.md` | Merged without conflict — and that silent success is exactly the hole `ADR 0091` was built for, see the row below |

### The new guard judged the merge it was built for, and demanded a correction

`#11` re-vendors three contracts; `#12` pinned those same three to the commits
they sat at on `main` **before** the re-vendoring. Git merged both cleanly: the
bytes came from one branch, the pin lines from the other, and no textual
conflict exists between them. The result would have been three pins naming
commits whose bytes are **not** the vendored bytes — a provenance record that
reads authoritative and is false.

`scripts/check-vendored-pin-follows-bytes.ts` refused the merge range. The
correction was not invented: each vendored file was re-hashed against the real
CORE repository commit by commit, and all three are byte-identical to
`uxxxug/wasla-core`@`0edb7af1438dd12b7c7bf22fb58669ae0022f2cc`
(2026-09-12 11:37:35Z) — the commit `#11` recorded reading. The three pins now
name that commit, and the guard passes on the range with
«3 ملفّاً منقولاً تغيَّرَ، ولكلٍّ سطرُ سندٍ تغيَّرَ معهُ في المدى نفسِه».

So the hole `ADR 0091` described as «a re-vendor that forgets its pin» was not
hypothetical and did not wait: it occurred on the **first** merge after the
guard landed, in the precise shape predicted, and was caught mechanically
rather than by anyone remembering.

### Measured immediately after, and not dressed up

Re-running the comparator against CORE at `bdf7239` (2026-09-12 13:26:22Z):
`core.fulfillment.cancelled.v1.schema.json` and `transport/core-v1.yaml` are
byte-identical to CORE **head**, so the `W-5` drift that started all of this is
closed at the bytes. `transport/outbound-delivery.md` is **stale again** — CORE
has amended that document five times since `0edb7af`. Its drift is prose, the
comparator declares it textual rather than semantic, and re-vendoring it once
per hour is a treadmill, not a guarantee. That is what `O-6` buys: a machine
reading the verdict instead of an agent noticing.

Also measured at the same head: CORE has published
`core.fulfillment.executed_after_cancellation.v1`, naming **MOVE** a consumer,
and MOVE answers an unknown type with `422` — which its own vendored transport
contract reads as permanent death. Recorded here as a **finding only**. The
reservation and the owner decision it needs — who pays for work delivered
against a cancelled order, CORE's own open question beside `CORE:B-20` — are
held unpushed by owner instruction, so that decision has deliberately **not**
been given a row in the tables below yet: a row would be read as a registered
owner decision, and it is not one until the owner says so.

### What this merge does **not** license

No `[x]`, no `VERIFIED`, no freshness claim. `verify` is still red at `city_id`
(`O-1`) and the Redis job still red at its secret step (`O-2`); both were left
untouched. `DEP-CORE-005` stays **open** — the comparator still cannot run in
CI without `O-6`. `W-5` and `W-9` stay unticked: `ح-4` wants three consecutive
green rounds and that is unreachable while `O-1` stands.

### CI verdict on `main` after the three merges — read 2026-09-12 at `dccbaa7`

Read per job **and per step** from the API, not assumed (`ح-8`). Runs
`34714088794` (`Roadmap freshness`) and `34714088803` (`CI`).

| Job | Verdict |
|---|---|
| `Roadmap freshness` | **success** — step 6, the pin-follows-bytes guard, judged the real merge range `556bbb6..dccbaa7` |
| `verify` | **failure** at step **23** `منع أي جدول بلا city_id في المخططات` (`O-1`). Steps 1–22 success, 24–58 skipped behind it |
| `تكامل على PostgreSQL حقيقي` | **success** |
| `فوضى متعدد المثيلات (F5-06)` | **success** |
| `تكامل على Redis حقيقي` | **failure** at step **8** `اختبارات الجلسات على Redis حقيقي` (`O-2`) — steps 1–7 success, migrations applied by the safe applier |

Every guard merged this round was judged and passed: `W-9`'s cutover ledger at
step 19, and `DEP-CORE-005`'s three at steps 20, 21 and 22. The guard that
caught the false pin printed, on `main`, with the real range:

```
env:
  BASE_SHA: 556bbb6a5901628fa3604e14a8828153cd6adc8b
  HEAD_SHA: dccbaa7a8ddf9cf60b0503c79e1429bb0a831c87
سندُ العقودِ يتبعُ بايتاتِها: نجح — 3 ملفّاً منقولاً تغيَّرَ، ولكلٍّ سطرُ سندٍ تغيَّرَ معهُ في المدى نفسِه.
```

Local run on the same tree: `2885 pass · 0 fail · 10241 expect()` across 186
files, `lint` and `typecheck` clean. Recorded as a local run, which is **not** a
substitute for a CI verdict and is not offered as one.

The two red jobs are the two reds this repository has carried all along, at the
same steps, for the two owner decisions that were deliberately left untouched.
Nothing was skip-classified, silenced, or moved.

## Owner decisions required, recorded 2026-09-11

| # | Decision | Why it cannot be taken by an executor here |
|---|---|---|
| O-1 | Either CORE adds city/geography to `core.fulfillment.created` (`DEP-CORE-006`), or a new governing appendix extends the closed `domain-ingress receipt` class to cover `core_event_inbox` and `move_event_outbox` and rules on `operational_jobs` | The 2026-09-04 governing appendix states the class is closed and can only be extended by a new governing appendix from the owner — not by an ADR, a comment in a migration, or an exception in a guard |
| O-2 | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as repository secrets | The `real-redis` CI job asserts a real Redis (`OPS-006`) and must not be weakened, silenced or skip-classified; the previous secrets belonged to the former repository account |
| O-3 | Issue a CORE bearer service credential for MOVE and set `CORE_EVENTS_BASE_URL` / `CORE_EVENTS_BEARER_TOKEN` on the worker | Credentials in CORE are owned by CORE; this repository must not mint or assume them, and the shipping job stays unregistered without them |
| O-4 | Provision a CORE `event_subscription` for `core.*` pointing at `https://<gateway>/webhook/core-events` with a signing secret of at least 32 characters, and set `CORE_INBOUND_SIGNING_SECRET` on the gateway | CORE's outbound contract states subscriptions are operator-provisioned and the secret is never echoed back; this repository receives what was provisioned and does not provision it |
| O-6 | Grant this repository's CI read access to CORE's contract directory — a read-only fine-grained token for `uxxxug/wasla-core` as a repository Actions secret, or a published copy of `contracts/` that a public job can read (a submodule, a release artifact, or a public mirror of that directory only) | `uxxxug/wasla-core` is **private** and the CI token of `uxxxug/ceezr` cannot read another private repository. Granting cross-repository read is an owner act: it is an access decision about CORE's repository, not a change in this one. Without it `scripts/check-core-contract-freshness.ts` can be run by hand wherever a CORE checkout exists, but `verify` cannot judge freshness, so `DEP-CORE-005` stays open. The comparator is deliberately built to **refuse to pass** when no CORE source is available rather than report a freshness it did not measure |

## Migrated

Nothing.

## Retired

Nothing. No legacy component is switched off before its replacement is proven.

## Status of item `W-9`, measured 2026-09-12 (additive; item text unchanged)

Item text is untouched (`ح-1`). This records **why the item cannot be executed**,
measured against the repository rather than inferred from the one-line note.

**`B-5` is real, and it is not the only thing blocking this item.** A cutover
and rollback rehearsal has to rehearse cutting over **to CORE**, and the
following are all recorded open in this same file: `B-5` (no production release
approval), `B-3` (no CORE database or environment provisioned), `DEP-CORE-007`
(no shared CORE environment, which is what forces every reconciliation row in
`W-8` to be `UNVERIFIABLE`), and `B-1` (production inventory unknown — row
counts, duplicate identities, live jobs). A rehearsal whose target does not
exist and whose volumes are unknown would rehearse **nothing**, and calling it
green would be exactly the false green that `W-8` was built to make
unconstructible.

**What already exists, and what it does not cover.** `OPS-010` provides a
schema-rollback path that is genuinely measured: `scripts/lib/rollback-audit.ts`
(static reading of migrations for anything a previous image depended on),
`scripts/check-rollback-safety.ts` (the static gate), and
`scripts/rollback-schema-drill.ts`, which CI runs on a real PostgreSQL as step 9
of the `تكامل على PostgreSQL حقيقي` job — read `success` at `c80201c`. That
covers **rolling a schema forward safely so a previous code image still runs**.
It does **not** cover this item: a WASLA cutover rehearsal is about moving
identity, payment and job ownership between two systems and back, which needs
the second system.

**No `[x]`, no reinterpretation.** The item is not silently rescoped into
documentation, and no rehearsal is claimed. The state is
**قيد التنسيق — blocked**, waiting on the owner.

## Merge state on `main`, measured 2026-09-12 (additive)

**Every open pull request is merged; none remains open.** `#1` `W-1` · `#2`
`W-4`/`W-5` · `#3` `W-2` · `#4` `W-6` · `#5` `W-8` · `#6` the `W-9` blocker
record. `main` = `0d1a29e`.

**`#5` and `#6` were merged by explicit owner instruction, and that is recorded
rather than implied.** Rule 0.7 asks for an independent reviewer; no independent
reviewer exists on this repository today, and the owner directed the merge in
writing. The rule is **not** amended by this: the ledger says the merge authority
was the owner, not an independent review, so a later reader can tell the
difference.

**Both conflicts caused by the earlier `#4` merge were resolved by union, never
by deletion.** In `.github/workflows/ci.yml` the `W-6` egress step and the `W-8`
dry-run step both survive, and both sit **before** the red `city_id` gate —
measured three times now, a guard step placed after it reads `skipped` and
therefore carries no verdict at all. In `package.json` the `ci` chain runs both
guards and both `check:*` keys are kept. In `ROADMAP.md`, `docs/SYSTEM_STATE.md`
and `docs/ROADMAP-MASTER.md` every section of `W-6`, `W-8` and `W-9` is preserved
in recording order with no character erased (`ح-8`).

**CI verdict on `main` at `0d1a29e`, read per job and per step** (run
`34670417918`; Roadmap-freshness `34670417911` = `success`):
`تكامل على PostgreSQL حقيقي` **success** · `فوضى متعدد المثيلات (F5-06)`
**success** · `verify` **failure** · `تكامل على Redis حقيقي` **failure** at step
8. In `verify`: Lint, Typecheck, Test `success`; **step 15 (`W-2`) `success` ·
step 16 (`W-6`) `success` · step 17 (`W-8`) `success`**; step 18 (`city_id`)
**failure**; everything after `skipped`.

**So all three WASLA guards are green on `main`, and the two reds are the two
owner blockers, unchanged.** `O-1` (`DEP-CORE-006`) — rule 0.4, tables from
`W-4`/`W-5` carry no `city_id`, root cause in CORE — and `O-2` — the real-Redis
job needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Both were
already red at `0c25ca0` and at `ef1f9ca` in the same job and the same step, so
merging changed neither.

**Measured locally on `main` after all merges:** `bun test` → **3008 pass · 829
skip · 0 fail** · 10598 `expect()` across 3837 tests in 287 files · `biome check .`
1112 files, no fixes · `typecheck` passed · all three guards pass · 85 ADRs with
unique numbers · skip classification 86 files / 770 cases.

**Nothing is marked `[x]`.** Merging is not a state flip: `ح-4` needs a read CI
verdict for the item's own claim, and `ح-5` needs a production-like environment.
`W-3`, `W-7` and `W-9` remain blocked on owner decisions and resources.

## Status of item `W-5` (third increment), recorded 2026-09-12 (additive; item text unchanged)

Governing decision: [ADR-0089](docs/adr/0089-cancellation-contract-re-vendored-and-foreign-blocker-namespace.md).
Evidence: `docs/evidence/architecture/W-5-CANCELLATION-20260912.md`.
Branch `feat/w5-recontract-cancellation-tenant-scope`, cut from `main`@`1d361ea`.

### What was measured before anything was written

Byte-comparison of all six vendored CORE schemas plus the two vendored transport
files against `uxxxug/wasla-core`@`0edb7af`. Five schemas matched exactly; the
cancellation schema and both transport files did not. The drift in the
cancellation schema is **breaking**, not cosmetic: CORE's tenant-scope cycle
added a **required** `organization_id` (plus `captured_minor`,
`financial_decision_required` and the `partially_captured` settlement state),
`validateObject` rejects any property outside the declaration, and `consume`
validates **before** inbox ingestion — so MOVE was rejecting **every**
cancellation CORE now publishes, leaving the fulfillment un-cancelled and the
operational job running. The first test added in this increment reproduced that
rejection before the fix and passes after it.

### What was built

| Layer | File | What it contains |
|---|---|---|
| Vendored contract | `docs/contracts/core/core.fulfillment.cancelled.v1.schema.json` | CORE's bytes at `0edb7af`, copied, never authored (`sha256 cd9d8369…`) |
| Vendored transport | `transport/core-v1.yaml` (`5401ab4c…`) · `transport/outbound-delivery.md` (`21e55afc…`) | Re-vendored in the same increment; drift was non-breaking but a stale copy is a false evidence source |
| Provenance | `docs/contracts/core/PROVENANCE.md` | A new section naming the cycle and its commit; superseded fingerprints are **kept readable** in a table the integrity guard does not parse, so each file keeps exactly one live fingerprint line |
| Domain | `packages/domain/wasla/event-envelope.ts` | `FieldSpec.type` gains `"boolean"`; the cancellation declaration is brought to the contract (five required fields; `captured_minor` integer ≥ 0 where absence is **not** zero; `financial_decision_required` boolean; six-value `settlement_state`) |
| Guard library | `scripts/lib/wasla-blockers.ts` | Mentions namespaced to a **named** owning repository (`CORE:`, `MARKET:`) are dropped before the blocker scan; a blocker we do not own has no status here to read |
| Tests | `tests/unit/core-contract-parity.test.ts` · `tests/integration/wasla-fulfillment-lifecycle.test.ts` · `tests/unit/wasla-blockers.test.ts` | Nine added cases; no existing case weakened, skipped or retimed |
| Index | — | `node_modules`, tracked in `main` as a symlink to one machine's absolute path against the repository's own `.gitignore`, removed from tracking; no content deleted |

### The money rule is satisfied structurally, not by convention

CORE blocker `CORE:B-20` leaves the fate of already-moved money undecided, and
while `financial_decision_required` is true the contract forbids telling a payer
they were refunded, invoicing the work as earned, or treating the fulfillment as
settled. MOVE has **no financial surface at all** — no table, no column, no
outbound event that can carry any of those claims — so the prohibitions hold by
construction. This is now measured: a cancellation carrying
`settlement_state: "partially_captured"`, `captured_minor: 2500` and
`financial_decision_required: true` closes the operational job, leaves `outcome`
`null`, and enqueues no new event.

### What is explicitly NOT claimed

`DEP-CORE-005` stays **open**: this increment re-vendored by hand from a read of
CORE at a named commit; it did not build the automated freshness check, so the
next drift will be just as silent. `O-1`, `O-2`, `O-3`, `O-4`, `DEP-CORE-006`
and `DEP-CORE-007` are untouched and stay red as recorded, and rule 0.4 keeps
`verify` red regardless of this work. The item is **not** marked `[x]` and no
`VERIFIED` is claimed (`ح-4`, `ح-5`). Nothing in CORE or MARKET was edited; no
branch or pull request was merged or deleted; no secret was added.

### Surrounding state measured, and deliberately not acted upon

- CI on `main`@`1d361ea` (run `34675470089`): `تكامل على PostgreSQL حقيقي`,
  `فوضى متعدد المثيلات (F5-06)` and `Roadmap freshness` succeeded; `verify`
  failed at step 19 (`city_id`, `O-1`) with steps 20–55 skipped, which means
  `bun test` has **never** been judged inside `verify`; `تكامل على Redis حقيقي`
  failed at step 8 (`O-2`, missing secrets).
- Pull requests #1–#9 merged; **#10 open**, failing only on `O-1` and `O-2`, with
  no file overlap against this increment.
- Twelve non-`main` branches are pre-migration snapshots. Recorded only; none
  merged, none deleted.


## CI verdicts on branch `feat/w5-recontract-cancellation-tenant-scope` (additive)

Read from GitHub after pushing `cc0e11d`, job by job and step by step. Recorded
as read; nothing here is a state flip (`ح-4`).

| Run | Event | Job | Verdict | Where |
|---|---|---|---|---|
| `34694520036` | push | `Roadmap freshness` | **success** | — |
| `34694520058` | push | `تكامل على PostgreSQL حقيقي` | **success** | 17 steps succeeded, 1 skipped (the failure-comment step, `if: failure()`) |
| `34694520058` | push | `فوضى متعدد المثيلات (F5-06)` | **success** | 13 steps succeeded, 1 skipped (same) |
| `34694520058` | push | `verify` | **failure** | steps 1–18 succeeded; **step 19** `منع أي جدول بلا city_id في المخططات` failed; steps 20–55 skipped |
| `34694520058` | push | `تكامل على Redis حقيقي` | **failure** | **step 8** `اختبارات الجلسات على Redis حقيقي` failed; step 9 (the attestation guard) skipped |
| `34694563529` | pull_request (#11) | CI | **failure** | same two jobs, same two steps |

**Both failures are the two owner blockers already recorded, unchanged by this
increment and identical to the verdict on `main`@`1d361ea`:** step 19 is `O-1`
(rule 0.4 — `operational_jobs`, `core_event_inbox`, `move_event_outbox` carry no
`city_id`, which needs either CORE geography per `DEP-CORE-006` or an owner
appendix), and Redis step 8 is `O-2` (the Upstash URL and token are not set as
repository Actions secrets, and `REQUIRE_REAL_REDIS=1` makes the code throw
correctly rather than pass silently). No step that this increment could affect
failed.

### A claim written earlier in this same increment, corrected by addition

Two paragraphs written before this verdict was read — one in the `W-5` third-increment
status section above, one in `docs/SYSTEM_STATE.md`, one in
`docs/evidence/architecture/W-5-CANCELLATION-20260912.md` — state that «`bun test`
has **never** been judged inside `verify`». **That is wrong, and it is corrected
here rather than deleted there.** Step 8 of `verify` is named `Test` and runs
`set -o pipefail; bun run test 2>&1 | tee /tmp/ci-output.log`, and `test` is
`bun test`. It **succeeded** on this branch and on `main`. What step 19 actually
prevents from ever being judged is the **guard chain from step 20 to step 55** —
migration safety, hot-query index coverage, the WASLA boundary inventory, the
CORE contract parity guard (step 52), the vendored-contract integrity guard
(step 53) and the coverage gate (step 54). Those are the checks whose CI verdict
is unread, including the two guards this increment relies on most. The practical
consequence stands and is now stated precisely: **the contract guards added in
`W-5` have green local runs and no CI verdict of their own, so `ح-4` cannot be
satisfied for them while `O-1` is open.**

Second correction of the same kind: `verify` step 8 running the full `bun test`
with no `TEST_DATABASE_URL` means the integration suites self-skip there, which
is where the large skip count in this job comes from. The PostgreSQL integration
job is the one that judges them, and it **succeeded** — which also settles the
four local failures classified in the `docs(W-5)` commit as environment
artifacts: CI, on `postgis/postgis:17-3.5` with one database per job, is green
on the same code.


## Blockers

| # | Blocker | Impact | What unblocks it |
|---|---|---|---|
| B-1 | Production data inventory unknown (row counts, duplicate identities, live jobs) | No migration can be planned against real volumes | Read access to production, or an exported inventory |
| B-2 | Duplicate-identity merge policy undecided | Identity handover to CORE cannot complete | An owner decision on canonical selection and conflict rules |
| B-3 | No CORE database or environment provisioned | Integration against CORE cannot be executed end-to-end yet | Infrastructure decision and provisioning |
| B-4 | Regulatory pricing policy undecided | Operational pricing inputs cannot be finalised | A legal/regulatory decision |
| B-5 | No production release approval | No production deployment will be attempted | Explicit owner approval |

## Open questions

- Which existing tables here are the true source of truth for a job today, and
  which are legacy duplicates? **Partially answered by `W-1`:** `orders` is the
  operational job table (a Ride or a Delivery), not a commercial order, and no
  duplicate job table exists in the schema. Whether rows in it are live is
  still unknown (`B-1`).
- How much identity state in this repository is live versus residual?
- Which operational surfaces are actually in production use?

## Risks

| Risk | Severity | Note |
|---|---|---|
| Legacy order/ride/job tables overlapping the canonical model | high | Must be mapped before any write path changes |
| Identity duplicated between this repository and MARKET | high | No automatic merge is permitted |
| Silent behaviour change during refactor | medium | Existing tests must pass before and after each step |

## Tests that pass at this commit

The pre-existing suite is untouched. `W-1` added one unit test file,
`tests/unit/check-boundary-audit.test.ts` (10 tests), most of them negative:
they corrupt the input and require the gate to fail, because a gate whose red
path is never exercised proves nothing when it is green.

## Not proven yet

- Integration with CORE (not attempted).
- Any data migration.
- Any cutover or rollback.

## Cross-repository status (recorded 2026-09-11)

- WASLA CORE canonical repository: `noor-seez/wasla-core` — permanently
  independent. It is not merged here, not vendored here, and not a shared
  package. CORE published its Money (double-entry ledger, wallets,
  authorization/capture) and Fulfillment coordination cycle at commit
  `f0eccc4bf2`, verified locally: typecheck clean, 37/37 tests, governance,
  contract and migration gates passing.
- No cross-repository integration has started. This repository still emits and
  consumes nothing from CORE.
- Nothing in this repository is left uncommitted by the WASLA work: every
  change made here is published on `main`.
- GitHub Actions on the `noor-seez` account is blocked at account level
  (billing/spending limit): workflow jobs are created but start zero steps, so
  CI results for this repository cannot be produced until billing is resolved.

## Owner instruction `O-7`, recorded 2026-09-13 — the goal is a standalone commercial product (additive; no item text is changed)

سُجِّلَ **قبلَ** أوّلِ تعديلٍ في هذه الدورةِ، كي لا يُقرَأَ أثرُه حُكماً أخضرَ.
نصُّ المالكِ، مُقتَطَعاً بلا تصرُّفٍ:

> «الهدف الجديد، فصل المشروع عن اي مشروع آخر أو هدف آخر، الهدف نشر هذا المشروع
> كمشروع تجاري مستقل، ربما في المستقبل أن تم نجاح هذا المشروع يتم تطبيق core,
> و market، لذلك يجب توثيق هذا الهدف في المشروع ان الهدف الحالي ليس تكامل
> المشروع مع مشاريع أخرى، ولكن استقلالية المشروع ونشره كمشروع تجاري منفصل، هيئ
> قاعدة البيانات لهذا الهدف، هيئ المشروع لهذا الهدف… أصبح التوثيق وملفات التوثيق
> أكثر من المشروع نفسه… باستثناء التجارب الميدانيه، اذا كانت تعيق التقدم الحقيقي
> في إكمال بناء المشروع فيجب حذفه أو وضعها في مكان بحيث لا تشكل عائق».

القرارُ الحاكمُ وأسبابُه وبدائلُه المرفوضةُ في
[`ADR 0094`](docs/adr/0094-move-is-a-standalone-commercial-product.md). وما
يلي حُكمُه على كلِّ سطرٍ كانَ يُحجَبُ بطرفٍ ثالثٍ — **بالإضافةِ، ولا سطرَ فوقَه
يُعدَّلُ ولا يُحذَفُ** (`ح-1` · `ح-2` · `ح-8`).

### حُكمُ `O-7` على تبعيّاتِ `CORE`

كلُّ صفٍّ أدناه **يبقى بنصِّه** في جدولِه الأصليِّ. الجديدُ هوَ التصنيفُ.

| # | الحُكمُ النافذُ | لماذا لم يُحذَفْ |
|---|---|---|
| `DEP-CORE-001` | **مؤجَّلٌ** — أُغلِقَ سابقاً في CORE، ولا يُبنى عليه الآنَ | سجلٌّ تاريخيٌّ مقيسٌ |
| `DEP-CORE-002` | **مؤجَّلٌ** — الاشتراكُ والاستحقاقُ يبقيانِ ههنا، فلا قراءةَ عبرَ حدٍّ تُحتاجُ | يعودُ إن نُفِّذَ `CORE` لاحقاً |
| `DEP-CORE-003` | **مؤجَّلٌ** — `cities` مصدرُ حقيقةٍ محليٌّ في منتجٍ مستقلٍّ، لا مِسقَطٌ لمرجعٍ خارجيٍّ | يعودُ عندَ التكاملِ |
| `DEP-CORE-004` | **مؤجَّلٌ** — قناةُ تيليجرام مملوكةٌ ههنا بالكاملِ | يعودُ عندَ التكاملِ |
| `DEP-CORE-005` | **مؤجَّلٌ** — طزاجةُ عقدٍ منقولٍ من نظامٍ لا نتكاملُ معه بلا مُتعلَّقٍ. يُؤجَّلُ سيرُ عملِ `core-contract-freshness` ويبقى الحاجزُ والعقودُ والأدلّةُ في مواضعِها | `ح-2`، والعملُ قِيسَ ووُثِّقَ |
| `DEP-CORE-006` | **مُنتَفٍ سببُه** — في منتجٍ مستقلٍّ تُنشَأُ المهمّةُ ههنا من طلبٍ في مدينةٍ معلومةٍ، فالمدينةُ مُستَلَمةٌ لا مُختَرَعةٌ. وجدولا مرورِ `CORE` يُخرَجانِ من مسارِ التطبيقِ (`S-2`) | الهجراتُ والأدلّةُ تبقى |
| `DEP-CORE-007` | **مؤجَّلٌ** — لا قياسَ مطلوبٌ ضدَّ بيئةِ `CORE` | يعودُ عندَ التكاملِ |
| `DEP-CORE-008` | **مُنتَفٍ سببُه** — `user_consents` مملوكٌ ههنا بحقِّ الأصلِ لا بالضرورةِ | تصنيفُ الجردِ يُصحَّحُ في `S-2` أو بعدَه بحاجزٍ لا بوثيقةٍ |

### حُكمُ `O-7` على قراراتِ المالكِ المفتوحةِ

| # | الحُكمُ النافذُ |
|---|---|
| `O-1` | **يُغلَقُ ههنا لا يُنتظَرُ** — `S-2`. ولا استثناءَ يُضافُ إلى حاجزِ الهجراتِ، ولا اسمَ إلى `DOMAIN_INGRESS_RECEIPT_TABLES`، ولا ملحقَ حاكمَ يُطلَبُ |
| `O-2` | **يُغلَقُ ههنا لا يُنتظَرُ** — `S-3`: Redis حقيقيٌّ مُستضافٌ في الشغلةِ. والحاجزُ بنصِّه |
| `O-3` · `O-4` | **مؤجَّلانِ** — لا بيانَ اعتمادٍ من `CORE` يُحتاجُ ولا اشتراكَ أحداثٍ |
| `O-5` | تعليمةٌ منفَّذةٌ سابقاً · لا تغييرَ |
| `O-6` | **مؤجَّلٌ** مع `DEP-CORE-005` |

### حُكمُ `O-7` على البنودِ `W-1`…`W-9`

نصُّ كلِّ بندٍ **لا يُمَسُّ** (`ح-1`)، ولا يُعادُ ترقيمٌ (`ح-2`). والحُكمُ:
`W-1` و`W-2` و`W-4` و`W-8` أعمالٌ **نافعةٌ للمنتجِ المستقلِّ** (جردُ حدودٍ،
مصفوفةُ هجرةٍ، نموذجُ مهمّةٍ قانونيٌّ، أدواتُ تشغيلٍ جافٍّ) فتبقى في مسارِها.
و`W-3` و`W-5` و`W-6` و`W-7` و`W-9` أهدافُ **تسليمٍ إلى `CORE`** — تُقرَأُ من اليومِ
**مؤجَّلةً بقرارِ المالكِ** `O-7`، لا مفتوحةً ولا مُنجَزةً ولا حاجبةً لغيرِها.

### ما لا تُغيِّرُه هذه التعليمةُ

`B-1` (جردُ بياناتِ الإنتاجِ) و`B-2` (سياسةُ دمجِ الهويّاتِ المكرّرةِ) و`B-4`
(قرارُ الأجرةِ التنظيميُّ) حواجزُ **حقيقيّةٌ داخليّةٌ أو نظاميّةٌ**، لا تبعيّاتٌ
على مستودَعٍ آخرَ، فلا يشملُها `O-7`. و`B-5` (موافقةُ إصدارٍ إنتاجيٍّ) يبقى
حاجزاً حتّى يُصدِرَ المالكُ موافقتَه بنصِّها.

### الميزانُ المقيسُ الذي استدعى البندَ الرابعَ من `ADR 0094`

| المقيسُ عندَ `a65a184` | العددُ |
|---|---|
| ملفّاتٌ في المستودَعِ | 1653 |
| منها في `docs/` | 341 |
| `docs/SYSTEM_STATE.md` | 629 KB |
| `docs/ROADMAP-MASTER.md` | 590 KB |
| سبعةُ ملفّاتِ مُخرَجٍ خامٍّ في `docs/evidence/` | 1.94 MB مجتمعةً |

والحُكمُ في `ADR 0094` §القرار/٤: الوثيقةُ وسيلةٌ لا تسليمٌ، والحدُّ يُنفَذُ
بحاجزٍ في `S-4` لا بعزمٍ مكتوبٍ.

### حالةُ `O-7` في سجلِّ الحواجزِ

`O-7` **تعليمةٌ نافذةٌ لا قرارٌ مُنتَظَرٌ**، فلا صفَّ لها في جدولِ القراراتِ
المفتوحةِ — وصفٌّ هناكَ يُقرأُ الحاكمَ منتظِراً. وأُعلِنَ إعفاءُها بسببِه في
`ROADMAP_ID_EXEMPTIONS` من `scripts/check-blocker-registry.ts`، بالسبيلِ الذي
صمَّمَه الحارسُ لهذه الحالةِ وله سابقةٌ مطابقةٌ (`O-5`) — لا بإضعافِ الحارسِ.
والطرفُ الثاني من الفحصِ يبقى حيّاً: إعفاءٌ لمعرّفٍ لم يعُدْ مذكوراً **يُخفِقُ**.
وقِيسَ هذا بحكمِ CI لا بتقديرٍ: الشغلةُ `34724386970` أخفقَت في الخطوةِ 8
(`Test`) لا في المتوقَّعةِ، والتفصيلُ في §٦ من
`docs/evidence/architecture/S-1-INDEPENDENCE-20260913.md`.

## Status of item `F2-03`, built and measured 2026-09-13 (additive; item text unchanged)

**البندُ `F2-03` (`SR-03` — اختيارُ الوجهةِ) قُلِبَ `[x]` في `docs/ROADMAP-MASTER.md`
بناءً لا قراءةً.** لم يكن على `main`@`2c7c6a7` حدُّ خدمةٍ ولا دليلُ معالمَ ولا
دالّةُ تطبيعٍ ولا بابٌ ولا شاشةٌ.

**القرارُ الحاكمُ: لا مُرمِّزَ جغرافيَّ خارجيّاً** (`O-7` · حاجزُ
`check-egress-boundary`). فالبحثُ من ثلاثةِ مصادرَ يملكُها المستودَعُ:
`saved_places` · آخرُ الوجهاتِ قراءةً من `orders` · ودليلُ معالمَ جديدٌ **ولكلِّ
صفٍّ من عشرتِه مصدرُه مكتوبٌ في نصِّ الهجرةِ**.

| الحقلُ | القيمةُ |
|---|---|
| القرارُ | `docs/adr/0102-destination-selection-without-a-geocoder.md` |
| الدليلُ | `docs/evidence/architecture/F2-03-CLOSURE-20260913.md` (8 أقسامٍ) |
| العقدانِ | `GET /v1/destinations/search` · `POST /v1/destinations/resolve` — مُسجَّلانِ بالإضافةِ في §10.2 |
| الهجراتُ | 4 ملفّاتٍ: واحدٌ طورُ `expand` وثلاثةٌ طورُ `index` |
| الحكمُ في القاعدةِ | `resolve_destination` تقرأُ مدينةَ صاحبِ الحسابِ من صفِّه وتحكمُ بـ`st_covers`؛ والرفضُ رمزٌ في حمولةٍ لا استثناءٌ (القاعدة 0.5) |
| الحاجزُ الجديدُ | `scripts/check-destination-contract.ts` (6 قواعدَ) · خطوتانِ مُسمّاتانِ في `ci.yml` (27 و28) وفي سلسلةِ `ci` |
| الاختباراتُ | 22 تكاملاً · 111 توكيداً · و85 وحدةً في 3 ملفّاتٍ · و34 حالةَ حاجزٍ فيها سالبةٌ لكلِّ قاعدةٍ |
| السجلّاتُ | الاستبقاءُ · جردُ الحدودِ · مصفوفةُ الهجرةِ · عقدُ المخطَّطِ ← 51 جدولاً · 100 دالّةً |
| PR | [#22](https://github.com/uxxxug/ceezr/pull/22) · التزامانِ `77455cc` و`80c6797` |

**والتماثُلُ قِيسَ لا افتُرِضَ**: طُبِّقَت الهجراتُ الأربعُ **جولتَينِ** على
القاعدةِ الحقيقيّةِ، فكانَ العددُ `1` و`10` صفّاً — بلا تضاعُفٍ.

**وأربعُ حمراتٍ عُولِجَت في جذرِها، ولا حاجزَ عُطِّلَ ولا توكيدَ خُفِّفَ:** بذرَتانِ
رُتِّبَ شرطُهما كي يراهُما كاشفُ التماثُلِ (**لا إعفاءَ في القائمةِ المُجمَّدةِ**) ·
جدولانِ غائبانِ عن أربعةِ سجلّاتٍ فأُلحِقا بحُجّتِهما · استفهامٌ بلوحةٍ لاتينيّةٍ
يسقطُ إلى آخرِ الترتيبِ فأُضيفَت دالّةٌ ثانيةٌ ورتبتُه صارَت **صفراً** مقيسةً ·
وتوكيدٌ يقرأُ حقلاً لا يُعادُ فصُحِّحَ ليقيسَ **أكثرَ لا أقلَّ**.

**وسقفُ الادّعاءِ، مُكرَّرٌ لا مُختصَرٌ: لا نشرَ حيَّ** (`ADR 0099`) **فهذه
الشاشةُ لم يفتحْها مستخدمٌ حقيقيٌّ ولا وجهةَ اختارَها راكبٌ**؛ وبوّابةُ `F2`
**غيرُ مُدَّعاةٍ**؛ ولا `مَقيس` ولا `مُثبَت` (`ح-5`). **ونصفُ البندِ المرئيُّ
غيرُ مُنجَزٍ**: لا أساسَ خرائطَ (`ADR 0007`)، و`.rd__map--off` **حدٌّ متقطِّعٌ**
لا مستطيلٌ رماديٌّ يُوهِمُ خريطةً. ولا مطابقةَ تقاربٍ (`pg_trgm` غيرُ منصَّبٍ).
وغلافُ جدةَ **مستطيلٌ تقريبيٌّ** 2408.56 كم² لا حدٌّ بلديٌّ.

## Finding `UX-021`, recorded 2026-09-13 — CSS classes with no matching stylesheet (additive)

**المقيسُ:** شاشةُ `F2-02` (`apps/miniapp/src/surfaces/rider/home/*`) تُصدِرُ
أصنافَ `.rh__*` ولا يُقابِلُها شيءٌ في `apps/miniapp/src/styles/global.css`.
فالسطحُ يُعرَضُ **بأنماطِ المتصفِّحِ الافتراضيّةِ** لا بأنماطِه.

**كيفَ اكتُشِفَ:** لا من تقريرٍ، بل وقتَ كتابةِ أنماطِ `.rd__*` لهذا البندِ
ومقارنةِ ما في الملفِّ بما تُصدِرُه الشاشتانِ.

**ولمَ لم يُصلَحْ ههنا:** إصلاحُه تعديلُ سطحِ `F2-02` وهوَ **خارجَ النطاقِ
المحجوزِ** لـ`F2-03`؛ وخلطُه بهذا البندِ يُفقِدُ كلاً منهما قياسَه المنفصلَ.
**فهوَ مفتوحٌ مُعلَنٌ لا مُسكَتٌ**، ومُسجَّلٌ في §25 وفي `ADR 0102` §6.

**ولا حاجزَ له اليومَ**: لا فحصَ يقابلُ أصنافَ JSX بمحدِّداتِ CSS. وبناءُ ذلكَ
الحاجزِ هوَ العلاجُ الجذريُّ — وإلّا تكرَّرَ الخرقُ في كلِّ سطحٍ قادمٍ — ويُسجَّلُ
دَيناً باسمِه لا يُطوى.

## CI verdicts on branch `feat/f2-03-destination-selection` (additive)

| الالتزامُ | الجرَيانُ | الحكمُ | القراءةُ |
|---|---|---|---|
| `77455cc` | `34743335256` · `34743294086` | **`failure`** | `verify` أخفقَ في الخطوةِ **47** من 72: `check-telegram-wrapper-isolation` — استيرادٌ مباشرٌ من `tg/location.ts` بدلَ بابِ الطبقةِ. والوظائفُ الثلاثُ الأخرى خضراءُ. |
| `80c6797` | `34743854137` · `34743852166` | **`success`** | أربعُ وظائفَ خضراءُ. والخطوتانِ **27** و**28** (حاجزُ عقدِ الوجهةِ وسقوطُه المزروعُ) `success` بأسمائِهما. و22/22 حالةَ تكاملٍ `(pass)` على PostgreSQL حقيقيٍّ في CI، ضمنَ `688 pass` على 87 ملفّاً. |

**والحمرةُ الأولى سببُها حقيقيٌّ والحاجزُ محقٌّ**: القسم 9.2 يُوجِبُ طبقةً واحدةً
قابلةً للاستبدالِ وبابُها `tg/index.ts` وحدَه. **والعلاجُ في الجذرِ** — إبدالُ
مسارِ الاستيرادِ، لا استثناءٌ ولا تعليقُ إعفاءٍ. **ودرسٌ يُسجَّلُ**: المسحُ
المحلّيُّ كانَ انتقائيّاً، ولو شُغِّلَت سلسلةُ `ci` كلُّها لَظهرَ الخرقُ قبلَ
الدفعِ — **وهذا عينُ ما تقولُه القاعدةُ: الأخضرُ المحلّيُّ ليسَ حكماً**.

**وتصحيحٌ لتوقُّعٍ سابقٍ، بالإضافةِ لا بالمحوِ (`ح-8`):** كُتِبَ في هذا الملفِّ
وفي تقاريرَ سابقةٍ أنَّ وظيفةَ **Redis الحقيقيِّ تبقى حمراءَ** لغيابِ
`UPSTASH_REDIS_REST_URL`/`_TOKEN` (`O-2`). **والحكمُ المقروءُ الآنَ يُخالِفُ
ذلكَ**: الوظيفةُ `success` في الجرَياناتِ الأربعةِ كلِّها — فالسرّانِ صارا
موجودَينِ بفعلِ المالكِ. ولا يُمحى النصُّ السابقُ؛ يبقى بتاريخِه ويُقرأُ مع هذا
التصحيحِ. **وحدُّ ما يُدَّعى**: الوظيفةُ خضراءُ في هذا الفرعِ في هذا التاريخِ،
لا أنَّ `O-2` أُغلِقَ حكماً عامّاً — وإغلاقُه يُسجَّلُ في موضعِه حينَ يُقاسُ على
`main`.

## `F2-06` closed on its lawful half — a position is never published without its age (added 2026-09-13, after the work, additively)

هذا القسمُ **زيادةٌ على حجزِ `F2-06` أعلاهُ ولا يمحوهُ ولا يُعدِّلُه** (`ح-1`)،
ويُقرأُ معَه: ذاكَ قالَ ما سيُبنى، وهذا يقولُ ما بُنيَ **وما لم يُبنَ بأسمائِه**.

**ما بُنيَ:** `supabase/migrations/20260913235000_f2_06_active_ride_snapshot.sql`
(دالّةُ لقطةٍ واحدةٌ `stable security invoker`، **والمِلكيّةُ قيدُ الاستفسارِ**
لا فحصُ تطبيقٍ، وغيرُ المالكِ يُرَدُّ `ORDER_NOT_FOUND` لا `FORBIDDEN`) ·
`packages/domain/transport/active-ride.ts` (الطَّورُ · حدُّ ٩٠ ثانيةً · تصنيفُ
الحجبِ · سياسةُ الإلغاءِ **بلا مالٍ**) · `packages/application/transport/`
(`read-active-ride.ts` + منفذُه) · `packages/infrastructure/transport/`
`active-ride-store.ts` (معرِّفُ Telegram **نصّاً** لا `Number()`) ·
`GET /v1/rides/:id` · `apps/miniapp/src/surfaces/rider/active/*` (٤ ملفّاتٍ) ·
٥٥ مفتاحاً في `{ar,en,ur}` · كتلةُ `.ar*` في `global.css` ·
`scripts/check-active-ride-contract.ts` بخمسِ قواعدَ (`UX-022`) و**١٨ حالةً
سالبةً** · خطوتانِ مُسمّاتانِ في `verify` وحلقةٌ في سلسلةِ `ci`.
والقرارُ: `ADR 0106`. والدليلُ:
`docs/evidence/architecture/F2-06-CLOSURE-20260913.md`.

**وعطبٌ حقيقيٌّ كشفَه القياسُ على قاعدةٍ حقيقيّةٍ — لا مُصرِّفٌ ولا محرِّكٌ
مُصنَّعٌ:** أوّلُ تشغيلٍ لاختبارِ التكاملِ أعطى **14/20** بإخفاقاتٍ كلُّها
`PostgresError 55000 — record "v_driver" is not assigned yet`: سجلٌّ لم يُسنَدْ
إليه شيءٌ **لا يجوزُ ذِكرُ حقلٍ منه في استعلامِ الإرجاعِ ولو في فرعٍ لا يُسلَكُ**،
فكانَت **كلُّ رحلةٍ بلا سائقٍ مُسنَدٍ تُسقِطُ الدالّةَ**. وأُصلِحَ **السببُ**
(متغيّراتٌ مفردةٌ بدلَ السجلِّ، وسببُها مكتوبٌ في `declare` كي لا يُعيدَه
«تنظيفٌ»)، **ولم يُخفَّفْ توكيدٌ ولا صُنِّفَ تخطّياً**، وأُعيدَ القياسُ:
**20/20 · 0 إخفاقٍ · 47 توكيداً**.

**وما لم يُبنَ — ولأجلِه `[~]` لا `[x]`:** **زرُّ الطوارئِ** (`F2-10` · `F8-05`)
· **مشاركةُ الرحلةِ برابطٍ** (`F2-09`) · **الاتصالُ/الرسالةُ** (لا رقمَ مقنَّعٌ،
وكشفُ رقمٍ خاصٍّ قرارُ خصوصيّةٍ لا واجهةٍ) · **صورةُ السائقِ والباركودُ** (لا
عمودَ لهما في المخطَّطِ) · **الإنهاءُ والتقييمُ** (`F2-07`) · **وسياسةُ الإلغاءِ
بعدَ الإسنادِ** مُجمَّدةٌ (`ADR 0039` §٤ · `م13-7`) فتُنشَرُ رمزاً
`AFTER_ASSIGNMENT_UNDECIDED` بلا مالٍ. **ولا يُرسَمُ منها زرٌّ رماديٌّ**: زرُّ
سلامةٍ لا يفعلُ شيئاً **وعدٌ كاذبٌ** في شاشةِ ركوبٍ ليلاً، والغيابُ المُصرَّحُ
أصدقُ منه.

**ولا يُدَّعى**: لا طَورَ «وصلَ السائقُ» (لا عمودَ `arrived_at`) · ولا تتبُّعَ
حيَّ (لقطةٌ بطلبٍ · `ADR 0035` §٤) · ولا وصولَ (`a11y`) مقيسٌ · ولا نشرَ حيَّ
(`ADR 0099`) **فلم يفتحْ راكبٌ حقيقيٌّ هذه الشاشةَ** · وبوّابةُ `F2` **غيرُ
مُدَّعاةٍ** · ولا `مَقيس` ولا `مُثبَت` (`ح-5`).

**وتصحيحٌ بالإضافةِ (`ح-8`):** خانةُ حكمِ CI في سطرِ `F2-05` من §25 بقيَت
`CI_PLACEHOLDER` ولم تُملأْ قبلَ دمجِ الطلبِ #24. والحكمُ الفعليُّ قُرِئَ الآنَ
من الشغلةِ `34766282338` للالتزامِ `af3b601`: أربعُ وظائفَ **success** (76 · 20
· 15 · 14 خطوةً) **بلا خطوةٍ ساقطةٍ**، وسُجِّلَ سطرَ تصحيحٍ في §25 —
**والسطرُ الأصليُّ يبقى بحرفِه**.

### حكمُ CI الأوّلُ أسقطَ الدفعةَ — والسببُ مُنحٌ ضمنيٌّ لا سهوُ كاتبٍ وحدَه (زيادةٌ، 2026-09-13)

هذا القسمُ **زيادةٌ لا تمحو ما فوقَه** (`ح-1` · `ح-8`). الشغلةُ
`34771548141` على الالتزامِ `18fe07c`: `verify` و`Redis` و`الفوضى` و`Roadmap
freshness` كلُّها `success`، و**`تكامل على PostgreSQL حقيقي` `failure`** بخطوةٍ
واحدةٍ ساقطةٍ. والموضِعُ `tests/integration/database-privilege-surface.test.ts`
(الطبقةُ ٢): `active_ride_snapshot(bigint,uuid)` كانَت **منفَّذةً من `anon`
و`authenticated`**، لأنَّ `postgres` يمنحُ `execute` لدورِ `public` على كلِّ
دالّةٍ جديدةٍ **تلقائيّاً** والهجرةُ لم تنزعْه.

**ولمَ لم يمسِكْه المحلِّيُّ:** شُغِّلَ ملفُّ التكاملِ **وحدَه** لا مُجلَّدُه،
فلم يُشغَّلْ اختبارُ الصلاحيّاتِ. ودرسُه مكتوبٌ: **«أخضرُ ملفٍّ» أضعفُ من
«أخضرَ محلِّيٍّ»، وهذا أضعفُ من حكمِ CI** (`ح-6`).

والإصلاحُ **بطبقتَينِ لا بسطرٍ**: `revoke execute … from public, anon,
authenticated` في الهجرةِ، **وقاعدةٌ سادسةٌ ساكنةٌ** في حاجزِ `UX-022` تُسقِطُ
كلَّ دالّةٍ تُنشَأُ بلا نزعٍ تامٍّ — بخمسِ حالاتٍ سالبةٍ مزروعةٍ (`ح-7`)،
فصارَ الحاجزُ **٢٣ حالةً** بعدَ ١٨. وأُعيدَ القياسُ: `anon` و`authenticated`
→ `false` على محرِّكٍ حقيقيٍّ، و**24 pass · 0 fail** على قاعدةٍ حقيقيّةٍ،
و`bun run ci` خروجُه `0`. والتفصيلُ في §٧٫١ من
`docs/evidence/architecture/F2-06-CLOSURE-20260913.md`.

**والحكمُ الثاني نجاحٌ تامٌّ** (الشغلةُ `34772293664` · `28af150`): أربعُ وظائفَ
`success` (٨٠ + ٢٠ + ١٥ + ١٤ خطوةً) وشغلةُ الخارطةِ `success` — **بلا خطوةٍ
ساقطةٍ واحدةٍ**، مقروءاً من واجهةِ الوظائفِ لا من راياتٍ. وقد كُتِبَ في خانةِ
حكمِ CI من سطرِ `F2-06` في §25 **الحكمانِ كلاهما**: الإخفاقُ الأوّلُ بسببِه
والنجاحُ الثاني بشروطِه — فالدليلُ يُصحَّحُ بالإضافةِ لا بالمحوِ (`ح-8`).
والبندُ يبقى **`[~]`**: لا تجربةَ ميدانيّةَ ولا نشرَ حيَّ، وبوّابةُ `F2` غيرُ
مُدَّعاةٍ.

### Reservation `F2-07` — the ride ends, and the receipt says only what was measured (recorded 2026-09-13, before the first edit)

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-07` — `SR-07` («الوصولُ والدفعُ»: ملخَّصُ الرحلةِ، المسافةُ، الزمنُ، المبلغُ — وفقَ نموذجِنا الراكبُ لا يدفعُ للمنصّةِ، إيصالٌ) و`SR-08` («التقييمُ»: نجومٌ + وسومٌ سريعةٌ + ملاحظةٌ حرّةٌ + «الإبلاغُ عن مشكلةٍ»). |
| التبعيّةُ المُستوفاةُ | `F2-06` مدموجٌ (`ea34c50`): `active_ride_snapshot` قائمةٌ و`GET /v1/rides/:id` قائمٌ وسطحُ الرحلةِ النشطةِ مبنيٌّ. والتقييمُ **موجودٌ في القاعدةِ سلفاً** لا يُخترَعُ: `ratings` (هجرةُ 2026-08-07) و`submit_rating` بنسختِها الحاكمةِ (هجرةُ 2026-08-13) — فالبناءُ ههنا **قراءةٌ وسطحٌ ووسومٌ**، لا منطقُ تقييمٍ جديدٌ. |
| النطاقُ المحجوزُ | هجرةٌ واحدةٌ (`expand`): دالّةُ ملخَّصِ الرحلةِ المنتهيةِ + عمودُ وسومٍ على `ratings` بمُعجَمٍ محصورٍ · `packages/domain/transport/ride-summary.ts` · `packages/application/transport/read-ride-summary.ts` + منفذُه · `packages/infrastructure/transport/ride-summary-store.ts` · `GET /v1/rides/:id/summary` و`POST /v1/rides/:id/rating` · `apps/miniapp/src/surfaces/rider/summary/*` · `RiderRoot.tsx` (مسارُ الشاشةِ) · `global.css` (كتلةٌ جديدةٌ) · `i18n/miniapp/{ar,en,ur}.json` · حاجزٌ جديدٌ بحالاتٍ سالبةٍ. |
| النطاقُ **غيرُ** المحجوزِ | **الأجرةُ والمبلغُ ووسيلةُ الدفعِ والإيصالُ الماليُّ** (مُجمَّدةٌ: `ADR 0039` §٤ · `م13-7` · `DEC-11`) · **تقييمُ السائقِ للراكبِ** (`SD-09`) · سطحُ السائقِ · `F2-09`/`F2-10` · `F3`. |
| لمَ لا مسافةَ مقطوعةً تُدَّعى | **لا أثرَ مسارٍ في المخطَّطِ**: `orders` فيها `pickup` و`dropoff` و`started_at` و`completed_at` **ولا عمودَ مسافةٍ ولا سلسلةَ نقاطٍ**. فالمقطوعُ **غيرُ مُقاسٍ**، ورقمٌ يُسمّى «المسافةَ» وهوَ خطٌّ مستقيمٌ **شاهدٌ كاذبٌ**. فيُنشَرُ الخطُّ المستقيمُ **باسمِه صريحاً** (`straightLineMeters`) أو لا يُنشَرُ إن غابَت الوجهةُ، **والمسافةُ المقطوعةُ تُسمّى غائبةً**. |
| لمَ لا مبلغَ | الأجرةُ ووسيلةُ الدفعِ مُجمَّدتانِ بقرارٍ سياديٍّ، **ولا تُرسَمُ خانةٌ فارغةٌ لهما** ولا «٠٫٠٠» ولا «يُحدَّدُ لاحقاً»: خانةُ مالٍ في إيصالٍ تُقرأُ التزاماً. فالإيصالُ ههنا **ملخَّصُ رحلةٍ لا فاتورةٌ**. |
| الوسومُ | مُعجَمٌ **محصورٌ في القاعدةِ** بقيدٍ لا في التطبيقِ (نظافةٌ · أدبٌ · التزامٌ بالمسارِ …)، ووسمٌ مجهولٌ **يُرَدُّ** لا يُخزَّنُ صامتاً. ومنطقُ التقييمِ **لا يُنسَخُ**: النسخةُ ذاتُ الوسومِ تحملُ المنطقَ، والتوقيعُ القائمُ `submit_rating(bigint, uuid, integer, text)` **يُفوِّضُ إليها** فمصدرُ الحقيقةِ واحدٌ (القاعدة 0.6). |
| الإبلاغُ عن مشكلةٍ | `open_support_ticket` **قائمةٌ في القاعدةِ** فتُنادى ولا تُعادُ كتابتُها. |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`) · بوّابةُ `F2` **غيرُ مُدَّعاةٍ** · **ولا `[x]` بل `[~]`** ما بقيَ «المبلغُ» في نصِّ `SR-07` مُجمَّداً والمسافةُ المقطوعةُ غيرَ مُقاسةٍ · ولا `مَقيس` ولا `مُثبَت` (`ح-5`). |

### إغلاقُ `F2-07` — الرحلةُ تنتهي بملخَّصٍ لا بفاتورةٍ، والنافذةُ ساعةُ القاعدةِ (2026-09-13)

هذا القسمُ **زيادةٌ لا تمحو حجزَ `F2-07` فوقَه** (`ح-1` · `ح-8`): الحجزُ يبقى
بحرفِه ليُقابَلَ به المُنفَّذُ.

**ما بُنيَ:** هجرةٌ واحدةٌ (`20260914010000`) فيها `completed_ride_summary(bigint,
uuid) → jsonb` **`stable security invoker`** تقرأُ الملخَّصَ في استفسارٍ واحدٍ
**والمِلكيّةُ قيدُ استعلامٍ فيها** (غيرُ المالكِ يُرَدُّ `ORDER_NOT_FOUND` لا
`FORBIDDEN`)، و`ratings.tags text[]` بقيدِ `ratings_tags_vocabulary` يقرأُ
دالّةً **ثابتةً** (`rating_tags_are_valid`)، و`submit_rating_with_tags(uuid,
bigint, smallint, text, text[])` **`security definer`** تحملُ منطقَ النافذةِ
**و`submit_rating` القائمةُ صارَت سطرَ تفويضٍ واحدٍ** (القاعدة 0.6). وفوقَها:
نطاقٌ نقيٌّ · حالةُ تطبيقٍ للقراءةِ وأخرى للكتابةِ · محوّلٌ · `GET
/v1/rides/:id/summary` و`POST /v1/rides/:id/rating` · شاشةُ ملخَّصٍ وتقييمٍ
بنجومٍ ووسومٍ وملاحظةٍ · وحاجزٌ بستِّ قواعدَ في `verify` **ولكلِّ قاعدةٍ حالةٌ
سالبةٌ مزروعةٌ** (29 حالةً · `ح-7`).

**والحكمُ الجوهريُّ:** **الشاشةُ لا تحكمُ على نافذةِ التقييمِ**؛ القاعدةُ تحكمُ
بـ`now()` مقابلَ `rating_prompt_window_hours` والشاشةُ **تقرأُ حكمَها**، فلا
بابٌ يُفتَحُ ثمَّ يُرفَضُ ولا نافذةٌ للزينةِ. **والعَدَمُ يُنشَرُ عَدَماً**:
ختمٌ ناقصٌ ⇒ مدّةٌ `null`، ووجهةٌ غائبةٌ ⇒ وترٌ `null` — لا «٠ د» ولا «٠
متراً» (`ADR 0023`). والتفصيلُ في `ADR 0107` و
`docs/evidence/architecture/F2-07-CLOSURE-20260913.md`.

**أعطابٌ كشفَها القياسُ:** (١) القاعدةُ السادسةُ في الحاجزِ كانَت تُطابِقُ
**بحدودِ الكلمةِ** فتُجيزُ `openSupportTicket` وتمسكُ `support ticket` بفراغٍ —
أي **تمنعُ ما لا يُكتَبُ وتُجيزُ ما يُكتَبُ** — فأُصلِحَ الجذرُ
(`separateCamelCase`) **مع حالةٍ سالبةٍ ثانيةٍ** تقيسُ أنَّ `sharedState` لا
يُقرأُ `share`. (٢) خُطّافُ تنظيفٍ سقطَ **بمهلةٍ** والحالاتُ كلُّها ناجحةٌ،
فجُمِّعَ الحذفُ في سبعِ عباراتٍ **ولم تُرفَعْ مهلةٌ**. (٣) **وخطأُ تشخيصٍ
يُسجَّلُ بحرفِه**: جريةُ `bun test` بقيَت حيّةً بعدَ سقوطِ أمرِ الصدَفةِ
بمهلتِه، وفيها ملفّاتٌ تُنفِّذُ `truncate … cascade`، فسمَّمَت كلَّ قياسٍ تالٍ —
**ومنه «قياسُ ضبطٍ» بُنيَ عليه استنتاجُ «تعارضِ ملفّاتٍ» لا أصلَ له**؛ ولمّا
قُتِلَت الجريةُ عادَ كلُّ ملفٍّ أخضرَ منفرداً.

**القياسُ محلّيّاً:** **31/31** حالةَ تكاملٍ على PostgreSQL حقيقيٍّ (98 توكيداً ·
ثلاثَ مرّاتٍ) · **101** حالةَ وحدةٍ جديدةً · `bun run ci` خروجُه `0` (**3789
ناجحةً · 0 فاشلةً · 4759 حالةً في 337 ملفّاً**). **والأخضرُ المحلِّيُّ ليسَ
حكماً** (`ح-6`). **وما لم يُقَسْ مُعلَنٌ**: مُجلَّدُ التكاملِ كلُّه لم يُشغَّلْ
إلى آخرِه على القاعدةِ البعيدةِ (~200 مللي ثانية لكلِّ رحلةِ شبكةٍ × تسعينَ
ملفّاً)، والحاسمُ عليه وظيفةُ «تكامل على PostgreSQL حقيقي» في CI.

**ولا يُدَّعى:** **لا مبلغَ ولا وسيلةَ دفعٍ ولا إيصالَ مالٍ ولا خانةً محجوزةً
لها** (`DEC-11`) · ولا **مسافةَ مقطوعةً** (المنشورُ وترٌ مستقيمٌ باسمِه) · ولا
**وصلَ لتذكرةِ دعمٍ** (`open_support_ticket` قائمةٌ في القاعدةِ وسطحُها نطاقُ
`F6` — ونصفُ وصلٍ أسوأُ من غيابٍ مُصرَّحٍ) · ولا **تقييمَ سائقٍ للراكبِ**
(`SD-09`) · ولا مشاركةَ ولا طوارئَ (`F2-09` · `F2-10`) · ولا وصولَ (`a11y`)
مقيسٌ · ولا نشرَ حيَّ (`ADR 0099`) **فلم يرَ راكبٌ حقيقيٌّ هذه الشاشةَ ولم
يُقيِّمْ سائقاً** · وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**، والبندُ **`[~]`** لا
`[x]`.

### حكمُ CI الفعليُّ لـ`F2-07` — أخضرُ من الجولةِ الأولى، مقروءاً وظيفةً وظيفةً (زيادةٌ، 2026-09-13)

هذا القسمُ **زيادةٌ لا تمحو ما فوقَه** (`ح-1` · `ح-8`). الطلبُ **#27** ·
الالتزامُ `26510ee`: الشغلةُ `34778086580` (`push`) — `verify` **success** (82
خطوةً) · `تكامل على PostgreSQL حقيقي` **success** (20) · `تكامل على Redis
حقيقي` **success** (15) · `فوضى متعدد المثيلات (F5-06)` **success** (14) —
**بلا خطوةٍ ساقطةٍ واحدةٍ**؛ والشغلةُ `34778171704` (`pull_request`) الوظائفُ
الأربعُ ذاتُها **success**؛ و`Roadmap freshness` (`34778086615`) **success**.
والخطوتانِ الجديدتانِ في `verify` (**37** و**38**) **نُفِّذَتا فعلاً** ولم
تُتجاوَزا.

**وما حسمَته وظيفةُ PostgreSQL وعجزَت عنه البيئةُ المحلّيّةُ**: الخطوةُ **7**
(المُطبِّقُ الآمنُ) و**10** (تمرينُ مسارِ العودةِ هجرةً هجرةً) و**11**
(`bun test tests/integration` **للمُجلَّدِ كلِّه**) و**13** (منعُ التخطّي
الصامتِ) — **أربعُها `success`**.

**وما بقيَ مُعلَناً ولا تطويه الخضرةُ**: تشغيلُ المُجلَّدِ كلِّه محلّيّاً على
القاعدةِ البعيدةِ **قُتِلَ عن قصدٍ** عندَ سبعةِ ملفّاتٍ (**59 ناجحةً · 3
فاشلةٍ**)، والفاشلاتُ الثلاثُ في `tests/integration/safe-migration-runner.test.ts`
(`F7-07` · **ملفٌّ سابقٌ لهذا البندِ**) لتجاوزِ **300 ثانيةً** في تطبيقِ
السلسلةِ كلِّها عبرَ مُجمِّعٍ في `ap-southeast-2` — **حدُّ بيئةٍ لا عطبُ
شِفرةٍ**، ودليلُه خضرةُ المُطبِّقِ نفسِه وتمرينِ العودةِ نفسِه في CI. وقُتِلَت
الجريةُ ولم تُترَكْ عملاً بدرسِ §٤٫٤ من الدليلِ: **جريةٌ حيّةٌ على قاعدةٍ
مشتركةٍ تُسمِّمُ كلَّ قياسٍ تالٍ**.

**والطلبُ لا يُدمَجُ** (القرارُ لمالكِ المستودعِ)، **وبوّابةُ `F2` غيرُ
مُدَّعاةٍ**، والبندُ **`[~]`**. والتفصيلُ في §٧ و§٧٫١ من
`docs/evidence/architecture/F2-07-CLOSURE-20260913.md`.

### Reservation `F2-08` — the ledger of what happened, with no invoice and no map (recorded 2026-09-13, before the first edit)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`8096307` فرعاً `feat/f2-08-ride-history-and-detail`، وحُكمُ CI
على ذاكَ الالتزامِ **أخضرُ** في الشغلتَينِ (`34778907165` · `34778907201`) —
قُرِئَ **قبلَ** القطعِ لا بعدَه، كي لا يُحمَلَ أحمرُ سابقٌ على هذا العملِ ولا
يُخفى به.

**والحواجزُ السياديّةُ تُعلَنُ أوّلاً لا آخِراً**، لأنَّ نصَّ البندِ يذكرُ ثلاثةَ
أشياءَ لا تُبنى ههنا، وذِكرُها في آخرِ السطرِ يُقرأُ اعتذاراً بعدَ الفعلِ:

1. **«الإيصالُ» في `SR-09` و`SR-10` — مُجمَّدٌ لا مُؤجَّلٌ.** آليّةُ الأجرةِ
   محجوبةٌ بـ[`ADR 0039`](docs/adr/0039-fare-mechanism-is-blocked-pending-regulatory-decision.md)
   §٤ على `DEC-11`، وملحقُ `م13-7` يُجمِّدُ معَها **الهياكلَ التمهيديّةَ**. فلا
   حقلَ مبلغٍ، ولا خانةَ «يُحدَّدُ لاحقاً»، ولا زرَّ إيصالٍ مُعطَّلٌ. وحاجزُ
   `check-quote-contract` القائمُ (`F2-04`) يُنفِذُ ذلكَ آلةً على شريحةِ الراكبِ،
   وسيُقاسُ على الملفّاتِ الجديدةِ بلا حرفٍ جديدٍ فيه.
2. **«مشكلةٌ في هذه الرحلةِ» — بندٌ آخرُ باسمِه.** تذكرةُ الدعمِ في التطبيقِ
   المصغَّرِ هيَ `F2-12` (`SR-11`). و`open_support_ticket` قائمةٌ في القاعدةِ،
   **ووصلُها بهذا السطحِ خارجَ النطاقِ المحجوزِ**: زرٌّ يفتحُ تذكرةً بلا شاشةٍ
   تُتابِعُها وعدٌ لا يُوفى. فالغيابُ **مُصرَّحٌ في دليلِ الإغلاقِ** ولا يُرسَمُ
   زرٌّ مُعطَّلٌ.
3. **«المسارُ على خريطةٍ ثابتةٍ» في `SR-10` — مستحيلٌ بلا مزوّدٍ، ومستحيلٌ بلا
   أثرٍ.** لا مزوّدَ خرائطَ في حزمةِ التطبيقِ المصغَّرِ (`ADR 0007`)، **ولا سلسلةَ
   نقاطٍ في المخطَّطِ أصلاً**: `orders` تحملُ `pickup` و`dropoff` نقطتَينِ ولا
   أثرَ بينهما. فحتّى لو وُجِدَ مزوّدٌ لَما وُجِدَ ما يُرسَمُ. فلا يُرسَمُ مستطيلٌ
   رماديٌّ يُوهِمُ خريطةً، ويُنشَرُ الطرفانِ **باسمَيهما** ووترُ الخطِّ المستقيمِ
   موسوماً كما في `F2-07`. والنصفُ المرئيُّ **دَينٌ مُعلَنٌ**.

**فالبندُ لا يُقلَبُ `[x]`، بل `[~]` بنصفِه المشروعِ**، ونصفُه المحجوبُ يبقى
مكتوباً باسمِه وبسندِه.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-08` — `SR-09` في §9.5 حرفاً: «قائمةٌ مقسّمةٌ بالشهرِ، بحثٌ، بطاقةٌ لكلِّ رحلةٍ معَ الحالةِ، إيصالٌ، «مشكلةٌ في هذه الرحلةِ»»، و`SR-10`: «المسارُ على خريطةٍ ثابتةٍ، الأزمنةُ، السائقُ، الإيصالُ، سجلُّ الأحداثِ». **المشروعُ منهما**: القائمةُ بالشهرِ · البحثُ · الحالةُ · الأزمنةُ · السائقُ · **سجلُّ الأحداثِ**. **والمحجوبُ**: الإيصالُ (١) · التذكرةُ (٢) · الخريطةُ (٣). |
| التبعيّةُ المُستوفاةُ | `F2-07` مدموجٌ (`8096307`): `completed_ride_summary(bigint, uuid)` قائمةٌ، وطبقاتُ `transport` الأربعُ مبنيّةٌ، وسطحُ `summary` يُقرأُ نموذجاً. ولا شيءَ من `F2-08` قائمٌ على `main`: لا دالّةَ سجلٍّ ولا عقدَ قائمةٍ ولا شاشةَ تاريخٍ. فهذا بناءٌ لا قراءةٌ. |
| العقدانِ | `GET /v1/rides` (السجلُّ — صفحاتٌ بمفتاحٍ لا بإزاحةٍ) و`GET /v1/rides/:id/detail` (التفاصيلُ وسجلُّ الأحداثِ). **جديدانِ** لا يذكرُهما §10، ويُسجَّلانِ بالإضافةِ في §10.2 لا بمسِّ جدولِ §10. |
| لماذا الصفحاتُ بمفتاحٍ لا بـ`offset` | `offset` يُعيدُ قراءةَ صفٍّ مرَّتَينِ أو يُسقِطُه إذا أُنشئت رحلةٌ بينَ صفحتَينِ، والراكبُ يُنشئُ رحلاتٍ **أثناءَ** تصفُّحِه. والمفتاحُ `(created_at, id)` مُرتَّبٌ نزولاً يُطابِقُ الفهرسَ القائمَ `orders_rider_created_id_idx` **حرفاً بحرفٍ**، فلا فهرسَ جديدٌ يُضافُ ولا سجلُّ استعلاماتٍ ساخنةٍ يُمَسُّ. |
| لماذا الشهرُ يُحسَبُ في القاعدةِ بمنطقةٍ **مُعلَنةٍ** لا في المتصفِّحِ | «رحلةُ الساعةِ الواحدةِ ليلاً في الأوّلِ من الشهرِ» تقعُ في الشهرِ السابقِ بتوقيتِ UTC. فحسابُ الشهرِ بساعةِ الجهازِ يجعلُ عنوانَ المجموعةِ يتغيَّرُ بتغيُّرِ إعدادِ هاتفٍ، وحسابُه بـUTC يُصنِّفُ رحلةَ الرِّياضِ في شهرٍ خاطئٍ. فالمنطقةُ **قيمةٌ في `platform_settings` لكلِّ مدينةٍ** (القاعدة 0.3 — لا قيمةَ عملٍ في الشِّفرةِ)، تُبذَرُ لمدنِ الإطلاقِ، **وتُنشَرُ في الردِّ نفسِه** كي تُقرأَ القيمةُ ويُقرأَ بأيِّ ساعةٍ صُنِّفَت. وغيابُها يُنشَرُ صراحةً لا يُستبدَلُ صامتاً. |
| لماذا سجلُّ الأحداثِ يُجمَعُ من `orders` و`audit_log` معاً | أختامُ الدورةِ الأربعةُ (`created_at` · `matched_at` · `started_at` · `completed_at`) في الصفِّ نفسِه، **ولا ختمَ للإلغاءِ**: `orders` فيها `cancelled_reason` بلا `cancelled_at`. والوقتُ **موجودٌ فعلاً** في `audit_log` صفَّ `order.cancelled` (هجرةُ `20260811090000`)، و`audit_log` مصنَّفٌ `auditUnboundedUntilCompliance` في سياسةِ الاحتفاظِ — أي لا يُقلَّمُ. **فلا يُضافُ عمودٌ ثانٍ لحقيقةٍ مكتوبةٍ**: عمودٌ جديدٌ يعني مصدرَينِ يفترقانِ (القاعدة 0.6)، ويعني `null` أبديّاً في كلِّ صفٍّ مضى قبلَ الهجرةِ فيُقرأُ «لم يُلغَ» عن ملغىً. |
| ولماذا لكلِّ حدثٍ **مصدرُه** منشوراً | كلُّ حدثٍ يحملُ `source` (اسمَ العمودِ أو `audit_log`) و`at` قد يكونُ `null`. فالسجلُّ **قابلٌ للمراجعةِ**: مَن قرأَه في نزاعٍ يعرفُ من أينَ جاءَ الختمُ، ولا يُقرأُ حدثٌ بلا وقتٍ صفراً ولا «الآنَ». |
| الملكيّةُ | كما في `F2-06` و`F2-07`: **قيدُ استعلامٍ لا فرعُ `if`**. مَن سألَ عن رحلةِ غيرِه يُجابُ `ORDER_NOT_FOUND` لا `FORBIDDEN`، فلا يُستدَلُّ على وجودِ رحلةٍ بفرقِ الرمزَينِ. والدالّتانِ `stable security invoker set search_path = public`، و`revoke execute … from public, anon, authenticated` على كلٍّ منهما. |
| البحثُ — وحدُّه مُعلَنٌ | مُطابقةٌ غيرُ حسّاسةٍ للحالةِ على `pickup_label` و`dropoff_label` **داخلَ صفوفِ الراكبِ وحدَه**: القسمُ الذي يمسحُه الاستعلامُ هوَ رحلاتُ شخصٍ واحدٍ لا الجدولُ. **ولا `pg_trgm` ولا `unaccent` في القاعدةِ** (مقيسٌ: الامتداداتُ المُثبَّتةُ ستّةٌ ليسا منها)، فلا يُدَّعى بحثٌ ضبابيٌّ ولا تطبيعٌ عربيٌّ ههنا؛ ودالّةُ التطبيعِ العربيِّ القائمةُ من `F2-03` تخدمُ دليلَ المعالمِ لا لافتاتِ الطلباتِ، **ووصلُها دَينٌ مُعلَنٌ** لا يُدَّعى إنجازُه. |
| النطاقُ المحجوزُ | `supabase/migrations/20260914030000_f2_08_*` (طورُ `expand`: دالّتا قراءةٍ + بذرُ إعدادِ المنطقةِ الزمنيّةِ) · `packages/domain/transport/ride-history.ts` و`ride-event-log.ts` · `packages/application/transport/{read-ride-history,read-ride-detail}.ts` ومنافذُها · `packages/infrastructure/transport/ride-history-store.ts` · `GET /v1/rides` و`GET /v1/rides/:id/detail` في `apps/gateway/src/routes/rides.ts` · `apps/miniapp/src/surfaces/rider/history/*` وتركيبُها في `RiderRoot.tsx` و`HomeScreen` · `apps/miniapp/src/styles/global.css` (كتلةٌ جديدةٌ) · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `scripts/check-ride-history-contract.ts` وتسجيلُه في `package.json` و`ci.yml` · السجلّاتُ (تسجيلُ الجديدِ لا تعديلُ القديمِ) · الاختباراتُ · `docs/adr/0107-*` · `docs/evidence/architecture/F2-08-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **الأجرةُ والمبلغُ ووسيلةُ الدفعِ والإيصالُ الماليُّ** (مُجمَّدةٌ) · **تذكرةُ الدعمِ وسطحُها** (`F2-12`) · **مزوّدُ الخرائطِ ورسمُ المسارِ** (`ADR 0007`) · مشاركةُ الرحلةِ (`F2-09`) · `SOS` من الواجهةِ (`F2-10`) · `cancel_order_by_rider` وكلُّ دالّةٍ كاتبةٍ (**هذا البندُ قراءةٌ محضةٌ: لا `insert` ولا `update` ولا `delete` في هجرتِه**) · جدولُ `orders` مخطَّطاً · ملفّاتُ `F2-01`…`F2-07` (تُقرأُ ولا تُعدَّلُ إلّا تركيبَ الشاشةِ) |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`: حسابُ Render بلا خدمةٍ)، فما يُغلَقُ ههنا **لم يفتحْه مستخدمٌ حقيقيٌّ**. وبوّابةُ `F2` (رحلةٌ كاملةٌ على جهازٍ حقيقيٍّ مسجَّلةٌ بالفيديو) **غيرُ مُدَّعاةٍ**. ولا `مَقيس` ولا `مُثبَت` (`ح-5`). **والبندُ `[~]` لا `[x]`** ما بقيَ الإيصالُ مُجمَّداً والخريطةُ معدومةً والتذكرةُ في بندٍ آخرَ. |

### إغلاقُ `F2-08` — الصفحةُ مفتاحٌ لا إزاحةٌ، والشهرُ منطقةٌ مُسمّاةٌ لا ساعةُ جهازٍ (2026-09-14)

هذا القسمُ **زيادةٌ لا تمحو حجزَ `F2-08` فوقَه** (`ح-1` · `ح-8`): الحجزُ يبقى
بحرفِه ليُقابَلَ به المُنفَّذُ.

**ما بُنيَ:** هجرةٌ واحدةٌ (`20260914030000`) فيها
`rider_ride_history(bigint, text, timestamptz, uuid, integer) → jsonb`
**`stable security invoker`** تقرأُ الصفحةَ في استفسارٍ واحدٍ بترقيمِ مفتاحٍ
(`p_limit + 1` في تعبيرٍ جدوليٍّ **بلا جدولٍ مؤقَّتٍ**)، و`rider_ride_detail(bigint,
uuid) → jsonb` تقرأُ التفاصيلَ وسِلسِلةَ الأحداثِ، **والمِلكيّةُ قيدُ استعلامٍ
في كلتَيهما** (غيرُ المالكِ يُرَدُّ `ORDER_NOT_FOUND`)، وبذرُ
`ride_history_month_timezone` لكلِّ مدينةٍ. وفوقَها: نطاقٌ نقيٌّ · حالتا تطبيقٍ ·
محوّلٌ · `GET /v1/rides` و`GET /v1/rides/:id/detail` · شاشتا السجلِّ والتفاصيلِ ·
وحاجزٌ **بثمانِ قواعدَ** في `verify` **ولكلِّ قاعدةٍ حالةٌ سالبةٌ مزروعةٌ**
(25 حالةً · `ح-7`).

**والأحكامُ الجوهريّةُ ثلاثةٌ:** (١) **الترقيمُ بمفتاحٍ لا بإزاحةٍ** — الإزاحةُ
لا ترفعُ خطأً بل تُكرِّرُ صفّاً وتُسقِطُ آخرَ **بصمتٍ** حينَ يُكتَبُ صفٌّ بينَ
صفحتَينِ، والمؤشِّرُ `(created_at, id)` يُطابِقُ الفهرسَ القائمَ حرفاً **ولا
فهرسَ جديدَ**. (٢) **الشهرُ منطقةٌ مُسمّاةٌ** تُقرأُ من `platform_settings`
بمدينةِ الطلبِ لا إزاحةً ولا ساعةَ جهازٍ، وثقةُ المصدرِ تُنشَرُ **باسمِها** لا
سقوطاً صامتاً. (٣) **لحظةُ الإلغاءِ من `audit_log`** إذ لا عمودَ `cancelled_at`
**ولم يُضَفْ**، وكلُّ حدثٍ يُنشَرُ **بمصدرِه مُسمّىً** وختمٌ ناقصٌ يُنشَرُ
`UNRECORDED` **ولا يُطوى**. والتفصيلُ في `ADR 0108` و
`docs/evidence/architecture/F2-08-CLOSURE-20260914.md`.

**أعطابٌ كشفَها القياسُ** — لا مُصرِّفٌ ولا مراجعةُ عينٍ، وكلاهُما **نصٌّ صحيحُ
التركيبِ خاطئُ المعنى يُعرَضُ سليماً ويكذبُ**: (١) نموذجُ العرضِ خرَّطَ
`ride`/`errand` و`service_type` في القاعدةِ `('transport','delivery')` حرفاً —
**فكانَ كلُّ صفٍّ في السجلِّ يُعرَضُ «خدمةً أخرى» وهوَ رحلةٌ**، وحُذِفَ مفتاحُ
`errand` من القواميسِ الثلاثةِ (86 مفتاحاً) لأنَّ نصّاً لا يُعرَضُ أبداً كَذِبٌ
مؤجَّلٌ. (٢) خرَّطَ `ORDER_STAMP`/`AUDIT_LOG` والهجرةُ تنطقُ **باسمِ العمودِ** —
فكانَ كلُّ حدثٍ «مصدراً آخرَ». **والدرسُ: العقدُ بينَ الهجرةِ والسطحِ يُقرأُ من
الهجرةِ ولا يُكتَبُ من الذاكرةِ.** (٣) **وخطأٌ ثالثٌ يُسجَّلُ بحرفِه** (`ح-8`):
كُتِبَ «`ADR 0107`» و`0107` رقمُ قرارِ `F2-07` القائمِ، فصُحِّحَ إلى `0108` في
أربعةِ مواضعَ **قبلَ الدفعِ**.

**القياسُ محلّيّاً:** **73** حالةَ وحدةٍ جديدةً في ثلاثةِ ملفّاتٍ ·
`bun test tests/unit/` **3482 ناجحةً · 0 فاشلةً · 215 ملفّاً** · `typecheck`
نظيفٌ · `lint` على خطِّ الأساسِ. **والأخضرُ المحلِّيُّ ليسَ حكماً** (`ح-6`).
**وما لم يُقَسْ مُعلَنٌ بلا تجميلٍ**: `tests/integration/ride-history.test.ts`
(**31 حالةً**) **لم يُشغَّلْ محلّيّاً ألبتّةَ** — لا `postgis` في صندوقِ
التنفيذِ ولا مُحرِّكَ حاوياتٍ — وهوَ مُسجَّلٌ في `scripts/lib/skip-registry.ts`
بمالكٍ وشرطِ تفعيلٍ **قبلَ أوّلِ دفعةٍ**، **والحاسمُ عليه وظيفةُ «تكامل على
PostgreSQL حقيقي» في CI**.

**ولا يُدَّعى:** **لا إيصالَ ولا مبلغَ ولا خانةَ محجوزةً** (`DEC-11`) · ولا
**خريطةَ ولا مسارَ مرسومَ** (`ADR 0007` والمخطَّطُ معاً — غيابٌ مُصرَّحٌ بنصٍّ) ·
ولا **تذكرةَ دعمٍ** (`F2-12` · `SR-11` — **والزرُّ غائبٌ لا مُعطَّلٌ**) · ولا
**تصديرَ ولا حذفَ بياناتٍ** (`F2-11`) · ولا **بحثَ عربيّاً مُطبَّعاً ولا
ضبابيّاً** (لا `pg_trgm` ولا `unaccent`) · ولا **وصولَ (`a11y`) مقيسٌ** · ولا
**نشرَ حيَّ** (`ADR 0099`) فلم يرَ راكبٌ حقيقيٌّ هاتَينِ الشاشتَينِ ·
**وبوّابةُ `F2` غيرُ مُدَّعاةٍ** · ولا `مَقيس` ولا `مُثبَت` (`ح-5`). **ودَينٌ
باسمِه `F2-08-D1`**: بطاقةُ السائقِ تُبنى مرّتَينِ وتُدمَجُ عندَ **ثالثِ**
قارئٍ لا قبلَه.

**وحكمُ CI** يُدوَّنُ أدناه بعدَ قراءتِه وظيفةً وظيفةً — **لا قبلَها**.

#### حكمُ CI على `F2-08` — دورةً دورةً ووظيفةً وظيفةً

**الدورةُ الأولى** — الدفعةُ `99a93bf`، التشغيلُ `34785644469`:
«فوضى متعدد المثيلات (F5-06)» **ناجحةٌ** · «تكامل على Redis حقيقي» **ناجحةٌ** ·
«Roadmap freshness» (`34785644557`) **ناجحةٌ** · «verify» **فاشلةٌ** في خطوةِ
`Test` · «تكامل على PostgreSQL حقيقي» **فاشلةٌ** في خطوةِ «اختبارات التكامل على
قاعدة حقيقية». **فسقطَ الأخضرُ المحلِّيُّ أمامَ حكمِ CI — وهذا عينُ `ح-6`.**

وسببانِ جذريّانِ، كلاهُما **في المقياسِ لا في المَقيسِ**، وأُصلِحا في `e0a19ab`:

١) **«verify» انقضَتْ مهلتُها لا فشلَ حكمُها.** الحالةُ «١) لا خرقَ في المستودعِ
كما هوَ» في `tests/unit/check-structured-logging.test.ts` استهلكَتْ `5119ms`
والمهلةُ `5000ms`. والسببُ **نظرةٌ خلفيّةٌ متغيّرةُ الطولِ** في نمطِ نداءِ
التسجيلِ — `(?<!console\s*\.\s*)` — تُقيَّمُ في المُحرِّكِ عندَ **كلِّ موضعٍ**
من المُدخَلِ، فكلَّفَ ملفٌّ واحدٌ من ١٣ كيلوبايتاً `115ms`، والمستودعُ كلُّه
`4413ms`. وقد نمَا الحملُ بنموِّ الشجرةِ حتّى عبرَ المهلةَ في آلةِ CI.
**والعلاجُ لم يكنْ رفعَ المهلةِ ولا إسكاتَ الحالةِ**، بل استبدالُ النظرةِ
الخلفيّةِ بمشيٍ إلى الخلفِ (`isConsoleQualified`) بزمنٍ ثابتٍ لكلِّ مطابقةٍ:
`4413ms` ← `225ms`، **وبالحكمِ نفسِه حرفاً بحرفٍ** (٢٤٣ موضعَ تسجيلٍ · ٠ خرقاً
قبلَ الإصلاحِ وبعدَه) — وحتّى استثناءُ `myconsole.log(` أُبقيَ كما كانَ لأنَّ
تغييرَه تغييرٌ في الحكمِ لا في الزمنِ. وسِتُّ حالاتٍ جديدةٍ (٢٩–٣٤) تُثبِّتُ
التكافؤَ وتمنعُ العودةَ **بميزانيّةِ زمنٍ مُعلَنةٍ** (`2500ms`، أي عشرةُ أضعافِ
القياسِ الحقيقيِّ) فسقوطُها يعني تراجُعاً أُسّيّاً لا بطءَ آلةٍ.

٢) **زرعُ التكاملِ خالفَ قيدَ القاعدةِ.** `seedOrder` كانَ يزرعُ `completed` بلا
سائقٍ مُسنَدٍ، فرفضَتْه القاعدةُ بـ`23514` على `orders_matched_requires_driver`،
فتساقطَتْ ثمانُ حالاتٍ على سببٍ واحدٍ. **والقيدُ لم يُخفَّفْ ولم يُلتَفَّ عليه**؛
الزرعُ صارَ يحترمُه: ما استوجبَتْ حالتُه سائقاً أخذَ سائقَ الملفِّ.

**الدورةُ الثانيةُ** — الدفعةُ `e0a19ab`، التشغيلُ `34786229661`:
«verify» **ناجحةٌ** (فالمهلةُ عُوفِيَتْ بالسببِ لا بالتخفيفِ) · «تكامل على Redis
حقيقي» **ناجحةٌ** · «فوضى متعدد المثيلات (F5-06)» **ناجحةٌ** · «تكامل على
PostgreSQL حقيقي» **فاشلةٌ** — **بحالتَينِ اثنتَينِ** بعدَ ثمانٍ ·
«Roadmap freshness» (`34786229675`) **فاشلةٌ**: دفعةُ إصلاحٍ مسَّتِ الشيفرةَ ولم
تمسَّ `ROADMAP.md` في المدى نفسِه — **وهذا السطرُ نفسُه هوَ الجوابُ**.

وسببانِ جذريّانِ آخرانِ، كلاهُما **عطبُ مقياسٍ**:

٣) **«الراكبُ الفارغُ» لم يكنْ راكباً.** الحالةُ ٢ تقيسُ سجلّاً فارغاً لراكبٍ
**مُسجَّلٍ**، والغريبُ كانَ مستخدماً بلا صفِّ `riders` فرُدَّ
`RIDER_NOT_REGISTERED` — وذاكَ مَقيسٌ وحدَه في الحالةِ ٤. فبلا صفِّ راكبٍ كانتِ
الحالتانِ تقيسانِ الشيءَ نفسَه **ويبقى الفراغُ بلا قياسٍ**؛ فزُرِعَ للغريبِ صفُّ
راكبٍ بلا رحلةٍ واحدةٍ، وأُلحِقَ بالتنظيفِ.

٤) **ترميزٌ ثانٍ أفسدَ إعداداً بعدَ استعادتِه.** استعادةُ
`ride_history_month_timezone` في الحالتَينِ ١٥ و١٦ كانت تُلتقَطُ بـ`value::text`
وتُعادُ مُعامِلاً إلى `::jsonb`، والمُشغِّلُ يُرمِّزُ النصَّ ترميزاً ثانياً فصارَ
المحفوظُ `"\"Asia/Riyadh\""` — **قيمةٌ صحيحةُ النوعِ فاسدةُ المعنى** أسقطَتِ
الحالةَ ٣١ بعدَها. فصارَ الالتقاطُ نصّاً داخليّاً (`#>> '{}'`) والإعادةُ
بـ`to_jsonb(...::text)`. وكذا استعادةُ الحالةِ ١٦ كانت تُسقِطُ `description_ar`
وهوَ `not null` فتُخفِقُ بـ`23502`؛ فصارَ الصفُّ يُستعادُ **بحقولِه** لا بقيمتِه.

**والدرسُ المُدوَّنُ:** أربعةُ أعطابٍ في هذه الدورةِ، **كلُّها في أدواتِ القياسِ
وزرعِه لا في المَقيسِ**، ولا واحدٌ منها ظهرَ محلّيّاً: اثنانِ لأنَّ قاعدةً
حقيقيّةً لا تُشغَّلُ في صندوقِ التنفيذِ، وواحدٌ لأنَّ آلةَ CI أبطأُ من المحلِّيّةِ
فأظهرَتْ تراجُعاً أُسّيّاً كانَ كامناً، وواحدٌ لأنَّ بوّابةً لا تُشغَّلُ إلّا على
مدى دفعةٍ. **وهذا هوَ معنى أنَّ CI هوَ الحاكمُ** (`ح-6`)، وأنَّ الخضرةَ
تُشترَطُ **ثلاثَ دوراتٍ متعاقبةً** (`ح-4`) لا دورةً واحدةً.

**الدورةُ الثالثةُ — خضراءُ** — الدفعةُ `64ad54e`:
التشغيلُ `34786676968` (دفعاً): «verify» **ناجحةٌ** · «تكامل على PostgreSQL
حقيقي» **ناجحةٌ** · «تكامل على Redis حقيقي» **ناجحةٌ** · «فوضى متعدد المثيلات
(F5-06)» **ناجحةٌ**. والتشغيلُ `34786677129`: «roadmap» **ناجحةٌ**. والتشغيلُ
`34786678688` (على طلبِ الدمجِ): الوظائفُ الأربعُ **ناجحةٌ**.
**وحالاتُ `tests/integration/ride-history.test.ts` الإحدى والثلاثونَ نُفِّذَتْ
كلُّها على PostgreSQL حقيقيٍّ بـ`postgis` ونجحَتْ** (813 ناجحةً · 0 فاشلةً في
وظيفةِ التكاملِ، و8 في وظيفةِ الطرفِ إلى الطرفِ) — **فالمتخطّى محلّيّاً صارَ
مَقيساً في CI، وهذا وحدَه حكمُه** (`ح-6`).

**وما لا يُقالُ بعدَ الخضرةِ:** الخضرةُ حكمُ بوّاباتٍ على شيفرةٍ، **لا نشرٌ
حيٌّ ولا راكبٌ حقيقيٌّ تصفَّحَ سجلَّه**، و`F2-08` تبقى `[~]` لا `[x]` لأنَّ
المحجوبَ سياديّاً (`DEC-11` · `ADR 0007` · `F2-12`) لم يتغيَّرْ بخضرةٍ، ودَينُ
`F2-08-D1` قائمٌ باسمِه. **وبوّابةُ `F2` غيرُ مُدَّعاةٍ.**

## حاجزٌ تشغيليٌّ `B-CI-001` — بوّابةُ CI معطَّلةٌ بسببِ فوترةِ الحسابِ لا بسببِ الشِّفرةِ (رُصِدَ 2026-09-14، إضافةً لا محواً)

**ما قِيسَ، لا ما استُنتِجَ.** بعدَ دمجِ `F2-08` (`36fbe2c`) شُغِّلَت الشغلتانِ
على `main` فسقطتا: `34787375529` (CI) و`34787375506` (Roadmap freshness).
والسقوطُ **ليسَ سقوطَ اختبارٍ**: الوظائفُ الأربعُ كلُّها انتهت في ثانيتَينِ
بـ`steps: []` — أي **لم تبدأْ أصلاً**. والسببُ منشورٌ حرفاً في تعليقِ الفحصِ:

> `The job was not started because recent account payments have failed or your`
> `spending limit needs to be increased. Please check the 'Billing & plans'`
> `section in your settings`

وأُعيدَ التشغيلُ مرّتَينِ (`run_attempt: 3`) فتكرَّرَ الحكمُ نفسُه، و`timing`
يقولُ `total_ms: 0` لكلِّ وظيفةٍ — **لا دقيقةَ حوسبةٍ صُرِفَت**.

**ولماذا هذا حاجزٌ لا مُضايقةٌ:** `ح-6` تقولُ إنَّ الأخضرَ المحلّيَّ **ليسَ
حكماً**، و`ح-4` تشترطُ ثلاثَ دوراتٍ خضراءَ مقروءةً قبلَ أيِّ ادّعاءٍ. فما دامت
الشغلاتُ **لا تبدأُ**، فلا حكمَ يُقرأُ، ولا بندَ يُغلَقُ، ولا فرعَ يُدمَجُ
«لأنَّه أخضرُ» — لأنَّ الخضرةَ غيرُ قابلةٍ للقياسِ اليومَ.

**وما لا يُفعَلُ ردّاً على هذا الحاجزِ — مكتوبٌ سلفاً كي لا يُغرى به لاحقاً:**

1. **لا تُعطَّلُ بوّابةٌ** ولا يُخفَّفُ فحصٌ ولا يُسكَتُ اختبارٌ كي يبدوَ المسارُ
   سالكاً؛ العطبُ في الفوترةِ لا في الحواجزِ.
2. **لا يُدَّعى إغلاقُ بندٍ بالأخضرِ المحلّيِّ**؛ العملُ يستمرُّ ويُدفَعُ،
   **وحكمُه يبقى «غيرُ مقروءٍ — محجوبٌ بـ`B-CI-001`»** حتّى تُشغَّلَ الشغلاتُ.
3. **لا يُنقَلُ الفحصُ إلى مكانٍ آخرَ** (مُشغِّلٌ ذاتيُّ الاستضافةِ، أو تشغيلٌ
   محلّيٌّ يُسمّى «حكماً») — فذاكَ نقلُ المشكلةِ لا حلُّها، ويُفقِدُ الحكمَ
   استقلالَه عن آلةِ المُنفِّذِ.
4. **لا يُمحى هذا السطرُ** متى عادت الفوترةُ؛ يُضافُ تحتَه سطرُ الرفعِ بتاريخِه
   ورقمِ أوّلِ شغلةٍ نجحت (`ح-8`).

**ومَن يرفعُه:** مالكُ الحسابِ وحدَه — لا صلاحيةَ تقنيّةً تُصلِحُ وسيلةَ دفعٍ.
الإجراءُ: `Settings → Billing & plans` في حسابِ `uxxxug`، تحديثُ وسيلةِ الدفعِ
أو رفعُ حدِّ الإنفاقِ، ثمّ إعادةُ تشغيلِ الشغلتَينِ أعلاه.

**وأثرُه على العملِ الجاري:** البنودُ تستمرُّ بناءً ودفعاً وفتحَ طلباتِ دمجٍ،
**ولا تُغلَقُ**. و`F2-09` يُبنى تحتَ هذا السقفِ المُعلَنِ.

### Reservation `F2-09` — one link, one clock, and a preview that is the recipient's own answer (recorded 2026-09-14, before the first edit)

حُجِزَ **قبلَ** أوّلِ تعديلٍ، وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
مقطوعٌ من `main`@`2c292e8` فرعاً `feat/f2-09-ride-share-link`.

**وحكمُ CI على نقطةِ القطعِ غيرُ مقروءٍ — وهذا يُقالُ أوّلاً لا آخِراً.**
الشغلتانِ على `36fbe2c` سقطتا **قبلَ أن تبدآ** لسببِ فوترةٍ لا لسببِ شِفرةٍ،
وهوَ الحاجزُ `B-CI-001` المُسجَّلُ أعلاه. فهذا البندُ يُبنى ويُدفَعُ ويُفتَحُ
له طلبُ دمجٍ، **ولا يُغلَقُ ولا يُدمَجُ** حتّى يُقرأَ حكمٌ حقيقيٌّ (`ح-4` · `ح-6`).

**والعطبُ المقيسُ الذي يُصلَحُ ههنا — وُجِدَ بالقراءةِ لا بالتخمينِ:**
`get_tracking_position(text)` (هجرةُ `20260814150000`) تنشرُ `lat`/`lng` لمن
يحملُ الرابطَ **بلا حدِّ عُمرٍ**: نقطةٌ عمرُها ساعتانِ تُرسَمُ على الخريطةِ
كأنّها الآنَ. وفي الوقتِ نفسِه شاشةُ **المالكِ** (`F2-06`) تحجبُ النقطةَ فوقَ
تسعينَ ثانيةً وتُصنِّفُ سببَ الحجبِ. فالغريبُ المجهولُ يُعطى ثقةً **أعلى** من
صاحبِ الرحلةِ — وهذا قلبٌ لترتيبِ الأمانِ. و`SR-13` يطلبُ «معاينةَ ما سيراهُ
المستلمُ»، ومعاينةٌ فوقَ مصدرَينِ مختلفَي السياسةِ **كذبةٌ بالبناءِ**.

| الحقلُ | القيمةُ |
|---|---|
| البندُ | `F2-09` — `SR-13` في §9.5 حرفاً: «رابطُ تتبّعٍ مؤقّتٌ معَ مدّةِ صلاحيةٍ، معاينةُ ما سيراهُ المستلمُ، إيقافُ المشاركةِ» · زرُّه «إرسالُ الرابطِ» · و§1060: المشاركةُ معَ قريبٍ **حتّى انتهاءِ الرحلةِ**. |
| ما هوَ قائمٌ ولا يُكرَّرُ (القاعدة 0.6) | جدولُ `trip_tracking_tokens` ودوالُّه الأربعُ (`issue_tracking_token` · `revoke_tracking_token` · `get_tracking_position` · `expire_tracking_tokens`) و`revoke_order_tracking_tokens` · منافذُ `application/tracking/tracking-token-ports.ts` ومحوّلاتُها · صفحةُ `GET /track/:token` العامّةُ · `TRACKING_TOKEN_BASE_URL` في الإعداداتِ. **فلا جدولَ ثانٍ للمشاركةِ، ولا مُولِّدَ رمزٍ ثانٍ، ولا صفحةَ عرضٍ ثانيةٌ.** الجديدُ **سطحُ المالكِ** وحدَه: أن يُصدِرَ ويُعايِنَ ويُوقِفَ من التطبيقِ المصغَّرِ. |
| العقودُ الثلاثةُ | `GET /v1/rides/:id/share` (الحالةُ: الروابطُ الساريةُ بأعمارِها وبقيّةِ صلاحيتِها + المعاينةُ) · `POST /v1/rides/:id/share` (إصدارٌ) · `DELETE /v1/rides/:id/share` (إيقافُ **كلِّ** روابطِ الرحلةِ). **جديدةٌ** لا يذكرُها §10، وتُسجَّلُ بالإضافةِ في §10.2. |
| الإصلاحُ الجذريُّ: مصدرٌ واحدٌ لحكمِ النقطةِ | تُستخرَجُ دالّةٌ داخليّةٌ واحدةٌ `tracking_link_view(uuid)` تُصنِّفُ الموقعَ (`LOCATED` · `NEVER_REPORTED` · `NO_TIMESTAMP` · `TOO_OLD`) وتنشرُ العُمرَ **دائماً**، **ولا تُخرِجُ الإحداثيّةَ من القاعدةِ متى لم يكن الحكمُ `LOCATED`** — الحجبُ في القاعدةِ لا في الواجهةِ، فلا يُسرَّبُ رقمٌ إلى سلكٍ ثمّ يُخفى برسمٍ. ثمّ تُعادُ كتابةُ `get_tracking_position(text)` **غلافاً رقيقاً للإذنِ** فوقَها. فالصفحةُ العامّةُ والمعاينةُ **جوابٌ واحدٌ حرفاً** لا جوابانِ متشابهانِ. |
| ولماذا الحدُّ في `platform_settings` لا في الشِّفرةِ | «تسعونَ ثانيةً» **قيمةُ عملٍ** (القاعدة 0.3) ومدينةٌ قد تختارُ غيرَها. فيُبذَرُ `driver_position_max_age_seconds` = `90` لكلِّ مدينةٍ — **مطابقاً** لـ`DRIVER_POSITION_MAX_AGE_SECONDS` في النطاقِ اليومَ فلا يتغيَّرُ سلوكُ `F2-06` بحرفٍ — **ويُحرَسُ التطابقُ آلةً**: حاجزٌ ساكنٌ يقرأُ البذرةَ من الهجرةِ والثابتَ من النطاقِ ويُسقِطُ البناءَ إن افترقا. فالقيمتانِ لا تنزلقانِ بصمتٍ، ولا يُعادُ بناءُ `F2-06` في بندٍ ليسَ له. |
| المعاينةُ — ولماذا هيَ جوابُ المستلمِ لا رسمٌ يُشبهُه | `rider_ride_share_state(bigint, uuid)` تُنادي `tracking_link_view` **نفسَها** وتنشرُ حمولتَها كما هيَ تحتَ `preview`. فما يراهُ المالكُ في المعاينةِ هوَ **بايتاتُ** ما سيراهُ المستلمُ. ولو حُسِبَت المعاينةُ حساباً ثانياً لَصارت شاشةً تُطمئنُ عن شاشةٍ أخرى لا تعرفُها. |
| الملكيّةُ والصلاحيةُ | الملكيّةُ **قيدُ استعلامٍ لا فرعُ `if`** (كما `F2-06`…`F2-08`)، وغيرُ المالكِ يُجابُ `ORDER_NOT_FOUND` لا `FORBIDDEN`. والبقيّةُ `seconds_remaining` **تُحسَبُ بساعةِ القاعدةِ** وتُنشَرُ عدداً — **لا يُرسَلُ ختمُ انتهاءٍ ليطرحَه جهازٌ بساعتِه** (نفسُ درسِ `F2-08` في المناطقِ الزمنيّةِ). |
| الإيقافُ بمعرّفِ الرحلةِ لا بالرمزِ | `revoke_order_tracking_tokens` القائمةُ: الراكبُ **لا يحملُ الرمزَ** في طلبِ الإيقافِ، فلا يُكتَبُ سرٌّ في سجلٍّ ولا في تاريخِ طلباتٍ. والردُّ عددُ ما أُلغيَ. |
| الحاجزُ الساكنُ | `scripts/check-ride-share-contract.ts` (+ `scripts/lib/ride-share-contract.ts`): ١ لا إحداثيّةَ في حمولةٍ حكمُها ليسَ `LOCATED` · ٢ كلُّ نقطةٍ منشورةٍ معَ عُمرِها · ٣ لا رمزَ مشاركةٍ يُرسَمُ نصّاً في الشاشةِ (الرابطُ وحدَه) · ٤ لا صلاحيةَ تُحسَبُ بساعةِ الجهازِ · ٥ لا قيمةَ مدّةٍ مكتوبةً في السطحِ · ٦ مفاتيحُ `rider.share.` الثلاثةُ متطابقةٌ · ٧ المعاينةُ تُقرأُ من الحقلِ `preview` لا تُركَّبُ. ولكلِّ قاعدةٍ **حالةٌ سالبةٌ مزروعةٌ** (`ح-7`). |
| وتعديلُ حاجزِ `F2-06` — نقلٌ مُصرَّحٌ لا إسكاتٌ | `scripts/lib/active-ride-contract.ts` يحظرُ اليومَ كلمةَ «مشاركة»/`share` في سطحِ الرحلةِ النشطةِ، **ورأسُه نفسُه يأمرُ بنقلِها إلى المسموحِ حينَ يُبنى مسارُها**. فتُنقَلُ ههنا **معَ مسارِها**، ويُشدَّدُ مكانَها شرطٌ موجبٌ: كلُّ زرِّ مشاركةٍ في السطحِ يجبُ أن يكونَ موصولاً بمسارٍ من العقودِ الثلاثةِ أعلاه. والطوارئُ (`F2-10`) والاتّصالُ يبقيانِ محظورَينِ بحرفِهما. |
| النطاقُ المحجوزُ | `supabase/migrations/20260914060000_f2_09_*` (طورُ `expand`: دالّةُ العرضِ المشتركةُ + دالّةُ حالةِ المشاركةِ + إعادةُ كتابةِ `get_tracking_position` غلافاً + بذرُ الإعدادِ) · `packages/domain/transport/ride-share.ts` · `packages/application/transport/{read-ride-share,start-ride-share,stop-ride-share}.ts` ومنافذُها · `packages/infrastructure/transport/ride-share-store.ts` · `apps/gateway/src/routes/rides.ts` (ثلاثةُ مساراتٍ جديدةٌ فقط) و`index.ts` (حقنُ التبعيةِ) · `apps/miniapp/src/surfaces/rider/share/*` وتركيبُه في شاشةِ الرحلةِ النشطةِ · `apps/miniapp/src/styles/global.css` (كتلةٌ جديدةٌ) · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ جديدةٌ فقط) · `scripts/check-ride-share-contract.ts` و`scripts/lib/ride-share-contract.ts` وتسجيلُهما في `package.json` و`ci.yml` · `scripts/lib/active-ride-contract.ts` (نقلُ المفردةِ معَ شرطٍ موجبٍ) · `packages/infrastructure/db/schema-contract.ts` (تسجيلُ الدوالِّ الجديدةِ) · الاختباراتُ · `docs/adr/0109-*` · `docs/evidence/architecture/F2-09-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **`SOS` وزرُّ الطوارئِ** (`F2-10`) · **الاتّصالُ المُقنَّعُ بالسائقِ** (لا مزوّدَ) · **إرسالُ الرابطِ برسالةٍ نصّيّةٍ أو واتساب من الخادمِ** (لا مزوّدَ رسائلَ؛ المشاركةُ من نظامِ الجهازِ) · **الأجرةُ والإيصالُ** (`DEC-11`) · **الخريطةُ ومزوّدُها** (`ADR 0007`) · حوارا البوتَينِ (يُقرآنِ ولا يُعدَّلانِ) · جدولُ `trip_tracking_tokens` مخطَّطاً (لا عمودَ جديدٌ) · `drivers.last_location` كتابةً (`BUG-001` بندٌ آخرُ) |
| سقفُ الادّعاءِ، مُعلَنٌ سلفاً | لا نشرَ حيَّ (`ADR 0099`)، ولا راكبَ حقيقيَّ شاركَ رابطاً، وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**. **وحكمُ CI محجوبٌ بـ`B-CI-001`** فلا `مَقيس` ولا `مُثبَت` (`ح-5`)، والبندُ يبقى **مفتوحاً** حتّى يُقرأَ حكمٌ. وخصوصيّةُ المشاركةِ نفسُها حدٌّ مُعلَنٌ: مَن أُعطيَ الرابطَ يرى موقعَ **السائقِ** — لا اسمَ الراكبِ ولا وجهتَه ولا هاتفَه — وهذا مكتوبٌ في المعاينةِ نصّاً كي يعرفَ المُشارِكُ ما يُعطي قبلَ أن يُعطيَه. |

### Reservation `F2-09` — additive amendment to the reserved scope (recorded 2026-09-14, during execution · `ح-8`)

**لا يُمحى سطرٌ من الحجزِ أعلاه ولا يُستبدَلُ؛ هذا تصحيحٌ بالزيادةِ** (`ح-8`).
اتّضحَ عندَ التنفيذِ أنَّ الإصلاحَ الجذريَّ **لا يمكنُ أن يكونَ جذريّاً** ما بقيَ
مستهلكٌ للحكمِ القديمِ خارجَ النطاقِ المحجوزِ. فالحَكَمُ الواحدُ يقتضي أن
**يُوصَلَ به قارئُه العامُّ** لا أن يُترَكَ الغلافُ وحدَه. فيُزادُ إلى النطاقِ
المحجوزِ:

* `apps/gateway/src/routes/public-tracking.ts` و`apps/gateway/src/public/tracking-page.ts`
  — **مستهلكا** `get_tracking_position`: لولا وصلُهما بالحَكَمِ لبقيَ للسياسةِ
  مصدرانِ ولَظلَّ الغريبُ يُرى نقطةً متقادمةً، وهوَ **عينُ العطبِ** الذي جاءَ
  البندُ لإغلاقِه لا تفصيلٌ فيه.
* `packages/application/tracking/tracking-token-ports.ts` و
  `packages/infrastructure/tracking/tracking-token-adapters.ts` — منفذُ القراءةِ
  ومحوّلُه: توسَّعَت حمولتُهما لتحملَ الحكمَ والعُمرَ ومصدرَ الحدِّ، إذ **منفذٌ
  يُعيدُ إحداثيّةً وحدَها لا يستطيعُ أن ينقلَ حكماً**.
* `apps/gateway/src/index.ts` — حقنُ التبعيّاتِ الثلاثِ (قراءةٌ · بدءٌ · إيقافٌ).

**وافتراقٌ ثانٍ يُسجَّلُ لا يُبتَلَعُ:** الحجزُ أعلاه سمّى ثلاثةَ ملفّاتٍ
`{read-ride-share,start-ride-share,stop-ride-share}.ts`، والمُنفَّذُ ملفٌّ واحدٌ
`packages/application/transport/ride-share.ts` فيه الثلاثةُ **دوالَّ مفصولةً
بمنافذَ مفصولةٍ مُحقَنةٍ كلٍّ على حدةٍ**. فالفصلُ المقصودُ — أن لا يحملَ
قارئُ الحالةِ صلاحيةَ الإصدارِ أو الإيقافِ — قائمٌ بالمنافذِ لا بعددِ
الملفّاتِ، والملفُّ الواحدُ أقلُّ سطحاً بلا خسارةٍ في الفصلِ. **والنطاقُ غيرُ
المحجوزِ لم يُوسَّعْ بحرفٍ**: لا `SOS`، ولا اتّصالَ، ولا إرسالَ رابطٍ من
الخادمِ، ولا أجرةَ، ولا خريطةَ، ولا حوارَ بوتٍ عُدِّلَ، ولا عمودَ في
`trip_tracking_tokens`، ولا كتابةَ في `drivers.last_location`.

### `F2-09` — execution record and why the item stays open (2026-09-14)

**نُفِّذَ البندُ كاملاً، ويبقى `[ ]`.** والسببُ **ليسَ عملاً ناقصاً** بل
الحاجزُ `B-CI-001` المُسجَّلُ أعلاه: شغلاتُ CI تسقطُ **قبلَ أن تبدأَ**
(`steps: []` في ثانيتَينِ) لفوترةِ حسابٍ لا لسببِ شِفرةٍ، وثلاثُ محاولاتٍ
نتيجتُها واحدةٌ. فاختباراتُ التكاملِ **الإحدى والعشرونَ مكتوبةٌ ولم تُشغَّلْ
قطُّ**، والحاجزُ الجديدُ وخطوتاه في `ci.yml` **لم يُقرأْ لهما حكمٌ**، و`ح-4`
(ثلاثُ جولاتٍ خضراءُ) **لا تستطيعُ أن تبدأَ**. و`ح-6` صريحةٌ: الأخضرُ المحلّيُّ
ليسَ حكماً. **فلا قلبَ حالةٍ، ولا دمجَ فرعٍ، ولا `مَقيس` ولا `مُثبَت`
(`ح-5`).**

| ما نُفِّذَ | الموضعُ |
|---|---|
| الحَكَمُ الواحدُ + حالُ المشاركةِ + الغلافُ + بذرُ الإعدادِ + نزعُ الصلاحيّاتِ | `supabase/migrations/20260914060000_f2_09_ride_share_link_view.sql` |
| النطاقُ والمنافذُ والمحوّلُ والاستخدامُ | `packages/domain/transport/ride-share.ts` · `packages/application/transport/ride-share-ports.ts` · `packages/infrastructure/transport/ride-share-store.ts` · `packages/application/transport/ride-share.ts` |
| العقودُ الثلاثةُ | `apps/gateway/src/routes/rides.ts` (`GET`/`POST`/`DELETE` على `/v1/rides/:id/share`) |
| وصلُ القارئِ العامِّ بالحَكَمِ | `apps/gateway/src/routes/public-tracking.ts` · `apps/gateway/src/public/tracking-page.ts` · منفذُ الرمزِ ومحوّلُه |
| سطحُ المالكةِ | `apps/miniapp/src/surfaces/rider/share/*` + `RideShareCard` في `ActiveRideScreen.tsx` · 44 مفتاحاً × 3 ألسنةٍ (391 → 435) |
| الحاجزُ الساكنُ | `scripts/lib/ride-share-contract.ts` (8 قواعدَ) · `scripts/check-ride-share-contract.ts` · `package.json` · `ci.yml` (خطوتانِ) |
| القياسُ المحلّيُّ | 95 حالةَ وحدةٍ جديدةً خضراءَ · `typecheck` = 0 · والتجاوزُ المسجَّلُ **95 ملفّاً و960 حالةً** |
| الوثائقُ | `ADR 0109` · `docs/evidence/architecture/F2-09-CLOSURE-20260914.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §9.5 و§25 |

**وأصدقُ ما في هذا السطرِ**: أنَّ قاعدةَ «الحَكَمُ واحدٌ» في الحاجزِ الجديدِ
**كانت تمرُّ زوراً** — يدخلُ في جسمِ الغلافِ ذيلُ الهجرةِ حيثُ
`revoke execute on function tracking_link_view(uuid)` فيُحسَبُ النصُّ في أمرِ
الصلاحيّةِ نداءً — وكانَ الحاجزُ **أخضرَ على المستودَعِ الحقيقيِّ وهوَ معطوبٌ**.
كشفَته **الحالةُ السالبةُ المزروعةُ** (`ح-7`) لا أخضرُه. والدرسُ يُسجَّلُ ههنا
لأنَّه يَعِمُّ: أخضرُ حاجزٍ ليسَ دليلاً على أنَّه يقيسُ؛ الدليلُ سقوطُه على خرقٍ
مزروعٍ.

### `F2-09` — the actual CI verdict after the push (read job-by-job, 2026-09-14)

**قُرِئَ الحكمُ ولم يُفترَضْ**، وهذا نصُّه: الدفعةُ `9c5c9d5` على الفرعِ
`feat/f2-09-ride-share-link` أطلقَت ثلاثَ جرياتٍ، و**كلُّ وظيفةٍ فيها سقطَت
بـ`steps: []`** — أي **لم تبدأْ**:

| الجريةُ | الوظيفةُ | الحكمُ | الخطواتُ |
|---|---|---|---|
| `34790584909` (CI) | `verify` · تكامل PostgreSQL · تكامل Redis · فوضى `F5-06` | `failure` × 4 | **0** |
| `34790619735` (CI) | الأربعُ نفسُها | `failure` × 4 | **0** |
| `34790584880` (Roadmap freshness) | `roadmap` | `failure` | **0** |

والتعليقُ على الوظيفةِ `103814019070` حرفاً: «The job was not started because
recent account payments have failed or your spending limit needs to be increased.
Please check the 'Billing & plans' section in your settings».

**فهذا الحاجزُ `B-CI-001` نفسُه، مُعاداً قياسُه على دفعةٍ جديدةٍ** — لا عطبَ في
شِفرةٍ ولا في هجرةٍ ولا في حاجزٍ: **شغلةٌ لم تبدأْ لا تُخفِقُ على كودٍ**.
ولذلكَ:

* اختباراتُ التكاملِ الإحدى والعشرونَ **لم تُشغَّلْ**، وخطوتا الحاجزِ الجديدِ
  في `ci.yml` **لم يُقرأْ لهما حكمٌ**؛
* و`ح-4` (ثلاثُ جولاتٍ خضراءُ) **لا تستطيعُ أن تبدأَ**؛
* و`F2-09` يبقى `[ ]` في §9.5، **ولا يُدمَجُ** طلبُ الدمجِ `#29` — وإن كانَ
  الأخضرُ المحلّيُّ تامّاً (`bun run ci` = 0)، فـ`ح-6` صريحةٌ: **الأخضرُ
  المحلّيُّ ليسَ حكماً**؛
* **ولا يُعطَّلُ الحاجزُ ولا تُحذَفُ وظيفةٌ ولا يُخفَّفُ اختبارٌ ولا يُصنَّفُ
  تخطّياً** كي يصيرَ الأحمرُ أخضرَ: العطبُ ليسَ ههنا، ونقلُه إلى مكانٍ آخرَ
  إخفاءٌ لا إصلاحٌ.

**وهذا حاجزٌ لا يملكُ المنفِّذُ إصلاحَه**: مِفتاحُه في «Billing & plans» من
إعداداتِ الحسابِ `uxxxug` على GitHub. وما دامَ قائماً فكلُّ بندٍ لاحقٍ يُبنى
**بلا حكمٍ** — يُكتَبُ ويُدفَعُ ولا يُغلَقُ ولا يُدمَجُ — وهوَ تراكمُ عملٍ غيرِ
مُحكَّمٍ، وذاكَ أسوأُ من التوقُّفِ عندَه بيانَ سببٍ.

### `F2-09` — أوّلُ حكمٍ حقيقيٍّ من CI، وعطبانِ أُصلِحا في جذرِهما (2026-09-14)

**رُفِعَ الحاجزُ `B-CI-001`**: المستودَعُ صارَ عامّاً فصارت الشغلاتُ تبدأُ.
والجريةُ `34790672521` على `a4180df` أوّلُ **حكمٍ مقروءٍ** لهذا البندِ:
`verify` ✅ · «تكامل على Redis حقيقي» ✅ · «فوضى متعدد المثيلات (F5-06)` ✅ ·
**«تكامل على PostgreSQL حقيقي» ❌** — و«Roadmap freshness» ✅.

والفشلُ كانَ في **مِرصادي أنا لا في النِّظامِ المقيسِ**، وهذا بيانُه بلا تلطيفٍ:

**١) ثلاثةَ عشرَ اختباراً سقطَ على رمزٍ أقصرَ من الحدِّ.** `freshToken()` كانَ
يُنتِجُ ستّةً وثلاثينَ محرفاً، و`issue_tracking_token` يشترطُ **أربعةً وستّينَ**
(`trip_tracking_tokens_token_long_enough`) فيَرُدُّ `TOKEN_TOO_SHORT` **قبلَ**
أيِّ حكمٍ موضوعيٍّ. والأخطرُ أنَّ اختبارَ الرفضِ (٥) كانَ **ليمرَّ كاذباً** لو
توقَّعَ رفضاً بلا تسميةِ رمزِه. فأُصلِحَ الجذرُ: الطولُ يُبنى إلى حدٍّ مُسمّىً
(`TOKEN_MIN_LENGTH`)، **وأُضيفَ حاجزٌ في المِرصادِ نفسِه**: كلُّ `TOKEN_TOO_SHORT`
يُرفَعُ **عطبَ أداةٍ** لا فشلَ توقُّعٍ، فلا يستطيعُ اختبارٌ بعدَ اليومَ أن يدَّعيَ
قياسَ حالةِ رحلةٍ وهوَ لم يبلغْ شرطَ الرمزِ. والإنتاجُ سليمٌ:
`randomBytes(32).toString("hex")` = أربعةٌ وستّونَ محرفاً.

**٢) اختبارٌ سمَّمَ ملفّاً آخرَ — وهذا أخطرُ من سقوطِه.** الاختبارُ (١٢) يحذفُ
إعدادَ المدينةِ ليُثبِتَ `FALLBACK_DEFAULT` ثمَّ يُعيدُه، وكانَ يُعيدُه
بـ`JSON.stringify` على قيمةِ المُحرِّكِ فينتِجُ `'"90"'` — **نصّاً** — فيخرقُ
`platform_settings_value_type_coherent` فتسقطُ الإعادةُ **وتبقى المدينةُ ناقصةَ
مفتاحٍ**؛ فكلُّ ملفٍّ يُفعِّلُ مدينةً بعدَه يسقطُ بـ`CITY_SETTINGS_INCOMPLETE`
(`tests/integration/scheduled-jobs.test.ts` وأخواتُها). فأُصلِحَ الجذرُ: الصفُّ
يُحفَظُ **بتمثيلِ القاعدةِ** (`value::text`) معَ نوعِه ووصفِه ومؤقّتيّتِه ويُعادُ
كما كانَ، **ثمَّ يُتحقَّقُ من الإعادةِ باختبارٍ** — فإن فشلَت سقطَ صاحبُها وحدَه
ولم يُنقَلْ عطبُه إلى غيرِه. وكذا (١١): يُعيدُ القيمةَ المحفوظةَ لا رقماً مكتوباً
في الاختبارِ يصيرُ مصدرَ حقيقةٍ ثانياً.

**ولم يُحذَفْ اختبارٌ ولا خُفِّفَ توقُّعٌ ولا صُنِّفَ تخطّياً**: الإحدى والعشرونَ
حالةً باقيةٌ بنصِّها، والمُصلَحُ هوَ ما كانَ يُقاسُ بهِ لا ما يُقاسُ.

والدرسُ يُضافُ إلى دفترِ البندِ: **أوّلُ حكمٍ من CI لم يكشفْ عطباً في الميزةِ
بل عطبَينِ في أداةِ قياسِها** — وأحدُهما كانَ يُسقِطُ ملفّاتِ غيرِه. ولو قُبِلَ
الأخضرُ المحلّيُّ حكماً (والمحلّيُّ يتخطّى التكاملَ إذ لا قاعدةَ) لمَا ظهرَ
واحدٌ منهما. فـ`ح-6` ليست تشدُّداً في اللفظِ: هيَ ما كشفَ هذا.

## إضافةُ البند F2-09 (2026-09-14) — تعديلُ نطاقٍ خارجَ الحجزِ: حاجزُ `jsonb`

**ما أُضيفَ خارجَ نطاقِ الحجزِ الأصليِّ، ولماذا مشروعٌ.** حكمُ CI الثاني
(`34792768951`) ردَّ الفشلَ إلى نمطٍ واحدٍ: ربطُ مُعامِلٍ بـ`::jsonb` يجعلُ
PostgreSQL يستنبِطُ نوعَه `jsonb` فيُرمِّزُ السائقُ القيمةَ مرّتَينِ. وهوَ
**رابعُ** ظهورٍ للنمطِ في المستودَعِ، والثلاثةُ قبلَه انتهَت إلى **تعليقٍ**
لا إلى حاجزٍ. فلمّا كانَ بينَ يديَّ مساران مشروعانِ — إصلاحُ السطرَينِ وحدَهما،
أو إصلاحُهما مع إنفاذِ الصنفِ آلةً — رجَّحتُ الثانيَ بقاعدةِ الأولويّةِ «أقوى
إنفاذٍ آليٍّ» و«أقلُّ اعتمادٍ على تدخُّلٍ يدويٍّ»: التعليقُ قد قُرِئَ ثلاثَ
مرّاتٍ ولم يمنعِ الرابعةَ.

**ما أُضيفَ**: `scripts/lib/jsonb-binding.ts` (منطقٌ خالصٌ) ·
`scripts/check-jsonb-binding.ts` (بوّابةٌ: ١٢٣٨ ملفّاً في `packages` و`apps`
و`tests` و`scripts`) · `tests/unit/check-jsonb-binding.test.ts` (تسعُ سالباتٍ
وموجباتٍ مزروعةٍ · `ح-7`) · خطوتانِ في `.github/workflows/ci.yml` ومدخلٌ في
سلسلةِ `ci` · `ADR 0110` · قسمٌ في `docs/SYSTEM_STATE.md`.

**وما لم يُفعَلْ عن قصدٍ**: لم يُصلَحْ `jsonb` قديمٌ لم يُثبَتْ عطبُه — الحاجزُ
أخضرُ على الحاضرِ، وذلكَ قياسُ حاضرٍ لا شهادةٌ على الماضي. ولم تُحذَفِ
التعليقاتُ التحذيريّةُ الثلاثةُ رغمَ أنَّها تحملُ النمطَ نصّاً: الحاجزُ يتجاوزُ
أسطرَ التعليقِ عن قصدٍ، إذ حذفُها ليخضرَّ محوُ دليلٍ (`ح-1`).

**حالةُ البندِ**: `F2-09` يبقى `[ ]`. الحكمُ الأخضرُ لوظيفةِ PostgreSQL لم
يُقرَأْ بعدُ، والأخضرُ المحلّيُّ ليسَ حكماً (`ح-6`)، و`ح-4` لم تبدأْ.

## إضافةُ البند F2-09 (2026-09-14) — سجلُّ حكمِ CI الثالثِ: أخضرُ كاملٌ (الجولةُ ١ من ٣)

الجريةُ `34794093496` على `b5a2b07`، وهذا نصُّ حكمِها لا خلاصتُه:

| الوظيفةُ | الحكمُ |
|---|---|
| `verify` | ✅ نجحَ |
| `تكامل على PostgreSQL حقيقي` | ✅ نجحَ |
| `تكامل على Redis حقيقي` | ✅ نجحَ |
| `فوضى متعدد المثيلات (F5-06)` | ✅ نجحَ |
| `Roadmap freshness` (`34794093484`) | ✅ نجحَ |

**وهذا أوّلُ حكمٍ أخضرَ كاملٍ لـ`F2-09`**، وقبلَه حكمانِ حمراوانِ قُرِئا بنصِّهما
ووُثِّقا (`34790672521` و`34792768951`) — وهما باقيانِ في السجلِّ: الأخضرُ لا
يمحو ما سبقَه (`ح-1` · `ح-8`).

**وحدُّ ما يُدَّعى ههنا**: جولةٌ **واحدةٌ** خضراءُ. و`ح-4` تشترطُ ثلاثاً
متتاليةً قبلَ قلبِ الحالةِ، فـ`F2-09` يبقى `[ ]` ولا يُقالُ فيه «مَقيسٌ» ولا
«مُثبَتٌ» (`ح-5`). وما يُقالُ: أنَّ الإحدى والعشرينَ حالةً تكامُلٍ جرَت على
PostgreSQL حقيقيٍّ فمرَّت، وأنَّ العطبَينِ اللذَينِ أسقطا الجولتَينِ السابقتَينِ
عولِجا عندَ جذرِهما لا بتخفيفٍ.

## إضافةُ البند F2-09 (2026-09-14) — الإغلاقُ: ثلاثُ جولاتٍ خضراءَ وقلبُ الحالةِ إلى `[x]`

| # | الجريةُ | الالتزامُ/الفرعُ | الحكمُ |
|---|---|---|---|
| ١ | `34794093496` | `b5a2b07` (الفرعُ) | ✅ الوظائفُ الأربعُ |
| ٢ | `34794365880` | `4422be2` (الفرعُ) | ✅ الوظائفُ الأربعُ |
| ٣ | `34794954696` | `ffb4cbb` (`main` بعدَ الدمجِ) | ✅ الوظائفُ الأربعُ |

و`Roadmap freshness` ناجحةٌ في الثلاثِ. فاكتملَ شرطُ `ح-4`، وقُلِبَ `F2-09` إلى
`[x]` في §9.5 من `docs/ROADMAP-MASTER.md`.

**وتصحيحٌ يُسجَّلُ لا يُطوى (`ح-8`)**: طلبُ الدمجِ `#29` كانَ قد دُمِجَ على
`a4180df` — أي **قبلَ** أوّلِ حكمٍ حقيقيٍّ — فوصلَ `main` بلا الالتزاماتِ الثلاثةِ
التي جعلَته أخضرَ، وبقيَ `main` أحمرَ. فلم يُعَدْ كتابةُ التاريخِ ولم يُحذَفْ شيءٌ:
فُتِحَ الطلبُ `#30` بالالتزاماتِ الباقيةِ ودُمِجَ بعدَ جولتَينِ خضراوَينِ، ثمَّ
قُرِئَ حكمُ `main` نفسِه فكانَ أخضرَ. وحكمُ `main` الأحمرُ السابقُ (`34791025064`
على `50c625d`) يبقى مكتوباً ههنا.

**وحدُّ ما يُدَّعى**: أنَّ الحَكَمَ الواحدَ يعملُ على PostgreSQL حقيقيٍّ في CI —
**لا** أنَّ راكباً شاركَ رابطاً ولا أنَّ قريباً فتحَه (`ADR 0099` · `ح-5`).

### Reservation `F2-10` — زرٌّ لا يَعِدُ إلّا بما يفعلُه، ونافذةٌ لا تُغلَقُ بانتهاءِ الرحلةِ (recorded 2026-09-14, before the first edit)

| الحقلُ | النصُّ |
|---|---|
| البندُ | `F2-10` — `SR-14` في §9.5 حرفاً: «تأكيدٌ من خطوةٍ واحدةٍ، ما سيحدثُ بالضبطِ، الاتصالُ بمركزِ البلاغاتِ الموحَّدِ، حالةُ البلاغِ» · زرُّه «تأكيدُ الطوارئِ» · و§1059: **تظلُّ فعّالةً حتّى بعدَ إنهاءِ الرحلةِ من قِبَلِ السائقِ**. |
| المِلكيّةُ | `F8-05` يملكُ **الاستقبالَ** في البوتَينِ وقد أُنجِزَ (`ADR 0077`)، و`F2-10` يملكُ **سطحَ التطبيقِ المُصغَّرِ** وما يلزمُه في القاعدةِ. وترويسةُ هجرةِ `F8-05` تُحيلُ صراحةً إرخاءَ «حادثٍ بلا طلبٍ» إلى هذا البندِ. |
| القيدُ الحاكمُ | §7: **من الضغطِ إلى التسجيلِ الصامدِ p99 ≤ 500ms بلا انتظارِ أيِّ خدمةٍ خارجيّةٍ** — فالنداءُ يُودِعُ في `notification_outbox` ويعودُ، والتسليمُ عملُ `deliver-safety-incidents.ts`. و`ARCH-013`: الاستغاثةُ تُحمى على حسابِ ما سواها. |
| القرارُ الأوّلُ — **ما بعدَ الرحلةِ نافذةٌ لا عَدَمٌ** | §1059 يوجِبُ بقاءَ الأيقونةِ فعّالةً بعدَ إنهاءِ السائقِ، و`trigger_sos` اليومَ يَرُدُّ `NO_ACTIVE_ORDER`. وأمامَنا مساران: (أ) إرخاءُ `safety_incidents.order_id` إلى `null`، (ب) **نافذةُ ما بعدَ الرحلةِ**: متى لم يكن ثمَّةَ طلبٌ نشِطٌ يُحَلُّ **آخرُ طلبٍ انتهى داخلَ نافذةٍ مُعدَّةٍ**. ونختارُ (ب) بقاعدةِ «أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ»: المدينةُ وقروبُ التصعيدِ وموضعُ الالتقاطِ كلُّها **تُقرأُ من الطلبِ**، فحادثٌ بلا طلبٍ يُوجِبُ مصدرَ مدينةٍ ثانياً ومسارَ تسليمٍ ثانياً وقيداً مُرخىً — ثلاثةَ تكرارٍ في سبيلِ حالةٍ يُغطّيها (ب) بلا واحدٍ منها. والنافذةُ **إعدادٌ** `sos_post_ride_window_minutes` في `platform_settings` بمدينةِ الطلبِ لا ثابتٌ في الشِّفرةِ (القاعدة 0.3)، ومصدرُها يُنشَرُ باسمِه. **وما لا يُغطّيه (ب) يُصرَّحُ ديناً**: راكبٌ لم يركبْ قطُّ، أو انقضَت نافذتُه — يُجابُ `NO_ACTIVE_ORDER` بنصِّه، ويبقى «حادثٌ بلا طلبٍ» بنداً آخرَ (`F12-03`). |
| القرارُ الثاني — **حالةُ البلاغِ حَكَمٌ في القاعدةِ لا حقلٌ في شاشةٍ** | «حالةُ البلاغِ» في `SR-14` بلا مسارِ قراءةٍ اليومَ: لا دالّةَ تقرأُ حادثةَ المُبلِّغِ نفسِه. فتُضافُ `sos_surface_state(bigint, text)` **قراءةً ذرّيّةً واحدةً** تنشرُ: أهليّةَ الإطلاقِ وسببَها مُصنَّفاً، وحالةَ آخرِ بلاغٍ للمُبلِّغِ نفسِه (`open`/`received`/`closed`) وعُمرَه بساعةِ القاعدةِ، **وقائمةَ الإفصاحِ برموزٍ** — فـ«ما سيحدثُ بالضبطِ» يُنشَرُ من مصدرِ الحقيقةِ نفسِه الذي سيفعلُه، لا نصّاً مكتوباً في شاشةٍ يُصدِّقُه المستخدمُ ولا أحدَ يُنفِذُه. والمِلكيّةُ **قيدُ استعلامٍ** لا فحصُ تطبيقٍ. |
| القرارُ الثالثُ — **الاستقبالُ موضعٌ ثالثٌ لا استثناءٌ** | حاجزُ `check-sos-intake-isolation.ts` ينصُّ في ترويسَتِه: «إن زِيدَ مسارُ استقبالٍ ثالثٌ (تطبيقٌ مُصغَّرٌ مثلاً) فيُزادُ موضعُه إلى `INTAKE_SITES` ولا يُخفَّفُ الفحصُ». فمُعالِجُ HTTP يُزادُ إلى `INTAKE_SITES` ويلتزمُ قواعدَه الخمسَ: انتظارٌ واحدٌ على `triggerSos`، و`orderId: null` حرفيّاً، ولا قارئَ محظورٌ. |
| القرارُ الرابعُ — **بطاقةٌ لا زرٌّ في اللقطةِ** | حالُ البلاغِ تتغيَّرُ بفعلِ صاحبِه لا بدورةِ الرحلةِ، فحشرُها في `active_ride_snapshot` يُوجِبُ تحديثَ اللقطةِ كلِّها بعدَ كلِّ ضغطةٍ — وهيَ حُجّةُ `F2-09` نفسُها. وبطاقةٌ مستقلّةٌ **تُخفي نفسَها متى لم يكن ثمَّةَ ما يُبلَّغُ عنه**، ولا تُرسَمُ رماديّةً: زرُّ سلامةٍ مُعطَّلٌ وعدٌ كاذبٌ. |
| النطاقُ المحجوزُ | هجرةٌ `supabase/migrations/20260914*_f2_10_sos_surface.sql` (طورُ `expand`: إعادةُ تعريفِ `trigger_sos` بتوقيعِه ورموزِه نفسِها معَ نافذةِ ما بعدَ الرحلةِ · `sos_surface_state` · بذرُ `sos_post_ride_window_minutes` · نزعُ التنفيذِ) · `packages/domain/safety/sos-surface.ts` · `packages/application/safety/sos-surface.ts` ومنافذُها · `packages/infrastructure/safety/sos-surface-store.ts` · `apps/gateway/src/routes/safety.ts` (مساران فقط) و`index.ts` و`server.ts` (حقنُ تبعيةٍ) · `apps/miniapp/src/surfaces/rider/sos/*` وتركيبُه في شاشةِ الرحلةِ النشطةِ · `apps/miniapp/src/styles/global.css` (كتلةٌ جديدةٌ) · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ `rider.sos.*` جديدةٌ فقط) · `scripts/lib/sos-surface-contract.ts` و`scripts/check-sos-surface-contract.ts` وتسجيلُهما · `scripts/check-sos-intake-isolation.ts` (موضعٌ ثالثٌ) · `scripts/lib/active-ride-contract.ts` (نقلُ كلماتِ الطوارئِ معَ شرطٍ موجبٍ) · `packages/infrastructure/db/schema-contract.ts` · `scripts/lib/{skip,rollback}-registry.ts` · الاختباراتُ · `docs/adr/0111-*` · `docs/evidence/architecture/F2-10-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **حادثٌ بلا طلبٍ ألبتّةَ** (`F12-03`) · **الاتّصالُ الهاتفيُّ المُقنَّعُ ورقمُ 911** (لا مزوّدَ؛ والكلماتُ `whatsapp`/`tel:`/`callDriver`/«اتصل» تبقى محظورةً في السطحِ) · **سطحُ السائقِ في التطبيقِ المُصغَّرِ** (`SD-05`؛ سائقُنا في البوتِ وقد نالَ `/sos` في `F8-05`) · **شاشةُ الدعمِ وفضُّ البلاغِ** (`claim_safety_incident`/`resolve_safety_incident` قائمتانِ لدورِ الدعمِ) · **تسليمُ الإخطارِ** (`F6-03` والعاملُ القائمُ) · **الأجرةُ والمالُ** (`DEC-11`) · جدولُ `safety_incidents` مخطَّطاً (لا عمودَ جديدٌ ولا قيدٌ مُرخىً) · حوارا البوتَينِ (يُقرآنِ ولا يُعدَّلانِ) |

### Closure `F2-10` — ما بُنِيَ فعلاً مقابلَ ما حُجِزَ (2026-09-14)

القراراتُ الأربعةُ المحجوزةُ أعلاه **نُفِّذَت كما كُتِبَت بلا انحرافٍ**: نافذةُ
ما بعدَ الرحلةِ إعداداً في `platform_settings` بمدينةِ الطلبِ ومصدرُها مُعلَنٌ
باسمِه (`SETTING`/`FALLBACK_DEFAULT`) · و`sos_surface_state(bigint, text)`
قراءةً ذرّيّةً واحدةً تنشرُ الأهليّةَ وسببَها مُصنَّفاً وحالَ البلاغِ وعُمرَه
بساعةِ القاعدةِ وقائمةَ الإفصاحِ **برموزٍ** · وموضعُ استقبالٍ **ثالثٌ** في
`INTAKE_SITES` بلا تخفيفِ قاعدةٍ · وبطاقةٌ مستقلّةٌ **تُخفي نفسَها** ولا تُرسَمُ
رماديّةً.

**وزيادةٌ على المحجوزِ، أُلزِمَ الوعدُ بنصِّه**: `SOS_NO_PHONE_CALL` رمزُ إفصاحٍ
**إجباريٌّ في كلِّ حالٍ** تُعيدُه القاعدةُ جائزاً كانَ السطحُ أو ممنوعاً —
«المنصّةُ لا تتّصلُ بشرطةٍ ولا إسعافٍ نيابةً عنكَ». فالحجزُ منعَ **كتابةَ**
`tel:` و`whatsapp` في السطحِ، وهذا يمنعُ **الصمتَ** عن أنَّ الاتّصالَ ليسَ
منّا — والصمتُ في لحظةِ خوفٍ وعدٌ بالإغفالِ.

**وقرارٌ زِيدَ لم يكن محجوزاً**: البطاقةُ **تبقى مرئيّةً ما دامَ بلاغٌ قائمٌ ولو
زالَ الجوازُ**. فالحجزُ قالَ «تُخفي نفسَها متى لم يكن ثمَّةَ ما يُبلَّغُ عنه»،
والبناءُ كشفَ أنَّ بلاغاً أُرسِلَ **هوَ نفسُه** «ما يُبلَّغُ عنه»: مَن نادى
يستحقُّ أن يرى مصيرَ ندائِه حتّى يُغلَقَ، وإلّا قرأَ الاختفاءَ ضياعاً فأعادَ
النداءَ أو يَئِسَ.

**وما لم يُبنَ يبقى كما صُرِّحَ**: حادثٌ بلا طلبٍ (`F12-03`) · الاتّصالُ
المُقنَّعُ · سطحُ السائقِ (`SD-05`) · شاشةُ فضِّ البلاغِ · والمالُ (`DEC-11`).

**والحكمُ**: `[~]` لا `[x]` — الهجرةُ لم تُطبَّقْ على قاعدةٍ حقيقيّةٍ في جلسةِ
البناءِ، ولم تُفتَحْ البطاقةُ في جهازٍ داخلَ Telegram، ولا تُقلَبُ الحالةُ قبلَ
ثلاثِ جولاتٍ خضراءَ من CI (`ح-4` · `ح-5`). راجِعْ `ADR 0111` و
`docs/evidence/architecture/F2-10-sos-surface-20260914.md`.

#### حكمُ CI الأوّلُ على `F2-10` — ما كشفَه المحرِّكُ الحقيقيُّ (2026-09-14)

| الوظيفةُ | الحكمُ |
|---|---|
| `verify` (الحواجزُ · النمطُ · الأنواعُ · 5097 حالةً · بوّابةُ التغطيةِ) | ✅ |
| تكامل على Redis حقيقي | ✅ |
| فوضى متعدد المثيلات (`F5-06`) | ✅ |
| **تكامل على PostgreSQL حقيقي** | ❌ حالةٌ واحدةٌ |
| `Roadmap freshness` | ✅ (بعدَ `e2b5227`) |

**الحالةُ الساقطةُ**: «لا طلبَ قائمَ للرّاكبِ: `NO_ACTIVE_ORDER` صريحاً لا عطلاً»
في `tests/integration/sos-order-resolution.test.ts` — توقَّعَت رفضاً فنالَت
قبولاً.

**والسببُ الجذريُّ كذبُ تجهيزٍ لا خطأُ حكمٍ**: `makeOrder` كانَ يكتبُ
`created_at` وحدَه، فيبقى `updated_at` عندَ `now()` مهما قيلَ `minutesAgo`.
فالطلبُ الموصوفُ بأنَّه «مكتملٌ منذُ ساعتَينِ» كانَ في القاعدةِ **مكتملاً هذه
اللحظةَ**. وهذا الكذبُ كانَ نائماً منذُ `F8-05` لأنَّ الحكمَ لم يكن ينظرُ إلّا
إلى الحالةِ؛ فلمّا صارَ `trigger_sos` يقيسُ `coalesce(completed_at, updated_at)`
كشفَه المحرِّكُ الحقيقيُّ في أوّلِ جولةٍ. **وهذا وحدَه يُثبِتُ لِمَ لا يُقبَلُ
الأخضرُ المحلّيُّ بديلاً عن حكمِ CI**: المحرِّكُ المُصنَّعُ لا يملكُ `now()`.

**والعلاجُ تصديقُ التجهيزِ لا تخفيفُ الحكمِ**: `makeOrder` صارَ يكتبُ
`updated_at` و`completed_at` بعُمرِهما المُعلَنِ، فعادَت الحالةُ تقيسُ ما تقولُ
إنَّها تقيسُه (مكتملٌ منذُ 120 دقيقةً خارجَ نافذةِ الثلاثينَ ← رفضٌ). **ولم
يُحذَفْ توقُّعٌ ولم تُخفَّفْ حالةٌ ولم يُسكَتْ فحصٌ.** وزِيدَت ثلاثُ حالاتٍ
موجبةٍ على محرِّكٍ حقيقيٍّ: انتهت منذُ 5 دقائقَ ← تُقبَلُ وتُنسَبُ · منذُ 31
دقيقةً ← تُردُّ · وإعدادُ المدينةِ رُفِعَ إلى 90 فانقلبَ حكمُ الستّينَ **بلا
تغييرِ شِفرةٍ** (إثباتُ القاعدةِ 0.3 لا ادّعاؤها). ورُدَّ الإعدادُ في
`beforeEach` كي لا يصيرَ ترتيبُ الحالاتِ حَكَماً.

### Reservation `F2-11` — «حُذِفَ كلُّ شيءٍ» جملةٌ لا يجوزُ أن تُقالَ (recorded 2026-09-14, before the first edit)

| الحقلُ | النصُّ |
|---|---|
| البندُ | `F2-11` — `SR-12` في §9.5: «حسابي + تنزيل/حذف البيانات فعلياً». و§466 يعدُّ الشاشةَ حرفاً: الاسمُ · الرقمُ · اللغةُ · الأماكنُ المحفوظةُ · جهةُ اتّصالٍ للطوارئِ · الإشعاراتُ · الخصوصيّةُ · تنزيلُ بياناتي · حذفُ حسابي. و§9.12: **«موجودان فعلياً ويعملان (لا زرّ صوري)»**. و§1091 يجعلُهما بنداً إلزاميّاً من PDPL: «حقوقُ أصحابِ البياناتِ — وصولاً وتصحيحاً وحذفاً ونقلاً — **مُنفَّذةً فعلاً** في `SR-12`». |
| المِلكيّةُ | `F2-11` يملكُ **مسارَي التنزيلِ والحذفِ وشاشةَ الحسابِ**. ولا يملكُ مُدَدَ الاستبقاءِ: تلكَ `DEC-15` في `packages/shared/config/retention-policy.ts` وحدَه. ولا يملكُ حسمَ الأصنافِ المُعلَّقةِ: ذاكَ `F12-10`. |
| **التعارضُ المحجوزُ حرفاً قبلَ هذا البندِ** | نصَّ سجلُّ الاستبقاءِ عندَ `user_consents` — منذُ `F2-01` — على هذا بعينِه: «وحذفُ الحسابِ (القسم 9.12) حينَ يُنفَّذُ **يُحسَمُ فيه هناكَ**: أنَّ المستخدمَ يُحذَفُ لا يعني أنَّ إثباتَ موافقتِه يُمحى، **وذاكَ تعارضٌ حقيقيٌّ** لا يُفصَلُ فيه من ملفِّ استبقاءٍ». فهذا البندُ هوَ «هناكَ». |
| القرارُ الأوّلُ — **الحذفُ حكمٌ لكلِّ جدولٍ، ومصدرُه سجلُّ الاستبقاءِ نفسُه** | «احذفْ حسابي» ليسَ `delete` واحداً. فثلاثةُ حقوقٍ تتزاحمُ على الصفِّ الواحدِ: حقُّ صاحبِه في المحوِ · وحقُّ **الطرفِ الآخرِ** في الرحلةِ التي شاركَه فيها · والأساسُ النظاميُّ الذي يُوجِبُ الحفظَ (فاتورةٌ ستَّ سنينَ · بلاغُ سلامةٍ محلُّ نزاعٍ · موافقةٌ هيَ دليلُ الامتثالِ). فيُضافُ `packages/shared/config/erasure-policy.ts` بأربعةِ أحكامٍ: `erase` · `anonymize` · `retainLegalBasis` · `notPersonal`، **قائمةً مغلقةً على الجداولِ كلِّها** كسجلِّ الاستبقاءِ. **والحاجزُ يُقابِلُ السجلَّينِ**: جدولٌ في أحدِهما وليسَ في الآخرِ يُسقِطُ CI · و`financialSixYears` أو `auditUnboundedUntilCompliance` **يستحيلُ** أن يكونَ `erase` — تناقضُ إقرارَينِ مُعلَنَينِ للجهةِ الرقابيّةِ أسوأُ من نقصِ أحدِهما. |
| القرارُ الثاني — **التنزيلُ يُشتَقُّ من حكمِ الحذفِ لا من قائمةٍ ثانيةٍ** | كلُّ جدولٍ حكمُه `erase` أو `anonymize` أو `retainLegalBasis` هوَ بحكمِ التعريفِ **جدولٌ فيه بيانةٌ شخصيّةٌ**، فيجبُ أن يظهرَ في التنزيلِ. والحاجزُ يُنفِذُ التطابقَ: جدولٌ شخصيٌّ غائبٌ عن التنزيلِ يُسقِطُ CI. **فيستحيلُ أن نحذفَ ما لا نُرِي**، ويستحيلُ أن يُنسى جدولٌ في التنزيلِ نسياناً صامتاً. وهذا يُلغي المصدرَ الثانيَ للحقيقةِ من أصلِه. |
| القرارُ الثالثُ — **إيصالُ حذفٍ يقولُ ما بقيَ ولِمَ بقيَ** | «حُذِفَ حسابُكَ» وحدَها **كذبٌ** ما دامَت فاتورتُه وبلاغُه باقيَينِ. فالحذفُ يُصدِرُ إيصالاً مُصنَّفاً: ما مُحِيَ · ما جُهِّلَ · **وما بقيَ وبأيِّ أساسٍ**، يُعرَضُ للمستخدمِ نصّاً من القاموسِ ويُخزَّنُ صفَّ تدقيقٍ. |
| القرارُ الرابعُ — **الحكمُ في القاعدةِ تحتَ قفلٍ لا في التطبيقِ** | الحذفُ يَمَسُّ عشراتِ الجداولِ؛ ودورةُ رحلةٍ تجري في أثنائِه. فدالّةُ قاعدةٍ واحدةٌ ذرّيّةٌ تحتَ قفلِ صفِّ المستخدمِ، **وتردُّ الحذفَ صريحاً إن كانَ للمستخدمِ طلبٌ قائمٌ** — لا يُحذَفُ راكبٌ في منتصفِ رحلةٍ فيبقى سائقُه معلَّقاً. |
| النطاقُ المحجوزُ | هجرةٌ `supabase/migrations/20260914*_f2_11_account_data_rights.sql` · `packages/shared/config/erasure-policy.ts` · `packages/domain/privacy/*` · `packages/application/privacy/*` · `packages/infrastructure/privacy/*` · `apps/gateway/src/routes/me-data-rights.ts` وتركيبُه · `apps/miniapp/src/surfaces/rider/account/*` وتركيبُه · `global.css` (كتلةٌ جديدةٌ) · `packages/shared/i18n/miniapp/{ar,en,ur}.json` (مفاتيحُ `rider.account.*` جديدةٌ فقط) · `scripts/lib/erasure-policy-contract.ts` و`scripts/check-erasure-policy.ts` وتسجيلُهما · `packages/infrastructure/db/schema-contract.ts` · `scripts/lib/{coverage,rollback}-registry.ts` · الاختباراتُ · `docs/adr/0112-*` · `docs/evidence/architecture/F2-11-*` · `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` |
| النطاقُ **غيرُ** المحجوزِ | **مُدَدُ الاستبقاءِ** (`DEC-15`) و**حسمُ `pending-decision-f12-10`** (`F12-10`) — هذا البندُ يحكمُ **الحذفَ بطلبِ صاحبِه** لا المؤقِّتَ الليليَّ · **حذفُ حسابِ السائقِ** (`SD-12`) · **وسيطُ الاتّصالِ** (لا مزوّدَ) · **الأجرةُ والمالُ** (`DEC-11`) · **تعديلُ الأماكنِ وحذفُها فرادى** (`PATCH`/`DELETE /v1/me/places/{id}` المُعلَنانِ في §9.8): من نصِّ `SR-12` ولا يُبنى في هذه الدفعةِ، **ولذا لا يُقلَبُ `F2-11` إلى `[x]` بل `[~]` والنصفُ الباقي مُعلَنٌ بنصِّه** — شاشةٌ تُنزِّلُ وتحذفُ الحسابَ ولا تُعدِّلُ مكاناً شاشةٌ ناقصةٌ، وقولُها تامّةً ادّعاءٌ (`ح-5`) · **جهةُ اتّصالِ الطوارئِ** إن لم يكن لها جدولٌ — تُعلَنُ ديناً لا تُخترَعُ · **الإشعاراتُ** إن لم يكن لها تفضيلٌ مخزَّنٌ — كذلكَ. |

---

### Closure `F2-11` — الحذفُ حكمٌ لكلِّ جدولٍ لا `delete` واحدةٌ (2026-09-14)

**الحالةُ: `[~]` لا `[x]`** — وذاكَ قصدٌ لا تقصيرٌ. نصُّ `SR-12` يعدُّ الشاشةَ
حرفاً، ومنه **تعديلُ الأماكنِ المحفوظةِ وحذفُها فرادى** (`PATCH`/`DELETE
/v1/me/places/{id}` المُعلَنانِ في §9.8) و**عرضُ الموافقاتِ**؛ وهُما خارجَ هذه
الدفعةِ صراحةً كما حُجِزَ في §Reservation أعلاه. فلا يُقلَبُ البندُ تامّاً
وفيه لفظٌ من نصِّه لم يُبنَ (`ح-5`)، **والنصفُ الباقي مكتوبٌ دَيناً يُقرأُ في
الشاشةِ نفسِها** لا في وثيقةٍ وحدَها: `rider.account.debt.editPlaces` و
`rider.account.debt.privacyView`.

#### ما تغيَّرَ في فهمِ المسألةِ

«احذفْ حسابي» جملةٌ واحدةٌ عندَ صاحبِها، **و51 مسألةً مستقلّةً في القاعدةِ**.
وأمرُ `delete from users` في هذا المخطَّطِ **ليسَ خياراً مرفوضاً بل خيارٌ غيرُ
موجودٍ**: يردُّهُ مفتاحُ `audit_log` الأجنبيُّ ويردُّهُ مفتاحُ
`user_consents`. فصارَ للحذفِ **سجلٌّ** لا أمرٌ: لكلِّ جدولٍ حكمٌ من خمسةٍ،
ومن السجلِّ نفسِه تُشتَقُّ **أقسامُ التنزيلِ الاثنا عشرَ** (القاعدة 0.6) —
فلا قائمتانِ تتفارقانِ عندَ أوّلِ جدولٍ يُضافُ. والتفصيلُ كلُّه في
`docs/adr/0112-erasure-is-a-per-table-judgement-not-a-delete.md`، والقياسُ في
`docs/evidence/architecture/F2-11-account-and-data-rights-20260914.md`.

**وأثرُ القرارِ الحقيقيُّ ليسَ شاشةً**: `scripts/check-erasure-policy.ts` صارَ
في سلسلةِ `ci` **يُخفِقُ على جدولٍ في المخطَّطِ بلا حكمٍ**. فسؤالُ «وماذا
يحدثُ لهذا عندَ الحذفِ؟» صارَ **إجباريّاً** على كلِّ جدولٍ يُضافُ بعدَ اليومِ.

#### ثلاثةُ أعطابٍ كشفَها التشغيلُ على قاعدةٍ حقيقيّةٍ

١. **عقدٌ مكسورٌ**: الدالّةُ تُصدِرُ `generated_at` والمحوّلُ يقرأُ
   `exported_at` — فكانَ **كلُّ تنزيلٍ يُرَدُّ عطباً**. والهجرةُ المُطبَّقةُ
   لا تُحرَّرُ بأثرٍ رجعيٍّ، فصُحِّحَ المحوّلُ ليطابقَ الواقعَ.
٢. **تصحيحٌ لدعوى سابقةٍ (`ح-8`)**: `ALREADY_ERASED` و`ACCOUNT_ERASED`
   **لا يُبلَغانِ من بابِ تيليجرامَ أبداً**، لأنَّ الحذفَ يُبدِّلُ
   `telegram_id` بمعرِضٍ سالبٍ؛ فمَن حذفَ حسابَه ثمَّ عادَ **مستخدمٌ جديدٌ**
   وما بعدَ الحذفِ `USER_NOT_FOUND`. **والسطرُ القديمُ لم يُمحَ** بل صُحِّحَ
   بالإضافةِ ههنا وفي `ADR 0112 §٣`.
٣. **أعمدةٌ ظُنَّت معلومةً ليست في المخطَّطِ**: `full_name` لا `display_name`،
   و`orders.rider_id → riders.id` لا `users.id`، والمعرِّفاتُ السالبةُ
   **محجوزةٌ** فلا تصلحُ بذرةً.

#### أربعةُ حواجزَ ردَّت عملَنا — وأُبقيَ مردوداً ولم يُلَيَّنْ واحدٌ منها

- زرٌّ اسمُه «الأماكنُ المحفوظةُ» ولا يفتحُ شيئاً: **حُذِفَ**، ووُضِعَ مكانَه
  دَينٌ مُعلَنٌ. زرٌّ صادقٌ غائبٌ خيرٌ من زرٍّ حاضرٍ كاذبٍ.
- مدخلٌ في `rollback-registry.ts` رُدَّ **ثلاثَ مرّاتٍ**: السببُ الجذريُّ أنَّ
  إسقاطَ المفتاحِ يجري بـ`execute format(...)` **فلا يراهُ قارئٌ ساكنٌ**.
  فحُذِفَ المدخلُ، وكُتِبَت ملحوظةٌ تشرحُ السببَينِ وتُحيلُ إلى `ADR 0112 §٦`
  حيثُ SQL العودةِ مكتوبٌ بحرفِه، وتقولُ إنَّ كاشفاً يفهمُ المفاتيحَ الأجنبيّةَ
  **يجبُ أن يحلَّ محلَّها**.
- بادئةُ أصنافٍ مخترَعةٌ (`account__*` · `receipt__*`) أسقطَها
  `check-css-class-coverage.ts`: صارَت `ac__*` مُعلَنةً، والإيصالُ
  `ac__receipt-*` **داخلَ كتلةِ الحسابِ** لا كتلةً ثانيةً، ولكلِّ صنفٍ
  **مُحدِّدٌ حقيقيٌّ** في `global.css`.
- `crypto.randomUUID` في العميلِ رُدَّ (`ADR 0043`): لم يُستَثنَ ولم تُنسَخِ
  الدالّةُ، بل **عُمِّمَ المُولِّدُ الواحدُ** `newIdempotencyKey` بوسيطِ نطاقٍ.

#### القياسُ

```
bun run ci → خروج 0 · 4123 ناجحةً · 1035 تخطّياً · 0 فاشلةً · 5158 حالةً / 355 ملفّاً
bun test tests/integration/account-data-rights.test.ts (قاعدةٌ حقيقيّةٌ) → 8 ناجحةً · 0 فاشلةً
scripts/check-erasure-policy.ts → 51 جدولاً محكوماً · 12 قسمَ تنزيلٍ مبنيّاً
```

**وحكمُ CI يُقرأُ بعدَ الدفعِ ويُدوَّنُ في §٩ من ملفِّ الدليلِ — ولا يُستبدَلُ
بالأخضرِ المحليِّ.**

#### حكمُ CI على `F2-11` — أربعُ وظائفَ خضراءُ من أوّلِ محاولةٍ

الدفعةُ `1417a9f` · الطلبُ #34 · التشغيلُ `34860201483` (وعلى الدفعِ
`34860198283`، والطرازةُ `34860198289`):

| الوظيفةُ | الحكمُ |
| --- | --- |
| `verify` | ناجحةٌ |
| تكامل على Redis حقيقي | ناجحةٌ |
| تكامل على PostgreSQL حقيقي | ناجحةٌ |
| فوضى متعدد المثيلات (F5-06) | ناجحةٌ |
| Roadmap freshness | ناجحةٌ |

**ولا دورةَ حمراءَ تُدوَّنُ في هذا البندِ** — وذاكَ لأنَّ الأربعةَ الذينَ
سقطوا سقطوا **محلّيّاً قبلَ الدفعِ** (عزلُ طبقةِ تيليجرامَ · `randomUUID` ·
بادئةُ الأصنافِ · التجاوزُ غيرُ المُصنَّفِ)، لا لأنَّ شيئاً لم يسقطْ.

**والحالاتُ الثمانِ شُغِّلَت فعلاً** على قاعدةِ CI المبنيّةِ من الصفرِ
(`8 pass · 0 fail`) ولم تُخطَّ — والملفُّ بذرَ مدينتَه بنفسِه وأزالَها.

**و`[~]` باقيةٌ**: الأخضرُ حكمُ بوّاباتٍ على شيفرةٍ لا نشرٌ حيٌّ ولا راكبٌ
حقيقيٌّ فتحَ الشاشةَ (`ADR 0099`).

### Closure `ADR 0113` — حقُّ المحوِ ليسَ بابَ تنصُّلٍ (2026-09-14)

**الثغرةُ كانت حقيقيّةً ومقيسةً لا مُتوهَّمةً.** بعدَ إغلاقِ `F2-11` سألَ
المالكُ سؤالاً سدَّ ثقباً في بناءٍ حُسِبَ تامّاً: **مَن حُظِرَ أو ساءَ
تقييمُه، ثمَّ حذفَ حسابَه وعادَ — ماذا يجدُ؟** والجوابُ الذي كانَ: **سِجِلّاً
أبيضَ**.

وبيانُ العِلَّةِ ثلاثةُ أسطرٍ من الشيفرةِ القائمةِ:

| الموضعُ | ما كانَ يفعلُ |
|---|---|
| `erase_my_account` | يُبدِّلُ `users.telegram_id` بمعرِضٍ سالبٍ ويُصفِّرُ التقييمَ |
| `identity/directories.ts` | `insert … on conflict (telegram_id) do update` |
| النتيجةُ | المعرِّفُ الحقيقيُّ لم يبقَ، فالعائدُ **لا يُصادِمُ شيئاً** فيُنشَأُ له صفٌّ `is_blocked = false` بمقامٍ صفرٍ |

**فصارَ «احذفْ حسابي» أرخصَ زرٍّ لرفعِ الحظرِ في المنصّةِ**: أرخصَ من مراجعةِ
دعمٍ، وأسرعَ، وبلا أثرٍ، وبلا مَن يعلمُ. والضررُ على **الطرفِ الثالثِ** لا
علينا: الراكبُ الذي حسِبَ أنَّ الحظرَ يحميه، والسائقُ الذي كسبَ خمسةَ نجومٍ
فيُزاحِمُه مَن نفضَ نجمتَه بالحذفِ.

**والحلُّ: أثرٌ واحدٌ يَعبُرُ الحذفَ — بتجزئةٍ لا بمعرِّفٍ.**
`hmac-sha256` لمعرِّفِ تيليجرامَ وللجوّالِ بفِلفِلٍ سرّيٍّ لا يُقرَأُ ولا
يُدوَّرُ، ومعَه حكمُ الحظرِ ومقامُ التقييمِ وعدُّ مرّاتِ الحذفِ. ولا اسمَ ولا
رقمَ: قيدٌ في القاعدةِ يردُّ كلَّ قيمةٍ ليست ستّينَ وأربعَ خانةٍ ستّةَ
عشريّةً، **فلا يتسرَّبُ معرِّفٌ عارٍ بهجرةٍ مستقبَليّةٍ ولو سهواً**.

**والإنفاذُ في القاعدةِ لا في مسارِ التسجيلِ.** مُشغِّلٌ `before update` يكتبُ
الأثرَ من `old` — **وتلكَ النافذةُ الوحيدةُ التي يكونُ فيها المعرِّفُ حاضراً**
— ومُشغِّلٌ `before insert` يُعيدُ تطبيقَه. ولو كانَ في `directories.ts` لَكفى
مسارُ تسجيلٍ ثانٍ يُضافُ غداً (لوحةُ إدارةٍ، `seed`، بوتُ سائقٍ) ليَصيرَ
الحاجزُ **قائماً في مكانٍ ومُخترَقاً في آخرَ بلا أن يُخفِقَ شيءٌ**.

**وثلاثةُ قيودٍ يسهُلُ نقضُها فحُرِسَت نصّاً:** الحظرُ **يُجمَعُ ولا يُرفَعُ**
(`is_blocked or excluded.is_blocked`) فحذفٌ ثانٍ لا يُبطِلُ الأوّلَ ·
والتقييماتُ **تُجمَعُ لا تُستبدَلُ** · والمطابقةُ **لا تُصفّى بالمدينةِ**
فمَن حُظِرَ في جدّةَ محظورٌ في مكّةَ، وإلّا لَكانَ الانتقالُ عفواً آليّاً.
**وثلاثتُها قواعدُ عدميّةٌ لا يُثبِتُها اختبارُ تكاملٍ أخضرُ** — فمَن أضافَ
`and city_id = ...` غداً يبقى الأخضرُ أخضرَ لأنَّ حالاتِه في مدينةٍ واحدةٍ —
**فحُرِسَت بحالاتِ وَحدةٍ تقرأُ نصَّ الهجرةِ** (`ح-7`).

**والإفصاحُ قبلَ الضغطِ لا بعدَه.** الإيصالُ يقولُ ما بقيَ **بعدَ** قرارٍ لا
يُنقَضُ، وذاكَ متأخِّرٌ: مَن ضغطَ يظنُّ أنَّه يمحو حظراً ثمَّ وجدَه عائداً
**يكونُ قد خُدِعَ بالسكوتِ**. فسطرٌ في الشاشةِ بثلاثِ لغاتٍ يقولُها صريحاً،
وقسمٌ ثالثَ عشرَ في التنزيلِ (`identityBar`)، وأساسٌ سادسٌ في الإيصالِ
(`BLOCK_AND_STANDING_SURVIVE_ERASURE`) — **والتجزئةُ نفسُها لا تُفصَحُ**
(`hash_disclosed: false`) لأنَّها مادّةُ الحاجزِ.

**وإعفاءُ `city_id` للفِلفِلِ طُلِبَ بملحقٍ حاكمٍ لا بـADR**: صنفُ الإعفاءِ من
القاعدةِ 0.4 **مغلقٌ لا يُفتَحُ بقرارٍ معماريٍّ**، فكُتِبَ ملحقُ 2026-09-14 في
`docs/MASTER_DIRECTIVE.md` مُعلِناً صنفَ `platform secret`، وحاجزُ
`check-migrations` يُخفِقُ على إعلانٍ بلا عضويّةٍ وعلى عضويّةٍ بلا إعلانٍ
وعلى عضوٍ ميّتٍ.

**وعطبانِ حقيقيّانِ في حارسَينِ قائمَينِ كشفَهُما هذا البناءُ وأُصلِحا في
مصدرِهما:** (١) `check-erasure-policy` كانَ يقرأُ **أوّلَ** هجرةٍ تُعرِّفُ
`export_my_data` لا آخرَها — و`create or replace` تجعلُ الأقدمَ نصّاً ميّتاً —
**فكانَ يكذبُ في الاتّجاهَينِ**: يُخفِقُ على قسمٍ زِيدَ ويسكتُ عن قسمٍ حُذِفَ.
والحالةُ السالبةُ مكتوبةٌ: اختبارٌ يُثبِتُ أنَّ `find` تُعطي الأقدمَ وأنَّ
البديلَ يُعطي النافذَ. (٢) `String.raw` بلا هربٍ في `css-class-coverage`.

**وتصحيحٌ إضافيٌّ لا محوٌ (`ح-8`)**: `ADR 0112 §٣-ب` والدليلُ `F2-11 §ب`
يقولانِ إنَّ العائدَ «مستخدمٌ جديدٌ بصفٍّ جديدٍ». **والسطرُ باقٍ ولم يُمحَ**:
كانَ وصفاً صادقاً للسلوكِ يومَ كُتِبَ، وصُحِّحَ بالإضافةِ في موضعَيه —
والسلوكُ **مُبدَّلٌ لا مُكذَّبٌ**، و`USER_NOT_FOUND` يبقى صحيحاً لأنَّ الصفَّ
جديدٌ حقّاً والأثرُ **يصبغُه** ولا يُحيي القديمَ.

**ما لا يُدَّعى (`ح-5`)**: لا سطحَ عفوٍ لمشرفٍ ولا مَن يملكُه (لوحةُ الإدارةِ
· `3.6`) · ولا حظرَ سائقٍ مبذورَ مقامٍ (`drivers` لم يُبنَ — **دَينٌ مُعلَنٌ**)
· ولا استعمالَ للمقامِ المحمولِ في معادلةِ المطابقةِ (محفوظٌ ومبذورٌ لا
مُستعمَلٌ في ترتيبٍ) · ولا إفصاحَ لمشرفٍ عن **سببِ** عودةِ الحظرِ · ولا نشرَ
حيَّ ولا محتالٌ حقيقيٌّ جُرِّبَ عليه (`ADR 0099`).

### تصحيحٌ بالإضافةِ · حكمُ CI الأوّلُ على `PR #35` كانَ أحمرَ (`ADR 0113` · 2026-09-14 · `ح-5` · `ح-8`)

`bun run ci` كانَ أخضرَ محلّيّاً، **ثمَّ سقطَ CI في ثلاثِ وظائفَ من أربعٍ**
([تشغيلُ 34869149115](https://github.com/uxxxug/ceezr/actions/runs/34869149115)):
`verify` نجحَ، و«تكامل على PostgreSQL حقيقي» و«تكامل على Redis حقيقي»
و«فوضى متعدد المثيلات (F5-06)» **أخفقَت كلُّها في تطبيقِ الهجراتِ نفسِه**:

```
✖ توقّفَ عندَ 20260914200000_identity_bar_survives_erasure.sql:
  schema "extensions" does not exist
```

**والسببُ الجذريُّ افتراضٌ لا عطبٌ عارضٌ**: `pgcrypto` تسكنُ مخطَّطَ
`extensions` على Supabase ومخطَّطَ `public` على قاعدةِ CI، فقُلنا
`extensions.hmac` فمضَت الهجرةُ حيثُ قِيسَت وسقطَت حيثُ يُحكَمُ. ولَزِمَ
التأهيلُ أصلاً لأنَّ الدالّةَ `security definer` بـ`search_path` مُثبَّتٍ
على `public, pg_temp` فلا يُغنيها اسمٌ غيرُ مُؤهَّلٍ.

**ولم يُعالَجْ بتخفيفٍ**: لا بحذفِ التثبيتِ (وهوَ يفتحُ اختطافَ مسارٍ على
دالّةٍ تملكُ صلاحيةَ مالكِها)، ولا بإضافةِ `extensions` إلى المسارِ (وهوَ
استبدالُ افتراضٍ بافتراضٍ)، ولا بتجميدِ الملفِّ في قائمةِ استثناءٍ. بل
**يُسأَلُ `pg_proc` عن مَقرِّ `hmac(bytea, bytea, text)` وقتَ التطبيقِ**
ويُبنى نصُّ الدالّةِ به بـ`format(%I)`، ويُسقَطُ التطبيقُ بـ`raise
exception` إن غابَت — لا تجزئةَ أضعفَ بديلاً عن سرٍّ. والتثبيتُ باقٍ كما
كانَ.

**وكشفَ إعادةُ التطبيقِ على قاعدةٍ نظيفةٍ عطباً ثانياً في القياسِ نفسِه**:
حالتانِ من العشرِ كانتا خضراءَ على **جدولٍ متقادمٍ** بقيَ في قاعدةِ
التجريبِ من صياغةٍ أولى بلا `city_id` — إحداهما تَعُدُّ الأعمدةَ فلم تذكرْ
`city_id`، والأخرى تدّعي رفضَ قيدِ التجزئةِ **وكانَ الرافضُ `not null` على
`city_id`** فتمرُّ ولو حُذِفَ القيدُ المقصودُ. أُسقِطَت الأشياءُ وأُعيدَ
تطبيقُ الهجرةِ كما كُتِبَت، وصُحِّحَت الحالتانِ، فصارَت **10/10 على مخطَّطٍ
مبنيٍّ من الهجرةِ لا من بقايا**. وزِيدَ حَرَسٌ نصّيٌّ (4 حالاتٍ) يمنعُ رجوعَ
التأهيلِ الجامدِ، إذ أخضرُ التكاملِ يجري على قاعدةٍ واحدةٍ فلا يرى فرقَ
المخطَّطاتِ أبداً (`ح-7`). ووحدةً: **31 حالةً** بعدَ الزيادةِ.

والسطرُ الذي قالَ «`bun run ci` أخضرُ محلّيّاً» **باقٍ مكتوباً** أعلاه: هوَ
صادقٌ في نفسِه، **وشاهدٌ على أنَّ الأخضرَ المحلّيَّ ليسَ حكماً**.

وحكمُ CI بعدَ هذا الإصلاحِ يُدوَّنُ ههنا بعدَ قراءتِه لا قبلَها.

### تصحيحٌ بالإضافةِ · حكمُ CI الثاني على `PR #35` وما ردَّه (`ADR 0113` §٥ · 2026-09-14 · `ح-5` · `ح-8`)

بعدَ إصلاحِ `extensions.hmac` مضَت الهجراتُ، **وردَّ الحكمُ الثاني أربعةَ
إخفاقاتٍ من ٨٥٢ حالةً** ([تشغيلُ 34870467844](https://github.com/uxxxug/ceezr/actions/runs/34870467844)):
`verify` و«Redis» و«فوضى `F5-06`» و«roadmap» خُضرٌ، و«تكامل على PostgreSQL
حقيقي» أحمرُ. **والعِلَلُ ثلاثٌ متمايزةٌ لا واحدةٌ**، أُعيدَ إنتاجُها كلُّها
على قاعدةٍ محلّيّةٍ حقيقيّةٍ (PostgreSQL 18 + PostGIS، ١١٧ هجرةً من الصفرِ)
قبلَ لمسِ حرفٍ:

**(أ) دوالُّ المُشغِّلاتِ الثلاثُ وُلِدَت مفتوحةً لـ`PUBLIC`.** منحةُ
`EXECUTE` الضمنيّةُ يُصدِرُها المحرِّكُ لا الهجرةُ، و`alter default
privileges` لا يُلغيها — وهيَ عينُ العِلَّةِ الموثَّقةِ في هجرةِ
`20260812000000`. فرأت الطبقةُ الثانيةُ في `database-privilege-surface`
وفحصُ `adversarial-security` أنَّ `anon` ينفِّذُ الثلاثَ. **أُصلِحَ في
الجذرِ**: `revoke execute ... from public, anon, authenticated` بجوارِ كلِّ
مُشغِّلٍ في الهجرةِ نفسِها؛ والسحبُ لا يُعطِّلُ شيئاً لأنَّ الإطلاقَ من
مُشغِّلٍ لا يُفحَصُ له `EXECUTE`. برهانٌ بعدَ الإصلاحِ:
`has_function_privilege('anon', oid, 'EXECUTE') = false` للثلاثِ.

**(ب) التنزيلُ صارَ ثلاثةَ عشرَ قسماً.** `identityBar` أضافَه هذا القرارُ
لأنَّ **ما يبقى بعدَ المحوِ يجبُ أن يُنزَّلَ**، فوُسِّعَ عقدُ
`account-data-rights` — **تغييرُ عقدٍ مُعلَنٌ لا تخفيفُ حاجزٍ**: القائمةُ ما
زالَت مجالاً مغلقاً يُقارَنُ بالتساوي، فقسمٌ رابعَ عشرَ يُضافُ سهواً
يُسقِطُ الاختبارَ.

**(ج) تنظيفُ الاختبارِ منعَه `identity_marks_city_id_fkey`.** المفتاحُ
`restrict` مقصودٌ فلا يُرخى؛ أُزيلَ ما بذرَه الملفُّ بعينِه — صفوفُ الأثرِ
لمدينتِه — قبلَ حذفِ المدينةِ.

**(د) حاجزُ `search_path` كانَ يقبلُ شكلاً واحداً**، فأسقطَ دوالَّ هذا
القرارِ المكتوبةَ `public, pg_temp`. وُسِّعَ المجالُ إلى الشكلَينِ **وبقيَ
مغلقاً**؛ والثاني **أمتنُ لا أرخى**: `pg_temp` غيرَ المذكورِ يُبحَثُ عنه
أوّلاً ضمناً. وتوحيدُ الـ١٣٦ دالّةَ `definer` الباقيةِ على الشكلِ الأمتنِ
**دَينٌ مُعلَنٌ** لا يُقضى في هذا الفرعِ لأنَّه يلمسُ هجراتٍ مطبَّقةً.

**ما لم يُفعَل ولِمَ (`ح-5`)**: لا حاجزَ نصّيَّ يشترطُ `revoke` بجوارِ كلِّ
`create function`. الفحصُ أظهرَ **أربعاً وثلاثينَ** هجرةً قديمةً تُنشئُ
دوالَّ بلا `revoke` في ملفِّها — أُحكِمَت بمسحٍ جامعٍ لاحقٍ أو بحلقةِ
تواقيعَ — فحاجزٌ نصّيٌّ يقتضي قائمةَ استثناءاتٍ من أربعٍ وثلاثينَ مُدخَلاً،
أي **مصدرَ حقيقةٍ ثانياً يُصانُ يدويّاً**. والقياسُ على قاعدةٍ حقيقيّةٍ هوَ
الذي كشفَ العِلَّةَ (أ) **فعلاً لا فرضاً**.

**حكمُ CI الثالثُ** ([تشغيلُ 34879270151](https://github.com/uxxxug/ceezr/actions/runs/34879270151)):
`verify` **pass** · «تكامل على PostgreSQL حقيقي» **pass** (٢م ٤٦ث) ·
«تكامل على Redis حقيقي» **pass** · «فوضى متعدد المثيلات (F5-06)» **pass**؛
و«roadmap» **fail** لأنَّ هجرةً تُعدَّلُ بلا سطرٍ في `ROADMAP.md` — **وهذا
الحاجزُ أصابَ**، وهذا السطرُ جوابُه لا تعطيلُه. وما بعدَه من أحكامٍ يُدوَّنُ
بعدَ قراءتِه لا قبلَها (`ح-4`: ثلاثةُ أحكامٍ خضراءَ متعاقبةٍ قبلَ `[x]`).

## `F2-12` · `SR-11` — بابُ الدعمِ من داخلِ التطبيقِ: مرجعٌ يُنطَقُ لا معرِّفٌ عالميٌّ (2026-09-14)

**العِلَّةُ**: للدعمِ بابٌ من جهةِ البوتِ، وللراكبِ في المِنِّي‑آبِّ **لا بابَ
ولا سجلَّ**؛ وللتذكرةِ معرِّفٌ `uuid` وحدَه — ومَن أملى ستَّةً وثلاثينَ محرفاً
في مكالمةِ دعمٍ يعلمُ أنَّ ذلكَ ليسَ مرجعاً. راجِعْ `ADR 0114`.

**ما بُنِيَ**: أربعُ هجراتٍ بأطوارٍ مفصولةٍ (توسيعٌ · ملءٌ رجعيٌّ · فهرسٌ
`concurrently` وحدَه في ملفِّه · تصديقٌ) تُضيفُ `support_tickets.reference`
بافتراضٍ من متسلسلةٍ على نمطِ `WSL-######` — **التوليدُ في القاعدةِ** فصفٌّ
يُكتَبُ بأيِّ مسارٍ يخرجُ بمرجعٍ — وفهرساً فريداً وقيدَ حضورٍ **يُقرآنِ من
`pg_index`/`pg_constraint`** لا من نصِّ الهجرةِ، وأربعَ قيمٍ في
`support_ticket_type`، ودالّةَ قراءةٍ بترقيمِ مفتاحٍ؛ ونطاقَ دعمٍ كاملاً
(نطاقٌ · منفذٌ · مخزنٌ · مسارانِ في البوّابةِ · شاشةٌ وعرضٌ وعقدٌ في سطحِ
الراكبِ) و59 مفتاحاً في القواميسِ الثلاثةِ؛ وحاجزاً ساكناً جديداً
`check-support-intake-contract.ts` بسبعِ قواعدَ ولكلٍّ افتراقٌ مزروعٌ (`ح-7`)
مُدرَجاً في سلسلةِ `ci` وفي `verify`.

**القياسُ محلّيّاً**: 16 حالةَ تكاملٍ على PostgreSQL حقيقيّةٍ (منها الترقيمُ
بمفتاحٍ مع صفٍّ يُكتَبُ **بينَ** الصفحتَينِ، وعزلُ راكبَينِ، وتهدئةٌ **لا
تكتبُ صفّاً**) و67 حالةَ وحدةٍ؛ وعقدُ المخطَّطِ 114 دالّةً؛ والحواجزُ
الساكنةُ كلُّها خضراءُ.

**الحالةُ `[~]`** — و`ح-4` يُوجِبُ ثلاثَ جولاتٍ خضراءَ من CI قبلَ `[x]`،
وحكمُ CI يُدوَّنُ بعدَ قراءتِه لا قبلَها.

## إغلاقُ `F2-10` و`F2-11` بحكمِ CI (2026-09-14)

قلبُ حالةٍ لا بناءٌ: `F2-10` قُلِبَ `[x]` بجولاتِ `34839711572` · `34852249908`
· `34861538030`، و`F2-11` بجولاتِ `34861538030` · `34880822092` ·
`34887616045` — ثلاثٌ خضراءُ متتاليةٌ لكلٍّ على `main` (`ح-4`). والدعوى
السابقةُ باقيةٌ بحرفِها مقرونةً بالقلبِ لا ممحوّةً (`ح-8`)، وبوّابةُ `F2`
غيرُ مُدَّعاةٍ.

## إغلاقُ `F2-12` بحكمِ CI (2026-09-14)

قلبُ حالةٍ لا بناءٌ: `34887051555` على `3f28049` · `34887616045` على
`main`@`75b72b8` · `34889897158` على `main`@`368eb11` — ثلاثٌ خضراءُ متتاليةٌ
(`ح-4`). وأوّلُ جولةٍ سقطَت برقمٍ مُثبَّتٍ في تدقيقِ التجاوزِ فأُصلِحَ
بالزيادةِ (98 · 994) لا بتعطيلِ الاختبارِ. وبنودُ `F2` كلُّها مغلقةٌ الآنَ،
**وبوّابةُ `F2` غيرُ مُدَّعاةٍ**.

## تصحيحُ عائقَي `F2-06` و`F2-08` بالإضافةِ (2026-09-14 · `ح-8`)

لا كودَ: صفَّا البندَينِ كانا يقولانِ إنَّ SOS والمشاركةَ و«الإبلاغَ عن
مشكلةٍ» غيرُ مبنيّةٍ — **وقد بُنِيَت كلُّها** (`F2-09` · `F2-10` · `F2-12`).
والنصُّ القديمُ باقٍ بحرفِه ومقرونٌ بزيادةٍ تقولُ ما أُغلِقَ وما بقيَ:
والباقي **عوائقُ قرارِيّةٌ لا فنّيّةٌ** (`DEC-11` للمالِ والإيصالِ ·
`ADR 0007` للخريطةِ · `م13-7` لسياسةِ الإلغاءِ) ودَينٌ مُعلَنٌ (`arrived_at`
والتتبُّعُ الحيُّ) — فلا تُقلَبُ الحالةُ إلى `[x]` بحُسنِ الظنِّ.


## `F3-01` + `F12-14` — وثائقُ السائقِ: الحجبُ **ساعةٌ لا رايةٌ** (2026-09-15)

بُنِيَ البندُ `F3-01` (`SD-01` + `SD-02`) ومعَه `F12-14` في مسارٍ واحدٍ، لأنَّ
الثاني **حكمٌ على الأوّلِ** لا ميزةٌ مستقلّةٌ: ما قيمةُ تاريخِ انتهاءٍ يُحفَظُ
ولا يمنعُ عرضاً؟

- **جدولٌ واحدٌ** `driver_documents` (صفٌّ لكلِّ نوعٍ لكلِّ سائقٍ، بحالتِه
  وتاريخِ انتهائِه ومسارِ كائنِه) بستِّ هجراتٍ مفصولةِ الأطوارِ: توسيعٌ،
  ففهرسانِ `concurrently` كلٌّ وحدَه، فتصديقُ ثلاثةِ قيودٍ، فالدوالُّ، فحَكَمُ
  دورةِ العروضِ.
- **الحجبُ يُحسَبُ ولا يُخزَّنُ**: `driver_document_block_reasons` تردُّ
  `MISSING:`/`REJECTED:`/`UNVERIFIED:`/`EXPIRED:` باسمِ النوعِ. فوثيقةٌ مقبولةٌ
  مضى تاريخُها تحجبُ **بلا وظيفةٍ دوريّةٍ ولا عمودٍ يُقلَبُ ولا نشرِ شيفرةٍ**،
  ويومُ الانتهاءِ نفسُه **ليسَ حجباً**.
- **الإنفاذُ في آخرِ بابٍ**: `open_offer_round` أُعيدَت كتابتُها بالتوقيعِ نفسِه
  لتُصفّي المحجوبَ في `CTE` واحدٍ وتنشرَ `blocked_by_documents` — فلا مسارٌ
  إداريٌّ ولا سكربتٌ ولا `psql` يُدخِلُ عرضاً لسائقٍ محجوبٍ، **ولا صفَّ إشعارٍ
  يُكتَبُ له**.
- **المِلفُّ في مخزنِ الكائناتِ**: دلوٌ خاصٌّ بصفرِ سياساتٍ، ورابطُ رفعٍ موقَّعٌ
  قصيرُ العُمرِ، والمسارُ **حكمُ القاعدةِ** (`OBJECT_PATH_NOT_MINE` لمسارِ
  غيرِكَ، ولا صفَّ يُكتَبُ للرفضِ). والخادمُ **يُوقِّعُ ولا يحملُ البايتاتَ**.
- **السياسةُ من الإعداداتِ** لا من رقمٍ صلبٍ: خمسةُ مفاتيحَ لكلِّ مدينةٍ
  (الأنواعُ الإلزاميّةُ · أيّامُ التنبيهِ · أقصى حجمٍ · أنواعُ المحتوى · عُمرُ
  الرابطِ).
- **حاجزٌ ساكنٌ جديدٌ** `scripts/check-driver-documents-contract.ts` بسبعِ قواعدَ،
  لكلٍّ منها حالةُ افتراقٍ مزروعةٌ (`ح-7`)، مُدرَجٌ في سلسلةِ `ci` وفي وظيفةِ
  `verify`. وقد **أصابَ فعلاً** عندَ أوّلِ تشغيلٍ: كشفَ افتراقاً حقيقيّاً بينَ
  رموزِ الأخطاءِ المنشورةِ وقواميسِ الواجهةِ الثلاثةِ فأُصلِحَ الافتراقُ، وكشفَ
  عطبَينِ في الحاجزِ نفسِه فأُصلِحا واحتُبِسا باختبارٍ.
- **القياسُ**: 25 حالةَ تكاملٍ على PostgreSQL حقيقيٍّ (منها قراءةُ
  `pg_constraint.convalidated` و`pg_index.indisvalid` من الكاتالوجِ لا من نصِّ
  هجرةٍ) و73 حالةَ وحدةٍ. وسجلُّ التجاوزِ رُفِعَ **بالزيادةِ** إلى 99 ملفّاً
  و1019 حالةً (`ح-8`).
- **الحكمُ مثبَّتٌ في** `docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md`،
  وأثرُ التوقيعِ الحقيقيِّ في
  `docs/evidence/storage/F3-01-SIGNED-UPLOAD-20260915.md`.

**وما لا يُدَّعى (`ح-5`)**: لا لوحَ مراجعةٍ للمشرفِ (القبولُ والرفضُ بندٌ لاحقٌ،
وحالُ `accepted` في الاختبارِ مزروعةٌ بـ`update` مكشوفٍ) · ولا مطابقةَ وجودِ
الكائنِ في المخزنِ · ولا توقيعَ يُقاسُ في CI (لا مخزنَ في الوظيفةِ؛ المُحوِّلُ
مقيسٌ بجالبٍ محقونٍ، والتوقيعُ الحقيقيُّ مقيسٌ مرّةً بأثرٍ موثَّقٍ) · ولا فحصَ
لمحتوى المِلفِّ · ولا تحقُّقَ من صحّةِ الوثيقةِ عندَ جهةٍ رسميّةٍ · ولا وثائقَ
مركبةٍ لأسطولٍ · **ولا `[x]`** لأيِّ البندَينِ قبلَ ثلاثِ جولاتٍ خضراءَ
متتاليةٍ (`ح-4`)، وهما اليومَ `[~]`.

### زيادةٌ على البندَينِ نفسِهما (`ح-8`) — حكمُ CI أوّلاً، ثمَّ سببانِ جذريّانِ (2026-09-15)

حكمُ CI على `PR #40` أخفقَ في وظيفتَينِ، وعُولِجَ سببُ كلٍّ منهما في أصلِه لا
في عَرَضِه:

- **`verify`**: الجدولُ `driver_documents` أُنشئَ **بلا `enable row level
  security`**. فأُضيفَ التفعيلُ وسياسةُ `service_role` وحدَها إلى الهجرةِ
  المُنشِئةِ، ومعَها مكتوبٌ أنَّ **غيابَ سياسةٍ للمستخدمِ قرارٌ لا سهوٌ**
  (الجدولُ لا يُمَسُّ إلّا من دالّاتٍ بـ`security definer`). ومقيسٌ في
  الكاتالوجِ: `relrowsecurity = t`.
- **التكاملُ — 46 إخفاقاً في مساراتٍ لا صلةَ لها بالوثائقِ**: الحاجزُ الأوّلُ
  أسقطَ من دورةِ العرضِ كلَّ سائقٍ له **أيُّ** سببِ حجبٍ، وفيها `MISSING:`.
  وذاكَ — لو نُشِرَ — **يُخرِجُ كلَّ سائقٍ اعتمدَته الإدارةُ قبلَ `F3-01` من
  الإسنادِ في لحظةِ الهجرةِ**. فضُيِّقَ البابُ إلى نصِّ البندِ حرفاً: هجرةُ
  `20260915010000` تُبدِّلُ شرطاً واحداً إلى
  `driver_document_dispatch_block_reasons` — دالّةٌ **مُشتقّةٌ** من الأمِّ لا
  مكرَّرةٌ، تُبقي `EXPIRED:` و`REJECTED:` وحدَهما.

**والاختبارُ زادَ ولم يُضعَّفْ**: محجوبُ الحالتَينِ ٢٣ و٢٤ صارَ محجوباً بوثيقةٍ
**منتهيةٍ** لا بغيابِ صفٍّ، وأُضيفَت ٢٦ (الرفضُ يحجبُ كالانتهاءِ) و٢٧ (**حدُّ
البندِ مقيسٌ**: غيابُ الوثائقِ كلِّها لا يُسقِطُ سائقاً اعتمدَته الإدارةُ) —
فصارَ الملفُّ 27 حالةً خضراءَ. ومدخلُ سجلِّ الارتدادِ مكتوبٌ لـ
`20260915010000`، والحكمُ مثبَّتٌ في `ADR 0115` §٥.

**وما لا يُدَّعى**: منعُ سائقٍ **ناقصِ** الوثائقِ من الاعتمادِ ابتداءً بابُه
لوحُ المراجعةِ (`SD-02`) — دَينٌ مُعلَنٌ لا مُنجَزٌ · وستُّ حالاتٍ محليّةٍ
مُخفِقةٍ أُرجِعَت إلى بيئةِ الصندوقِ ومُخطِّطِ PG 18 المحليِّ، **وحكمُ CI هوَ
الفيصلُ** · ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`).

### تصحيحٌ بالإضافةِ (`ح-8`) — حكمُ CI أسقطَ الفرعَ، والسببُ **شرطٌ مُستعارٌ** لا منطقُ البندِ

الجولةُ [`34909694080`](https://github.com/uxxxug/ceezr/actions/runs/34909694080)
أعلنَت وظيفةَ **«تكامل على PostgreSQL حقيقي»** حمراءَ: `871 pass · 1 fail`،
والمُخفِقُ واحدٌ هوَ خطّافُ `beforeAll` في
`tests/integration/driver-documents.test.ts:181` —
«تعذّر الزرعُ: لا مدينةَ مفعَّلةً لها منطقةُ خدمةٍ مفعَّلةٌ».

**والسببُ الجذريُّ ليسَ في `F3-01` ولا في `F12-14`**، بل في **شرطٍ مسبقٍ
مُستعارٍ**: بذرةُ الهجراتِ تُنشئُ مدنَ الإطلاقِ الخمسَ **معطَّلةً**
(`is_active = false` بقرارِ `F2-05`)، ومنطقةَ خدمةٍ مفعَّلةً واحدةً لـ`JED`.
فالاستعلامُ `select … where c.is_active order by c.code limit 1` **لا يجدُ
شيئاً على قاعدةٍ نظيفةٍ**؛ ولا ينجحُ إلّا إن سبقَه ملفُّ اختبارٍ آخرُ فعَّلَ
مدينةً ولم يُرجِعْها. وقد ثبتَ ذلكَ بالقياسِ لا بالظنِّ: على قاعدةٍ مهجورةٍ
حديثاً في الصندوقِ يُخفِقُ الملفُّ **منفرداً وحتماً**.

**الإصلاحُ في الجذرِ بلا إضعافِ توكيدٍ**: الملفُّ صارَ **يصنعُ شرطَه**
— يختارُ `JED` بالرمزِ، ويُفعِّلُها مستوفياً قيدَ
`cities_active_requires_groups` (القروباتُ الثلاثةُ) لا مُخفِّفاً له، ثمَّ
**يردُّها إلى حالتِها** في `afterAll` فلا يُورِّثُ لِمَن بعدَه شرطاً لم
يطلُبْه. والتوكيداتُ السبعُ والعشرونَ باقيةٌ حرفاً بحرفٍ، ولا اختبارَ سُكِّتَ
ولا صُنِّفَ تخطّياً. وقيسَ بعدَ الإصلاحِ: `27 pass · 0 fail · 90 توكيداً`،
والقاعدةُ تعودُ بعدَه إلى خطِّ الأساسِ (`JED` معطَّلةٌ بلا قروبات) بالفحصِ.

**واكتشافٌ جديدٌ يُسجَّلُ ولا يُعالَجُ ههنا** (`ح-6`): **سبعةُ** ملفّاتٍ أُخرى
تحملُ الاستعلامَ المُستعارَ نفسَه — `quote` و`active-ride` و`ride-request` و
`ride-summary` و`ride-history` و`ride-share` و`rider-support-intake`. وخضرتُها
في CI **رهنُ ترتيبِ التشغيلِ**: في جولةِ الصندوقِ الكاملةِ أخفقَ `quote`
بالسببِ عينِه بعدَ أن أعادَ `five-cities-launch` المدنَ إلى التعطيلِ في
`afterAll`. فهذا **أخضرُ زائفٌ قائمٌ** (`OPS-009` · `F9-05`)، ونطاقُه محجوزٌ
في الحجزِ `OPS-019`، ويُعالَجُ في فرعٍ مستقلٍّ بحاجزٍ آليٍّ يمنعُ عودتَه —
لا في هذا الفرعِ، كي لا يختلطَ إصلاحُ قياسٍ بتسليمِ ميزةٍ.

## `F3-02` — عروضُ السائقِ: **المؤقّتُ حقيقةُ خادمٍ** وللقبولِ كاتبٌ واحدٌ (2026-09-15)

بُنِيَ البندُ `F3-02` (`SD-03` + `SD-04`) على حكمَينِ لا ثالثَ لهما: **أنَّ
العدَّ التنازليَّ نقلٌ عن ساعةِ القاعدةِ** لا مقارنةٌ بساعةِ الجهازِ، **وأنَّ
القبولَ لا يُكتَبُ ههنا** بل يُفوَّضُ إلى الذرّيّةِ القائمةِ `claim_ride`.

- **لا لحظةَ مُطلقةً تُنشَرُ**: الدوالُّ الثلاثُ تنشرُ `seconds_left`
  (بـ`greatest(0, floor(...))` فلا سالبَ) و`server_time` — و`expires_at`
  **لا يُنشَرُ ألبتّةَ** لا في لوحٍ ولا في تفصيلٍ ولا في جوابِ قبولٍ. والواجهةُ
  تعُدُّ بفارقٍ محليٍّ (`countdownSeconds`) فتُلغي إزاحةُ ساعةِ الجهازِ نفسَها
  بينَ قراءتَينِ، والصلاحيّةُ `is_claimable` **حكمُ خادمٍ**.
- **كاتبٌ واحدٌ**: `driver_accept_offer` تُحِلُّ الهويّةَ، وتتحقّقُ من
  **المِلكيّةِ بقيدِ استعلامٍ** (فعرضُ غيرِكَ يُرَدُّ `OFFER_NOT_FOUND` كمعرِّفٍ
  معدومٍ سواءً)، ثمَّ تُنادي `claim_ride` وتُمرِّرُ رموزَها. فلا `for update` ولا
  `skip locked` ولا `update orders` ولا `update order_offers` في الهجرةِ — يمنعُها
  الحاجزُ الساكنُ.
- **الجوابُ منقّىً**: `claim_ride` تحملُ هويّةَ الراكبِ وهاتفَه، والغلافُ يُعيدُ
  **ثلاثةَ مفاتيحَ فقط** (`ok` · `order_id` · `matched_at`) — يُقاسُ بعدِّ
  المفاتيحِ لا بقراءةِ شيفرةٍ. وهويّةُ الراكبِ بابُها `F3-03`.
- **المسافةُ موسومةٌ بجنسِها**: كلُّ مسافةٍ كائنٌ
  `{ kind: 'STRAIGHT_LINE', meters }` أو `null` — لا رقماً عارياً يُقرأُ مسافةَ
  طريقٍ وهوَ وترٌ. ووجهةٌ غائبةٌ `null` لا صفرٌ.
- **قرارُ «التقديرِ»**: `SD-03` و`SD-04` يطلبانِه، و**الاكتشافُ المقيسُ أن لا
  عمودَ أجرةٍ في المخطَّطِ كلِّه** — لا `fare` ولا تعريفةَ في `platform_settings`.
  فالتقديرُ **طبقةٌ لم تُبنَ** لا حقلٌ نُسِيَ. ورقمٌ مُخترَعٌ يُقرأُ وعداً،
  وحقلٌ فارغٌ يُقرأُ عطباً — **فأُعلِنَت الطبقةُ غائبةً**: لا مفردةَ مالٍ في SQL
  ولا في الشيفرةِ ولا في مفتاحٍ من الأربعةِ والستِّينَ، والحاجزُ يحرسُ ذلكَ
  بقاعدةٍ صريحةٍ، والإعلانُ في `ADR 0117` §٣ وههنا **لا في الشاشةِ**. ويُنشَرُ
  بدلاً منه ما هوَ مقيسٌ: وترُ الراكبِ من `distance_km` المخزونِ، ووترُ الرحلةِ
  بـ`st_distance` وقتَ القراءةِ، والخدمةُ والملاحظةُ والعناوينُ.
- **وحاجزٌ قائمٌ أصابَ فعلاً**: أوّلُ نسخةٍ من الشاشتَينِ حرَّكَت قراءةَ الساعةِ
  بـ`setInterval` كلَّ ثانيةٍ بلا نداءِ شبكةٍ، **فأسقطَها
  `scripts/check-system-screens-policy.ts`** (`F1-07` · `ADR 0035` §٤ يمنعانِ
  كلَّ مؤقّتٍ دوريٍّ لا الاستقصاءَ الشبكيَّ وحدَه). فعُولِجَ في الجذرِ ولا
  استثناءَ ولا التفافَ بـ`requestAnimationFrame`: **الباقي محسوبٌ لحظةَ الرسمِ**
  من آخرِ قراءةٍ ويُحدَّثُ بفعلِ السائقِ، والحدُّ مُعلَنٌ في الشاشةِ نفسِها وفي
  `ADR 0117` §٦.
- **حاجزٌ ساكنٌ جديدٌ** `scripts/check-driver-offers-contract.ts` **بثمانِ
  قواعدَ**، لكلِّ واحدةٍ حالةُ افتراقٍ مزروعةٌ (`ح-7`): تكافؤُ اللغاتِ · ترجمةُ
  كلِّ رمزٍ في الاتّجاهَينِ · لا مفردةَ مالٍ · كاتبٌ واحدٌ · نزعُ التنفيذِ عن
  ثلاثةِ أدوارٍ · صدقُ الساعةِ والمسافةِ · استيفاءُ `STATUS_BY_ERROR` · لا هويّةَ
  راكبٍ. وهوَ في سلسلةِ `ci` وفي `verify` بخطوتَينِ مُسمّاتَينِ.
- **القياسُ**: 24 حالةَ تكاملٍ على PostgreSQL حقيقيٍّ — ومنها **قبولانِ
  متزامنانِ على اتّصالَينِ مستقلَّينِ يُنجِحانِ واحداً فقط** وصفُّ `accepted`
  واحدٌ بالعدِّ — و41 حالةَ وحدةٍ للحاجزِ (49 توكيداً). والملفُّ يصنعُ شرطَه
  بمعينِ `OPS-019` ويردُّ المدينةَ، ومدخلُه في سجلِّ التجاوزِ مُضافٌ (`ح-8`).
- **الحكمُ مثبَّتٌ في**
  `docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md`.

**وما لا يُدَّعى (`ح-5`)**: **ذرّيّةُ `claim_ride` ليسَت من كسبِ هذا البندِ** —
هيَ قائمةٌ ومقيسةٌ قبلَه، والمقيسُ ههنا أنَّ الغلافَ **لم يُضِفْ كاتباً ثانياً**
· و`distance_km` محسوبٌ `haversineKm` **وقتَ الدَّرْزِ** فلا يُعادُ قياسُه في
القراءةِ، ووترُ الرحلةِ من المحرِّكِ وقتَ القراءةِ — فالرقمانِ **مصدرُهما
مختلفٌ** ولا يُقارَنانِ، ولا مسافةَ طريقٍ في المستودعِ (`ADR 0024`) ·
وانحرافُ ساعةِ الأجهزةِ الحقيقيِّ **غيرُ مقيسٍ** (المقيسُ أنَّ الحكمَ لا يقرؤها)
· و`duplicate: true` من `claim_ride` **لا يُنشَرُ** فنقرةٌ مُعادةٌ تُقرأُ فوزاً
طازجاً · ولا إشعارَ فوريَّ ولا خريطةَ مرسومةً (مُعلَنانِ دَيناً في الشاشةِ) ·
والرفضُ يُحوَّلُ إلى **الكاتبِ القائمِ** في `order_offers` ولا يُدَّعى له قياسٌ
تكامليٌّ ههنا · وحدُّ الحاجزِ في اللغةِ: مفردةُ «دفع» **غيرُ محجوبةٍ** لأنَّها
حركيّةٌ أيضاً · **ولا `[x]`** قبلَ ثلاثِ جولاتٍ خضراءَ متتاليةٍ (`ح-4`)، وهوَ
اليومَ `[~]`.

## `F3-03` — مَهمّةُ السائقِ النشطةُ: **الطَورُ ختمُ إنسانٍ** ولِـ`arrived_at` كاتبٌ واحدٌ (2026-09-15)

بُنِيَ البندُ `F3-03` (`SD-05`) على حكمَينِ لا ثالثَ لهما: **أنَّ انتقالَ
الطَورِ يقعُ بختمٍ يكتبُه إنسانٌ** لا باستنتاجٍ يُشتَقُّ من قُربٍ أو زمنٍ،
**وأنَّ ما لهُ كاتبٌ قائمٌ لا يُكتَبُ ثانيةً** — فالبدءُ والإنهاءُ يُفوَّضانِ
إلى `start_ride`/`complete_ride`، والجديدُ الوحيدُ كاتباً هوَ ختمُ الوصولِ.

- **لا استنتاجَ للطَورِ**: لا `st_distance` ولا قراءةَ موقعٍ ولا مقارنةَ لحظةٍ
  في أيِّ ملفٍّ من الشريحةِ لتقريرِ طَورٍ. و`arrived_at` لا يُكتَبُ إلّا بفعلٍ
  صريحٍ عبرَ `driver_mark_arrived`. والحاجزُ الساكنُ يمنعُ لفظَ القُربِ
  (`ST_DWithin` · `st_distance` · `proximity` · `geofence` · `radius`) في
  الشريحةِ كلِّها، ويمنعُ `Date.now(`/`new Date(` في ملفّاتِ القرارِ.
- **الزرُّ اسمٌ من الخادمِ**: `driver_active_job` تنشرُ `next_action` ∈
  {`MARK_ARRIVED`, `START_RIDE`, `COMPLETE_RIDE`, `null`} و`server_time`،
  و`JobScreen.tsx` **مُمنوعٌ حرفيّاً** من ذكرِ `"matched"` و`"in_progress"` —
  فمصدرُ حقيقةِ الأطوارِ واحدٌ، وإضافةُ طَورٍ غداً تقعُ في القاعدةِ وحدَها.
- **كاتبٌ واحدٌ لِـ`arrived_at`**: عمودٌ جديدٌ في هجرةِ توسيعٍ
  (`20260915030000`) معَ قيدِ `orders_arrived_requires_driver` — فأيُّ تجاوزٍ
  للكاتبِ يسقطُ منَ المحرِّكِ لا منَ المراجعةِ (مقيسٌ: كتابةٌ مباشرةٌ على طلبٍ
  بلا سائقٍ تُرفَضُ). والدالّةُ تقفلُ `for update` وتُرَدُّ `ALREADY_ARRIVED`
  **معَ الختمِ الأوّلِ نفسِه**، وختمانِ متزامنانِ يُنجِحانِ واحداً لا اثنَينِ.
- **تفويضٌ لا نسخٌ**: `driver_start_ride`/`driver_complete_ride` تتحقّقانِ من
  المِلكيّةِ لتمييزِ الرمزِ فحسبُ، ثمَّ تُنادِيانِ الذرّيّةَ القائمةَ.
  و`update orders set status` و`update order_offers` و`update
  driver_availability` **لا تُكتَبُ في الهجرةِ ألبتّةَ** — يمنعُها الحاجزُ.
  والبرهانُ ميدانيٌّ: الإنهاءُ **يُعيدُ السائقَ متاحاً**، وذاكَ أثرُ
  `complete_ride` وحدَها.
- **بدءٌ بلا ختمِ وصولٍ يمرُّ — عن قصدٍ**: `start_ride` لا تشترطُ الختمَ، فلو
  اشترطَهُ الغلافُ لَصارَ حَكَماً موازياً لحالةِ الطلبِ. والأثرُ مُعلَنٌ:
  `arrived_at` يبقى **عَدَماً** لا صفراً (`ADR 0023`) فمَن قاسَ الانتظارَ غداً
  وجدَ غياباً صريحاً لا رقماً مُخترَعاً (`ADR 0118` §٣).
- **المِلكيّةُ قيدُ استعلامٍ**: `assigned_driver_id = v_driver.id` في `where`،
  ومَهمّةُ غيرِه ومعرِّفٌ معدومٌ يُرَدّانِ `JOB_NOT_FOUND` بالحرفِ نفسِه.
- **حمولةٌ منقّاةٌ بإعلانٍ**: من الراكبِ **اسمٌ أوّلٌ ولغةٌ** فقط. وثمانيةُ
  حقولٍ محجوبةٌ حرفيّاً (`phone` · `full_name` · `fullName` · `telegram_id` ·
  `telegramId` · `telegram_username` · `rider_id` · `riderId`)، والمباحُ
  **مباحٌ بإعلانٍ** في الحاجزِ لا بسهوٍ. ومقيسٌ بعدِّ مفاتيحِ `rider` وبغيابِ
  الهاتفِ والمعرِّفِ من الحمولةِ نفسِها.
- **الأثرُ المُنفَذُ**: أربعُ دوالَّ منزوعةِ التنفيذِ عن
  `public`/`anon`/`authenticated` وممنوحةٍ لـ`service_role` · طبقةُ تطبيقٍ
  بأحدَ عشرَ رمزَ خطأٍ عامّاً · أربعةُ مساراتِ بوّابةٍ بـ`STATUS_BY_ERROR`
  **مستوفىً في الاتّجاهَينِ** · شاشةٌ موصولةٌ بأربعةِ ملفّاتٍ · 46 مفتاحاً
  بثلاثِ لغاتٍ · مدخلُ خروجٍ واحدٌ في سجلِّ الحدودِ (`W-6`) · كتلةُ CSS
  `djb`.
- **الإنفاذُ آليٌّ**: `scripts/check-driver-job-contract.ts` بثمانِ قواعدَ،
  ولكلِّ قاعدةٍ **حالةُ افتراقٍ مزروعةٌ** (`ح-7`) — 44 حالةَ وحدةٍ — والحاجزُ
  والاختبارُ **خطوتانِ مُسمّاتانِ** في `verify` وفي سلسلةِ `ci`. وقاعدةُ
  الكاتبِ الواحدِ صُحِّحَت في أثناءِ البناءِ: `start_ride(` كانَ يُطابِقُ
  اسمَ الغلافِ نفسِه، فصارَ بلَحاقٍ خلفيٍّ `(?<!driver_)` — **فالحاجزُ سقَطَ
  على نموذجٍ فأُصلِحَ**، لا افتُرِضَ صحيحاً. وشُذَّتْ نصوصُ `comment on` من
  فحصِ المالِ بدالّةٍ مُصدَّرةٍ `blankSqlObjectComments`: تلكَ النصوصُ تُعلِنُ
  **غيابَ** الأجرةِ فذكرُها فيها إثباتٌ لا خرقٌ.
- **19 حالةَ تكاملٍ على PostgreSQL حقيقيٍّ** بلغَت ما لا يقدرُ عليه نصٌّ:
  ختمانِ متزامنانِ، ولحظةُ وصولٍ لا تُزحزَحُ، وقيدٌ يُسقِطُ تجاوزَ الكاتبِ،
  وإنهاءٌ يُعيدُ التوفّرَ. والملفُّ **يُنشئُ مدينتَه المفعَّلةَ ويُعيدُها**
  (`OPS-019`) فلا أخضرَ رهنَ ترتيبِ التشغيلِ. وأرضيّاتُ `skip-audit` رُفِعَت
  **بالزيادةِ** 100→101 ملفّاً و1043→1062 حالةً (`ح-8`).

**وما لا يُدَّعى (`ح-5`)**: صدقُ الختمِ ميدانيّاً **غيرُ مقيسٍ** — المقيسُ أنَّ
النظامَ لا يخترعُه ولا يُزحزِحُه · ومدّةُ الانتظارِ **غيرُ محسوبةٍ** وإنّما
صارَ عمودُها موجوداً وكاتبُه واحداً · **وعائقُ `F2-06` يبقى مفتوحاً**: سببُه
(غيابُ لحظةِ الوصولِ وكاتبِها) زالَ، وسطحُ الراكبِ الذي يُظهِرُ الوصولَ **لم
يُبنَ** وعائقُ «لا تتبُّعَ حيَّ» (`ADR 0035` §٤) قائمٌ · **واستغاثةُ السائقِ
زيادةٌ ثانيةٌ مُعلَنةٌ دَيناً**: `sos_surface_state` يقبلُ `'driver'` لكنَّ
`createSafetyRoutes` يُثبِّتُ مساراً بدورٍ واحدٍ ويُركَّبُ بـ`role: "rider"`،
وفتحُ ذلكَ **خارجُ النطاقِ المحجوزِ** · ولا خريطةَ مدمَجةٌ (رابطُ ملاحةٍ
خارجيٌّ · `ADR 0007`) · ولا أثرَ صلاحيّاتٍ مقيسٌ (الاتّصالُ بمالكِ القاعدةِ
يتخطّى `revoke`؛ والنزعُ مقيسٌ نصّاً) · ولا `مَقيس` ولا `مُثبَت`، **ولا `[x]`**
قبلَ ثلاثِ جولاتٍ خضراءَ متتاليةٍ (`ح-4`)، وهوَ اليومَ `[~]`.

**وانحرافٌ عن الحجزِ يُسجَّلُ لا يُسكَتُ عنه**: نصُّ الحجزِ ذكرَ ملفَّ دليلٍ
في `docs/evidence/architecture/F3-03-*`، **ولم يُكتَبْ**. والسببُ معيارٌ من
الملحقِ الحاكمِ: **أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ**. فالدليلُ ههنا في §25 وفي
`ADR 0118` وفي الجدولِ، وملفٌّ رابعٌ يُعيدُ الكلامَ نفسَه يصيرُ نسخةً تتعتّقُ
بلا حاجزٍ يُلزِمُ تحديثَها — وهوَ عينُ ما فعلَ `F3-02` قبلَه. والسطرُ في
الحجزِ **يبقى مكتوباً** لا مُمحوّاً، وهذا السطرُ تصحيحُه بالإضافةِ (`ح-8`).

### وحكمُ CI الأوّلُ أسقطَ البناءَ — والسببُ عُولِجَ في جذرِه لا في الحاجزِ

الدفعةُ الأولى لهذا الفرعِ (PR ‏#44) نالَت **حكماً حقيقيّاً مختلفاً عن الأخضرِ
المحلّيِّ**: وظائفُ التكاملِ الثلاثةُ خضراءُ (PostgreSQL و Redis وفوضى متعدّدِ
المثيلاتِ) و`Roadmap freshness` خضراءُ، **و`verify` سقطَت** عندَ الخطوةِ
«النطاقُ واحدٌ ولا أصلَ تنفيذيّاً من نطاقٍ ثالثٍ (F1-10 · TG-005 · ADR 0045)»:

```
✗ 1 خرقاً لسياسةِ النطاقِ الواحدِ (F1-10):
  apps/miniapp/src/surfaces/driver/job/job-view.ts:97
    ← return `https://maps.google.com/?q=${place.latitude},${place.longitude}`;
```

ولِمَ لم يُرَ محلّيّاً: ذلكَ الفحصُ **يقرأُ مُخرَجَ البناءِ لا الشيفرةَ**،
فيُشغَّلُ بعدَ `build:miniapp` وحدَه، ولم يكن في السَّربِ المحلّيِّ بناءٌ. وهذا
بعينِه ما تقولُه القاعدةُ: **الأخضرُ المحلّيُّ ليسَ بديلاً عن حكمِ CI**.

والمعالجةُ **جذرٌ لا عَرَضٌ**، وثلاثةُ طرقٍ كانت مفتوحةً:

1. **توسيعُ القائمةِ المغلقةِ** بـ`maps.google.com` — مرفوضٌ: القائمةُ تُغذّي
   `script-src` نفسَه، فيصيرُ مُضيفٌ **لا نُشغِّلُ منه شيفرةً** مأذوناً بتشغيلِ
   شيفرةٍ في مستندٍ يحملُ جلسةَ المستخدمِ. وذاكَ **إضعافُ حاجزٍ** لِسببٍ لا
   يستحقُّه.
2. **نقلُ الدالّةِ إلى `packages/`** — مرفوضٌ: الفحصُ يمسحُ `apps/miniapp` فحسب،
   فالنقلُ يُنجِحُ الحاجزَ **والشيفرةُ نفسُها تُحزَمُ في المصغَّرِ**. وذاكَ نقلُ
   المشكلةِ إلى موضعٍ لا يُفحَصُ فيه.
3. **أن يُنشِرَ الخادمُ الرابطَ** — وهوَ المُختارُ.

فصارَ في البوّابةِ `navigationUrlFor` و`wirePlace`، وتحملُ كلُّ نقطةٍ في
الحمولةِ `navigation_url`، والشاشةُ **تفتحُ ما أُعطِيَت ولا تُركِّبُ عنواناً**.
وحُوِّلَ موضعُ السجلِّ في سجلِّ المخارجِ من ملفِّ العرضِ إلى ملفِّ المساراتِ
(`W-6`) — فالمُضيفُ يُقرأُ حيثُ هوَ حقّاً. وهذا نفسُ ما تفعلُه لوحةُ الإشرافِ
في `google-maps-link` قبلَنا: **مصدرُ حقيقةٍ واحدٌ لِمُضيفٍ خارجيٍّ، في
الخادمِ**.

**وأُضيفَت القاعدةُ ٩ إلى الحاجزِ الساكنِ** (فصارَت تسعاً) لِتمنعَ الرجعةَ:
لا عنوانَ مطلقاً في أيِّ مِلفٍّ من مِلفّاتِ السطحِ، والبوّابةُ **مُلزَمةٌ**
بنشرِ `navigation_url` والعقدُ مُلزَمٌ بقراءتِه. **ولها خمسُ حالاتٍ مزروعةٍ**
(`ح-7`) ومنها أنَّ **أيَّ** مُضيفٍ ثالثٍ يُسقِطُ لا «جوجل» وحدَها، وأنَّ
بوّابةً تكفُّ عن النشرِ تُسقِطُ ولو كانَ العميلُ نظيفاً: 44 حالةً ⇒ **49**.
والفرقُ بينَ هذه القاعدةِ و`check-single-origin-assets`: تلكَ تقرأُ المُخرَجَ
بعدَ بناءٍ، وهذه تُسقِطُ **قبلَه وبسببٍ مقروءٍ** في الشريحةِ.

**وإعادةُ القياسِ بعدَ الإصلاحِ**: `check-single-origin-assets` بعدَ
`build:miniapp` ⇒ أخضرُ (نطاقٌ خارجيٌّ واحدٌ مأذونٌ له، وسياسةُ المُخرَجِ
تطابقُ وحدةَ السياسةِ حرفاً حرفاً) · `typecheck` ⇒ 0 · حاجزُ العقدِ ⇒ تسعُ
قواعدَ · اختبارُ الحاجزِ ⇒ **49 pass · 0 fail** · مجموعةُ الوحدةِ كامِلةً ⇒
**4404 pass · 1133 skip · 0 fail** (370 مِلفّاً) · `check-egress-boundary`
أُعيدَ توليدُه من السجلِّ.

**وما لا يُدَّعى ههنا (`ح-5`)**: أنَّ الرابطَ من الخادمِ **لا يُقلِّلُ** ثقةً
في وجهةٍ خارجيّةٍ — الوجهةُ هيَ هيَ، والمكسبُ **موضعُ الحقيقةِ وقابليّةُ
مراجعتِه** لا أمنُ الوجهةِ · ولا خريطةَ مدمَجةً بعدُ (`ADR 0007`) · وحكمُ CI
بعدَ هذه الدفعةِ **يُقرأُ ويُوثَّقُ** ولا يُفترَضُ.

## `F3-04` — بثُّ الموقعِ التكيّفيُّ: **النبضةُ لها سببٌ منشورٌ ومُدّةٌ من الخادمِ** (2026-09-15)

بُنِيَ البندُ `F3-04` (`SD-05`) على حكمَينِ: **أنَّ إيقاعَ النبضةِ حقيقةُ خادمٍ**
تُقرأُ من `platform_settings` لمدينةِ السائقِ فلا يخترعُ عميلٌ ثوانيَ، **وأنَّ
النبضةَ لا تقعُ إلّا لسببٍ يُسمّيهِ الخادمُ** — فالسكونُ حالٌ مُعلَنةٌ لا شاشةٌ
فارغةٌ (ADR 0119).

- **كتلةٌ واحدةٌ في جذرِ القراءةِ القائمةِ**: `location_broadcast:
  {reason, interval_seconds}` تُنشَرُ في **مَخرجَي** `driver_active_job`
  كِلَيهِما — لا مسارَ جديدٌ ولا نداءٌ ثانٍ. ونشرُها في مَخرجِ المَهمّةِ وحدَه
  كانَ سيُسكِتُ **نصفَ** الحالاتِ: السائقُ المتاحُ بلا مَهمّةٍ يبثُّ كي يُوكَلَ
  إليه.
- **ثلاثةُ إعداداتٍ لثلاثةِ أسبابٍ** بمدينةٍ (60 · 15 · 20 ثانيةً بذراً):
  `location_broadcast_seconds_available`/`_matched`/`_on_trip` — تُضبَطُ بلا نشرِ
  حزمةٍ. **والمُدّةُ مُدّةٌ لا لحظةٌ**: `interval_seconds` ولا `expires_at`.
- **فشلٌ مغلقٌ**: إعدادٌ غائبٌ أو صفرٌ أو سالبٌ ⇒ `interval_seconds: null`
  **والسببُ يُنشَرُ** فيُقرأُ سكوناً مُفسَّراً؛ و`?? 0` في عميلٍ **يُسقِطُه
  الحاجزُ** لأنَّ صفراً بثٌّ متّصلٌ لا سكونٌ.
- **ختمُ الوصولِ يُسكِتُ النبضةَ** حتّى بدءِ الرحلةِ: `matched` **بلا** ختمِ
  وصولٍ ⇒ `TO_PICKUP`، وبعدَ الختمِ لا سببَ — والطَورُ ختمُ إنسانٍ لا مسافةٌ
  تُحسَبُ ولا وقتٌ يمضي (ADR 0118).
- **القرارُ دالّةٌ نقيّةٌ**: `nextBroadcastDecision` بلا `Date.now()` ولا مؤقّتٍ
  ولا شبكةٍ ⇒ `SEND`/`WAIT{delayMs}`/`STOP{why}` بستّةِ أسبابِ سكونٍ مُسمّاةٍ،
  وتراجعٌ مُضاعَفٌ **بسقفٍ مُصرَّحٍ** (ثلاثُ مُضاعفاتٍ)، ورموزٌ قاتلةٌ تُوقِفُ
  ولا تُعيدُ، و`FIX_REJECTED` يُعيدُ الضبطَ ولا يُضاعِفُ، وساعةٌ رجعَت إلى
  الوراءِ تبثُّ ولا تسكُنُ أبداً.
- **مُرسِلٌ واحدٌ**: `POST /v1/driver/location` القائمُ (`F4-01`) **بلا تعديلِ
  سطرٍ فيه**، ولا مسارَ استقبالٍ ثانٍ — ومُرسِلانِ يقتسمانِ حدَّ المعدَّلِ نفسَه.
- **الكتلةُ المُشوَّهةُ تُسقِطُ القراءةَ** (`MALFORMED_RESULT`): سببٌ من المجموعةِ
  المغلقةِ ومُدّةٌ عددٌ صحيحٌ موجبٌ، وإلّا فلا قبولَ صامتٌ.

**وفارقٌ عن نصِّ الحجزِ يُقالُ لا يُوارى** (`ح-8`): كُتِبَ في الحجزِ أنَّ مدخلَ
القرارِ فيه `lastAcceptedAtMs`، وصارَ في التنفيذِ `lastAttemptAtMs` معَ
`lastError` — لأنَّ الإيقاعَ يُحسَبُ من **آخرِ محاولةٍ** لا من آخرِ قبولٍ، وإلّا
لَتحوَّلَ رفضٌ متكرِّرٌ (`STALE`) إلى بثٍّ متّصلٍ بلا مُهلةٍ. ونصُّ الحجزِ يبقى
مكتوباً كما كانَ.

**وحاجزٌ ساكنٌ بثمانِ قواعدَ** (`scripts/check-location-broadcast-contract.ts`)
لكلِّ واحدةٍ **حالةُ افتراقٍ مزروعةٌ** (`ح-7`): الكتلةُ في الجذرِ في المَخرجَينِ ·
لا مُدّةَ مُخترَعةً ولا اسمَ إعدادٍ في عميلٍ · الغيابُ لا يُقرأُ صفراً والمُشوَّهُ
يُسقِطُ · القرارُ نقيٌّ · السببُ من الخادمِ لا من مقارنةِ حالةٍ في شاشةٍ ·
تراجعٌ بسقفٍ ورموزٌ قاتلةٌ · مُرسِلٌ واحدٌ · ولكلِّ سببِ بثٍّ وسكونٍ نصُّه بثلاثِ
لغاتٍ. **وقاعدةٌ حُسِّنَت في أثناءِ القياسِ**: كانَ فحصُ الرقمِ المُرتَدِّ يقرأُ
جارَ المُعامِلِ وحدَه فيُفلِتُ `const intervalSeconds = published ?? 30` — فصارَ
سطريّاً. والحالةُ السلبيّةُ هيَ التي كشفَته، لا مراجعةُ نظرٍ.

**وحكمُ التشغيلِ كشفَ عطباً حقيقيّاً**: `v_order.status` نوعُه `order_status`
و**لا يُحوَّلُ ضمناً** إلى `text`، فسقطَت قراءةُ المَهمّةِ كلُّها عندَ أوّلِ
مَهمّةٍ حقيقيّةٍ برسالةِ `function ... does not exist`. ولم يرَهُ فحصُ الأنواعِ
ولا الحاجزُ الساكنُ ولا نجاحُ الهجرةِ — رآهُ **اختبارُ تكاملٍ على محرِّكٍ
حقيقيٍّ** وحدَه، فصُبَّ صبّاً صريحاً في النداءَينِ.

**القياسُ بعدَ الإصلاحِ**: تكاملٌ على PostgreSQL 18 محلّيّةٍ ⇒ **16 pass · 0
fail** (ومنها: إعدادٌ محذوفٌ ⇒ `null`، وصفرٌ وسالبٌ ⇒ `null`، وكسرٌ ⇒ أرضيّةٌ،
ومدينةٌ معدومةٌ ⇒ `null` بلا انفجارٍ، وختمُ وصولٍ ⇒ سكونٌ ثمَّ بدءٌ ⇒ `ON_TRIP`،
و`public`/`anon` لا يُنفِّذانِ الدالّةَ قراءةً من الكاتالوجِ) · وحدةُ القرارِ ⇒
**14 pass** · اختبارُ الحاجزِ ⇒ **19 pass** · `typecheck` ⇒ 0 · مجموعةُ الوحدةِ
كامِلةً ⇒ **4435 pass · 1149 skip · 0 fail** ثمَّ أُصلِحَ ما أسقطَه حاجزُ
`rollback-audit` بتسجيلِ مسارِ العودةِ (سحبُ التنفيذِ بعدَ `create or replace`
**إعادةُ قفلٍ لا تضييقٌ جديدٌ**، والعودةُ بالكودِ وحدَه تكفي) · وأرضيّاتُ
التخطّي رُفِعَت **بالزيادةِ** 101/1062 ⇒ 102/1078.

**وما لا يُدَّعى (`ح-5`)**: لا تتبُّعَ حيَّ للراكبِ وعائقُ `F2-06` **يبقى
مفتوحاً** (ADR 0035 §٤) · ولا خريطةَ مُدمَجةً (ADR 0007) · ولا قياسَ للبطاريّةِ
ولا لحُزَمِ البياناتِ · ولا قياسَ سلوكيَّ للإذنِ على مُضيفٍ حقيقيٍّ · ولا نبضةَ
في الخلفيّةِ بعدَ إغلاقِ المصغَّرِ (حدٌّ مُعلَنٌ لا عطبٌ مكتومٌ) · و`مَقيس`
و`مُثبَت` **لا يُدَّعيانِ**، والبندُ يبقى `[~]` حتّى ثلاثِ جولاتِ CI خضراءَ
متتاليةٍ على `main` (`ح-4`).

### وحكمُ CI على `PR #45` — مَدخلُ طبقةِ تلغرامَ واحدٌ (`F3-04` · `ح-8`)

الأخضرُ المحلّيُّ **لم يكن بديلاً** مرّةً أخرى: أخفقَت شغلةُ `verify` بينما مرَّ
**تكاملُ PostgreSQL الحقيقيُّ بستَّ عشرةَ حالةً**، والسببُ سطرٌ واحدٌ:

```
✗ 1 خرقاً لعزلِ طبقةِ تيليجرام (F1-02):
  apps/miniapp/src/surfaces/driver/location/LocationBroadcast.tsx:44
    ← ../../../tg/location.ts
```

**والسببُ الجذريُّ منهجيٌّ لا مطبعيٌّ**: شُغِّلَت محلّيّاً فحوصٌ **مُنتقاةٌ** لا
سلسلةُ `ci` كامِلةً، فلم يُقرأْ `check-telegram-wrapper-isolation`. والمعالجةُ
جزؤها الأوّلُ استيرادٌ من `apps/miniapp/src/tg/index.ts` — المَدخلُ **الوحيدُ**
المسموحُ (`ADR 0031` · القسم 9.2)، وهوَ يُصدِّرُ ما احتاجَتْه الشاشةُ أصلاً فلا
سطرَ يُزادُ في الطبقةِ. وجزؤها الثاني **أنَّ السلسلةَ كامِلةً تُشغَّلُ قبلَ كلِّ
دفعةٍ** ⇒ ثمانيةٌ وستّونَ فحصاً محلّيّاً بلا سقوطٍ واحدٍ.

**والدرسُ يُقالُ صريحاً**: استيرادُ مِلفٍّ داخليٍّ من طبقةِ تغليفٍ يعملُ ويُنجِحُ
كلَّ اختبارٍ — وهوَ بعينِه ما يجعلُ استبدالَ الطبقةِ لاحقاً مستحيلاً بلا مسحِ
مستودعٍ. فالحاجزُ يحرسُ **قابليّةَ الاستبدالِ** لا صحّةَ النداءِ.

## `ح-4` — ثلاثُ جولاتٍ خضراءَ متتاليةٍ: `F3-01` و`F3-02` ⇒ `[x]` (2026-09-15)

قاعدةُ `ح-4` تقولُ: لا `[x]` بلا دليلٍ وسجلٍّ **وثلاثِ جولاتِ CI خضراءَ
متتاليةٍ على `main`**. والجولاتُ قُرِئَت من GitHub لا من ذاكرةٍ:

| # | الجولةُ | الالتزامُ | الحكمُ |
|---|---|---|---|
| ١ | `34929312604` | `88f3473` | success |
| ٢ | `34936675739` | `51ae56f` | success |
| ٣ | `34941645850` | `b6bc232` | success |

**وقبلَها جولةٌ ساقطةٌ** (`34925903150`@`6e228e2`) — فالسلسلةُ **ثلاثٌ بالحدِّ لا
أكثرُ**، والعدَّ يبدأُ من بعدِ السقوطِ لا من أوّلِ دفعةٍ للبندِ. وهذا يُقالُ كي
لا يُقرأَ الرقمُ ثلاثاً وهوَ في الحقيقةِ اثنتانِ.

فرُفِعَ `F3-01` و`F3-02` إلى `[x]`، **وشِفرتُهما داخلةٌ في الجولاتِ الثلاثِ
كلِّها** (كلُّ جولةٍ تُشغِّلُ السلسلةَ كامِلةً على `main` بعدَ الدمجِ لا على
الفرعِ وحدَه).

**والعدُّ الجاريُّ** (يُقرأُ ولا يُفترَضُ): `F3-03` ⇒ **جولتانِ**
(`34936675739` · `34941645850`) فيبقى `[~]` · `F3-04` ⇒ **جولةٌ واحدةٌ**
(`34941645850`) فيبقى `[~]`.

**وما لا يُدَّعى بهذه الترقيةِ (`ح-5`)**: `[x]` تعني **مُنفَّذٌ ومُختبَرٌ
ومُتحقَّقٌ منه بحكمِ CI**، ولا تعني `مَقيس` ولا `مُثبَت عند N`: لا نشرَ حيَّ
(`ADR 0099`) ولا مستخدمَ حقيقيَّ ولا قياسَ حملٍ إنتاجيَّ. وسُلَّمُ الأدلّةِ
يبقى كما هوَ، والبنودُ التي فوقَ `مُتحقَّقٌ منه` **فارغةٌ بإعلانٍ**.

## `F3-05` — الحصيلةُ والأداءُ: **الشفافيّةُ مقامٌ يُنشَرُ لا شِعارٌ** (2026-09-15)

بُنِيَ البندُ `F3-05` (`SD-06` · `SD-09`) على حكمٍ واحدٍ: **شاشةُ أرقامٍ تُقرأُ
على مُشتَغِلٍ أخطرُ من شاشةِ حالةٍ**. الحالةُ الخاطئةُ تُرى فتُشتكى؛ أمّا رقمٌ
خاطئٌ عن رزقِ إنسانٍ فيُقرأُ **حُكماً نهائيّاً** لا يعرفُ صاحبُه كيفَ يُنازعُه،
ولا يسقُطُ به اختبارٌ: كلُّ نداءٍ ناجحٌ وكلُّ `count` يُرجِعُ عدداً (ADR 0120).

- **كسرٌ بمقامِه لا نسبةٌ عارية**: `{numerator, denominator, rate}` و`rate: null`
  عندَ مقامٍ صفرٍ. «نسبةُ قبولِك ٠٪» عن **صفرِ عروضٍ** حكمٌ كاذبٌ على إنسانٍ،
  و«١٠٠٪» من عرضٍ واحدٍ تُقرأُ انتظاماً — **فالمقامُ هوَ المعلومةُ**. والشاشةُ
  تختارُ نصَّها بحُكمٍ مُسمّىً (`UNMEASURED` / `MEASURED`) لا بمقارنةِ أرقامٍ.
- **ومقامُ كلِّ كسرٍ ما يعرفُه صاحبُه**: القبولُ على **العروضِ الواصلةِ إليه**
  (`order_offers` بمعرِّفِه) لا على طلباتِ المدينةِ، والإلغاءُ على **ما قبِلَه**
  لا على ما عُرِضَ عليه.
- **والمالُ غيابٌ مُعلَنٌ بسببِه**: `money {amount: null, basis:
  'NOT_INTERMEDIATED'}` — لا عمودَ أجرةٍ ولا وساطةَ نقدٍ (`ADR 0039` §٤ ·
  `DEC-11`)، والحصيلةُ تُقالُ بما هوَ معلومٌ فعلاً: رحلاتٌ مُكتمِلةٌ وثوانيَ
  تواجدٍ.
- **والنافذةُ تُحسَبُ بمنطقةِ زمنِ المدينةِ في الخادمِ**: `[from, to)` والمنطقةُ
  تُنشَرُ لتُعرَضَ، وغيابُ الإعدادِ `WINDOW_UNRESOLVED` ⇒ `409` **فشلٌ مغلقٌ**.
  ورحلةُ الواحدةِ والنصفِ بعدَ منتصفِ الليلِ حصيلةُ يومِها لا يومِ UTC.
- **والتواجدُ من أزواجِ تبديلِ `attendance_log`** مقصوصاً على الحدِّ وعلى الآنِ
  معَ `open`، لا من عدَّادٍ مخزونٍ.
- **والتقييمُ تراكميٌّ** يستثني المَوسومَ كما يستثنيهِ الإسنادُ، **وعواملُ
  الترتيبِ من نفسِ صفوفِ إعداداتِ المطابَقةِ** معَ `behaviour_affects_ranking:
  false` — حقيقةُ الترتيبِ تُنشَرُ من حيثُ تُحسَبُ لا نصّاً في شاشةٍ.
- **والغيابُ عَدَمٌ في كلِّ طبقةٍ** (ADR 0023): تقييمٌ بلا صوتٍ `null` لا صفرَ
  نجومٍ، ووزنٌ غيرُ مضبوطٍ `null` لا صفراً (صفرٌ **قرارُ مُشغِّلٍ** بالتعطيلِ)،
  ومُدّةٌ بلا ختمِ بدءٍ `null` لا رحلةٌ لحظيّةٌ.
- **ولا هويّةَ راكبٍ في الحصيلةِ ألبتّةَ**: جدولُ الرحلاتِ سجلُّ السائقِ عن
  نفسِه لا عن الناسِ — وأرشيفٌ يُقرأُ في وقفةٍ أسهلُ مكانٍ لتسرُّبِ هويّةٍ.

**والدليلُ**: تسعُ قواعدَ في حاجزٍ ساكنٍ لكلٍّ افتراقٌ مزروعٌ (`ح-7`) · 52 مفتاحاً
بثلاثِ لغاتٍ · 35 حالةَ وحدةٍ · 23 حالةَ تكاملٍ على PostgreSQL حقيقيٍّ.

**ودرسٌ**: أوّلُ تشغيلٍ للحاجزِ أعطى ثلاثَ مخالفاتٍ **كاذبةٍ**، لأنَّ
`telegram_id` مفتاحُ مِلكيّةٍ مشروعٌ في الخادمِ وحرامٌ في العميلِ — فقاعدةٌ
تمنعُه في كلِّ الطبقاتِ تمنعُ الصوابَ. فشُقَّت رموزُ الهويّةِ طبقتَينِ، ولم
يُضعَّفْ حاجزٌ ولم يُسكَتْ اختبارٌ.

**وما لا يُدَّعى (`ح-5`)**: لا مبلغَ يُعرَضُ (عائقٌ مفتوحٌ يُغلَقُ في `SD-08`) ·
ولا تصنيفَ سائقٍ ولا درجةَ ولا وسمَ تحفيزٍ · ولا مقارنةَ بغيرِه · ولا مسافةَ
طريقٍ · ولا ذاكرةَ للتقريرِ · ولا قياسَ أداءٍ على بياناتٍ إنتاجيّةٍ.
**ولا `[x]` قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-4`).** **(2026-09-16): الشرطُ مُستوفى** — عشرُ جولاتٍ خضراءَ متتاليةٍ على `main` (`34953942937` … `35040522114`)، **فقُلِبَ إلى `[x]`**.

## `F3-05` — حُكمُ CI الحقيقيُّ وعطبٌ **نقلَ نفسَه إلى ملفٍّ آخرَ** (2026-09-15)

`PR #47` دُفِعَ فسقطَ جوبٌ واحدٌ من خمسةٍ: **«تكامل على PostgreSQL حقيقي»**
(الجولتانِ `34949519499` · `34949531944`)، والأربعةُ الباقيةُ خضراءُ. والحكمُ
قُرِئَ من الشغلةِ لا من الأخضرِ المحلّيِّ — والأخضرُ المحلّيُّ كانَ كامِلاً
(68 خطوةً · 4494 فحصَ وحدةٍ · 23 فحصَ تكاملٍ للبندِ)، فهذا **بيانُ حدٍّ**
لِـ`ح-6` لا شكوى: قاعدةٌ محلّيّةٌ لها تاريخٌ ليست قاعدةً نظيفةً.

**نصُّ السقوطِ**: `مهامّ فشلت: expire-offers:…={"sum":1.2,"code":
"INCONSISTENT_WEIGHTS"}` في **ملفٍّ ليسَ ملفَّ البندِ** (`scheduled-jobs`)،
مكرَّراً في ستَّةِ فحوصٍ.

**السببُ الجذريُّ** (أُعيدَ إنتاجُه محلّياً أوّلاً، ثمَّ قُرِئَ في الشيفرةِ):
`tests/integration/driver-activity.test.ts` كانَ يُبدِّلُ إعداداتَ المدينةِ
لفحصِ الغيابِ ثمَّ يُرجِعُ في `finally` **قيمةً مُخترَعةً** لا القيمةَ الأصليّةَ:
كتبَ `match_weight_preferred_area = 0.2` حيثُ كانَ `0` بذراً، و
`rating_min_count_for_trust = 5` حيثُ كانَ `3`. فصارَ مجموعُ أوزانِ المطابَقةِ
`0.7 + 0.3 + 0.2 = 1.2`، فرفضَ محمِّلُ الإعداداتِ لقطةَ المدينةِ رفضاً صحيحاً
(`InconsistentWeightsError`) — **فالحاجزُ لم يُخطئْ، الاختبارُ أخطأَ**، وأخطأَ
بطريقةٍ تُسقِطُ **عملَ غيرِه**.

**الإصلاحُ — في الجذرِ لا في العَرَضِ** (ولا تخفيفَ فحصٍ ولا `skip` ولا نقلَ
مشكلةٍ):

| # | ما تمَّ | لماذا هكذا |
|---|---|---|
| ١ | `snapshotSetting(key)` تُلقِطُ الحالَ **قبلَ** التبديلِ: القيمةَ ونوعَها أو **غيابَ الصفِّ** | «إرجاعُ ما كانَ» يستلزمُ **معرفةَ** ما كانَ؛ وما لم يكن صفّاً يُحذَفُ لا يُكتَبُ صفراً |
| ٢ | القراءةُ **مُقشَّرةً** (`value #>> '{}'`) لا `value::text` | `value::text` يُعيدُ نصَّ JSON (`"Asia/Riyadh"` بتنصيصٍ)، ورَدُّه معامِلاً يُغلَّفُ ثانيةً — **قِيسَ**: صارَ `"\"\\\"Asia/Riyadh…` بعدَ تشغيلَينِ. فالكتابةُ بمصدرٍ واحدٍ هوَ `setSetting` |
| ٣ | `withSetting(key, value, type, body)` تُبدِّلُ ثمَّ تُرجِعُ في `finally` **قطعاً** | ثلاثةُ `try/finally` مكتوبةٍ بأيدٍ صارت واحدةً — التكرارُ هوَ ما سمحَ بالخطأِ أوّلاً |
| ٤ | `afterAll` يُقارِنُ **بصمةَ كلِّ إعداداتِ المدينةِ** قبلَ الملفِّ وبعدَه ويسقُطُ إن اختلفَت | **إنفاذٌ آليٌّ**: مَن يُبدِّلُ إعداداً يُثبِتُ بنفسِه أنَّه أرجعَه، فلا يُقرأُ العطبُ عطبَ ملفٍّ آخرَ مرّةً أخرى |

**والحاجزُ أُثبِتَ بافتراقٍ مزروعٍ** (`ح-7`): حُقِنَ التلويثُ مؤقّتاً في
`finally` فسقطَ الملفُّ **14 فحصاً** ومعَه بصمةُ الإعداداتِ؛ ورُدَّ الإصلاحُ
فعادَ **23/23**. فالحاجزُ **مقروءٌ ساقطاً** لا مفترَضاً.

**القياسُ بعدَ الإصلاحِ** (لا قبلَه): `driver-activity` 23/23 ·
`scheduled-jobs` 8/8 (كانَ 6 ساقطةً) · الوحدةُ **4494 نجاحاً / 0 سقوطاً** ·
68 خطوةَ سلسلةِ CI `rc=0` · بوابةُ التغطيةِ `0` · **التكاملُ كاملاً (100 ملفّاً)
في شوطَينِ**: 473/474 و499/501، والسواقطُ الثلاثةُ **معروفةٌ محلّيّاً لا في CI**
(`hot-query-index-plans` و`safe-migration-runner` على PG18 · وانقضاءُ مهلةِ 5s
في `unmatched-escalation` تحتَ تزاحمٍ محلّيٍّ — يمرُّ منفرداً 11/11).

**وحكمُ CI بعدَ الدفعِ** (الجوبُ الساقطُ صارَ أخضرَ، والخمسةُ خضراءُ):
`34952523795` — `verify` · `تكامل على PostgreSQL حقيقي` (2m52s) ·
`تكامل على Redis حقيقي` · `فوضى متعدد المثيلات (F5-06)` — و`roadmap`
(`34952523844`). فدُمِجَ `PR #47` بـsquash (`f63457e`)، **وجولةُ `main` عليه
خضراءُ في جوباتِها الأربعةِ** (`34953942937`).

## `ح-4` — العدُّ يُقرأُ لا يُفترَضُ: `F3-03` و`F3-04` ⇒ `[x]` (2026-09-15)

الجولاتُ قُرِئَت من GitHub بجوباتِها لا بحُكمِها الأعلى وحدَه، وكلُّ جولةٍ
تُشغِّلُ السلسلةَ كامِلةً على `main` **بعدَ الدمجِ**:

| # | الجولةُ | الالتزامُ | الحكمُ | تحتوي `F3-03`؟ | تحتوي `F3-04`؟ |
|---|---|---|---|---|---|
| ١ | `34936675739` | `51ae56f` | success | نعم (دخلَ فيه) | لا |
| ٢ | `34941645850` | `b6bc232` | success | نعم | نعم (دخلَ فيه) |
| ٣ | `34943317132` | `4033ca1` | success | نعم | نعم |
| ٤ | `34953942937` | `f63457e` | success | نعم | نعم |

فـ`F3-03` بلغَ **ثلاثاً** (الجولاتُ ١·٢·٣) و`F3-04` بلغَ **ثلاثاً** (٢·٣·٤)،
وكلتا السلسلتَينِ **متّصلةٌ بلا جولةٍ ساقطةٍ بينَها** — فرُفِعا إلى `[x]`.

**والعدُّ الجاريُّ** (يُقرأُ ولا يُفترَضُ): `F3-05` ⇒ **عشرُ جولاتٍ خضراءَ متتاليةٍ** على `main` (`34953942937` … `35040522114`) — **فقُلِبَ إلى `[x]` (2026-09-16)**. والسطرُ الأصليُّ («جولةٌ واحدةٌ») صحيحٌ في وقتِه ومنسوخٌ الآنَ.

---

## `F3-06` — لوحُ اشتراكِ السائقِ: **السعرُ من `platform_settings` لا ثابتٍ** (2026-09-15)

بُنِيَ البندُ `F3-06` (`SD-07`) على حكمٍ واحدٍ: **أنَّ كلَّ مَعطياتِ اللوحِ
من القاعدةِ لا من كودٍ**. `GET /v1/driver/subscription` يَقرأُ
`driver_subscription_dashboard` التي تُجمِعُ الحالَ والخطةَ والسعرَ من
`platform_settings` وأيّامَ الصلاحيةِ والتحذيرَ قبلَ الانتهاءِ وحالَ الإلغاءِ.
و`GET /v1/driver/subscription/history` يَقرأُ `driver_subscription_history`
لآخرِ الدفعاتِ بسقفٍ خادميٍّ (١…٥٠). **والتجديدُ «ابدأِ الدفعَ» لا «أكملِه»**:
`POST /v1/driver/subscription/renew` يُعيدُ استخدامَ `subscribePlan` القائمِ
الذي يقرأُ السعرَ من `priceReader` ويُنشئُ معاملةَ دفعٍ بمفتاحِ
إيديمبوتنسيّةٍ، وعندَ غيابِ المزوّدِ ⇒ `PAYMENT_PROVIDER_NOT_AVAILABLE` `503` —
**فشلٌ مغلقٌ** لا نجاحٌ كاذبٌ.

والملكيّةُ في القاعدةِ: `USER_NOT_FOUND` و`NOT_A_DRIVER` من الدالّتَينِ لا من
الطبقةِ. و٩ رموزِ عطبٍ منشورةٍ، و٥٧ مفتاحاً بثلاثِ لغاتٍ (٧٩٢ ← ٩٠٥)، و٤٤ قاعدةَ
نمطٍ ببادئةِ `dsub`. وحاجزٌ ساكنٌ **بخمسِ قواعدَ** لكلٍّ افتراقٌ مزروعٌ (`ح-٧`)،
و١٤ حالةَ وحدةٍ و١٣ حالةَ تكاملٍ (تُتخطّى بلا `TEST_DATABASE_URL`).

**وما لا يُدَّعى (`ح-5`)**: الهجرةُ لم تُطبَّقْ على قاعدةٍ حقيقيّةٍ في هذه الجلسةِ،
والتجديدُ لم يُختَبرْ بمزوّدِ دفعٍ حقيقيٍّ — المزوّدُ اليدويُّ يُرجِعُ `pending`
بلا `checkoutUrl`. ولا `[x]` قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-٤`). **(2026-09-16): الشرطُ مُستوفى** — ثماني جولاتٍ خضراءَ متتاليةٍ على `main` (`34987624903` … `35040522114`)، **فقُلِبَ إلى `[x]`**.

**وما لا يُدَّعى (`ح-5`)**: `[x]` ههنا تعني **مُنفَّذٌ ومُختبَرٌ ومُتحقَّقٌ منه
بحكمِ CI** ولا تعني `مَقيس` ولا `مُثبَت عند N`: لا نشرَ حيَّ (`ADR 0099`) ولا
سائقَ حقيقيَّ ولا جهازَ حقيقيَّ ولا قياسَ حملٍ إنتاجيَّ. **وعائقُ `F2-06` يبقى
مفتوحاً** و**زيادةُ استغاثةِ السائقِ ديناً مُعلَناً** — الترقيةُ لا تمسُّهما.

## `F3-07` — مركبتي + الشعارُ والباركودُ: **العرضُ والتحديثُ في ثلاثةِ مساراتَ** (2026-09-15)

بُنِيَ البندُ `F3-07` (`SD-11`) على حكمٍ واحدٍ: **أنَّ مركبةَ السائقِ ووثائقِها الثلاثَ
تُجمَعُ في نداءٍ واحدٍ من القاعدةِ**. `GET /v1/driver/vehicle` يَقرأُ `driver_vehicle`
التي تُجمِعُ النوعَ واللوحةَ وسنةَ الصنعِ والشعارَ والباركودَ وحالاتِ الوثائقِ الثلاثِ
(رخصةُ السيرِ، التأمينُ، الفحصُ الفنّيُّ) وتواريخَ انتهائِها. و`PATCH /v1/driver/vehicle`
يُحدِّثُ النوعَ واللوحةَ والسنةَ، و`POST /v1/driver/vehicle/assets` يُحدِّثُ مسارَي الشعارِ
والباركود.

والملكيّةُ في القاعدةِ: `USER_NOT_FOUND` و`NOT_A_DRIVER` من الدوالِّ الثلاثِ لا من
الطبقةِ. **وسنةُ الصنعِ تُتحقَّقُ منها** في الطبقةِ (`validateVehicleYear` بحدودٍ
`VEHICLE_YEAR_MIN`/`MAX`). **والبنيةُ القائمةُ تُعادُ**: `vehicle_type` و`plate_number`
موجودانِ مسبقًا، `vehicle_photo_file_id` من `F3-01`، `driver_documents` يخدمُ الوثائقَ
الثلاثَ، `MiniAppSessionReader` يُعادُ استخدامُه. و٧ رموزِ عطبٍ منشورةٍ، و٤٩ مفتاحاً
بثلاثِ لغاتٍ (٩٠٥ ← ٩٥٤)، وبادئةُ `dveh` مُسجَّلةٌ في `DECLARED_BLOCKS`. وحاجزٌ ساكنٌ
**بخمسِ قواعدَ** لكلٍّ افتراقٌ مزروعٌ (`ح-٧`)، و١٠ اختباراتِ وحدةٍ و١٣ حالةَ تكاملٍ
(تُتخطّى بلا `TEST_DATABASE_URL`).

**وسجلُ العقدِ (`schema-contract.ts`)**: الدوالُ الثلاثُ `driver_vehicle` و
`update_driver_vehicle` و`update_driver_vehicle_assets` مُسجَّلةٌ في `CONTRACT_FUNCTIONS`
لِتُطبَّقَ عليها بوابةُ عقدِ المخطّط (`ح-٣`).

**وما لا يُدَّعى (`ح-5`)**: الهجرةُ لم تُطبَّقْ على قاعدةٍ حقيقيّةٍ، ولا `[x]` قبلَ ثلاثِ
جولاتِ CI خضراءَ متتاليةٍ (`ح-٤`).

### تصحيحٌ بالإضافةِ (`ح-8`) — حكمُ CI على `PR #50` أسقطَ التكاملَ، والسببُ **نوعٌ كاذبٌ في عقدِ خرجٍ** (`ADR 0121` · 2026-09-15)

**حكمُ CI الأوّلُ** ([تشغيلُ 35005161181](https://github.com/uxxxug/ceezr/actions/runs/35005161181)):
`verify` أخضرُ · `تكامل على Redis حقيقي` أخضرُ · `فوضى متعدد المثيلات (F5-06)` أخضرُ ·
`Roadmap freshness` أخضرُ · **`تكامل على PostgreSQL حقيقي` أحمرُ** على حالةٍ واحدةٍ:

```
tests/integration/driver-vehicle.test.ts
  Expected: "2027-01-01"   Received: undefined
```

**والسببُ الجذريُّ عطبُ منتَجٍ لا عطبُ اختبارٍ**: الهجرةُ أعلنَت تواريخَ انتهاءِ
الوثائقِ الثلاثِ في عقدِ خرجِ `driver_vehicle` بنوعِ `date`، وسائقُ `postgres.js`
يُحوِّلُ `date` إلى كائنِ `Date` عندَ منتصفِ ليلِ UTC، ودالّةُ `readDate` في
`PostgresDriverVehicleStore` عقدُها `string | null` فتقرأُ الكائنَ **عَدَماً** بلا
خطأٍ ولا سجلٍّ. أي أنَّ **شاشةَ مركبتي كانت تُخفي انتهاءَ رخصةِ السيرِ والتأمينِ
والفحصِ الفنّيِّ** — وهيَ الحقيقةُ التي تحجُبُ السائقَ عن العملِ (`ADR 0115`) —
ولم يكشِفْها إلّا اختبارُ تكاملٍ على قاعدةٍ حقيقيّةٍ. والاختبارُ كانَ صادقاً،
فلم يُخفَّفْ.

**والعلاجُ في الجذرِ ثمَّ في الجنسِ كلِّه**:

| ما عُمِلَ | الموضعُ |
|---|---|
| العقدُ يُعلِنُ `text` والقراءةُ `to_char(x,'YYYY-MM-DD')` للتواريخِ الثلاثِ | `supabase/migrations/20260915170000_f3_07_driver_vehicle.sql` |
| حاجزٌ ساكنٌ يمسحُ **١٣٤ هجرةً** ويُسقِطُ البناءَ على أيِّ عمودِ `date` في `returns table( … )` | `scripts/lib/date-only-boundary.ts` · `scripts/check-date-only-boundary.ts` |
| ١٠ حالاتِ وحدةٍ بسالباتٍ مزروعةٍ — منها **العقدُ الذي أسقطَ CI** (`ح-7`) | `tests/unit/check-date-only-boundary.test.ts` |
| خطوتانِ مُسمّاتانِ في `verify` + سلسلةُ `ci` + مُختصرُ `check:date-only-boundary` | `.github/workflows/ci.yml` · `package.json` |
| القرارُ وبديلُه المرفوضُ (تنسيقُ `Date` في المحوِّلِ) مكتوبانِ | `docs/adr/0121-a-bare-date-crosses-the-boundary-as-text.md` |

**وقياسٌ جديدٌ صارَ ممكناً في الصندوقِ (ما كانَ يُتخطّى)**: نُصِّبَ PostgreSQL 18 مع
PostGIS 3.6 محليّاً، وطُبِّقَت الهجراتُ الـ١٣٤ بـ`scripts/migrate.ts` نفسِه الذي
يُطبِّقُ في CI (`ADR 0068`)، فجرَت اختباراتُ التكاملِ على قاعدةٍ حقيقيّةٍ قبلَ الدفعِ:
`tests/integration/driver-vehicle.test.ts` **٩ من ٩ خضراءُ**. وهذا لا يُبطِلُ الحكمَ:
**حكمُ CI هوَ الحاكمُ** (`ح-6`) لأنَّ خادمَ CI إصدارُه ١٧ لا ١٨.

**وما لا يُدَّعى (`ح-5`)**: حالةُ `tests/integration/migration-applier.test.ts` (`F7-07`)
أخفقَت محليّاً بمهلةِ خُطّافٍ (٥ ثوانٍ) — وهذا صنفٌ مُرجَعٌ سابقاً إلى بيئةِ الصندوقِ
لا إلى منطقِ البندِ، ولم يُمَسَّ الاختبارُ ولا مهلتُه؛ حكمُ CI عليه يُقرأُ ويُدوَّنُ.
ولا `[x]` على `F3-07` قبلَ حكمِ CI أخضرَ (`ح-4`).

### تصحيحٌ بالإضافةِ (`ح-8`) — التكاملُ لم يسقُط بل **علَّقَ**: وعدٌ لا يُحسَمُ في اختبارٍ (`ADR 0122` · 2026-09-15)

**حكمُ CI الثانِ** ([تشغيلُ 35013549945](https://github.com/uxxxug/ceezr/actions/runs/35013549945)):
`verify` أخضرُ (بحاجزِ `ADR 0121` الجديدِ فيه) · `تكامل على Redis حقيقي` أخضرُ ·
`فوضى متعدد المثيلات (F5-06)` أخضرُ · `Roadmap freshness` أخضرُ ·
**`تكامل على PostgreSQL حقيقي` لا أخضرُ ولا أحمرُ: بقيَ `in_progress` أكثرَ من ساعةٍ**
وأطولُ تشغيلٍ ناجحٍ مقيسٍ لهذه الوظيفةِ ≈ **٣ دقائقَ**
([تشغيلُ 34987213472](https://github.com/uxxxug/ceezr/actions/runs/34987213472)).

**والسببُ الجذريُّ**: بعدَ تصحيحِ `ADR 0121` صارَ اختبارُ
`tests/integration/driver-vehicle.test.ts` يجتازُ تسعَ حالاتٍ ثمَّ **يتوقّفُ عندَ
العاشرةِ إلى الأبدِ** — وهيَ الحالةُ التي مرَّرَت وسمَ `sql` **خامّاً** إلى
`expect(…).rejects`. ووسمُ استعلامِ `postgres.js` **مُرجَأٌ لا وعدٌ منطلقٌ**: لا
يُرسَلُ حتّى يُنادى `then`، ومُطابِقُ الرفضِ لا يُناديه؛ فلا استعلامَ يُرسَلُ، ولا
وعدَ يُحسَمُ، ولا اختبارَ يسقطُ. **والتعليقُ الصامتُ أسوأُ من الأحمرِ: الأحمرُ يقولُ
أينَ.** ولمَّا كانَ الخطأُ الأوّلُ (`ADR 0121`) يُسقِطُ الحالةَ **الأولى** من الملفِّ،
لم تُبلَغِ الحالةُ العاشرةُ أصلاً — فالتعليقُ كانَ **مستوراً بعطبٍ آخرَ**.

**وكيفَ قِيسَ نصّاً لا تخميناً**: `pg_stat_activity` أظهرَ الاتّصالَ `idle` وآخرَ
استعلامٍ مُنفَّذٍ هوَ **الذي قبلَ** الحالةِ العاشرةِ، والعمليّةُ تدورُ بلا عملٍ؛ ثمَّ
مُسِحَ **كلُّ** ملفِّ تكاملٍ (١٠٢ ملفّاً) بمهلةٍ قسريّةٍ واحداً واحداً حتّى ردَّ ملفٌّ
واحدٌ الرمزَ `124`. وبعدَ الإصلاحِ: **١٣ من ١٣ خضراءُ والعمليّةُ تخرُجُ** في ٨٢ مِلّي.

**والعلاجُ في الجذرِ ثمَّ في الجنسِ كلِّه ثمَّ في المنصّةِ**:

| ما عُمِلَ | الموضعُ |
|---|---|
| الحالتانِ تُمرِّرانِ **وعداً منطلقاً** (نتيجةَ `updateVehicle` و`updateAssets`) لا وسمَ قالبٍ | `tests/integration/driver-vehicle.test.ts` |
| حاجزٌ ساكنٌ يمسحُ **٣٦٢ ملفَّ اختبارٍ** ويُسقِطُ البناءَ على أيِّ وسمِ قالبٍ داخلَ `expect(…)` | `scripts/lib/lazy-query-assertion.ts` · `scripts/check-lazy-query-assertion.ts` |
| ١٠ حالاتِ وحدةٍ بسالباتٍ مزروعةٍ — منها **الحالةُ التي علَّقَت CI** — ومُوجباتٍ (`await sql`، نداءُ دالّةٍ، تعليقٌ) (`ح-7`) | `tests/unit/check-lazy-query-assertion.test.ts` |
| **سقفُ زمنٍ لكلِّ وظيفةٍ**: `verify` ٢٠د · التكاملُ ٢٥د · Redis ١٥د — فأيُّ تعليقٍ قادمٍ يصيرُ **أحمرَ مُسمّىً** لا صمتاً | `.github/workflows/ci.yml` |
| خطوتانِ مُسمّاتانِ في `verify` + سلسلةُ `ci` + مُختصرُ `check:lazy-query-assertion` | `.github/workflows/ci.yml` · `package.json` |
| القرارُ وبديلاهُ المرفوضانِ (السقفُ وحدَه · الحاجزُ وحدَه) مكتوبانِ | `docs/adr/0122-a-deferred-query-is-not-a-promise.md` |

**وما قِيسَ محليّاً قبلَ الدفعِ**: `bun test` كاملاً — **٤٥٣٨ ناجحةً · ٠ ساقطةً** (منها
عشرُ حالاتِ الحاجزِ الجديدِ) · `lint` و`typecheck` نظيفانِ · ترقيمُ القراراتِ ١٢٢ فريداً ·
ميزانُ التوثيقِ ٠٫٤٣١ والسقفُ ٠٫٧٥ · والحاجزُ الجديدُ **قِيسَ على النصِّ التاريخيِّ**
فردَّ خرقَينِ في السطرَينِ ٢٣٢ و٢٣٨ من الملفِّ **قبلَ** إصلاحِه.

**وما لا يُدَّعى (`ح-5`)**: هذا التصحيحُ **يُبطِلُ حكمَ التشغيلِ الثانِ ولا يُتِمُّه**؛
لا `[x]` على `F3-07` قبلَ حكمِ CI أخضرَ على الدفعةِ الجديدةِ (`ح-4` · `ح-6`)، ولا يُدَّعى
أنَّ التعليقَ كانَ **الخرقَ الأخيرَ** في الملفِّ — يُقرأُ الحكمُ ويُدوَّنُ كما وقعَ.

### تصحيحٌ بالإضافةِ (`ح-8`) — فحصانِ **صحيحانِ منتجاً وكاذبانِ قياساً**: نافذةٌ رهنَ ساعةِ الحائطِ (`ADR 0123` · 2026-09-15)

**حكمُ CI الثالثُ** ([تشغيلُ 35024571423](https://github.com/uxxxug/ceezr/actions/runs/35024571423)):
`verify` أخضرُ في ١م٥٦ث (بحاجزَي `ADR 0121` و`ADR 0122` فيه) · `تكامل على Redis حقيقي`
أخضرُ · `فوضى متعدد المثيلات (F5-06)` أخضرُ · `Roadmap freshness` أخضرُ ·
**`تكامل على PostgreSQL حقيقي` أحمرُ في ٢م٤٢ث** — لا معلَّقاً. فحاجزُ `ADR 0122` عملَ:
الوظيفةُ رَكَضَت إلى نهايتِها لأوّلِ مرّةٍ فقالت **أينَ**:
**١٠٠٤ ناجحةً · ٢ ساقطةً · ١٠٠٦ حالةً في ١٠٣ ملفّاتٍ [١٤٥٫١٣ث]**.

**والساقطتانِ كِلتاهُما في `tests/integration/driver-activity.test.ts`**:

| الفحصُ | المتوقَّعُ | المقيسُ |
|---|---|---|
| `١٩) نافذةٌ جاريةٌ وسائقٌ متاحٌ ⇒ open صادقةٌ` | تواجدٌ `> 1500` ثانيةٍ | **١١٠٠** |
| `٢٣) الجدولُ مرتَّبٌ بالأحدثِ أوّلاً` | صفّانِ | **واحدٌ** |

**والسببُ الجذريُّ**: الدورةُ كانت عندَ **٢١:١٨Z** — أي **٠٠:١٨ بتوقيتِ الرياضِ**.
والملفُّ كانَ يُثبِّتُ `city_timezone` على `Asia/Riyadh` **حرفاً**، ثمَّ يزرعُ تبديلَ
تواجدٍ عندَ `now() - 30 min` ورحلةً عندَ `now() - 2h` ويقرأُ نافذةَ `day`. ونافذةُ اليومِ
تبدأُ عندَ **منتصفِ ليلِ المدينةِ**، فعمرُها حينَها ١٨ دقيقةً: فقُصَّ التواجدُ على حدِّها
(١١٠٠ ثانيةً بالحرفِ) وسقطَت الرحلةُ الأقدمُ خارجَها. **فالمنتَجُ صادقٌ والقياسُ كانَ
رهنَ ساعةِ الحائطِ**: يمرُّ نهاراً ويسقطُ بعدَ منتصفِ الليلِ. وقد **أُعيدَ إنتاجُ العطبِ
محليّاً** عندَ ٠٠:٣٢ بتوقيتِ الرياضِ قبلَ أن يُمَسَّ حرفٌ — الفحصُ ٢٣ ساقطاً بالرقمِ نفسِه.

**وعطبٌ ثانٍ وراءَه في السقالةِ**: `withSetting` كانَ يُرجِعُ في `finally` **لقطةَ مطلعِ
الملفِّ** لا قيمةَ لحظةِ ندائِه، فتثبيتُ `beforeAll` يُمحى عندَ أوّلِ
`withSetting(KEY_TIMEZONE, null, …)` في الفحصِ الرابعِ — أي أنَّ تثبيتَ المنطقةِ وحدَه
**ما كانَ ليكفي**، وقد قِيسَ ذلكَ: بقيَ الفحصُ ٢٣ ساقطاً حتّى صُحِّحَ الإرجاعُ.

**والعلاجُ في الجذرِ ثمَّ في الجنسِ كلِّه**:

| ما عُمِلَ | الموضعُ |
|---|---|
| منطقةُ الزمنِ **تُحسَبُ** من ساعةِ القاعدةِ (`Etc/GMT±N`) ليقعَ «الآنَ» **وسَطَ** اليومِ المحليِّ — وتُقاسُ الساعةُ بعدَ التثبيتِ لا يُوثَقُ بالاسمِ | `tests/integration/driver-activity.test.ts` |
| `beforeAll` **يُثبِتُ بُعدَ الحدَّينِ** (≥ ٤ ساعاتٍ) ويرمي خطأً مقروءاً وإلّا — شرطُ قياسٍ لا إخفاقُ منتَجٍ | الملفُّ نفسُه |
| `withSetting` يُرجِعُ **قيمةَ اللحظةِ** (`readSetting`) وذاكرةُ اللقطاتِ لحالِ المطلعِ وحدَه | الملفُّ نفسُه |
| **الأرقامُ المتوقَّعةُ لم تُخفَّفْ**: `> 1500` و`toHaveLength(2)` كما هُما | الملفُّ نفسُه |
| حاجزٌ ساكنٌ يمسحُ **٣٦٣ ملفَّ اختبارٍ**: منطقةُ زمنٍ مكتوبةٌ حرفاً في **كتابةِ إعدادٍ** داخلَ ملفٍّ يقرأُ نافذةً محليّةً ⇒ سقوطُ `verify` — ويقرأُ الكتابةَ **كتلةً** فيلتقطُ `insert` متعدّدَ الأسطرِ | `scripts/lib/wall-clock-window-tests.ts` · `scripts/check-wall-clock-window-tests.ts` |
| ١٢ حالةَ وحدةٍ: سالباتٌ مزروعةٌ — منها **السطرُ ٣٣٤ الذي أسقطَ CI** — ومُوجباتٌ (منطقةٌ معامِلاً لدالّةٍ خالصةٍ · منطقةٌ محسوبةٌ · `null` · تعليقٌ · رخصةٌ مُعلَنةٌ بسببٍ) (`ح-7`) | `tests/unit/check-wall-clock-window-tests.test.ts` |
| خطوتانِ مُسمّاتانِ في `verify` + سلسلةُ `ci` + مُختصرُ `check:wall-clock-window-tests` | `.github/workflows/ci.yml` · `package.json` |
| القرارُ وبدائلُه المرفوضةُ (تخفيفُ الرقمِ · تخطٍّ ليليٌّ · `p_now` معامِلاً في سطحِ الإنتاجِ) مكتوبةٌ | `docs/adr/0123-a-local-window-is-not-the-wall-clock.md` |

**وما قِيسَ محليّاً قبلَ الدفعِ**: `tests/integration/driver-activity.test.ts` **٢٣ من ٢٣
خضراءُ عندَ ٠٠:٤٠ بتوقيتِ الرياضِ** — أي عندَ الساعةِ نفسِها التي أسقطَتها في CI ·
حاجزُ النافذةِ الجديدُ **قِيسَ على النصِّ التاريخيِّ** فردَّ الخرقَ في السطرِ ٣٣٤ من
الملفِّ **قبلَ** إصلاحِه · ١٢ حالةَ وحدةٍ خضراءُ · والمسحُ على المستودَعِ كلِّه نظيفٌ.

**وما لا يُدَّعى (`ح-5`)**: لم يتغيّر حرفٌ من الهجرةِ — العطبُ كانَ في **القياسِ** لا في
**المقيسِ**، ولا يُدَّعى أنَّ حسابَ النافذةِ صُحِّحَ (هوَ صحيحٌ ومقيسٌ أصلاً). ولا `[x]`
على `F3-07` قبلَ حكمِ CI أخضرَ على الدفعةِ الجديدةِ (`ح-4` · `ح-6`).

### حكمُ CI على `F3-07` — أخضرُ مقروءٌ، ودمجٌ، وجولتانِ من ثلاثٍ (`ح-4` · `ح-6`)

**الجولةُ الأولى الخضراءُ — الفرعُ `feat/f3-07-driver-vehicle` على `30a70d7`،
تشغيلُ [35027998264](https://github.com/uxxxug/ceezr/actions/runs/35027998264)**:
`verify` ✅ ١م٥٩ث · `تكامل على PostgreSQL حقيقي` ✅ **٣م٧ث** · `تكامل على Redis حقيقي`
✅ ٣١ث · `فوضى متعدد المثيلات (F5-06)` ✅ ١م٥ث · `Roadmap freshness` ✅ ١٤ث — بلا خطوةٍ
ساقطةٍ. فالوظيفةُ التي علَّقَت ساعةً ثمَّ سقطَت بفحصَينِ **تمرُّ الآنَ في ثلاثِ
دقائقَ**، والأرقامُ المتوقَّعةُ كما كانت.

**فدُمِجَ الطلبُ `#50`** ضغطاً إلى `main` (`0b5d1bf`) — والفرعُ حُذِفَ بعدَ الدمجِ.

**الجولةُ الثانيةُ الخضراءُ — `main` على `0b5d1bf`، تشغيلُ
[35028339423](https://github.com/uxxxug/ceezr/actions/runs/35028339423)**: ناجحٌ،
ومعَه `Roadmap freshness` (`35028339432`) ✅.

**فحالُ `F3-07` يبقى `[~]`**: جولتانِ من ثلاثٍ، والثالثةُ تُقرأُ على `main` ولا
تُفترَضُ (`ح-4`).

**وما لا يُدَّعى (`ح-5`)**: لا سائقٌ حقيقيٌّ حدَّثَ مركبتَه على جهازٍ، ولا نشرَ حيَّ،
ولا وصولَ (`a11y`) مقيسٌ.

**وملاحظةٌ محليّةٌ لا تُخفى**: في صندوقِ العملِ (PostgreSQL 18، خلافَ ١٧ في CI) سقطَت
حالةُ `F7-02` `audit_log_action_entity_idx` لأنَّ المُخطِّطَ — عندَ إسقاطِ الفهرسِ
المركَّبِ — ينحدرُ إلى `Index Scan` على `audit_log_entity_idx` لا إلى `Seq Scan`؛
وحالتا `CAP-003` تنجحانِ منفردتَينِ وتسقطانِ بمهلةِ خطّافٍ تحتَ ازدحامِ نواتَينِ.
وكلُّهنَّ **خضراءُ في CI على العشرةِ نفسِها** — فلا تُمَسُّ، وحكمُ CI هوَ الحاكمُ
(`ح-6`).

**والفرعُ `chore/h4-f3-03-f3-04-green-runs` مهجورٌ ومُستَنفَدٌ**: هو خلفَ `main`
تماماً، ودمجُه يُرجِعُ `F3-06`، وعمَلُه الوحيدُ حلَّ في الطلبِ `#48`. **فلا يُدمَجُ
أبداً**، ويُقرأُ هذا السطرُ سجلَّه.

### حجزُ نطاقِ `F3-08` — `SD-10` دعمُ السائقِ و`SD-12` حسابُه (فُتِحَ 2026-09-16 قبلَ أوّلِ تعديلِ ملفٍّ)

حُجِزَ قبلَ أوّلِ تعديلٍ وفقَ قاعدةِ الحجزِ في `docs/ROADMAP-MASTER.md` §25.
الحاكمُ: `SD-10` (§«الدعم»: **نفسُ `SR-11` بأصنافِ السائقِ** — خصمٌ، اشتراكٌ، راكبٌ
مسيءٌ، مركبةٌ) · `SD-12` (§«حسابي»: اللغةُ، الإشعاراتُ، المنطقةُ، إضافةٌ إلى الشاشةِ
الرئيسةِ، الخصوصيّةُ، حذفُ الحسابِ) · `ADR 0114` (المرجعُ منطوقٌ تُولِّدُه القاعدةُ) ·
`ADR 0078` (لا نصَّ إنسانٍ في سجلِّ تطبيقٍ) · القاعدةُ 0.3 (لا رقمَ عملٍ صلباً) ·
القاعدةُ 0.5 (الحكمُ في المحرِّكِ) · `م13-7` (لا خانةَ دفعٍ محجوزةً).

**الحالةُ الفعليّةُ المقروءةُ من `main`@`f414500` لا من تقريرٍ** — وهيَ سببُ شكلِ هذا
الحجزِ:

- `support_ticket_type` في القاعدةِ يحملُ اليومَ `subscription, ride_dispute,
  lost_item, driver_conduct, app_problem, other`. **فأصنافُ السائقِ الثلاثةُ
  الباقيةُ غائبةٌ**: الخصمُ، والراكبُ المسيءُ، والمركبةُ. و`subscription` **موجودٌ
  أصلاً** وتردُّه القاعدةُ للراكبِ بـ`NOT_A_DRIVER` — فهوَ بابُ السائقِ مفتوحاً في
  المحرِّكِ ومغلقاً في الواجهةِ.
- `open_support_ticket(p_telegram_id, p_type, p_message, p_file_id, p_order_id)`
  **لا دورَ في توقيعِها**: تُستنبَطُ الهويّةُ من صفِّ صاحبِ الحسابِ. **فتُعادُ
  استعمالاً لا تُنسَخُ.**
- `rider_support_tickets(…)` قراءةٌ **خاصّةٌ بالراكبِ** ترفضُ بـ`NOT_A_RIDER` —
  فقراءةُ تذاكرِ السائقِ **تحتاجُ نظيرَها** ولا تُقضى بتخفيفِ شرطِ الأولى.
- `POST/GET /v1/support/tickets` قائمانِ ولا يذكرانِ دوراً في عنوانِهما
  (`§ROADMAP-MASTER` جدولُ الواجهةِ يُسندُهما إلى `SR-11` **و**`SD-10` معاً) —
  **فلا مسارَ ثالثٌ**.
- `packages/domain/support/rider-support.ts` يقولُ عن نفسِه: «`SD-10` — الأصنافُ
  تُوسَّعُ ههنا وحدَها ولا تُنسَخُ في سطحٍ ثانٍ»، و`ports.ts` يقولُ: «يُزادُ منفذٌ
  للسائقِ ولا يُبدَّلُ هذا». **فالحجزُ يتبعُ ما كتبَه الملفُّ عن نفسِه.**
- سطحُ السائقِ اليومَ سبعُ شاشاتٍ (`offers`, `offer`, `job`, `activity`,
  `subscription`, `vehicle`, `documents`) في `DriverRoot.tsx` بحالةٍ محليّةٍ لا
  مُوجِّهِ عناوينٍ — **فالزيادةُ شاشتانِ في المُتّحِدِ نفسِه** لا مُوجِّهٌ جديدٌ.
- `SD-12` **لا يحتاجُ نقطةً جديدةً**: `/v1/me` والموافقاتُ و`POST /v1/me/erasure`
  مُنفَّذاتٌ في `F2-11` **بلا دورٍ في عقدِها**؛ ونظيرُ الشاشةِ في
  `apps/miniapp/src/surfaces/rider/account/*`. **فالعملُ سطحٌ يُبنى لا خادمٌ
  يُكرَّرُ.**

**النطاقُ المحجوزُ، بستِّ زياداتٍ مُرقَّمةٍ لا تُدمَجُ في واحدةٍ:**

| # | الزيادةُ | ما تمسُّه | ما يُقاسُ عليها |
|---|---|---|---|
| `S-1` | **أصنافُ السائقِ قيمٌ في النوعِ المعدودِ**: `alter type support_ticket_type add value if not exists` للخصمِ والراكبِ المسيءِ والمركبةِ، **في هجرةٍ لا تستعملُ القيمَ الجديدةَ** (سابقةُ `20260914220000`) | هجرةٌ جديدةٌ في `supabase/migrations/` طَورُها `expand` | **القيمُ تُقرأُ من كاتالوجِ القاعدةِ** (`pg_enum`) لا من نصِّ الهجرةِ، وتذكرةٌ بصنفٍ جديدٍ تُكتَبُ فعلاً على قاعدةٍ حقيقيّةٍ |
| `S-2` | **قراءةُ تذاكرِ السائقِ حكمُ قاعدةٍ**: `driver_support_tickets(…)` نظيرَ قراءةِ الراكبِ — ترقيمُ **مفتاحٍ لا إزاحةٍ**، وترفضُ `NOT_A_DRIVER` و`USER_NOT_FOUND` و`LIMIT_OUT_OF_RANGE` و`CURSOR_INCOMPLETE`، وتقرأُ زمنَ الاستجابةِ بـ`get_setting` | الهجرةُ نفسُها | **راكبٌ يُنادي قراءةَ السائقِ فيُردُّ `NOT_A_DRIVER`** من القاعدةِ لا من الطبقةِ؛ **وقراءةُ الراكبِ لم يُمَسَّ حرفٌ منها** (`ح-8`) |
| `S-3` | **المجالُ يُوسَّعُ ولا يُنسَخُ**: `DRIVER_SUPPORT_CATEGORIES` في `packages/domain/support` **إضافةً** إلى أصنافِ الراكبِ، ومنفذُ سائقٍ **يُزادُ** إلى `ports.ts`، وحالتا استخدامٍ تُعيدانِ استعمالَ `open_support_ticket` | `packages/{domain,application,infrastructure}/support/*` | **مصفوفةُ الراكبِ ثابتةٌ حرفاً** في اختبارٍ، وصنفُ سائقٍ من راكبٍ يُردُّ `CATEGORY_UNKNOWN` **قبلَ الشبكةِ**، وصنفُ راكبٍ من سائقٍ كذلكَ |
| `S-4` | **نقطتانِ لا ثالثةٌ**: المسارانِ القائمانِ يقبلانِ أصنافَ السائقِ، **والدورُ يُستنبَطُ من صفِّ صاحبِ الحسابِ لا من الجسمِ ولا من العنوانِ** | `apps/gateway/src/routes/support-tickets.ts` | **لا مسارَ جديدٌ يُسجَّلُ**: عددُ مساراتِ الدعمِ في تركيبِ الخادمِ يبقى اثنَينِ، وحالةُ HTTP لكلِّ رمزٍ جديدٍ مُصنَّفةٌ لا `500` |
| `S-5` | **شاشتا السائقِ**: «تذكرةٌ جديدةٌ» بأصنافِه ومتابعةُ تذاكرِه، **وحسابي** (اللغةُ · الإشعاراتُ · المنطقةُ · إضافةٌ إلى الشاشةِ الرئيسةِ · الخصوصيّةُ · **حذفُ الحسابِ فعلاً**) — بإعادةِ استعمالِ `/v1/me` والموافقاتِ و`/v1/me/erasure` | `apps/miniapp/src/surfaces/driver/{support,account}/*` · `DriverRoot.tsx` · `packages/shared/i18n/miniapp/{ar,en,ur}.json` | **حذفٌ يُقاسُ لا يُدَّعى**: النداءُ هوَ نداءُ `F2-11` نفسُه، ومدخلانِ من الجذرِ يُفتحانِ بلا مُوجِّهٍ، وثلاثُ لغاتٍ بلا مفتاحٍ ناقصٍ |
| `S-6` | **الإنفاذُ آليّاً**: حاجزٌ ساكنٌ يمنعُ نسخَ أصنافِ الراكبِ في سطحِ السائقِ، ويمنعُ مسارَ دعمٍ ثالثاً، ويمنعُ زمنَ استجابةٍ مكتوباً في الشِّفرةِ، ويمنعُ سطحَ حسابٍ يُنشئُ حذفاً خاصّاً به بدلَ نقطةِ `F2-11` | `scripts/lib/driver-support-account-contract.ts` + `scripts/check-…` · `.github/workflows/ci.yml` خطوتَينِ مُسمّاتَينِ · `package.json` | **سالبةٌ مزروعةٌ لكلِّ قاعدةٍ** تُقاسُ إسقاطُها — لا «صفرُ مخالفاتٍ» على المستودَعِ كما هوَ (`ح-5` · `ح-7`) |

**ما هوَ خارجَ هذا الحجزِ صراحةً:** لا **مُرفَقَ** (رفعُ ملفٍّ دَينٌ مُعلَنٌ منذُ
`F2-12` ولا يُفتَحُ ههنا) · ولا **خيطَ ردٍّ** في التطبيقِ · ولا أسئلةً شائعةً ولا
صفحةَ مفقوداتٍ · ولا لوحَ موظّفِ دعمٍ ولا تغييرَ توجيهٍ في `ticket-advisor.ts` · ولا
يُمَسُّ سطحُ الراكبِ ولا قراءتُه ولا أصنافُه (`ح-8`) · ولا يُمَسُّ نصُّ بندٍ ولا معيارُ
قبولٍ (`ح-1`) ولا يُرقَّمُ شيءٌ من جديدٍ (`ح-2`) ولا يُضعَّفُ حاجزٌ ولا يُصنَّفُ
اختبارٌ تخطّياً بلا سببٍ مُسجَّلٍ (`ح-7`) · ولا `[x]` قبلَ ثلاثِ جولاتِ CI خضراءَ
متتاليةٍ **مقروءةٍ** (`ح-4` · `ح-6`).

## `F3-08` — `SD-10` دعمُ السائقِ: **مجالُ القراءةِ أوسعُ من مجالِ الكتابةِ** (2026-09-16)

نُفِّذَ نصفُ الحجزِ الأوّلُ (`SD-10`) في دفعةٍ واحدةٍ، و`SD-12` (حسابي) يُنفَّذُ في
الدفعةِ التالية بحجزِه نفسِه — **والفصلُ عن قصدٍ**: `SD-10` أتمُّ حكماً في القاعدةِ
(بوّابةُ دورٍ + دالّةُ قراءةٍ)، و`SD-12` سطحٌ فوقَ نقاطٍ قائمةٍ **معَ سؤالٍ مفتوحٍ
يجبُ قياسُه قبلَ وعدٍ**: `POST /v1/me/erasure` يردُّ رفضَه بـ`NOT_A_RIDER`، فحسابُ
سائقٍ **بلا صفِّ راكبٍ** قد لا يقدرُ على حذفِ نفسِه اليومَ. وذاكَ عطبُ منتَجٍ
لا عطبُ سطحٍ، ويُقاسُ على قاعدةٍ حقيقيّةٍ قبلَ أن تُبنى شاشةٌ تَعِدُ بحذفٍ لا يقعُ.

### ما بُنِيَ فعلاً (مقيسٌ لا مُدَّعىً)

- **`S-1` أصنافُ السائقِ قيمٌ في النوعِ**: هجرةُ `20260916010000` تُضيفُ
  `deduction` و`rider_conduct` و`vehicle` بـ`add value if not exists` **ولا
  تستعملُها في الهجرةِ نفسِها**. مقيسٌ من `pg_enum` لا من نصِّ الهجرةِ.
- **`S-2` قراءةُ السائقِ حكمُ قاعدةٍ**: هجرةُ `20260916020000` تُنشئُ
  `driver_support_tickets(bigint, integer, timestamptz, uuid)` نظيرَ قراءةِ
  الراكبِ، وتُعيدُ إنشاءَ `open_support_ticket` **ببوّابةِ دورٍ**: صنفُ سائقٍ من
  حسابٍ بلا صفِّ سياقةٍ يُردُّ `NOT_A_DRIVER`. وترتيبُ البوّاباتِ مقيسٌ:
  `MESSAGE_EMPTY` ← `USER_NOT_FOUND` ← `USER_BLOCKED` ← `NOT_REGISTERED` ←
  `NOT_A_DRIVER` ← `CITY_GROUP_MISSING` ← تهدئةٌ ← `ORDER_NOT_YOURS`.
- **`S-3` المجالُ يُوسَّعُ ولا يُنسَخُ**: ثلاثةُ لبوبٍ مشتركةٍ استُخرِجَت
  (`packages/domain/support/ticket-types.ts` · `packages/application/support/intake.ts`
  · `packages/infrastructure/support/ticket-store.ts`)، ومِلفّاتُ الراكبِ صارَت
  مُحوِّلاتٍ **تحفظُ كلَّ اسمِ تصديرٍ وتوقيعِه** (`ح-8`).
- **`S-4` المساراتُ**: `POST|GET /v1/driver/support/tickets`.
- **`S-5` السطحُ**: لبٌّ مشتركٌ في `apps/miniapp/src/surfaces/support/*`، ومُحوِّلاتُ
  الراكبِ فوقَه بلا تغييرِ سلوكٍ، وشاشةُ السائقِ في
  `apps/miniapp/src/surfaces/driver/support/*`، ومدخلٌ في لوحِ العروضِ
  (`dof__support`)، و٦٢ مفتاحاً × ٣ لغاتٍ (٩٥١ ← ١٠١٣).
- **`S-6` الإنفاذُ**: حاجزُ `check-support-intake-contract` **وُسِّعَ** لا كُتِبَ
  ثانياً، وصارَ يقيسُ قواعدَه السبعَ على **دورَينِ** وعلى **هجراتِ الدعمِ كلِّها**.
- **القياسُ**: ٢٩ حالةَ تكاملٍ على PostgreSQL 18 حقيقيٍّ (١٣ للسائقِ + ١٦ للراكبِ
  **بلا انحدارٍ**) · ١٦ حالةَ وحدةٍ جديدةً · ٤١٩٦ حالةَ وحدةٍ كلِّيّاً بلا ساقطٍ ·
  ٢٩ حالةً في اختبارِ الحاجزِ نفسِه (منها ١١ سالبةً مزروعةً) · `lint` و`typecheck`
  خضراءُ · وكلُّ حاجزٍ في سلسلةِ `ci` أُجرِيَ محلّيّاً.

### ثلاثةُ انحرافاتٍ عن الحجزِ — تُسجَّلُ ولا تُمحى (`ح-5`)

١. **الحجزُ قالَ «لا مسارَ ثالثٌ»، والمُنفَّذُ مسارانِ للسائقِ.** والسببُ قياسٌ لا
رأيٌ: قراءةُ السائقِ **دالّةٌ أخرى** في القاعدةِ (`driver_support_tickets`)، فمسارُ
قراءةٍ واحدٌ يخدمُ الدورَينِ يحتاجُ **مُعامِلَ دورٍ في الطلبِ** — وذاكَ يُنقَلُ
اختيارُ الدورِ إلى العميلِ، وهوَ عكسُ ما تقولُه الوثيقةُ نفسُها: «الدورُ يُستنبَطُ
من صفِّ صاحبِ الحسابِ لا من الجسمِ ولا من العنوانِ». والمسارُ المُسمّى بالدورِ
**لا يُصدِّقُ دعوى العميلِ**: بوّابةُ القاعدةِ هيَ الحاكمُ، ومَن نادى مسارَ السائقِ
بلا صفِّ سياقةٍ يُردُّ من المحرِّكِ. وهوَ نمطُ `‎/v1/driver/*‎` القائمُ في المستودعِ
(المركبةُ والاشتراكُ والحصيلةُ) لا نمطٌ مُبتدَعٌ ههنا. **والمعيارُ في `S-4`
(«يبقى اثنَينِ») مُبدَّلٌ بمعيارٍ أقوى**: لا مسارَ يُصدِّقُ دوراً يقولُه العميلُ.

٢. **الحجزُ قالَ حاجزاً جديداً (`driver-support-account-contract.ts`)،
والمُنفَّذُ توسيعُ الحاجزِ القائمِ.** ورأسُ الحاجزِ القائمِ يقولُ عن نفسِه حرفاً:
«`SD-10` — تُزادُ مِلفّاتُه ههنا ولا تُكتَبُ قواعدُ ثانيةٌ للسؤالِ نفسِه». وحاجزٌ
ثانٍ يسألُ «هل لكلِّ صنفٍ نصٌّ» مصدرُ حقيقةٍ مكرَّرٌ، وهوَ أوّلُ ما تنهاهُ الغايةُ
الثانيةُ من غاياتِ التنفيذِ.

٣. **الحجزُ قالَ «شاشتانِ للسائقِ»، والمُنفَّذُ لبٌّ مشتركٌ ومُحوِّلانِ.** ونسخُ
٣٤٤ سطرِ شاشةٍ لدورٍ ثانٍ يُنتِجُ عطبَينِ يُصلَحُ أحدُهما — ولذلكَ انتقلَت القاعدةُ
٥ من الحاجزِ (المرجعُ يُعرَضُ) إلى الشاشةِ المشتركةِ: **الحاجزُ يقيسُ حيثُ العرضُ
يُكتَبُ، لا حيثُ اسمُ الدورِ مكتوبٌ**.

### ما بقيَ دَيناً مُعلَناً

لا مُرفَقَ (`debt.attachment`) · ولا خيطَ ردٍّ في التطبيقِ (`debt.thread`) · ولا
كشفَ خصمٍ تفصيليّاً (`debt.deductionTrace`) — والثلاثةُ **مكتوبةٌ في الشاشةِ نصّاً
يقرؤُه السائقُ** لا مخفيّةٌ في وثيقةٍ. و`SD-12` بحجزِه ودفعتِه. و`F3-08` يبقى
`[~]` حتّى تُقرأَ ثلاثُ جولاتِ CI خضراءَ (`ح-4` · `ح-6`).

## `F3-08` — `SD-12` حقَّا بيانةِ السائقِ: **المالُ يمنعُ لا الدورُ** (2026-09-16)

نُفِّذَ **النصفُ الثاني** من حجزِ `F3-08` (سطر ~4187) بحجزِه نفسِه لا بحجزٍ جديدٍ،
والسؤالُ المفتوحُ الذي سُجِّلَ في الدفعةِ الأولى — «حذفُ حسابِ سائقٍ يُقاسُ قبلَ أن
يُوعَدَ به» — **صارَ مقيساً**:

- **القاعدةُ**: `supabase/migrations/20260916030000_sd_12_driver_account_erasure.sql`
  — دالّتانِ بـ`create or replace`: `erase_my_account` بفرعِ سائقٍ كاملٍ (١٥ قسماً
  معدوداً في الإيصالِ)، و`export_my_data` من **١٣ قسماً إلى ٣١** و`subject`
  مقروءٌ من `users.role`.
- **المانعُ مالٌ لا دورٌ**: `WALLET_HAS_BALANCE` (ومعَه `wallet_balance_minor`
  مقروءٌ من `subscription_wallet_balance`) · `ACTIVE_ORDER` ·
  `ROLE_NOT_SELF_ERASABLE` لحسابِ المؤسّسةِ. و`NOT_A_RIDER` **يبقى** في
  الاتّحادِ موسوماً بـ`ح-8`.
- **صفرُ جدولٍ مؤجَّلٍ**: الستةَ عشرَ الموسومةُ `deferredTo: "SD-12"` صارَت
  محكومةً — والمالُ والحضورُ وقرارُ الإسنادِ **تبقى بأسسٍ مكتوبةٍ ثلاثةٍ**.
- **الحاجزُ يُلزِمُ العبارةَ لا الاسمَ** (القاعدةُ ٩): `delete from <t>` للمحوِ ·
  `update <t>` للتجهيلِ · على `ENFORCED_SUBJECTS = [rider, driver]`. والعَدُّ:
  `54 جدولاً محكوماً · 31 قسمَ تنزيلٍ · (rider: 13 · driver: 27 · admin: 5)`.
- **العطبُ الذي كشفَه التشغيلُ**: `ACTIVE_ORDER` كُتِبَ على `o.driver_id` والعمودُ
  `assigned_driver_id`، و`plpgsql` **لا يُصرِّفُ جسمَ الدالّةِ عندَ إنشائِها**،
  فطُبِّقَت الهجرةُ بلا شكوى. **رآه اختبارُ التكاملِ وحدَه** وأُصلِحَ في الهجرةِ.
- **الشاشةُ ليست في هذه الدفعةِ**: شاشةُ حسابِ السائقِ (مِرآةُ
  `surfaces/rider/account/*` على قلبٍ مشتركٍ) دفعةٌ تاليةٌ — و**زرٌّ غيرُ مبنيٍّ
  لا يُدَّعى مبنيّاً** (`ح-5`). ودَينُ **بايتاتِ المخزَنِ** مسجَّلٌ في
  `docs/SYSTEM_STATE.md` لا ممسوحٌ.
- **الدليلُ**: `docs/adr/0125-a-drivers-erasure-stops-at-money-not-at-role.md` ·
  `docs/evidence/architecture/SD-12-driver-account-2026-09-16.md` ·
  `tests/integration/driver-account-erasure.test.ts` (٥ حالاتٍ).

و`F3-08` يبقى `[~]` حتّى جولتِه الثالثةِ الخضراءِ المقروءةِ (`ح-4` · `ح-6`).

### `F3-08` صارَ `[x]` — بخمسِ جولاتٍ خضراءَ مقروءةٍ (2026-09-16 · إضافةٌ لا محوٌ · `ح-8`)

السطرُ أعلاه («يبقى `[~]` حتّى جولتِه الثالثةِ») **صحيحٌ في وقتِه ومنسوخٌ الآنَ**:
`PR #52` دُمِجَ بجولةٍ خضراءَ أولى بلا حمرةٍ — الفرعُ
[35039776259](https://github.com/uxxxug/ceezr/actions/runs/35039776259) ثمَّ `main`
[35040085897](https://github.com/uxxxug/ceezr/actions/runs/35040085897) — فصارَت
الجولاتُ الخضراءُ المتتاليةُ **خمساً** (`35034757161` · `35035556445` ·
`35035865721` · `35039776259` · `35040085897`)، فاكتملَ شرطُ `ح-4`.

**وما لا يشملُه هذا `[x]`**: **شاشةُ حسابِ السائقِ في التطبيقِ لم تُبنَ** ودَينُ
بايتاتِ المخزَنِ قائمٌ — بندُ الدفعةِ التاليةِ، ولا يُدَّعى مبنيّاً (`ح-5`).

---

## `ح-4` — `F3-05` و`F3-06` ⇒ `[x]`: ثلاثُ جولاتٍ خضراءَ متتاليةٍ مقروءةٌ (2026-09-16)

الجولاتُ قُرِئَت من GitHub بجوباتِها لا بحُكمِها الأعلى وحدَه، وكلُّ جولةٍ
تُشغِّلُ سلسلةَ CI كامِلةً على `main` **بعدَ الدمجِ**:

| # | الجولةُ | الالتزامُ | الحكمُ | تحتوي `F3-05`؟ | تحتوي `F3-06`؟ |
|---|---|---|---|---|---|
| ١ | `34953942937` | `f63457e` | success | نعم (دخلَ فيه) | لا |
| ٢ | `34976110848` | `2322933f` | success | نعم | لا |
| ٣ | `34987624903` | `b03233c` | success | نعم | نعم (دخلَ فيه) |
| ٤ | `34987712409` | `73a168d` | success | نعم | نعم |
| ٥ | `35028339423` | `0b5d1bf` | success | نعم | نعم |

فـ`F3-05` بلغَ **ثلاثاً** (الجولاتُ ١·٢·٣) و`F3-06` بلغَ **ثلاثاً** (٣·٤·٥)،
وكلتا السلسلتَينِ **متّصلةٌ بلا جولةٍ ساقطةٍ بينَها** — فرُفِعا إلى `[x]`.

**والعدُّ الجاريُّ** (يُقرأُ ولا يُفترَضُ): `F3-05` ⇒ **عشرُ جولاتٍ خضراءَ
متتاليةٍ** على `main` (`34953942937` … `35040522114`) · `F3-06` ⇒ **ثماني
جولاتٍ خضراءَ متتاليةٍ** على `main` (`34987624903` … `35040522114`).

**وما لا يُدَّعى (`ح-5`)**: `[x]` تعني **مُنفَّذٌ ومُختبَرٌ ومُتحقَّقٌ منه
بحكمِ CI**، ولا تعني `مَقيس` ولا `مُثبَت عند N`: لا نشرَ حيَّ (`ADR 0099`) ولا
سائقَ حقيقيَّ ولا جهازَ حقيقيَّ ولا قياسَ حملٍ إنتاجيَّ.
---

### F4-04 — قناة Socket.IO آنية للرحلة النشطة (2026-09-16)

**التنفيذ:** قناة Socket.IO للرحلة النشطة (ADR 0042). استُبدِلَ `Bun.serve`
بـ`http.createServer` (Node) مع جسر نحيف إلى Hono. العميل يتصل بـ`auth.sessionToken`،
الخادم يحل الرحلة النشطة من القاعدة، ينضم لغرفة `ride:<tripId>`. اشتراك واحد على
ناقل الأحداث لكل نسخة. `session_ended` لا يغلق الغرفة. بث Live Location لم يُمسَّ.

**الحالة:** `[~]` — ٦ اختبارات وحدة ناجحة + typecheck + lint. ينتظر ثلاث جولات
خضراء على `main` (`ح-4`). الدليل: `docs/evidence/architecture/F4-04-20260916.md`.

### F4-05 — التتبّع العام من القناة المشتركة (2026-09-16)

أُضيفَ منفذُ `DriverLocationHotStateReader` بـ`HGETALL` على Redis. `createTrackingTokenRpc` يقرأُ
الحالةَ الساخنةَ أوّلاً ويُعَدُّ للقاعدةِ عند غيابِها. المعرّفاتُ تُحلُّ بنداءٍ مستقلٍّ لا
بتعديلِ `get_tracking_position` (عقدُ الهويّةِ محفوظٌ). ٨ اختباراتِ وحدةٍ ناجحةٍ. الحالةُ `[~]`،
ينتظرُ ثلاثَ جولاتٍ خضراءَ على `main` (`ح-4`). الدليل: `docs/evidence/architecture/F4-05-20260916.md`.

<!-- F4-05 lint fix: biome organize imports on adapter and test files -->
<!-- F4-05 schema contract: trip_tracking_tokens reference added -->


### F4-06 — خريطة المشرف من المجرى المشترك (2026-09-16)

ربطت صفحة `/admin/live-map` بمجرى SSE القائم عند `/admin/api/live/drivers` بدلَ إعادة
التحميلِ الدوريّة كلَّ ٢٠ ثانية. اختزالُ حالةٍ قابلٌ للاختبارِ في `packages/maps/live-map-reducer.ts`
(اللقطةُ مصالحةٌ كاملة، والدلتا بفاصلِ الترتيب BUG-009/ADR 0053). وإزالةُ `LIVE_REFRESH_SECONDS`
من مسارِ الخريطة. السطحُ الخادميُّ يبقى احتياطيًّا. ١٤ اختبارَ وحدةٍ ناجحةً. CAP-011 لم يُغلق —
نماذجُ القراءة المادية والنسخةُ التحليليةُ تبقى F7-08. الحالةُ `[~]`، ينتظرُ ثلاثَ جولاتٍ خضراءَ
على `main` (`ح-4`). الدليل: `docs/evidence/architecture/F4-06-20260916.md`.

### F2-06 — قناة الرحلة الآنية للراكب: الخطوة الأولى (2026-09-16)

بناءُ مستهلكِ التتبُّعِ الحيِّ في Mini App + طورُ «وصلَ السائقُ». إضافةُ `driver_arrived`
إلى `ActiveRidePhase`، وقراءةُ `arrived_at` من `active_ride_snapshot` (هجرةٌ:
`create or replace function` لا دالّةٌ جديدةٌ). وعميلُ Socket.IO في
`ride-channel-client.ts` (حقنُ ناقلٍ وجلسةٍ للاختبارِ بلا شبكةٍ). ومحوّلُ التتبُّعِ الحيِّ
في `live-tracking-reducer.ts` (حارسُ تسلسلٍ BUG-009/ADR 0053). ودمجُ القناةِ في
`ActiveRideScreen.tsx` (اشتراكٌ عندَ الدخولِ، فصلٌ نظيفٌ عندَ الخروجِ، موقعٌ حيٌّ يُغطّي
اللقطةَ). وزرُّ التحديثِ يبقى احتياطيًّا. ٢١ اختبارَ وحدةٍ ناجحةً. `F4-07` سيُنفَّذُ كفرعٍ
منفصلٍ بعدَ دمجِ هذا. الحالةُ `[~]`، يُقرأُ حكمُ CI بعدَ الدفعِ. الدليل:
`docs/evidence/architecture/F2-06-20260916.md`.


**تصحيحٌ 2026-09-16 (إعادة تسمية الهجرة)**: طابعُ الهجرةِ غُيِّرَ من
`20260916030000` إلى `20260916040000` لتجنبِ التعارضِ مع
`20260916030000_sd_12_driver_account_erasure.sql`. وأُضيفَ إعلانُ خطرِ التراجعِ
`revoke_function:active_ride_snapshot(2)` إلى `scripts/lib/rollback-registry.ts`.

### F4-07 — إسقاط Live Location كمسار رئيسي (2026-09-16)

تركيبُ Socket.IO في الإنتاجِ عبر `RiderRoot.tsx` (ناقلٌ حقيقيٌّ ورمزُ جلسةٍ من
`getSession`). وإسقاطُ `CustomerLiveRelay` كمسارٍ رئيسيٍّ: لا يُنشَأُ ولا يُشترِكُ
إلّا إن كان `liveLocationFallbackEnabled` مُفعَّلًا (افتراضيًّا `false`). وخريطةُ
`tripId→messageId` لا تُنشَأُ إلّا معه. والكودُ لم يُحذَفْ. 7 اختباراتٍ ناجحةٍ.
الحالةُ `[~]`، يُقرأُ حكمُ CI بعدَ الدفعِ. الدليل:
`docs/evidence/architecture/F4-07-20260916.md`.

### F4-07 — إصلاحُ سلسلةِ الاستيرادِ (2026-09-16)

نقلُ اختبار `production-ride-channel` من `tests/unit/` إلى
`apps/miniapp/src/services/` لكسرِ سلسلةِ الاستيرادِ التي كانت تسحبُ ملفاتِ
miniapp (التي تستعملُ أنواعَ DOM) إلى تجميعِ الجذرِ (الذي بلا DOM). وتغييرُ
استيرادِ `socket.io-client` إلى type-only مع تحميلٍ كسولٍ.

### F4-07 — إصلاحُ استيرادِ socket.io-client كـESM (2026-09-16)

استعادةُ الاستيرادِ المستوى الأعلى (top-level import) لِـ`socket.io-client` في
`production-ride-channel.ts` بدلَ `require()` الذي لا يعملُ في حزمةِ المتصفحِ.

---

## حجزُ نطاقِ `SD-12` — سطحُ حسابِ السائقِ على لبٍّ مشتركٍ (2026-09-16)

**الفرعُ**: `feat/sd-12-driver-account-surface` من `main`@`b1d36d8`.
**العائقُ المُعلَنُ الذي يُغلَقُ**: «شاشةُ حسابِ السائقِ في التطبيقِ لم تُبنَ» —
الخادمُ مبنيٌّ (`supabase/migrations/20260916030000_sd_12_driver_account_erasure.sql`
· `ADR 0125` · `tests/integration/driver-account-erasure.test.ts`) والسطحُ غائبٌ،
و`DriverRoot.tsx` يقولُ ذلكَ نصّاً في رأسِ مِلفِّه: «لا يعرضُ شاشةَ حسابٍ: بندُ
`SD-12`».

**قبلَ الحجزِ فُحِصَ** (بالتسلسلِ الذي يوجبُه المالكُ): لا فرعَ قائماً لِـ`SD-12`
ولا `PR` مفتوحاً (`gh pr list` فارغةٌ)، و`origin/chore/h4-f3-03-f3-04-green-runs`
**لا يُدمَجُ أبداً** كما ينصُّ هذا المِلفُّ، وآخرُ جولاتِ `main` خضراءُ
(`35058604385` · `35058604386`).

### الزياداتُ المرقَّمةُ

1. **لبٌّ مشتركٌ** `apps/miniapp/src/surfaces/account/` على سابقةِ
   `surfaces/support/` حرفاً (`ADR 0124`): عقدٌ ونموذجُ عرضٍ **مُعامَلٌ بالبادئةِ**
   ولوحُ حقوقٍ واحدٌ. **مصدرُ حقيقةٍ واحدٌ** للمجالاتِ المغلقةِ (أسسُ الإبقاءِ ·
   رفوضُ المحوِ · رفوضُ التنزيلِ · رموزُ العطبِ) بدلاً من نسختَينِ تفترقانِ.
2. **إغلاقُ فجوةٍ حقيقيّةٍ في العقدِ**: البوّابةُ تنشرُ `walletBalanceMinor` في
   فرعِ الرفضِ (`me-data-rights.ts:138`) و`account-contract.ts` **لا يُعلِنُه**،
   فرصيدٌ يمنعُ المحوَ يُقرأُ اليومَ «لا يمكنُ الآنَ» بلا رقمٍ. يُعلَنُ في العقدِ
   ويُنسَّقُ في الواجهةِ بلغةِ صاحبِه كما توجبُ حاشيةُ المنفذِ.
3. **رفوضُ `SD-12` يصيرُ لها نصٌّ**: `WALLET_HAS_BALANCE` و
   `ROLE_NOT_SELF_ERASABLE` موجودانِ في مجالِ النطاقِ ومنشورانِ من القاعدةِ
   **وليسَ لهما نصٌّ في أيِّ قاموسٍ** — أي أنَّ سائقاً يُمنَعُ اليومَ يرى مفتاحاً
   خاماً أو فراغاً. وكذا أسسُ الإبقاءِ الثلاثةُ الجديدةُ.
4. **`rider/account/` يصيرُ مُحوِّلاً نحيفاً** على اللبِّ — **بلا تغييرِ مفتاحٍ
   ولا صنفِ نمطٍ ولا سلوكٍ** (`ح-8`): كلُّ مفاتيحِ `rider.account.*` وأصنافُ
   `ac__*` تبقى حرفاً.
5. **`driver/account/`** جديدٌ: شاشةٌ ببادئةِ `driver.account.` ودَينُها
   المُعلَنُ مكتوبٌ في الشاشةِ نفسِها لا مُخترَعٌ زرّاً صوريّاً (`ح-5`).
6. **`DriverRoot.tsx`**: `{kind:"account"}` يُزادُ إلى الاتّحادِ ومدخلٌ من اللوحِ
   — **زيادةُ مدخلٍ لا نقصُه**؛ مدخلُ الدعمِ في اللوحِ يبقى كما هوَ ويُزادُ ثانٍ
   من شاشةِ الحسابِ (الموضعُ الذي أعلنَه رأسُ `DriverRoot` طبيعيّاً).
7. **مفاتيحُ `driver.account.*`** في القواميسِ الثلاثةِ `ar`/`en`/`ur`.
8. **حاجزٌ ساكنٌ** `scripts/check-account-surface-contract.ts` بقواعدَ لكلٍّ
   **افتراقٌ مزروعٌ** (`ح-7`)، وخطوةٌ مُسمّاةٌ في `ci.yml` ومختصرٌ
   `check:account-surface` في `package.json`.
9. **اختباراتُ وحدةٍ** للنموذجِ المُعامَلِ وللمُحوِّلَينِ.
10. **الوثائقُ**: `ADR` جديدٌ · دليلٌ في `docs/evidence/architecture/` ·
    `SYSTEM_STATE.md` · صفٌّ في `docs/ROADMAP-MASTER.md` §25 · هذا المِلفُّ.

### ما هوَ **خارجَ** النطاقِ صراحةً

  ــ **لا تعديلَ في هجرةٍ ولا في دالّةِ قاعدةٍ**: الخادمُ مبنيٌّ ومقيسٌ، وسطحٌ
     يُبنى لا يُعيدُ فتحَ عقدٍ أخضرَ.
  ــ **لا مسَّ لِـ`dataRights` في طبقةِ التطبيقِ ولا للمسارَينِ**: `walletBalanceMinor`
     يُنشَرُ فعلاً؛ المطلوبُ إعلانُه في عقدِ العميلِ لا تغييرُ منفذٍ.
  ــ **`دَينُ بايتاتِ المخزَنِ`** يبقى دَيناً مُعلَناً — بندٌ مستقلٌّ لا يُحمَلُ
     على سطحٍ.
  ــ **لا مُوجِّهَ عناوينٍ** في التطبيقِ المُصغَّرِ: الشاشةُ عضوٌ في اتّحادِ
     `DriverRoot` كما هيَ سابقةُ كلِّ شاشاتِ `F3`.
  ــ **لا إرفاقَ ولا تحريرَ هويّةٍ ولا تفضيلاتِ إشعارٍ**: لا جدولَ لها ولا حدَّ
     `API`، فتُقالُ دَيناً على الشاشةِ ولا تُعرَضُ حقلاً لا يُحفَظُ.
  ــ **لا رفعَ لأيِّ بندٍ من `[~]` إلى `[x]`**: `F4-04`/`F4-05`/`F4-06`/`F4-07`/
     `F2-06` تنتظرُ ثلاثَ جولاتٍ خضراءَ مقروءةً من الـ`API` (`ح-4` · `ح-6`)،
     وهذا الفرعُ لا يُقدِّمُ فيها شيئاً.

### القواعدُ الحاكمةُ لهذا النطاقِ

القاعدة 0.3 (لا رقمَ أعمالٍ في شِفرةٍ) · القاعدة 0.6 (مصدرُ حقيقةٍ واحدٌ — وهيَ
عِلّةُ اللبِّ المشتركِ) · القاعدة 0.7 (لا دمجَ بلا `CI`) · `ح-5` · `ح-7` · `ح-8` ·
`ADR 0112` · `ADR 0113` · `ADR 0124` · `ADR 0125` · القسم 9.11 · القسم 9.12.

### ما تمَّ فعلاً في هذا النطاقِ (2026-09-16 · إضافةٌ لا محوٌ · `ح-8`)

**الزياداتُ العشرُ المحجوزةُ أعلاه مبنيّةٌ كلُّها**، والحاكمُ
`docs/adr/0126-one-account-core-two-roles.md`، والشاهدُ
`docs/evidence/architecture/SD-12-driver-account-2026-09-16.md` §٦.

**وثلاثةُ أعطابٍ حقيقيّةٍ كانت قائمةً عُولِجَت في أصلِها لا في عَرَضِها**:

1. `KNOWN_BASES` في سطحِ الراكبِ كانَ **خمسةَ أسسٍ** والنطاقُ يُعلِنُ **تسعةً**،
   ومن الناقصةِ `BLOCK_AND_STANDING_SURVIVE_ERASURE` — **وهوَ يُرسَلُ في إيصالِ
   كلِّ حذفٍ** (`identityBar`) **ونصُّه مكتوبٌ عندَنا منذُ `ADR 0113`**. فكانَ مَن
   سألَ «لماذا بقيَ حظري؟» يُجابُ «سببُ إبقاءٍ لا نعرفُ نصَّه بعدُ». والإصلاحُ
   **استيرادُ المجالِ من النطاقِ**: العلّةُ كانت وجودَ **نسخةٍ ثانيةٍ** للمجالِ.
2. `rider.account.section.identityBar` **غائبٌ من القواميسِ الثلاثةِ** —
   فيُقرأُ على إيصالِ حذفٍ **مفتاحٌ خامٌ**.
3. `notificationsSent` **قسمٌ يُصدَّرُ للسائقِ فعلاً ولا نصَّ له** — أوّلُ ما
   أسقطَه الحاجزُ الجديدُ. فأقسامُ الإيصالِ **٣٢** لا ٣١ كما كانَ مكتوباً في
   شاهدِ `SD-12` الأوّلِ؛ والتصحيحُ **إضافةً** لا محواً (`ح-8`).

**ولم يرَ شيئاً من ذلكَ مُصرِّفٌ ولا تغطيةٌ ولا حاجزٌ قائمٌ**، وكلُّ الأدواتِ خضراءُ.

**والحاجزُ الجديدُ** `scripts/check-account-surface-contract.ts` ثمانِ قواعدَ،
**ولكلِّ واحدةٍ حالةٌ سلبيّةٌ مبذورةٌ** في `tests/unit/account-surface.test.ts`
(`ح-7`)، وأقسامُ الإيصالِ تُقرأُ **من جسمِ الدالّةِ في الهجرةِ** لا من سجلٍّ موازٍ.
وخطوتانِ مُسمّاتانِ في `.github/workflows/ci.yml` و`check:account-surface` في
`package.json` وفي سلسلةِ `ci`.

**والقياسُ المحلّيُّ**: `lint` (٠ أخطاءٍ) · `typecheck` · `build:miniapp` ·
`bun test tests/unit` ⇒ **4282 pass · 0 fail**. و`tests/unit/data-rights.test.ts`
بقيَ أخضرَ **بلا سطرٍ مُعدَّلٍ** — وهوَ الذي يقيسُ أسماءَ تصديرِ مُهايئِ الراكبِ.

**وما لم يُفعَلْ عن قصدٍ** (`ح-5`): لا مَنفذَ ثانٍ ولا هجرةَ ولا تعديلَ في طبقةِ
التطبيقِ · `SubscriptionScreen.tsx` **لم يُحوَّلْ** إلى القاسمِ الجديدِ (يعرضُ `45`
والجديدُ `45.00`، فالتحويلُ **تغييرُ معروضٍ** خارجَ الحجزِ — دَينٌ مُسجَّلٌ في
`ADR 0126` §٤) · لا مُوجِّهَ عناوينٍ · لا تحريرَ هويّةٍ ولا تفضيلاتِ إشعارٍ ولا
تبديلَ لغةٍ للسائقِ (دُيونٌ تُقالُ نصّاً) · **ولا رفعَ لأيِّ بندٍ من `[~]` إلى `[x]`**.

**وحكمُ CI** يُقرأُ لكلِّ مَهمّةٍ من الواجهةِ البرمجيّةِ ويُكتَبُ في الشاهدِ §٦٫٦
(`ح-6`) — والأخضرُ المحلّيُّ ليسَ بديلاً عنه.

---

## حجزُ نطاقِ `F3-09` — دفعُ الاشتراكِ داخلَ التطبيقِ وفاتورتُه الضريبيّةُ (2026-09-16)

**الفرعُ**: `feat/f3-09-subscription-payment-invoice` من `main`@`41379cc`.
**البندُ**: `F3-09` في `docs/ROADMAP-MASTER.md` §12 — الحالةُ `[ ]`، ونصُّه:
«`SD-08` دفعُ الاشتراكِ داخلَ التطبيقِ عبرَ مزوّدٍ مرخَّصٍ، بلا بياناتِ بطاقةٍ
عندَنا». وصفُّ `SD-08` في §… يزيدُ: «صفحةُ دفعٍ مستضافةٌ من مزوّدٍ مرخَّصٍ
(mada / Apple Pay / بطاقاتٌ)، **بلا تخزينِ أيِّ بياناتِ بطاقةٍ عندَنا، حالةُ
العمليةِ، فاتورةٌ ضريبيّةٌ**».

**قبلَ الحجزِ فُحِصَ** (بالتسلسلِ الذي يوجبُه المالكُ): البندُ `[ ]` ولا فرعَ له
ولا `PR` مفتوحاً (`gh pr list` فارغةٌ)، و`origin/chore/h4-f3-03-f3-04-green-runs`
**لا يُدمَجُ أبداً**، وآخرُ جولاتِ `main` خضراءُ مقروءةً لكلِّ مَهمّةٍ
(`35066478232` · `35066478282` على `41379cc`). والمِلكيّةُ: الدفعُ والاشتراكُ
**`CORE`** لا `MOVE` — ولذا **لا يُفتَحُ مزوّدٌ جديدٌ ولا يُلمَسُ ويبهوكٌ**، بل
يُستعملُ ما هوَ قائمٌ (`payment-provider-factory.ts` · `moyasar-provider.ts` ·
`tap-provider.ts` · `payment-webhook.ts` · `reconcile-pending-payments.ts`).

### العطبُ الحقيقيُّ الذي يُغلَقُ أوّلاً — **زرُّ الدفعِ قد لا يفعلُ شيئاً**

`SubscriptionScreen.tsx:323` يفتحُ رابطَ صفحةِ الدفعِ بـ`<a target="_blank">`.
**وهذا نقضٌ لِـ`ADR 0031`/`ARCH-014`** المكتوبِ في رأسِ `apps/miniapp/src/tg/webapp.ts`
حرفاً: «كلُّ نداءٍ لواجهةِ تلغرامَ **يجبُ** أن يمرَّ عبرَ هذه الوحدةِ». و`openLink`
**مُعلَنٌ أصلاً** في `capabilities.ts:48` (`minVersion 6.4`) وفي
`host-types.ts:178` — **وغيرُ مستعملٍ في المستودعِ كلِّه**. أي أنَّ السبيلَ
المُقنَّنَ مبنيٌّ ومهجورٌ، والسبيلُ المهجورُ هوَ **الوحيدُ** الذي يمرُّ منه المالُ:
هذا `<a>` هوَ الرابطُ الخارجيُّ الوحيدُ في التطبيقِ المُصغَّرِ كلِّه (مقيسٌ
بـ`rg 'target="_blank"'`). وفي عارضِ تلغرامَ داخلَ التطبيقِ يُهمَلُ `target="_blank"`
كثيراً، **فالسائقُ يضغطُ ولا يحدثُ شيءٌ ولا رسالةَ عطبٍ** — لأنَّ نقرةً لا تُبلِغُ
عن نفسِها.

### الزياداتُ المرقَّمةُ

1. **مَسلكٌ واحدٌ لفتحِ رابطٍ خارجيٍّ** في طبقةِ `tg/`: بوّابةُ قدرةٍ على
   `openLink`، **ورجوعٌ رشيدٌ** عندَ غيابِها، **وجوابٌ يُقالُ** (`opened` /
   `unavailable`) لا صمتٌ. والشاشةُ تعرضُ الرابطَ نصّاً قابلاً للنسخِ عندَ
   العجزِ بدلاً من زرٍّ ميّتٍ.
2. **الفاتورةُ الضريبيّةُ المبسَّطةُ** (`SD-08`) — غائبةٌ من المستودعِ كلِّه
   (مقيسٌ: لا عمودَ ولا دالّةَ ولا مِلفَّ فيه `vat`/`tax_invoice`). تُبنى قراءةً
   مشتقّةً من `payment_transactions` **بترقيمٍ متتابعٍ** لا بمعرِّفٍ عشوائيٍّ،
   وبنسبةِ ضريبةٍ **من `platform_settings`** لا رقماً في شِفرةٍ (القاعدة ٠.٣).
3. **هويّةُ البائعِ الضريبيّةُ إعدادٌ لا ثابتٌ**: الاسمُ والرقمُ الضريبيُّ
   من `platform_settings`، **وغيابُها فشلٌ مغلقٌ** (`TAX_IDENTITY_NOT_CONFIGURED`
   ⇒ `503`) لا فاتورةٌ بخاناتٍ فارغةٍ. **ولا يُبذَرُ رقمٌ ضريبيٌّ مُختلَقٌ.**
4. **رمزُ الاستجابةِ السريعةِ** يُبنى **في الخادمِ** بترميزِ `TLV` بالحقولِ
   الخمسةِ التي تُوجِبُها الهيئةُ، فلا تختلقُه شاشةٌ ولا يُحسَبُ مرّتَينِ.
5. **حالةُ العمليةِ** تُقرأُ لمعاملةٍ بعينِها بعدَ الرجوعِ من صفحةِ الدفعِ،
   **والمِلكيّةُ في القاعدةِ** لا في الطبقةِ.
6. **حاجزٌ ساكنٌ يُثبِتُ «بلا بياناتِ بطاقةٍ عندَنا»** آلةً لا نثراً: لا عمودَ
   ولا حقلَ ولا مفتاحَ اسمُه من مُعجَمِ بياناتِ البطاقةِ في هجرةٍ ولا في شِفرةٍ.
   فالوعدُ الذي لا يحرسُه حاجزٌ وعدٌ ينقضُه تعديلٌ لاحقٌ بلا أن يُنتبَهَ.
7. **سدادُ دَينِ `ADR 0126` §٤**: `SubscriptionScreen.tsx` يعرضُ المبلغَ
   بـ`String(entry.amountMinor / 100)` — يصيرُ `minorUnitsToMajorText` فموضعُ
   القاسمِ النقديِّ واحدٌ. وهذا داخلُ النطاقِ الآنَ لأنَّ الفاتورةَ تعرضُ مالاً.
8. **لكلِّ قاعدةِ حاجزٍ حالةٌ سلبيّةٌ مبذورةٌ** (`ح-7`)، وخطواتٌ مُسمّاةٌ في CI.

### وما لا يُبنى في هذا الفرعِ عن قصدٍ (`ح-5`)

  ــ **لا ادّعاءَ امتثالٍ للمرحلةِ الثانيةِ** من الفوترةِ الإلكترونيّةِ: الربطُ
     بمنصّةِ «فاتورة» والإبلاغُ خلالَ أربعٍ وعشرينَ ساعةً والختمُ التشفيريُّ
     (`CSID`) و`UBL 2.1` **كلُّها غيرُ مبنيّةٍ** — لا شهادةَ عندَنا ولا تسجيلَ،
     فتُعلَنُ دَيناً مكتوباً لا تُوصَفُ مُنجَزاً.
  ــ **لا مزوّدَ دفعٍ جديدَ ولا تعديلَ ويبهوكٍ ولا هجرةَ في `payment_core`**.
  ــ **لا `Apple Pay` ولا `mada` كتكاملٍ عندَنا**: هذه وسائلُ **الصفحةِ
     المستضافةِ** عندَ المزوّدِ، وذاكَ جوهرُ «بلا بياناتِ بطاقةٍ عندَنا».
  ــ **لا فاتورةَ لمعاملةٍ غيرِ ناجحةٍ**: `pending` ليسَ توريداً.
  ــ **لا رفعَ لأيِّ بندٍ من `[~]` إلى `[x]`**.

### القواعدُ الحاكمةُ لهذا النطاقِ

القاعدة 0.3 (لا رقمَ أعمالٍ في شِفرةٍ — **ومنه نسبةُ الضريبةِ**) · القاعدة 0.4
(`city_id`) · القاعدة 0.6 (مصدرُ حقيقةٍ واحدٌ) · القاعدة 0.7 (لا دمجَ بلا CI) ·
`ح-5` · `ح-7` · `ح-8` · `ADR 0031` (`ARCH-014`) · `ADR 0039` §٤ · `ADR 0126`.

### تصحيحٌ مضافٌ في وصفِ العطبِ — `F3-09` (2026-09-16 · `ح-8`)

كُتِبَ أعلاهُ أنَّ `openLink` «**وغيرُ مستعملٍ في المستودعِ كلِّه**». **وهذا خطأٌ
في قراءةٍ، ويُصحَّحُ بالإضافةِ لا بالمحوِ**: المَسلكُ المُقنَّنُ **مبنيٌّ ومُستعملٌ**
— `apps/miniapp/src/tg/app.ts:52` فيها `openExternalLink` ببوّابةِ قدرةٍ وتنقيةِ
مخطَّطٍ (`http`/`https` وحدَهما) وجوابٍ يُقالُ، **و`JobScreen.tsx:118` تناديها
فعلاً** لرابطِ الملاحةِ.

**والعطبُ إذن أضيقُ وأشدُّ**: مسارُ **الملاحةِ** يمرُّ بالمَسلكِ الصحيحِ، ومسارُ
**المالِ** وحدَه يخرجُ عنه بـ`<a target="_blank">`. فليسَ الأمرُ سبيلاً غائباً بل
**سابقةً قائمةً في المستودعِ نفسِه خرجَ عنها موضعٌ واحدٌ — وهوَ الموضعُ الذي
يمرُّ منه المالُ**. وذاكَ دليلٌ أقوى لا أضعفُ: الصوابُ معروفٌ ومكتوبٌ ومُطبَّقٌ
على بُعدِ مِلفَّينِ.

### تضييقُ النطاقِ إلى دفعتَينِ (2026-09-16 · إضافةٌ)

الزياداتُ الثمانُ أعلاهُ تُقسَمُ دفعتَينِ لأنَّ كلَّ دفعةٍ يجبُ أن تخضرَّ في CI
وحدَها ولا تُدمَجُ نصفَ حقيقةٍ:

**الدفعةُ الأولى — هذا الفرعُ**: الزياداتُ ١ (مَسلكُ الرابطِ في مسارِ المالِ)
و٢ و٣ و٤ و٥ **في الخادمِ** (هجرةٌ ودوالُّ ومنافذُ ومساراتُ بوّابةٍ) و٦ (حاجزُ
«بلا بياناتِ بطاقةٍ») و٧ (سدادُ دَينِ القاسمِ النقديِّ) و٨.

**الدفعةُ الثانيةُ — فرعٌ تالٍ**: سطحُ الفاتورةِ وحالةِ العمليةِ في التطبيقِ
المُصغَّرِ ومفاتيحُه بثلاثِ لغاتٍ. **ولا زرَّ صوريَّ يُضافُ قبلَه**: ما لا سطحَ
له اليومَ يُقالُ في الوثيقةِ لا يُلمَّحُ إليه بزرٍّ لا يعملُ.

### ما تمَّ فعلاً في هذا النطاقِ — الدفعةُ الأولى (2026-09-16)

**الدليلُ**: `docs/evidence/architecture/F3-09-simplified-tax-invoice-2026-09-16.md` ·
**القرارُ**: `docs/adr/0127-simplified-tax-invoice.md` (ومنه §٦ تصحيحُ `ح-8`).

بُنيَ في الخادمِ والقاعدةِ: امتدادُ سجلِّ `subscription_invoices` بسبعةِ أعمدةٍ
ضريبيّةٍ وقيدِ «الكلُّ أو لا شيءَ» وزنادَي ثباتٍ، ودالّتا `TLV` ودالّةُ حمولةٍ،
وإعادةُ تعريفِ الكاتبِ الوحيدِ `issue_subscription_invoice(uuid)` لِيُفوتِرَ ضريبيّاً
**ويُغلِقَ** عندَ غيابِ هُويّةِ البائعِ، ومُغلِّفُ مِلكيّةٍ يُفوِّضُ إليه، وقارئٌ،
وحالُ دفعةٍ؛ وطبقاتُ المجالِ والتطبيقِ والبنيةِ والحدِّ (`POST` يُصدِرُ · `GET`
يقرأُ)؛ وحاجزٌ جديدٌ بثمانِ قواعدَ ولكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`)؛ وعرّافُ
`TLV` **مُفكِّكٌ بلا مُركِّبٍ** عن قصدٍ.

**وأهمُّ ما وقعَ في هذه الدفعةِ ليسَ ما أُضيفَ بل ما حُذِفَ**: كُتِبَت الهجرةُ أوّلاً
بجدولٍ جديدٍ `tax_invoices` ومُتوالٍ عامٍّ، فأسقطَ حاجزُ الاستبقاءِ البناءَ، فقُرِئَ
إسقاطُه على حقيقتِه — **سجلُّ فواتيرِ اشتراكٍ قائمٌ منذُ `20260813010000`** بكاتبِه
وترقيمِه وقيودِه ومَنفذِه. فحُذِفَ الجدولُ الثاني ومُتوالُه وزنادَاهُ **قبلَ دفعِ
أيِّ التزامٍ**، ولم يُصنَّف لِيَخضَرَّ حاجزٌ. فترقيمٌ واحدٌ، وقيدٌ واحدٌ، وإقرارٌ
واحدٌ لكلِّ توريدٍ (القاعدةُ ٠٫٦ · الأولويّةُ الثانيةُ في الترجيحِ).

**وأثرُ ذلكَ على النشرِ مُعلَنٌ لا مضمرٌ**: مدخلٌ في `scripts/lib/rollback-registry.ts`
بـ`breaksPreviousRelease: true` وإجراءٌ مقروءٌ في `docs/rollback.md` — تُضبَطُ
`tax_seller_name` و`tax_seller_vat_number` لكلِّ مدينةٍ عاملةٍ **قبلَ** تطبيقِ
الهجرةِ أو معَها، والهجرةُ تبذُرُ النسبةَ ولا تبذُرُ الهُويّةَ.

**والقياسُ**: 4385 اختبارَ وحدةٍ ناجحاً بلا فشلٍ، و`tsc` (نداءانِ منفصلانِ) و`biome`
و`build:miniapp` وأربعةٌ وعشرونَ حاجزاً خُضرٌ، و٣٤ حالةَ تكاملٍ **مُتجاوَزةً محلّيّاً
ومُصنَّفةً في السجلِّ** لأنَّ حكمَها لوظيفةِ «تكامل على PostgreSQL حقيقي». **ولا
`[x]`** قبلَ ثلاثِ جولاتِ CI خضراءَ تُقرأُ بالوظيفةِ (`ح-4`)، ولا سطحَ فاتورةٍ في
التطبيقِ المُصغَّرِ في هذه الدفعةِ (`ح-5`).

### تصحيحُ الدفعةِ الأولى بعدَ حكمِ CI — `F3-09` (2026-09-16)

الجولةُ `35074775194` ردَّت وسمَ قالبٍ مُرجَأً في `expect` واستيراداً يتخطّى مَنفذَ
`tg/index.ts`؛ والجولةُ `35076192872` — أوّلُ تطبيقٍ للهجرةِ على محرِّكٍ حقيقيٍّ —
ردَّت لفَّ `base64`، وسطحَ صلاحيّاتٍ مفتوحاً لأربعِ دوالَّ، وتلويثَ إعداداتٍ بينَ
ملفَّي اختبارٍ. عُولِجَت جميعاً في جذرِها بلا تعطيلِ حاجزٍ ولا تخفيفِ اختبارٍ،
وزيدَ قياسانِ جديدانِ. **والبندُ يبقى `[ ]`** حتّى ثلاثِ جولاتٍ خضراءَ تُقرأُ
بالوظيفةِ (`ح-4`).
