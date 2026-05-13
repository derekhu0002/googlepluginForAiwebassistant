# Argo Copilot Instructions

## Purpose

These instructions apply to the main Copilot agent for this repository.
The goal is to keep a stable shared understanding of how to read intent architecture, implementation architecture, and code without requiring the user to restate those rules in each task.

## Repository Reading Order

When a task concerns architecture, implementation, tests, delivery, or code changes, follow this order unless the user explicitly narrows scope:

1. Read `design/KG/SystemArchitecture.json` first.
  Read it as an intent-architecture knowledge graph, not as a static checklist: inspect relevant elements, relationships, views, attributes, and testcase-related fields before moving on.
2. Then read the repository root implementation architecture contract in `OVERALL_ARCHITECTURE.md`.
3. Then read relevant local `ARCHITECTURE.md` files under affected stable directories.
4. Only after those contracts are read, inspect code, tests, scripts, configuration, and documentation as implementation evidence.

Do not ask the user for facts that can be confirmed from the repository, contracts, tests, or tool results.

## Graph Usage Protocol

Treat the graph-usage guidance embedded in `design/KG/SystemArchitecture.json` as always-on standing knowledge for this repository.

Apply it as a working protocol:

1. Use the graph as the first fact source, read it as modeled architecture rather than informal prose, and preserve ArchiMate semantics instead of rewriting them by naming intuition.
2. Treat `attributes`, `description`, `browser_path`, `acceptanceCriteria`, `#file:...`, and `#sym:...` as evidence pointers; follow them on demand, but do not let referenced evidence override explicit graph semantics.
3. Treat explicit testcase baselines as stable acceptance boundaries unless the user is explicitly redesigning intent architecture; do not add, delete, rebuild, or redefine them during ordinary implementation or repair work.
4. Keep stage boundaries explicit: intent design updates intent, implementation architecture design updates contracts and testcase ownership, coding updates implementation only, and support tests or runtime notes belong in implementation assets rather than the intent layer.
5. Do not conclude from isolated names or descriptions; use nearby relationships, views, upstream and downstream context, and referenced evidence together, make only minimal assumptions, and clearly separate repository-confirmed facts from assumptions in the final explanation.

## Architecture Layers

### Intent Architecture

- `design/KG/SystemArchitecture.json` is the first source of truth for intent, constraints, explicit semantics, and acceptance boundaries.
- The intent graph is an architecture skeleton suitable for loading into agent context; detailed expansion should live in repository files referenced from the graph rather than being invented ad hoc.
- The intent model is the ontology container for intent-side concepts, design elements, their relationships, and explicit testcase baselines.
- Treat explicit testcase definitions in the intent architecture as acceptance baseline contracts.
- Explicit testcases belong to the intent layer and form part of the acceptance boundary; they are not implementation details.
- Treat principles and constraints in the intent architecture as stronger than current code reality.
- Current code does not override the intent architecture automatically.
- Interpret ArchiMate element and relationship semantics according to the modeling language, not by informal name guessing.
- Intent defines what must be true, including explicit acceptance boundaries that downstream layers are expected to fulfill rather than reinterpret.

### Implementation Architecture

- Implementation architecture is not a separate abstract idea; it is expressed by the repository itself.
- The implementation model is the ontology container for implementation-side concepts, stable architecture elements, testcase ownership, and guardrail structure.
- The root contract is `OVERALL_ARCHITECTURE.md`.
- Local contracts are the relevant `ARCHITECTURE.md` files inside stable directories.
- Stable directory and file layout, explicit testcase entrypoints, and non-explicit test guardrails are part of the implementation architecture.
- A directory is considered a **Stable Architecture Element** if it contains an `ARCHITECTURE.md` or is explicitly mapped in `OVERALL_ARCHITECTURE.md`. If neither exists, treat it as an incidental implementation detail.
- Stable architecture elements and their relations should be materialized by stable repository directories and their contracts; they are not inferred from arbitrary files by default.
- The implementation side owns executable guards, test entrypoints, and the physical organization of supporting validation assets.
- The repository root is the read boundary of implementation architecture; stable directories and key files are implementation elements only when contracts promote them to that role.
- Directory hierarchy means containment by default, not automatic `implements` semantics.
- `implements` mappings must be declared explicitly in `OVERALL_ARCHITECTURE.md` and relevant `ARCHITECTURE.md` files.
- Indirect implementation chains are valid. If element C implements element B, and B implements intent element A, then C indirectly carries A.
- Implementation architecture organizes and constrains realization: it turns intent into stable elements, dependency direction, testcase ownership, and executable guardrails.

### Code Reality

- Code, tests, scripts, and configuration are evidence of the current implementation state.
- Code realization is the executed and editable implementation state that consumes and realizes the implementation architecture; it is not the same thing as the architecture contract itself.
- They help confirm or reject hypotheses about the implementation, but they do not silently redefine intent architecture or frozen architecture contracts.
- When code conflicts with established architecture contracts, report the mismatch and prefer restoring alignment rather than normalizing drift.
- Code realizes the implementation architecture. Treat the overall flow as directional: intent drives implementation architecture, implementation architecture governs coding, and divergence between code and architecture is drift unless the user is intentionally redesigning the upstream layers.

