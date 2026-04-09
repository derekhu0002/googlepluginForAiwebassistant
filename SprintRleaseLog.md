# Release Summary: THINKING duplicate reasoning fix

## Release Status

- Status: completed
- Date: 2026-04-09
- Goal: 修复 THINKING 框重复 reasoning 文本问题，完成 full-model 实现收尾并通过最终回归验证。
- Fast-track baseline commit: `91d5b9324b106214e25e79e7f8bc728f74478871`
- Full-model implementation commit: `525290be0b9f29b365352c7f01e037c82d922ae5`
- Final validated commit: `9f1673248fe60b9a107cde5fe15b0aace5ec518d`

## Release Summary

- TASK-002..TASK-007 completed for the normalized event contract, shared protocol/schema adoption, reasoning projection merge semantics, App live-run replay/lifecycle handling, renderer scope reduction, and regression coverage.
- QA retry regression fix on `9f1673248fe60b9a107cde5fe15b0aace5ec518d` restored session/history/lifecycle behavior while preserving reasoningTimeline semantic authority and duplicate-prevention guarantees.

## Completed Scope

- `TASK-002`: Implement normalized event contract metadata for reasoning and assistant text emissions
- `TASK-003`: Adopt the extended normalized event contract in extension shared protocol and SSE schema validation
- `TASK-004`: Refactor reasoningTimeline projection to merge Thinking by semantic identity instead of view-layer text dedupe
- `TASK-005`: Constrain App live run state handling to transport replay dedupe and lifecycle updates
- `TASK-006`: Reduce renderer duplicate-handling logic so Thinking rendering depends on projected read-model semantics
- `TASK-007`: Add regression tests for normalized contract, projection merge, renderer scope, and current-session duplicate prevention

## Validation Results

- QA: passed
  - Verified App full regression suite is green, targeted extension suites passed, THINKING duplicate regressions passed, projection semantics regressions passed, python adapter regressions passed, and extension typecheck passed.
- Audit: passed
  - Confirmed the duplicate-thinking repair remains aligned with the approved architecture: normalized contract ownership stays in adapter/protocol layers, `reasoningTimeline.ts` remains semantic authority, `App.tsx` handles replay/lifecycle shell behavior only, and `reasoningTimelineView.tsx` stays render-only.

## Commit Traceability

- Fast-track baseline: `91d5b9324b106214e25e79e7f8bc728f74478871`
- Full-model implementation: `525290be0b9f29b365352c7f01e037c82d922ae5`
- QA retry regression fix / final validated commit: `9f1673248fe60b9a107cde5fe15b0aace5ec518d`

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- Completed tasks: `TASK-002`, `TASK-003`, `TASK-004`, `TASK-005`, `TASK-006`, `TASK-007`
- QA status: `passed`
- Audit status: `passed`

## Release Conclusion

The THINKING duplicate reasoning fix is finalized on commit `9f1673248fe60b9a107cde5fe15b0aace5ec518d`. The release removes repeated reasoning rendering by shifting duplicate handling to normalized event/projection semantics, preserving renderer simplicity and restoring session/history/lifecycle behavior, with QA and Audit both passing.
