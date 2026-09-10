/**
 * الغرض: مَخرَجُ حزمةِ الصمودِ (`CAP-006` · `F8-04`).
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: shared/resilience
 */

export {
  type Bulkhead,
  type BulkheadConfig,
  type BulkheadPermit,
  type BulkheadSnapshot,
  createBulkhead,
} from "./bulkhead.ts";
export {
  type BreakerConfig,
  type BreakerSnapshot,
  type BreakerState,
  type CircuitBreaker,
  createCircuitBreaker,
} from "./circuit-breaker.ts";
export {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  DEPENDENCY_NAMES,
  type DependencyGuard,
  type DependencyGuardOptions,
  type DependencyName,
  type GuardBudget,
  type GuardOutcome,
  type GuardRejection,
  type GuardRejectionReason,
  type GuardSnapshot,
} from "./dependency-guard.ts";
