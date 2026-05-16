---
name: handoff
description: Hand off the current Argo workflow stage to the next stage. Use when the user asks to hand off work, continue in the next stage, move from Intent Design to Implementation Design, or move from Implementation Design to Coding/Repair.
argument-hint: What should the next stage focus on?
---

Write a short handoff for the next agent in Argo's staged workflow.

First infer the current stage from the conversation and repository context. Then choose the next stage using Argo's workflow:
- Intent Design -> Implementation Design
- Implementation Design -> Coding/Repair
- If the user explicitly asks for a different next stage, follow the user's instruction.

Keep it simple. Do not repeat the full conversation.

Tell the next agent only:
- what it needs to do next
- which files or contracts it should read first

If the user passed arguments, treat them as the focus for the next stage and tailor the handoff accordingly.