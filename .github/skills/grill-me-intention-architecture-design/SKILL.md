---
name: grill-me-intention-architecture-design
description: 'Interrogate plans, designs, and implementation proposals until they are concrete, dependency-ordered, and testable. Use when you need relentless questioning, branch-by-branch design review, dependency resolution, or codebase exploration to answer plan questions instead of asking the user.'
argument-hint: 'Describe the plan, design, or decision you want stress-tested'
user-invocable: true
---

Interview me relentlessly about every aspect of this plan based on the **intention architecture model** and the code base until we reach a shared understanding, then consolidate our plan into a comprehensive set of acceptance testcases and scenarios testcases with each testcase hooked under one and only one key element from the model. Walk down each branch of the design tree, resolving dependencies between decisions one by one. And finally, if a question can be answered by exploring the code base, explore the code base instead.

**intention architecture model:** 
#file:..\..\..\design\KG\SystemArchitecture.json