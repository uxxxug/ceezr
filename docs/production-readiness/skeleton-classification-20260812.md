# تصنيف ملفات «هيكل فقط»

- **النطاق المفحوص:** `/home/user/workspace/repo` فقط، قراءةً دون أي تعديل فيه.
- **الجرد:** الأمر `grep -rl 'هيكل فقط' --include='*.ts' . | wc -l` أعاد **246**.
- **قاعدة التصنيف:** الفئة ١ للوحدات المستقبلية غير الموصولة بالـcontainers (مع استثناء اسم مجلد `scheduling`؛ فالدليل هناك يستبعد ملفات الهيكل ذاتها، إذ إن العامل يستخدم ملفات scheduling أخرى منفذة). الفئة ٢ عندما تؤدي دالة/RPC أو ملف منفذ فعلي الوظيفة نفسها باسم/موضع آخر. الفئة ٣ عندما أعاد بحث الاسم والفعل/RPC في `packages apps supabase/migrations` بلا نتيجة بعد استبعاد ملف الهيكل نفسه.

## مفاتيح الدليل المنسوخ من `grep`

### الفئة ١ — عدم التوصيل

| المفتاح | أمر grep والنتيجة الفعلية |
|---|---|
| F-analytics | `grep -nE 'analytics' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-documents | `grep -nE 'documents' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-enterprise | `grep -nE 'enterprise-integration' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-flags | `grep -nE 'feature-flags' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-kyc | `grep -nE 'kyc' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-marketplace | `grep -nE 'marketplace' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-scheduling | `grep -nE 'cancel-scheduled-order\|list-scheduled-orders\|materialize-recurring-order\|schedule-order\|domain/scheduling/(entity\|errors\|events\|index\|value-objects)\|infrastructure/scheduling/index' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-tenancy | `grep -nE 'tenancy' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |
| F-workflow | `grep -nE 'workflow' apps/gateway/src/container.ts apps/workers/src/container.ts` → **لا ناتج؛ grep=1** |

### الفئة ٢ — بدائل فعلية

| المفتاح | المسار البديل وسطر grep الفعلي |
|---|---|
| E-BOT | `apps/gateway/src/bots/driver/index.ts:7: ... الملفات المجاورة (offers, subscription, availability) صارت أقساماً داخل ... driver-dialog.ts` |
| E-DRIVER | `packages/application/bots/driver-dialog.ts:1098:  const registered = await deps.drivers.register({` |
| E-RIDER | `packages/application/bots/rider-dialog.ts:1133:async function createOrderAndMatch(`؛ و`...:1098:  const requested = await requestDelivery(` |
| E-RATING | `packages/application/reputation/ride-lifecycle.ts:78:export async function startRide(` و`...:91:export async function completeRide(`؛ و`packages/application/reputation/rate-driver.ts:40:export async function submitRating(` |
| E-SUPPORT | `packages/infrastructure/dispute/support-adapters.ts:50:export function createSupportTicketPort(sql: Sql): SupportTicketPort {` و`...:172:export function createSupportResolutionPort(sql: Sql): SupportResolutionPort {` |
| E-AUDIT | `apps/gateway/src/admin/queries.ts:240:    from audit_log a`؛ و`supabase/migrations/20260806120100_phase_2_1_atomic_rpcs.sql:68:  insert into audit_log ...` |
| E-CAP | `packages/infrastructure/identity/directories.ts:203:          select (record_attendance(...`؛ و`packages/infrastructure/dispatch/dispatch-adapters.ts:116:export function createDriverCandidateRepository(sql: Sql)` |
| E-DELIVERY | `packages/application/delivery/request-delivery.ts:46:export async function requestDelivery(`؛ و`packages/application/bots/rider-dialog.ts:1098:  const requested = await requestDelivery(` |
| E-DISPATCH | `packages/application/dispatch/match-order.ts:95:export async function matchOrder(`؛ `packages/application/dispatch/broadcast-offers.ts:107:export async function broadcastOffers(`؛ `apps/workers/src/jobs/expire-offers.ts:50:export async function expireOffers(` |
| E-FIN | `packages/infrastructure/financial/payment-adapters.ts:113:    confirmPayment: (input) =>`؛ `...:115:        const rows = await sql\`select confirm_payment(` |
| E-GEO | `packages/domain/geo/gps-fix.ts:237:      const distanceKm = haversineKm(...)`؛ `packages/tracking/tracking-service.ts:219:      type: "location_updated",` |
| E-IDENTITY | `packages/infrastructure/identity/directories.ts:95:    register: (input: RegisterDriverInput) =>`؛ `apps/gateway/src/admin/queries.ts:1487:    select admin_set_user_blocked(` |
| E-MSG | `packages/application/dispatch/relay-negotiation-message.ts:60:export async function relayNegotiationMessage(`؛ `...:83:  const safe = redactPhoneNumbers(body);`؛ `packages/infrastructure/dispatch/negotiation-adapters.ts:120:    advance: (negotiationId ...` |
| E-NOTIFY | `packages/infrastructure/notification/telegram-driver-notifier.ts:45:        const text = tr("driver.offer_received", {`؛ `packages/infrastructure/notification/telegram-negotiation-notifier.ts:88:      guard("publisher.escalationCard", async () => {` |
| E-POLICY | `apps/gateway/src/container.ts:90:import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";` |
| E-SAFETY | `packages/application/dispatch/escalate-unmatched-order.ts:86:  const escalated = await deps.escalation.escalate(...)`؛ `packages/application/tracking/customer-live-relay.ts:95:export function createCustomerLiveRelay(...)` |
| E-SUB | `packages/infrastructure/subscription/subscription-adapters.ts:58:      guard("rpc.start_trial", async () => {`؛ `packages/application/financial/subscribe-plan.ts:54:export async function subscribePlan(` |
| E-TRANSPORT | `packages/application/bots/rider-dialog.ts:1133:async function createOrderAndMatch(`؛ `packages/infrastructure/transport/order-adapters.ts:287:export function createPastOrdersLookup(sql: Sql)`؛ `packages/application/reputation/ride-lifecycle.ts:91:export async function completeRide(` |
| E-DISPUTE | `packages/application/dispute/resolve-dispute.ts:26:/** يقابل resolve_support_ticket ... */`؛ `packages/infrastructure/dispute/support-adapters.ts:175:      guard("rpc.resolve_support_ticket", async ...` |

