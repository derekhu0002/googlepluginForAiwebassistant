---
name: implementation-task-handler
description: Implements approved repository tasks with traceable runtime-state updates.
---

# IMPLEMENTATION EXECUTION

Use this skill for code changes in this repository.

## Required flow

1. Read runtime context with `query_graph(mode="summary")`.
2. Read assigned task IDs with `query_graph(mode="task_by_id", id="TASK-...")` or equivalent runtime lookup.
3. Apply the smallest code change that satisfies the approved architecture.
4. Prefer the real opencode serve path as the default behavior; keep mock behind explicit test/fallback flags only.
5. Update runtime status with `update_graph_model(action="set_task_status", ...)` before returning.

## Repository-specific constraints

- Extension question cards must only render for the currently pending question ID.
- Canonical invocation log path is `<repo>/python_adapter/logs/invocations.jsonl` unless explicitly overridden.
- Workspace `.opencode` definitions must describe this project, not template/example agents.
