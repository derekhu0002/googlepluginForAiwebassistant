# Release Summary: sidepanel transcript 合同重构

## Release Status

- Status: completed
- Date: 2026-04-11
- Goal: 按 OpenCode Web Share 合同将 transcript 重构为 source-ordered flat part stream，且 summary/status 仅位于尾部 summary part。
- Main implementation commit: `d80ef2520f717b327ab85519d892928288ad756f`
- Final validated baseline commit: `944cc120271d15ecd08394e03f0c73e52f079304`

## Release Summary

- 本次发布完成 sidepanel transcript 合同重构，将 transcript 统一为 source-ordered flat part stream，并确保 summary/status 仅通过尾部 summary part 暴露。
- 渲染层、样式层、live/history shell 集成与测试基线已全部收敛到同一 Share 风格 transcript-stream contract，移除旧 message-card/card shell 与 feed-external inline status 依赖。
- 主实现位于 `d80ef2520f717b327ab85519d892928288ad756f`，随后通过 `97426a4afa4c1fc278dc29526f744252606e6759` 移除 feed 外状态，再通过 `944cc120271d15ecd08394e03f0c73e52f079304` 移除 part 内 streaming 状态，完成最终验证基线收口。

## Completed Scope

- `TASK-085`: Rebaseline sidepanel transcript projection to source-ordered flat part stream.
- `TASK-086`: Replace card-based transcript rendering with Share-style flat part renderer.
- `TASK-087`: Align sidepanel transcript CSS to unified vertical part-stream skeleton.
- `TASK-088`: Converge sidepanel live/history shell integration on single transcript-stream contract.
- `TASK-089`: Rebaseline transcript tests to Share reference contract.

## Validation Results

- QA: expected passed after recheck
- Audit: expected passed after recheck

## Commit Traceability

- Main implementation: `d80ef2520f717b327ab85519d892928288ad756f`
- Remove feed-external status: `97426a4afa4c1fc278dc29526f744252606e6759`
- Remove in-part streaming status: `944cc120271d15ecd08394e03f0c73e52f079304`
- Final validation baseline: `944cc120271d15ecd08394e03f0c73e52f079304`
- Completed tasks: `TASK-085`, `TASK-086`, `TASK-087`, `TASK-088`, `TASK-089`

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- QA status: `expected passed after recheck`
- Audit status: `expected passed after recheck`
- Final commit: `944cc120271d15ecd08394e03f0c73e52f079304`

## Release Conclusion

sidepanel transcript 合同重构已完成发布收口。最终交付以 commit `944cc120271d15ecd08394e03f0c73e52f079304` 为验证基线，达成 Share 合同要求：source-ordered flat part stream、尾部 summary part 承载 summary/status、统一渲染与样式骨架，以及 live/history/follow-up 单流集成。