### الفئة ٣ — غياب مثبت

**الأمر المستعمل لكل سطر F3 أدناه:**

```sh
grep -RInE --include='*.ts' --include='*.sql' '<الفعلCamel>|<الفعل_snake>' \
  packages apps supabase/migrations | grep -v '^<مسار-ملف-الهيكل>:'
```

**المخرج المنسوخ لكل الأفعال الـ23:** `لا ناتج؛ grep=1 بعد استبعاد ملف الهيكل`.

## apps/gateway

| المسار | الفئة | الدليل |
|---|---:|---|
| `apps/gateway/src/bots/driver/availability.ts` | ٢ | E-BOT → `apps/gateway/src/bots/driver/index.ts:7` |
| `apps/gateway/src/bots/driver/offers.ts` | ٢ | E-BOT → `apps/gateway/src/bots/driver/index.ts:7` |
| `apps/gateway/src/bots/driver/rating.ts` | ٢ | E-RATING → `packages/application/reputation/rate-driver.ts:40` |
| `apps/gateway/src/bots/driver/registration.ts` | ٢ | E-DRIVER → `packages/application/bots/driver-dialog.ts:1098` |
| `apps/gateway/src/bots/driver/subscription.ts` | ٢ | E-BOT / E-SUB → `driver-dialog.ts` و`subscription-adapters.ts:58` |
| `apps/gateway/src/bots/driver/trip-lifecycle.ts` | ٢ | E-RATING → `packages/application/reputation/ride-lifecycle.ts:78,91` |
| `apps/gateway/src/bots/rider/order-tracking.ts` | ٢ | E-RIDER / E-TRANSPORT → `rider-dialog.ts:1133` و`order-adapters.ts:287` |
| `apps/gateway/src/bots/rider/rating.ts` | ٢ | E-RATING → `packages/application/reputation/rate-driver.ts:40` |
| `apps/gateway/src/bots/rider/request-delivery.ts` | ٢ | E-RIDER → `packages/application/bots/rider-dialog.ts:1098` |
| `apps/gateway/src/bots/rider/request-ride.ts` | ٢ | E-RIDER → `packages/application/bots/rider-dialog.ts:1133` |
| `apps/gateway/src/groups/support-group.ts` | ٢ | E-SUPPORT → `packages/infrastructure/dispute/support-adapters.ts:50,172` |

## application/analytics (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/analytics/build-city-report.ts` | ١ | F-analytics |
| `packages/application/analytics/build-demand-heatmap.ts` | ١ | F-analytics |
| `packages/application/analytics/build-driver-performance-report.ts` | ١ | F-analytics |
| `packages/application/analytics/export-dataset.ts` | ١ | F-analytics |
| `packages/application/analytics/index.ts` | ١ | F-analytics |

## application/audit

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/audit/export-audit-report.ts` | ٣ | F3 `exportAuditReport\|export_audit_report` — لا ناتج بعد استبعاد هذا الملف |
| `packages/application/audit/index.ts` | ٢ | E-AUDIT → `apps/gateway/src/admin/queries.ts:240` |
| `packages/application/audit/query-audit-trail.ts` | ٢ | E-AUDIT → `apps/gateway/src/admin/queries.ts:240` |
| `packages/application/audit/record-audit-event.ts` | ٢ | E-AUDIT → `20260806120100_phase_2_1_atomic_rpcs.sql:68` |

## application/capability

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/capability/declare-capability.ts` | ٢ | E-CAP → `infrastructure/identity/directories.ts:95` |
| `packages/application/capability/index.ts` | ٢ | E-CAP → `infrastructure/identity/directories.ts:95` |
| `packages/application/capability/list-capable-drivers.ts` | ٢ | E-CAP → `infrastructure/dispatch/dispatch-adapters.ts:116` |
| `packages/application/capability/record-attendance.ts` | ٢ | E-CAP → `infrastructure/identity/directories.ts:203` |
| `packages/application/capability/toggle-availability.ts` | ٢ | E-CAP → RPC `record_attendance` في `directories.ts:203` |
| `packages/application/capability/update-capability.ts` | ٢ | E-CAP → تسجيل/upsert السائق في `directories.ts:95` |

