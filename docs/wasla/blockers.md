# حواجزُ الحكمِ — مُولَّدةٌ من `ROADMAP.md`

**هذه الوثيقةُ مُولَّدةٌ. لا تُحرَّرْ يداً** (القاعدةُ 0.6): تُولَّدُ بـ
`bun run scripts/check-blocker-registry.ts --write`، ومصدرُها الوحيدُ جداولُ
`ROADMAP.md`. فإن أردتَ تغييرَ حاجزٍ فغيِّرْ صفَّه هناكَ.

المُفكَّكُ: **18** حاجزاً، منها **17** مفتوحةٌ.

| المعرّفُ | الصنفُ | الحالةُ | ما هوَ | ماذا يمنعُ |
|---|---|---|---|---|
| `DEP-CORE-001` | تبعيّةٌ على CORE | مُغلَقٌ | ~~No network ingress that accepts `move.job.*` events~~ — **CLOSED** by CORE `d2c38e3`, read at CORE@`1231817` on 2026-09-12 | Was blocking outbox delivery for item 5; the production shipper now exists |
| `DEP-CORE-002` | تبعيّةٌ على CORE | **مفتوحٌ** | No cheap entitlement read | Item 7 (payment/wallet/subscription handover) |
| `DEP-CORE-003` | تبعيّةٌ على CORE | **مفتوحٌ** | No city/geography change event | Item 1 execution and item 2 |
| `DEP-CORE-004` | تبعيّةٌ على CORE | **مفتوحٌ** | No Telegram channel adapter | Item 6 |
| `DEP-CORE-005` | تبعيّةٌ على CORE | **مفتوحٌ** | No mutual repository access, so vendored contract freshness cannot be verified automatically | Contract parity stays a manually compared sha256 fingerprint |
| `DEP-CORE-006` | تبعيّةٌ على CORE | **مفتوحٌ** | `core.fulfillment.created` carries no city or geography, and `organization_id` / `order_reference` are opaque here | Landing the item 4 and 5 schema under sovereign rule 0.4; also driver assignment later, since drivers are city-bound |
| `DEP-CORE-007` | تبعيّةٌ على CORE | **مفتوحٌ** | No shared CORE environment and no service credential for MOVE, so no delivery to a real CORE can be measured | Item 5 can only be measured against CORE's written contract, never against CORE itself |
| `DEP-CORE-008` | تبعيّةٌ على CORE | **مفتوحٌ** | No consent surface: CORE owns identity (`users` is `MOVE_TO_CORE`, wave 5) but publishes no way to record or read a user's acceptance of the platform's terms and privacy policy with a versioned, timestamped record | `F2-01`'s `user_consents` has to live in MOVE today, which means the same person would consent twice if MARKET ever asks. The boundary registry records it `MOVE_TO_CORE` and the migration matrix gives it a plan; both are blocked on this |
| `O-1` | قرارُ مالكٍ | **مفتوحٌ** | Either CORE adds city/geography to `core.fulfillment.created` (`DEP-CORE-006`), or a new governing appendix extends the closed `domain-ingress receipt` class to cover `core_event_inbox` and `move_event_outbox` and rules on `operational_jobs` | The 2026-09-04 governing appendix states the class is closed and can only be extended by a new governing appendix from the owner — not by an ADR, a comment in a migration, or an exception in a guard |
| `O-2` | قرارُ مالكٍ | **مفتوحٌ** | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as repository secrets | The `real-redis` CI job asserts a real Redis (`OPS-006`) and must not be weakened, silenced or skip-classified; the previous secrets belonged to the former repository account |
| `O-3` | قرارُ مالكٍ | **مفتوحٌ** | Issue a CORE bearer service credential for MOVE and set `CORE_EVENTS_BASE_URL` / `CORE_EVENTS_BEARER_TOKEN` on the worker | Credentials in CORE are owned by CORE; this repository must not mint or assume them, and the shipping job stays unregistered without them |
| `O-4` | قرارُ مالكٍ | **مفتوحٌ** | Provision a CORE `event_subscription` for `core.*` pointing at `https://<gateway>/webhook/core-events` with a signing secret of at least 32 characters, and set `CORE_INBOUND_SIGNING_SECRET` on the gateway | CORE's outbound contract states subscriptions are operator-provisioned and the secret is never echoed back; this repository receives what was provisioned and does not provision it |
| `O-6` | قرارُ مالكٍ | **مفتوحٌ** | Grant this repository's CI read access to CORE's contract directory — a read-only fine-grained token for `uxxxug/wasla-core` as a repository Actions secret, or a published copy of `contracts/` that a public job can read (a submodule, a release artifact, or a public mirror of that directory only) | `uxxxug/wasla-core` is **private** and the CI token of `uxxxug/ceezr` cannot read another private repository. Granting cross-repository read is an owner act: it is an access decision about CORE's repository, not a change in this one. Without it `scripts/check-core-contract-freshness.ts` can be run by hand wherever a CORE checkout exists, but `verify` cannot judge freshness, so `DEP-CORE-005` stays open. The comparator is deliberately built to **refuse to pass** when no CORE source is available rather than report a freshness it did not measure |
| `B-1` | حاجزُ برنامجٍ | **مفتوحٌ** | Production data inventory unknown (row counts, duplicate identities, live jobs) | No migration can be planned against real volumes |
| `B-2` | حاجزُ برنامجٍ | **مفتوحٌ** | Duplicate-identity merge policy undecided | Identity handover to CORE cannot complete |
| `B-3` | حاجزُ برنامجٍ | **مفتوحٌ** | No CORE database or environment provisioned | Integration against CORE cannot be executed end-to-end yet |
| `B-4` | حاجزُ برنامجٍ | **مفتوحٌ** | Regulatory pricing policy undecided | Operational pricing inputs cannot be finalised |
| `B-5` | حاجزُ برنامجٍ | **مفتوحٌ** | No production release approval | No production deployment will be attempted |
