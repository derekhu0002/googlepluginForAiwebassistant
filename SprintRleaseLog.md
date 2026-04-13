# Release Summary: full-model transcript contract/rendering remediation

## Release Status

- Status: completed
- Date: 2026-04-12
- Tasks: `TASK-105`, `TASK-106`, `TASK-107`, `TASK-108`
- Main implementation commit: `35358ba3cec0e2661102a105fc0005fb93e1feea`
- Audit-traceability rework commit: `b487a2fd09499b10d7a52e9bf1f9a4c4f6f853a6`
- QA status: `passed`
- Audit status: `passed`

## Release Summary

- Finalized the full-model transcript contract/rendering remediation across the Python adapter, extension shared contract, transcript projection mapper, and sidepanel renderer/controller.
- The release preserves transcript semantic metadata end-to-end, suppresses TOOL items from direct chat rendering while retaining internal state, and merges assistant text by logical message identity for stable projected transcript rendering.

## Completed Scope

- `TASK-105`: Implement adapter transcript-preserving normalized event semantics in `python_adapter/app`
- `TASK-106`: Update extension shared protocol/schema for transcript-preserving normalized events
- `TASK-107`: Refactor transcript projection mapper to merge assistant text by logical message identity and suppress TOOL chat output
- `TASK-108`: Align sidepanel renderer/controller with projected transcript-only conversation contract

## Validation Results

- QA: passed — validated commit `35358ba3cec0e2661102a105fc0005fb93e1feea` across adapter, shared contract, mapper, and renderer, including targeted pytest, vitest, typecheck, and build coverage.
- Audit: passed — re-audit validated commit `b487a2fd09499b10d7a52e9bf1f9a4c4f6f853a6` after TASK-106 traceability rework closed the prior `IntentNotVerified` gap for `ELM-APP-EXT-SHARED-API-CONTRACT`.

## Commit Traceability

- Primary implementation scope commit: `35358ba3cec0e2661102a105fc0005fb93e1feea`
- Final validation/audit anchor commit: `b487a2fd09499b10d7a52e9bf1f9a4c4f6f853a6`
- Traceability matrix scope: all completed runtime tasks in this remediation release

## Intent Traceability Matrix

# Traceability Matrix

Scope: all completed runtime tasks

| Requirement (Intent) | Architecture Component (Design) | Implemented Task | Source Files (Reality) | Verified by Tests? |
| --- | --- | --- | --- | --- |
| N/A | ELM-APP-008C Opencode Event Normalizer | TASK-105 Implement adapter transcript-preserving normalized event semantics in python_adapter/app (35358ba3cec0e2661102a105fc0005fb93e1feea) | python_adapter/app/models.py<br>python_adapter/app/opencode_adapter.py<br>python_adapter/tests/test_opencode_adapter.py | ✅ Yes |
| N/A | ELM-APP-EXT-SHARED-API-CONTRACT Extension Stream Contract | TASK-106 Update extension shared protocol/schema for transcript-preserving normalized events (b487a2fd09499b10d7a52e9bf1f9a4c4f6f853a6) | N/A | ❌ No |
| N/A | ELM-APP-EXT-RUN-CONVERSATION-MAPPER Reasoning Projection Mapper | TASK-107 Refactor transcript projection mapper to merge assistant text by logical message identity and suppress TOOL chat output (35358ba3cec0e2661102a105fc0005fb93e1feea) | N/A | ❌ No |
| N/A | ELM-APP-EXT-CONVERSATION-RENDERER Conversation Renderer | TASK-108 Align sidepanel renderer/controller with projected transcript-only conversation contract (35358ba3cec0e2661102a105fc0005fb93e1feea) | N/A | ❌ No |

100% of the intended sprint scope was not verified by tests. The generated traceability matrix contains one or more `❌ No` rows, so full intent verification was not achieved in the generated release artifact and the release package reflects verification gaps.

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- Main implementation commit: `35358ba3cec0e2661102a105fc0005fb93e1feea`
- Audit rework commit: `b487a2fd09499b10d7a52e9bf1f9a4c4f6f853a6`

## Notable Follow-up Notes

- Runtime validation records show QA and audit both passed, but the generated matrix still reports `❌ No` rows for TASK-106 through TASK-108 because graph/scanner traceability reality remains incomplete or normalized inconsistently for some TypeScript-tagged artifacts.
- The audit itself called out minor non-blocking scanner normalization artifacts for TypeScript block-comment tags with trailing `*/`; this should be corrected so future release packaging can emit fully aligned matrix verification results.
- A follow-up should improve graph-backed source-file linkage for the shared contract, mapper, and renderer so release traceability reflects the validated implementation reality instead of `N/A`/`❌ No` placeholders.

## Release Conclusion

The completed full-model transcript contract/rendering remediation is finalized for release packaging. Delivery status is complete, QA passed, and audit passed after the TASK-106 traceability rework, with follow-up recommended to reconcile release-matrix evidence generation with the already-approved validation outcome.