## application/delivery

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/delivery/cancel-delivery.ts` | ٢ | E-TRANSPORT → موحّد الطلبات (`order-adapters.ts`) |
| `packages/application/delivery/deliver-parcel.ts` | ٢ | E-RATING → `ride-lifecycle.ts:91` ينهي الطلب الموحد |
| `packages/application/delivery/estimate-delivery-fare.ts` | ٣ | F3 `estimateDeliveryFare\|estimate_delivery_fare` — لا ناتج |
| `packages/application/delivery/get-delivery-status.ts` | ٢ | E-TRANSPORT → قارئات الطلب في `order-adapters.ts` |
| `packages/application/delivery/list-delivery-orders.ts` | ٢ | E-TRANSPORT → `createPastOrdersLookup` في `order-adapters.ts:287` |
| `packages/application/delivery/pickup-parcel.ts` | ٢ | E-RATING → `ride-lifecycle.ts:78` |

## application/dispatch

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/dispatch/broadcast-offer.ts` | ٢ | E-DISPATCH → `broadcast-offers.ts:107` |
| `packages/application/dispatch/claim-order.ts` | ٢ | E-DISPATCH → `match-order.ts:95` |
| `packages/application/dispatch/expire-offer.ts` | ٢ | E-DISPATCH → `apps/workers/src/jobs/expire-offers.ts:50` |
| `packages/application/dispatch/score-candidates.ts` | ٢ | E-DISPATCH → `match-order.ts:95` (اختيار/ترتيب المرشحين داخل المطابقة) |

## application/documents (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/documents/expire-document.ts` | ١ | F-documents |
| `packages/application/documents/index.ts` | ١ | F-documents |
| `packages/application/documents/list-driver-documents.ts` | ١ | F-documents |
| `packages/application/documents/upload-document.ts` | ١ | F-documents |
| `packages/application/documents/validate-document.ts` | ١ | F-documents |

## application/enterprise-integration (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/enterprise-integration/index.ts` | ١ | F-enterprise |
| `packages/application/enterprise-integration/ingest-orders-inbound.ts` | ١ | F-enterprise |
| `packages/application/enterprise-integration/reconcile-integration-state.ts` | ١ | F-enterprise |
| `packages/application/enterprise-integration/register-integration.ts` | ١ | F-enterprise |
| `packages/application/enterprise-integration/sync-orders-outbound.ts` | ١ | F-enterprise |

## application/feature-flags (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/feature-flags/disable-feature.ts` | ١ | F-flags |
| `packages/application/feature-flags/enable-feature.ts` | ١ | F-flags |
| `packages/application/feature-flags/index.ts` | ١ | F-flags |
| `packages/application/feature-flags/is-feature-enabled.ts` | ١ | F-flags |
| `packages/application/feature-flags/list-feature-flags.ts` | ١ | F-flags |

## application/financial

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/financial/charge-subscription-fee.ts` | ٢ | E-FIN → `infrastructure/financial/payment-adapters.ts:113,115` |
| `packages/application/financial/create-wallet.ts` | ٣ | F3 `createWallet\|create_wallet` — لا ناتج |
| `packages/application/financial/get-wallet-balance.ts` | ٣ | F3 `getWalletBalance\|get_wallet_balance` — لا ناتج |
| `packages/application/financial/issue-invoice.ts` | ٣ | F3 `issueInvoice\|issue_invoice` — لا ناتج |
| `packages/application/financial/refund-payment.ts` | ٣ | F3 `refundPayment\|refund_payment` — لا ناتج |
| `packages/application/financial/settle-driver-payout.ts` | ٣ | F3 `settleDriverPayout\|settle_driver_payout` — لا ناتج |
| `packages/application/financial/top-up-wallet.ts` | ٣ | F3 `topUpWallet\|top_up_wallet` — لا ناتج |

## application/geo

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/geo/calculate-distance.ts` | ٢ | E-GEO → `packages/domain/geo/gps-fix.ts:237` |
| `packages/application/geo/find-nearby-drivers.ts` | ٢ | E-CAP → `dispatch-adapters.ts:116`؛ E-GEO → مسافة `gps-fix.ts:237` |
| `packages/application/geo/index.ts` | ٢ | E-GEO → `packages/domain/geo/gps-fix.ts:237` |
| `packages/application/geo/resolve-location.ts` | ٣ | F3 `resolveLocation\|resolve_location` — لا ناتج |
| `packages/application/geo/update-driver-location.ts` | ٢ | E-GEO → `packages/tracking/tracking-service.ts:219` |
| `packages/application/geo/validate-city-boundary.ts` | ٣ | F3 `validateCityBoundary\|validate_city_boundary` — لا ناتج |

