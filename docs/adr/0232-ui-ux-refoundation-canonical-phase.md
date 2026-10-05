# ADR 0232: WASLA UI/UX Refoundation — Canonical Phase Activation

**Status:** Accepted
**Date:** 2026-10-05

## Context

The project has accumulated multiple design directives across three input files:
1. The "Final Approved Design" (lTryq.txt) — high-level design vision
2. The "Executive Directive v2.0" (50-page PDF) — most detailed implementation specification
3. The "Final Design Directive for All Interfaces v1.0" (49-page PDF) — earlier version

The previous roadmap (ROADMAP.md) focused on WASLA MOVE field execution and is now superseded by the UI/UX Refoundation phase.

## Decision

1. **v2.0 (PDF) is the governing reference** for implementation details when files conflict.
2. **lTryq.txt governs design direction** unless it contradicts reality or v2.0.
3. **The nine creative ideas (§13 of v2.0) are adopted** and are part of the Definition of Done.
4. **The previous roadmap is marked Historical/Superseded** — the active phase is now "WASLA UI/UX REFOUNDATION".
5. **A new CI gate `check-state-sync`** is created to enforce that code + state + roadmap + affected documentation move together, using a manifest/declaration mechanism in `docs/work-packets/*.json`.
6. **The canonical UI/UX directive** is at `docs/UI_UX_CANONICAL_DIRECTIVE.md`.

## Consequences

- All UI/UX work must follow the PR sequence (PR 0–11) from v2.0 §15.
- Every PR with implementation changes must include a work-packet manifest declaring affected files and documentation.
- Every implementation file in the diff must be declared in the manifest.
- Every declared affected doc must actually be modified.
- Any modified documentation not declared in the manifest causes failure.
- The nine creative ideas must be implemented or their deferral documented.
- Branch protection on `main` is recommended but requires owner action (GitHub admin settings).
- No commit-message exceptions — the manifest is the only enforcement path.