## Graph Interpretation Rules

- Treat `attributes`, `description`, `browser_path`, `acceptanceCriteria`, `#file:...`, and `#sym:...` as traceability and evidence pointers.
- Follow those pointers to gather evidence, but do not let referenced content override explicit graph semantics, principles, constraints, or testcase baselines.
- Read relationships directionally and preserve their source/target semantics; do not flatten them into undirected associations.
- When graph information is incomplete, make only the minimum necessary assumption, label it clearly as an assumption, and avoid inventing external interfaces, deployment facts, SLAs, org processes, or new acceptance baselines.
- When graph statements and code disagree, prefer the graph and contracts first, then explain the implementation drift.

## Conflict Priority

When repository evidence conflicts, resolve it in this order:

1. Hard constraints and principles in the intent architecture.
2. Explicit testcase baselines and explicit intent semantics.
3. Clear graph content in elements, relationships, views, and attributes.
4. Referenced files and symbols followed from graph pointers.
5. Current code reality.

## Stage Boundaries

### Intent Architecture Design Stage

- Responsible for intent elements, relationships, views, principles, constraints, and explicit testcase baselines.
- Do not rewrite intent baselines during ordinary implementation or coding tasks unless the user explicitly requests intent redesign.

### Implementation Architecture Design Stage

- Responsible for `OVERALL_ARCHITECTURE.md`, relevant `ARCHITECTURE.md`, stable implementation boundaries, explicit testcase entrypoint materialization, and critical non-explicit tests.
- Focus on high-level stable elements such as stable directories, stable components, key entry files, interface boundaries, dependency direction, test ownership, and traceability.
- Do not degrade into file-by-file or function-by-function mirroring.
- This stage converts intent-side explicit testcases into physical read-only entrypoints plus critical and supporting non-explicit test guardrails in the repository.

### Coding And Repair Stage

- Respect the frozen and evolvable test assets defined in Test Semantics and in the implementation contracts.
- During coding, validate by invoking existing testcase entrypoints rather than rewriting them.

## Test Semantics

### Explicit Testcases

- Explicit testcases are the stable acceptance or scenario baseline declared by intent architecture.
- Their target, scope, assertion boundary, and physical single entrypoint are not to be rewritten during ordinary coding.
- If an explicit testcase is missing a physical entrypoint, report it as an implementation architecture design gap rather than patching around it silently in coding mode.

### Non-Explicit Tests

- Non-explicit tests belong to the implementation layer rather than the intent layer.
- Critical non-explicit tests are limited to four categories:
  - architecture boundary guards
  - dependency direction guards
  - explicit entrypoint correctness guards
  - key implementation traceability guards
- Critical non-explicit tests should be frozen during implementation architecture design.
- Supporting non-explicit tests exist to help later coding and regression work and do not automatically become frozen contracts.
- Non-explicit tests should normally live in the owning stable element's `tests/` directory, with cross-directory tests owned by the nearest common ancestor.

## Control Loop Semantics

- Intent architecture design updates intent.
- Implementation architecture design updates implementation contracts and testcase ownership.
- Coding realizes implementation architecture.
- Automated testing produces failure records that feed repair without redefining the upstream baselines.

## Architecture Design Principles

Apply these as active decision criteria, not as slogans:

- Clean Architecture
- SOLID Principles
- Deep Module
- Progressive Disclosure
- Separation of Concerns
- Stable dependency direction toward abstractions

When designing or changing implementation architecture:

- Prefer a small number of stable high-level elements over exhaustive mirrors of source files.
- Keep complex details behind stable module boundaries instead of leaking them to callers.
- Do not promote helpers, private functions, or incidental file splits into stable architecture elements without a real boundary reason.
- Ask the user only about high-leverage decisions that materially change module decomposition, interface boundaries, dependency direction, explicit entrypoint freezing, or critical guardrails.
- Derive implementation details directly from repository evidence, but never assume new architectural boundaries or intents without explicit graph or contract support.

## Expected Working Style

- Identify Your Stage: At the beginning of each task, explicitly state which stage you are operating in (Intent Design, Implementation Design, or Coding/Repair) based on the user's request and the files being modified.
- State clearly which conclusions are repository-confirmed facts and which are minimal assumptions.
- When editing architecture-related assets, prefer updating contracts and test guardrails before modifying business behavior unless the user explicitly asks for implementation work.
- If no contract file exists yet, report that as an architecture gap and create or update the appropriate contract file when the task is implementation architecture design.
- **Stop and Ask**: If you find an unresolvable conflict between Intent (KG) and Implementation (Contracts) that would require a breaking change to the acceptance baseline, you must stop and present the conflict to the user instead of proceeding with assumptions.
- **Token Efficiency**: Aim for the most concise code implementation that satisfies all testcases. Avoid gold-plating or over-engineering that is not derived from the Intent Architecture.
- Do not reason from a single element name or one description field in isolation; use nearby relationships, views, upstream/downstream links, and referenced evidence before concluding how a concept should be implemented.