## application/identity

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/identity/assign-role.ts` | ٢ | E-IDENTITY → تسجيل المستخدم في `directories.ts:95` |
| `packages/application/identity/block-user.ts` | ٢ | E-IDENTITY → `apps/gateway/src/admin/queries.ts:1487` |
| `packages/application/identity/get-user-profile.ts` | ٢ | E-IDENTITY → قارئات الهوية في `directories.ts` |
| `packages/application/identity/index.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/application/identity/link-telegram-account.ts` | ٢ | E-IDENTITY → إدراج `telegram_id` في `directories.ts:95` |
| `packages/application/identity/register-user.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/application/identity/update-user-profile.ts` | ٢ | E-IDENTITY → upsert التسجيل في `directories.ts:95` |
| `packages/application/identity/verify-phone.ts` | ٢ | E-DRIVER → تدفق الهاتف ثم التسجيل في `driver-dialog.ts:1098` |

## application/kyc (متقدم، خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/kyc/approve-kyc.ts` | ١ | F-kyc |
| `packages/application/kyc/index.ts` | ١ | F-kyc |
| `packages/application/kyc/reject-kyc.ts` | ١ | F-kyc |
| `packages/application/kyc/review-kyc-request.ts` | ١ | F-kyc |
| `packages/application/kyc/submit-kyc-request.ts` | ١ | F-kyc |
| `packages/application/kyc/verify-against-government-registry.ts` | ١ | F-kyc |

## application/marketplace (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/marketplace/confirm-order.ts` | ١ | F-marketplace |
| `packages/application/marketplace/index.ts` | ١ | F-marketplace |
| `packages/application/marketplace/place-order.ts` | ١ | F-marketplace |
| `packages/application/marketplace/publish-listing.ts` | ١ | F-marketplace |
| `packages/application/marketplace/search-listings.ts` | ١ | F-marketplace |
| `packages/application/marketplace/settle-order.ts` | ١ | F-marketplace |
| `packages/application/marketplace/update-listing.ts` | ١ | F-marketplace |
| `packages/application/marketplace/withdraw-listing.ts` | ١ | F-marketplace |

## application/messaging

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/messaging/close-relay-channel.ts` | ٢ | E-MSG → `negotiation-adapters.ts:120` (advance/close الدورة) |
| `packages/application/messaging/get-relay-transcript.ts` | ٣ | F3 `getRelayTranscript\|get_relay_transcript` — لا ناتج |
| `packages/application/messaging/index.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |
| `packages/application/messaging/mask-contact-details.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:83` |
| `packages/application/messaging/open-relay-channel.ts` | ٢ | E-MSG → دورة التفاوض في `negotiation-adapters.ts` |
| `packages/application/messaging/relay-message.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |

## application/notification

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/notification/get-user-notifications.ts` | ٣ | F3 `getUserNotifications\|get_user_notifications` — لا ناتج |
| `packages/application/notification/index.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |
| `packages/application/notification/mark-notification-read.ts` | ٣ | F3 `markNotificationRead\|mark_notification_read` — لا ناتج |
| `packages/application/notification/schedule-notification.ts` | ٣ | F3 `scheduleNotification\|schedule_notification` — لا ناتج |
| `packages/application/notification/send-bulk-notification.ts` | ٣ | F3 `sendBulkNotification\|send_bulk_notification` — لا ناتج |
| `packages/application/notification/send-notification.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |

## application/policy

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/policy/evaluate-cancellation-policy.ts` | ٣ | F3 `evaluateCancellationPolicy\|evaluate_cancellation_policy` — لا ناتج |
| `packages/application/policy/evaluate-pricing-policy.ts` | ٣ | F3 `evaluatePricingPolicy\|evaluate_pricing_policy` — لا ناتج |
| `packages/application/policy/get-setting.ts` | ٢ | E-POLICY → `apps/gateway/src/container.ts:90` |
| `packages/application/policy/index.ts` | ٢ | E-POLICY → `settings-repository.ts` المستورد في container |
| `packages/application/policy/list-city-policies.ts` | ٢ | E-POLICY → `settings-repository.ts` المستورد في container |
| `packages/application/policy/set-setting.ts` | ٢ | E-POLICY → `settings-repository.ts` المستورد في container |

## application/safety

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/safety/index.ts` | ٢ | E-SAFETY → التصعيد/الموقع الحي في `escalate-unmatched-order.ts:86` و`customer-live-relay.ts:95` |
| `packages/application/safety/notify-escalation-group.ts` | ٢ | E-SAFETY → `escalate-unmatched-order.ts:86` |
| `packages/application/safety/resolve-safety-incident.ts` | ٣ | F3 `resolveSafetyIncident\|resolve_safety_incident` — لا ناتج |
| `packages/application/safety/share-live-trip.ts` | ٢ | E-SAFETY → `customer-live-relay.ts:95` |
| `packages/application/safety/trigger-sos.ts` | ٣ | F3 `triggerSos\|trigger_sos` — لا ناتج؛ و`apps/gateway/src/groups/escalation-group.ts:8` يقول: «ما زال ناقصاً: زرّ SOS» |

