# Release Summary: ELM-007 sidepanel conversation redesign

## Release Status

- Status: completed
- Date: 2026-04-07
- Goal: Rebuild the extension conversation into a single chat-first stream closer to the left opencode-style reference, with real-time reasoning/progress, final result, inline question options/answers, continued follow-up input, and default-hidden/demoted legacy cards.
- Final validated commit: `e96c41d9432a89604d314c4ac3f6dd585f00a31f`

## Release Summary

- TASK-065 refactored `extension/src/sidepanel/App.tsx` into a chat-first shell with a primary conversation surface, persistent composer, and demoted secondary utility panels.
- TASK-066 added unified stream mapping in `extension/src/sidepanel/reasoningTimeline.ts` to merge prompts, reasoning/progress, inline questions and answers, final results, and errors into one ordered conversation model.
- TASK-067 updated `extension/src/sidepanel/reasoningTimelineView.tsx` to render inline question options, answer controls, and collapsible reasoning directly in the assistant flow.
- TASK-068 restyled `extension/src/sidepanel/styles.css` to match the chat-first opencode-like hierarchy and visually demote legacy cards behind collapsed secondary panels.
- TASK-069 aligned live and history rendering in `extension/src/sidepanel/App.tsx` and `extension/src/sidepanel/useRunHistory.ts` so both use the same conversation contract and new live runs clear stale history selection.
- TASK-070 expanded `extension/src/sidepanel/App.test.tsx` regression coverage for chat-first interaction flows, inline question answering, collapsed reasoning, and preserved run-start and permission behavior.

## Completed Scope

- TASK-065: Refactor `App.tsx` into a chat-first sidepanel shell for ELM-007.
- TASK-066: Add unified chat-stream view-model mapping in `reasoningTimeline.ts` for ELM-007.
- TASK-067: Render inline question options and collapsible reasoning in `reasoningTimelineView.tsx` for ELM-007.
- TASK-068: Restyle sidepanel to opencode-like chat-first hierarchy in `styles.css` for ELM-007.
- TASK-069: Align live and history conversation rendering in `App.tsx`/`useRunHistory.ts` for ELM-007.
- TASK-070: Expand sidepanel chat-first regression coverage in `App.test.tsx` for ELM-007.

## Validation Results

- QA: passed
  - Validated commit `e96c41d9432a89604d314c4ac3f6dd585f00a31f` across the chat-first shell, unified conversation mapper, inline question renderer, history alignment, styling changes, and regression coverage.
  - Evidence: targeted vitest execution for `src/sidepanel/App.test.tsx` and `src/sidepanel/reasoningTimeline.test.ts` passed (29 tests), extension typecheck passed, and extension production build passed.
  - Confirmed chat-first primary layout, in-stream reasoning/progress, in-stream final result, inline question answering, continued follow-up composer, shared live/history presentation contract, and default-collapsed secondary panels.
- Audit: passed
  - Confirmed ELM-007 implementation aligns with intended chat-first redesign across `App.tsx`, `reasoningTimeline.ts`, `reasoningTimelineView.tsx`, `useRunHistory.ts`, and `styles.css`.
  - Confirmed ArchitectureID evidence for ELM-APP-EXT-CONVERSATION-SHELL, ELM-APP-EXT-RUN-CONVERSATION-MAPPER, ELM-APP-EXT-CONVERSATION-RENDERER, and ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX, with regression protection in `App.test.tsx`.

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- Final validated commit: `e96c41d9432a89604d314c4ac3f6dd585f00a31f`
- Completed tasks: `TASK-065`, `TASK-066`, `TASK-067`, `TASK-068`, `TASK-069`, `TASK-070`

## Release Conclusion

ELM-007 sidepanel conversation redesign is complete, QA-validated, and audit-approved for release recording. The extension sidepanel now presents a unified chat-first conversation with real-time reasoning/progress, inline questions and answers, continued follow-up input, aligned live/history rendering, and legacy cards demoted behind default-collapsed secondary panels.