## application/scheduling (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/scheduling/cancel-scheduled-order.ts` | ١ | F-scheduling |
| `packages/application/scheduling/index.ts` | ١ | F-scheduling |
| `packages/application/scheduling/list-scheduled-orders.ts` | ١ | F-scheduling |
| `packages/application/scheduling/materialize-recurring-order.ts` | ١ | F-scheduling |
| `packages/application/scheduling/schedule-order.ts` | ١ | F-scheduling |

## application/subscription

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/subscription/cancel-subscription.ts` | ٤ — منفَّذ فعلياً (تصحيح 2026-08-13) | نُفِّذ فعلاً قبل صدور هذا التصنيف: `cancel-subscription.ts:58 export async function cancelSubscription` + دالّة `cancel_subscription` موجودة في القاعدة (هجرة `20260812130000_subscription_cancel_and_upgrade.sql`) + موصولة في `apps/gateway/src/container.ts:601` + اختبار `tests/unit/subscription-changes.test.ts`. الدليل الحرفي: [`docs/evidence/coordinator-doc-corrections-20260813.txt`](../evidence/coordinator-doc-corrections-20260813.txt). سبب إدراجها خطأً في الفئة ٣: عبارة «هيكل فقط» ما زالت مقتبسة تاريخياً داخل ترويسة الملف، فأحصاها جرد grep. |
| `packages/application/subscription/check-subscription-status.ts` | ٢ | E-SUB → قارئ الاشتراك في `subscription-adapters.ts` |
| `packages/application/subscription/index.ts` | ٢ | E-SUB → `subscription-adapters.ts:58` |
| `packages/application/subscription/renew-subscription.ts` | ٢ | E-FIN/E-SUB → `confirm_payment` واشتراك مدفوع بديل |
| `packages/application/subscription/start-trial.ts` | ٢ | E-SUB → `subscription-adapters.ts:58` |
| `packages/application/subscription/subscribe-plan.ts` | ٢ | E-SUB → `packages/application/financial/subscribe-plan.ts:54` |
| `packages/application/subscription/upgrade-plan.ts` | ٤ — منفَّذ فعلياً (تصحيح 2026-08-13) | نُفِّذ فعلاً قبل صدور هذا التصنيف: `upgrade-plan.ts:93 export async function upgradePlan` + دالّتا `plan_upgrade_quote` و`upgrade_plan` في القاعدة (نفس الهجرة) + موصولة في `apps/gateway/src/container.ts:601` + اختبار `tests/unit/subscription-changes.test.ts`. الدليل الحرفي: [`docs/evidence/coordinator-doc-corrections-20260813.txt`](../evidence/coordinator-doc-corrections-20260813.txt). سبب الإدراج الخطأ: الاقتباس التاريخي لعبارة «هيكل فقط» في الترويسة. |

## application/tenancy (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/tenancy/assign-user-to-tenant.ts` | ١ | F-tenancy |
| `packages/application/tenancy/create-tenant.ts` | ١ | F-tenancy |
| `packages/application/tenancy/get-tenant-context.ts` | ١ | F-tenancy |
| `packages/application/tenancy/index.ts` | ١ | F-tenancy |
| `packages/application/tenancy/suspend-tenant.ts` | ١ | F-tenancy |

## application/transport

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/transport/cancel-ride.ts` | ٢ | E-TRANSPORT → إلغاء الطلب الموحد في `order-adapters.ts` |
| `packages/application/transport/complete-ride.ts` | ٢ | E-RATING → `ride-lifecycle.ts:91` |
| `packages/application/transport/estimate-ride-fare.ts` | ٣ | F3 `estimateRideFare\|estimate_ride_fare` — لا ناتج |
| `packages/application/transport/get-ride-status.ts` | ٢ | E-TRANSPORT → قارئات الطلب في `order-adapters.ts` |
| `packages/application/transport/index.ts` | ٢ | E-TRANSPORT → `order-adapters.ts` |
| `packages/application/transport/list-driver-rides.ts` | ٣ | F3 `listDriverRides\|list_driver_rides` — لا ناتج |
| `packages/application/transport/list-rider-rides.ts` | ٢ | E-TRANSPORT → `createPastOrdersLookup` في `order-adapters.ts:287` |
| `packages/application/transport/request-ride.ts` | ٢ | E-RIDER → `rider-dialog.ts:1133` |
| `packages/application/transport/start-ride.ts` | ٢ | E-RATING → `ride-lifecycle.ts:78` |

## application/workflow (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/application/workflow/abort-workflow-instance.ts` | ١ | F-workflow |
| `packages/application/workflow/advance-workflow-step.ts` | ١ | F-workflow |
| `packages/application/workflow/define-workflow.ts` | ١ | F-workflow |
| `packages/application/workflow/index.ts` | ١ | F-workflow |
| `packages/application/workflow/start-workflow-instance.ts` | ١ | F-workflow |

## domain/analytics (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/analytics/entity.ts` | ١ | F-analytics |
| `packages/domain/analytics/errors.ts` | ١ | F-analytics |
| `packages/domain/analytics/events.ts` | ١ | F-analytics |
| `packages/domain/analytics/index.ts` | ١ | F-analytics |
| `packages/domain/analytics/value-objects.ts` | ١ | F-analytics |

## domain/audit

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/audit/entity.ts` | ٢ | E-AUDIT → `audit_log` في `admin/queries.ts:240` |
| `packages/domain/audit/errors.ts` | ٢ | E-AUDIT → RPCs تكتب `audit_log` في الهجرة:68 |
| `packages/domain/audit/events.ts` | ٢ | E-AUDIT → RPCs تكتب `audit_log` في الهجرة:68 |
| `packages/domain/audit/index.ts` | ٢ | E-AUDIT → `audit_log` في `admin/queries.ts:240` |
| `packages/domain/audit/value-objects.ts` | ٢ | E-AUDIT → `audit_log` في `admin/queries.ts:240` |

## domain/capability

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/capability/errors.ts` | ٢ | E-CAP → `record_attendance` في `directories.ts:203` |
| `packages/domain/capability/events.ts` | ٢ | E-CAP → `record_attendance` في `directories.ts:203` |
| `packages/domain/capability/value-objects.ts` | ٢ | E-CAP → `createDriverCandidateRepository` في `dispatch-adapters.ts:116` |

## domain/dispatch

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/dispatch/errors.ts` | ٢ | E-DISPATCH → `match-order.ts:95` |
| `packages/domain/dispatch/events.ts` | ٢ | E-DISPATCH → `broadcast-offers.ts:107` |

## domain/documents (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/documents/entity.ts` | ١ | F-documents |
| `packages/domain/documents/errors.ts` | ١ | F-documents |
| `packages/domain/documents/events.ts` | ١ | F-documents |
| `packages/domain/documents/index.ts` | ١ | F-documents |
| `packages/domain/documents/value-objects.ts` | ١ | F-documents |

## domain/enterprise-integration (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/enterprise-integration/entity.ts` | ١ | F-enterprise |
| `packages/domain/enterprise-integration/errors.ts` | ١ | F-enterprise |
| `packages/domain/enterprise-integration/events.ts` | ١ | F-enterprise |
| `packages/domain/enterprise-integration/index.ts` | ١ | F-enterprise |
| `packages/domain/enterprise-integration/value-objects.ts` | ١ | F-enterprise |

## domain/feature-flags (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/feature-flags/entity.ts` | ١ | F-flags |
| `packages/domain/feature-flags/errors.ts` | ١ | F-flags |
| `packages/domain/feature-flags/events.ts` | ١ | F-flags |
| `packages/domain/feature-flags/index.ts` | ١ | F-flags |
| `packages/domain/feature-flags/value-objects.ts` | ١ | F-flags |

## domain/financial

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/financial/errors.ts` | ٢ | E-FIN → `payment-adapters.ts:113,115` |
| `packages/domain/financial/events.ts` | ٢ | E-FIN → RPC `confirm_payment` في `payment-adapters.ts:115` |

## domain/geo

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/geo/events.ts` | ٢ | E-GEO → `tracking-service.ts:219: type: "location_updated"` |

## domain/identity

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/identity/entity.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/domain/identity/errors.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/domain/identity/events.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/domain/identity/index.ts` | ٢ | E-IDENTITY → `directories.ts:95` |

## domain/kyc (متقدم، خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/kyc/errors.ts` | ١ | F-kyc |
| `packages/domain/kyc/events.ts` | ١ | F-kyc |
| `packages/domain/kyc/index.ts` | ١ | F-kyc |

## domain/marketplace (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/marketplace/entity.ts` | ١ | F-marketplace |
| `packages/domain/marketplace/errors.ts` | ١ | F-marketplace |
| `packages/domain/marketplace/events.ts` | ١ | F-marketplace |
| `packages/domain/marketplace/index.ts` | ١ | F-marketplace |
| `packages/domain/marketplace/value-objects.ts` | ١ | F-marketplace |

## domain/messaging

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/messaging/entity.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |
| `packages/domain/messaging/errors.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |
| `packages/domain/messaging/events.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |
| `packages/domain/messaging/index.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:60` |
| `packages/domain/messaging/value-objects.ts` | ٢ | E-MSG → `relay-negotiation-message.ts:83` |

## domain/notification

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/notification/entity.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |
| `packages/domain/notification/errors.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |
| `packages/domain/notification/events.ts` | ٢ | E-NOTIFY → `telegram-negotiation-notifier.ts:88` |
| `packages/domain/notification/index.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |
| `packages/domain/notification/value-objects.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |

## domain/policy

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/policy/errors.ts` | ٢ | E-POLICY → `createSettingsRepository` في `container.ts:90` |
| `packages/domain/policy/events.ts` | ٢ | E-POLICY → `createSettingsRepository` في `container.ts:90` |
| `packages/domain/policy/value-objects.ts` | ٢ | E-POLICY → `createSettingsRepository` في `container.ts:90` |

## domain/safety

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/safety/entity.ts` | ٢ | E-SAFETY → `escalate-unmatched-order.ts:86` |
| `packages/domain/safety/errors.ts` | ٢ | E-SAFETY → `escalate-unmatched-order.ts:86` |
| `packages/domain/safety/events.ts` | ٢ | E-SAFETY → `customer-live-relay.ts:95` |
| `packages/domain/safety/index.ts` | ٢ | E-SAFETY → التصعيد/الموقع الحي |
| `packages/domain/safety/value-objects.ts` | ٢ | E-SAFETY → `customer-live-relay.ts:95` |

## domain/scheduling (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/scheduling/entity.ts` | ١ | F-scheduling |
| `packages/domain/scheduling/errors.ts` | ١ | F-scheduling |
| `packages/domain/scheduling/events.ts` | ١ | F-scheduling |
| `packages/domain/scheduling/index.ts` | ١ | F-scheduling |
| `packages/domain/scheduling/value-objects.ts` | ١ | F-scheduling |

## domain/subscription

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/subscription/errors.ts` | ٢ | E-SUB → `subscription-adapters.ts:58` |
| `packages/domain/subscription/events.ts` | ٢ | E-SUB → RPC `start_trial` في `subscription-adapters.ts:58` |
| `packages/domain/subscription/value-objects.ts` | ٢ | E-SUB → `subscription-adapters.ts:58` |

## domain/tenancy (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/tenancy/entity.ts` | ١ | F-tenancy |
| `packages/domain/tenancy/errors.ts` | ١ | F-tenancy |
| `packages/domain/tenancy/events.ts` | ١ | F-tenancy |
| `packages/domain/tenancy/index.ts` | ١ | F-tenancy |
| `packages/domain/tenancy/value-objects.ts` | ١ | F-tenancy |

## domain/transport

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/transport/errors.ts` | ٢ | E-TRANSPORT → `order-adapters.ts:287` |
| `packages/domain/transport/events.ts` | ٢ | E-RATING → `ride-lifecycle.ts:78,91` |
| `packages/domain/transport/value-objects.ts` | ٢ | E-TRANSPORT → `order-adapters.ts:287` |

## domain/workflow (خارج النطاق)

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/domain/workflow/entity.ts` | ١ | F-workflow |
| `packages/domain/workflow/errors.ts` | ١ | F-workflow |
| `packages/domain/workflow/events.ts` | ١ | F-workflow |
| `packages/domain/workflow/index.ts` | ١ | F-workflow |
| `packages/domain/workflow/value-objects.ts` | ١ | F-workflow |

## infrastructure

| المسار | الفئة | الدليل |
|---|---:|---|
| `packages/infrastructure/analytics/index.ts` | ١ | F-analytics |
| `packages/infrastructure/audit/index.ts` | ٢ | E-AUDIT → `audit_log` في `admin/queries.ts:240` |
| `packages/infrastructure/capability/index.ts` | ٢ | E-CAP → `directories.ts:203` |
| `packages/infrastructure/delivery/index.ts` | ٢ | E-DELIVERY → `request-delivery.ts:46` |
| `packages/infrastructure/dispatch/index.ts` | ٢ | E-DISPATCH → `match-order.ts:95` |
| `packages/infrastructure/dispute/index.ts` | ٢ | E-DISPUTE → `support-adapters.ts:175` |
| `packages/infrastructure/documents/index.ts` | ١ | F-documents |
| `packages/infrastructure/enterprise-integration/index.ts` | ١ | F-enterprise |
| `packages/infrastructure/feature-flags/index.ts` | ١ | F-flags |
| `packages/infrastructure/geo/index.ts` | ٢ | E-GEO → `tracking-service.ts:219` |
| `packages/infrastructure/identity/index.ts` | ٢ | E-IDENTITY → `directories.ts:95` |
| `packages/infrastructure/kyc/index.ts` | ١ | F-kyc |
| `packages/infrastructure/marketplace/index.ts` | ١ | F-marketplace |
| `packages/infrastructure/messaging/index.ts` | ٢ | E-MSG → `negotiation-adapters.ts:120` |
| `packages/infrastructure/notification/index.ts` | ٢ | E-NOTIFY → `telegram-driver-notifier.ts:45` |
| `packages/infrastructure/policy/index.ts` | ٢ | E-POLICY → `container.ts:90` |
| `packages/infrastructure/safety/index.ts` | ٢ | E-SAFETY → `customer-live-relay.ts:95` |
| `packages/infrastructure/scheduling/index.ts` | ١ | F-scheduling |
| `packages/infrastructure/subscription/index.ts` | ٢ | E-SUB → `subscription-adapters.ts:58` |
| `packages/infrastructure/tenancy/index.ts` | ١ | F-tenancy |
| `packages/infrastructure/transport/index.ts` | ٢ | E-TRANSPORT → `order-adapters.ts:287` |
| `packages/infrastructure/workflow/index.ts` | ١ | F-workflow |

## ملخص الأرقام

| الفئة | العدد |
|---|---:|
| ١ — هيكل مشروع خارج النطاق | 101 |
| ٢ — استُبدل بتنفيذ فعلي باسم آخر | 122 |
| ٣ — فجوة صامتة | 21 |
| ٤ — أُدرج خطأً ثم ثبت أنه منفَّذ فعلياً (تصحيح 2026-08-13) | 2 |
| **المجموع** | **246** |

التحقق الحسابي: `101 + 122 + 21 + 2 = 246`، وهو يطابق خرج جرد grep.

**تصحيح مؤرَّخ 2026-08-13 (الوكيل المنسِّق):** البندان ١٤ و١٥ في قائمة الفئة ٣ أدناه
(`cancel-subscription.ts` و`upgrade-plan.ts`) لم يكونا فجوتين وقت كتابة هذا المستند؛ كانا
منفَّذين وموصولين ومختبَرين، وإنما أحصاهما جرد `grep 'هيكل فقط'` لأن العبارة باقية
مقتبسةً تاريخياً في ترويستيهما. فالفجوات الحقيقية المفتوحة عند بدء أمر الإغلاق الشامل
**21 لا 23**. لم يُحذف أي سطر من هذا المستند؛ البندان أُبقيا في القائمة مع وسم إغلاق.

## ملفات الفئة ٣ فقط — مرتبة حسب الأثر التجاري

### حرج: سلامة، أموال، أو امتثال

1. `packages/application/safety/trigger-sos.ts` — لا مسار SOS؛ والدليل الإضافي المنسوخ: `apps/gateway/src/groups/escalation-group.ts:8: ما زال ناقصاً: زرّ SOS ...`.
2. `packages/application/safety/resolve-safety-incident.ts` — لا RPC أو تنفيذ باسم الحادث الأمني.
3. `packages/application/financial/refund-payment.ts` — لا ردّ دفعة.
4. `packages/application/financial/settle-driver-payout.ts` — لا تسوية مستحقات السائق.
5. `packages/application/financial/get-wallet-balance.ts` — لا كشف رصيد.
6. `packages/application/financial/create-wallet.ts` — لا محفظة.
7. `packages/application/financial/top-up-wallet.ts` — لا شحن رصيد.
8. `packages/application/financial/issue-invoice.ts` — لا فاتورة.
9. `packages/application/audit/export-audit-report.ts` — لا تصدير لسجل التدقيق.

### عالٍ: تسعير/طلب/تجربة المستخدم الأساسية

10. `packages/application/policy/evaluate-pricing-policy.ts` — لا محرك تسعير.
11. `packages/application/transport/estimate-ride-fare.ts` — لا تقدير أجرة مشوار.
12. `packages/application/delivery/estimate-delivery-fare.ts` — لا تقدير أجرة توصيل.
13. `packages/application/policy/evaluate-cancellation-policy.ts` — لا سياسة قرار الإلغاء.
14. ~~`packages/application/subscription/cancel-subscription.ts` — لا إلغاء اشتراك.~~ **مُغلَق — بل لم يكن مفتوحاً**: منفَّذ وموصول ومختبَر منذ 2026-08-12؛ تصحيح 2026-08-13، الدليل في `docs/evidence/coordinator-doc-corrections-20260813.txt`.
15. ~~`packages/application/subscription/upgrade-plan.ts` — لا ترقية خطة.~~ **مُغلَق — بل لم يكن مفتوحاً**: منفَّذ وموصول ومختبَر منذ 2026-08-12؛ تصحيح 2026-08-13، نفس ملف الدليل.
16. `packages/application/geo/resolve-location.ts` — لا تحويل موقع/عنوان.
17. `packages/application/geo/validate-city-boundary.ts` — لا منع موقع خارج نطاق المدينة.

### متوسط: التشغيل والتواصل

18. `packages/application/notification/send-bulk-notification.ts` — لا إرسال جماعي.
19. `packages/application/notification/schedule-notification.ts` — لا جدولة إشعار.
20. `packages/application/notification/get-user-notifications.ts` — لا صندوق إشعارات.
21. `packages/application/notification/mark-notification-read.ts` — لا حالة قراءة.
22. `packages/application/messaging/get-relay-transcript.ts` — لا سجل/نسخة لمراسلات relay.
23. `packages/application/transport/list-driver-rides.ts` — لا قائمة تاريخ مشاوير السائق.
