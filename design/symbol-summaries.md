# Symbol Summaries

| Symbol | Stereotype | Business Effect |
|--------|-----------|-----------------|
| test_site/server | <<Utility>> | Starts a local HTTP server for testing purposes. |
| AnalyzeRequest | <<ValueObject>> | — |
| AnalyzeResult | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| MessageFeedbackResult | <<ValueObject>> | — |
| AnalysisProvider | <<ValueObject>> | — |
| backend/src/timeout | <<Utility>> | Provides a utility to enforce timeouts on asynchronous operations. |
| _FakeResponse | <<ValueObject>> | — |
| python_adapter/tests/test_probe_opencode | <<Test>> | Contains unit tests for validating health and agent responses. |
| MockAnalysisProvider | <<Test>>, <<Adapter>> | Mocks an analysis provider for testing purposes. |
| backend/src/providers/mockAnalysisProvider | <<Utility>> | Provides a sleep utility for asynchronous operations. |
| backend/src/providers/index | <<Factory>> | Creates an instance of an analysis provider. |
| backend/src/index | <<Utility>> | Entry point for the backend module. |
| AppError | <<ValueObject>> | Defines a custom error type with additional metadata. |
| ErrorBody | <<ValueObject>> | — |
| AuthError | <<ValueObject>> | — |
| PermissionError | <<ValueObject>> | — |
| ValidationError | <<ValueObject>> | — |
| TimeoutError | <<ValueObject>> | — |
| AnalysisError | <<ValueObject>> | — |
| backend/src/config | <<Utility>> | Parses and validates configuration for backend origins. |
| backend/src/app | <<Factory>> | Creates the main application instance with a provider and environment. |
| ImmediateProvider | <<Test>>, <<Adapter>> | Provides immediate analysis results for testing. |
| backend/src/app.test | <<Test>> | Contains tests for the backend application. |
| FakeStreamContext | <<Test>> | Mocks an asynchronous streaming context for testing. |
| FakeAsyncClient | <<Test>> | Mocks an asynchronous HTTP client for testing. |
| python_adapter/tests/test_opencode_adapter | <<Test>> | Contains unit tests for the Opencode adapter. |
| python_adapter/tests/test_config | <<Utility>> | Tests configuration settings for environment variables and default values. |
| python_adapter/tests/test_app | <<Utility>> | Tests application flow for starting runs, handling events, and submitting answers. |
| backend/dist/index | <<Utility>> | Provides utility functions for app creation, origin validation, and asynchronous operations. |
| DrawerBarItem | <<ValueObject>> | — |
| MainAgentOption | <<ValueObject>> | — |
| extension/src/sidepanel/useSidepanelController | <<Controller>> | Manages sidepanel state synchronization and event handling. |
| extension/src/sidepanel/useScrollFollowController | <<Controller>> | Controls scroll behavior for message containers. |
| extension/src/sidepanel/useRunHistory | <<Utility>> | Provides access to historical run data. |
| python_adapter/scripts/probe_opencode | <<Utility>> | Probes OpenCode endpoints for health and agent availability. |
| OpenCodeReferenceInput | <<ValueObject>> | — |
| ChatStreamViewProps | <<ValueObject>> | — |
| extension/src/sidepanel/reasoningTimelineView | <<View>> | Renders reasoning timeline with transcript and feedback components. |
| extension/src/sidepanel/reasoningTimelineView.test | <<Utility>> | Tests rendering and behavior of reasoning timeline view. |
| TimelineEventEntry | <<ValueObject>> | — |
| TimelineCardModel | <<Entity>> | — |
| ConversationTurnModel | <<Entity>> | — |
| ReasoningSectionModel | <<Entity>> | — |
| FragmentBadgeModel | <<Entity>> | — |
| ChatStreamItemModel | <<Entity>> | — |
| TranscriptPartModel | <<Entity>> | — |
| TranscriptMessageModel | <<Entity>> | — |
| TranscriptTailPatchModel | <<Entity>> | — |
| TranscriptSummaryModel | <<Entity>> | — |
| TranscriptReadModel | <<Entity>> | — |
| ProjectionAnomalyRecord | <<ValueObject>> | — |
| LiveTranscriptProjectionState | <<ValueObject>> | — |
| LiveTranscriptProjectionDebug | <<ValueObject>> | — |
| BuildChatStreamItemsOptions | <<ValueObject>> | — |
| BuildTranscriptSegmentReadModelOptions | <<Entity>> | — |
| StableTranscriptProjectionOptions | <<ValueObject>> | — |
| AssistantResponseAggregation | <<ValueObject>> | — |
| CockpitStatusModel | <<Entity>> | — |
| extension/src/sidepanel/reasoningTimeline | <<Service>> | Processes and aggregates reasoning timeline events. |
| extension/src/sidepanel/reasoningTimeline.test | <<Utility>> | Tests reasoning timeline event processing. |
| extension/src/sidepanel/reasoningTimeline.chromeSandbox.test | <<Utility>> | Tests reasoning timeline in a Chrome sandbox environment. |
| extension/src/sidepanel/reasoningTimeline.chromeSandbox.entry | <<Adapter>> | Provides entry point for Chrome sandbox transcript fixture. |
| extension/src/sidepanel/questionState | <<Service>> | Manages question state for active and pending questions. |
| extension/src/sidepanel/questionState.test | <<Utility>> | Tests question state management logic. |
| SessionNavigationItem | <<ValueObject>> | — |
| RunEventAcceptanceResult | <<ValueObject>> | — |
| extension/src/sidepanel/model | <<Utility>> | Manages and processes run-related state and events. |
| extension/src/sidepanel/model.test | <<Utility>> | Contains test scaffolding for the model module. |
| RunDiagnosticsSource | <<ValueObject>> | — |
| RunDiagnosticsSnapshot | <<ValueObject>> | — |
| extension/src/sidepanel/diagnostics | <<Utility>> | Generates and formats diagnostics snapshots for runs. |
| extension/src/sidepanel/diagnostics.test | <<Utility>> | Contains test scaffolding for the diagnostics module. |
| extension/src/sidepanel/components/stage/MainStage | <<Controller>> | Renders the main stage UI for managing sessions and diagnostics. |
| JsonlInvocationLogger | <<Utility>> | Logs invocation data to a JSONL file. |
| Settings | <<ValueObject>> | Holds configuration settings for the Python adapter. |
| python_adapter/app/config | <<Utility>> | Provides helper functions for environment variable parsing. |
| extension/src/sidepanel/components/shell/StatusRail | <<Controller>> | Renders the status rail UI for session and state visualization. |
| extension/src/sidepanel/components/shell/ShellHeader | <<Controller>> | Renders the shell header UI for session management. |
| extension/src/sidepanel/components/shared/icons | <<Utility>> | Provides reusable UI icons for the side panel. |
| RunNotFoundError | <<ValueObject>> | Represents an error when a run is not found. |
| OpencodeAdapter | <<Adapter>> | Facilitates communication with the OpenCode backend. |
| NormalizedRunEventTool | <<ValueObject>> | Represents metadata for a tool used in a normalized run event. |
| RunContext | <<ValueObject>> | Encapsulates context information for a run. |
| RunStartRequest | <<ValueObject>> | — |
| QuestionAnswerRequest | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| QuestionOption | <<ValueObject>> | Represents a selectable option for a question. |
| QuestionPayload | <<ValueObject>> | — |
| NormalizedRunEventSemantic | <<ValueObject>> | Encapsulates semantic details of a normalized run event. |
| NormalizedRunEvent | <<Entity>> | Represents a normalized event in a run with metadata and optional details. |
| RunStartResult | <<ValueObject>> | Holds the result of a run start operation, including agent and session details. |
| python_adapter/app/main | <<Controller>> | Handles API requests and maps errors for run management and feedback submission. |
| extension/src/sidepanel/components/panels/SessionsPanel | <<Adapter>> | Manages session navigation and interactions in the side panel. |
| extension/src/sidepanel/components/panels/RulesPanel | <<Adapter>> | Handles rule management and editing in the side panel. |
| extension/src/sidepanel/components/panels/ContextPanel | <<Adapter>> | Displays context-related information and handles permission requests. |
| extension/src/sidepanel/components/composer/Composer | <<Adapter>> | Manages user input and agent selection for composing prompts. |
| extension/src/sidepanel/App | <<Controller>> | Main entry point for the side panel application. |
| ChromeStubOptions | <<ValueObject>> | — |
| extension/src/sidepanel/App.test | <<Utility>> | Contains test utilities and mocks for the side panel application. |
| UsernameExtractionInput | <<ValueObject>> | — |
| extension/src/shared/username | <<Utility>> | Extracts and normalizes username context from various sources. |
| extension/src/shared/username.test | <<Utility>> | Contains test utilities for username extraction. |
| CanonicalCapturedFields | <<ValueObject>> | — |
| FieldRuleDefinition | <<ValueObject>> | — |
| PageRule | <<ValueObject>> | — |
| MatchedRuleSummary | <<ValueObject>> | — |
| ActiveTabContext | <<ValueObject>> | — |
| UsernameContext | <<ValueObject>> | — |
| StreamConnectionState | <<ValueObject>> | — |
| AssistantState | <<ValueObject>> | — |
| StartRunResponse | <<ValueObject>> | — |
| ExtensionApiFailureResponse | <<ValueObject>> | — |
| AnswerSuccessResponse | <<ValueObject>> | — |
| FeedbackSuccessResponse | <<ValueObject>> | — |
| MessageFeedbackUiState | <<ValueObject>> | — |
| ContentScriptReadyResponse | <<ValueObject>> | — |
| extension/src/shared/scripting | <<Utility>> | Provides scripting utilities for content script readiness and error handling. |
| RulesStorageLike | <<ValueObject>> | — |
| extension/src/shared/rules | <<Utility>> | Manages rules and field templates for URL matching and data capture. |
| extension/src/shared/rules.test | <<Utility>> | Contains unit tests for rules module. |
| TranscriptTraceCorrelation | <<ValueObject>> | — |
| TranscriptTraceRecord | <<ValueObject>> | — |
| TranscriptObservabilityEnvelope | <<ValueObject>> | — |
| RunEventCanonicalMetadata | <<ValueObject>> | — |
| RunEventTransportMetadata | <<ValueObject>> | — |
| RunEventFrontier | <<ValueObject>> | — |
| RunEventDiagnostic | <<ValueObject>> | — |
| RunEventState | <<ValueObject>> | — |
| RunStateSyncMetadata | <<ValueObject>> | — |
| QuestionOption | <<ValueObject>> | Represents a selectable option for a question. |
| QuestionPayload | <<ValueObject>> | — |
| NormalizedRunEvent | <<Entity>> | Represents a normalized event in a run with metadata and optional details. |
| RunStreamLifecycle | <<ValueObject>> | — |
| RunStartRequest | <<ValueObject>> | — |
| QuestionAnswerRequest | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| MessageFeedbackResponse | <<ValueObject>> | — |
| RunRecord | <<ValueObject>> | — |
| AnswerRecord | <<ValueObject>> | — |
| RunHistoryDetail | <<ValueObject>> | — |
| extension/src/shared/protocol | <<Utility>> | Manages event processing, correlation, and metadata derivation for normalized run events. |
| PageAccessResult | <<ValueObject>> | — |
| extension/src/shared/pageAccess | <<Utility>> | Evaluates and validates page access patterns and permissions. |
| extension/src/shared/pageAccess.test | <<Utility>> | Contains unit tests for page access module. |
| HistoryStore | <<ValueObject>> | — |
| extension/src/shared/history | <<Repository>> | Manages IndexedDB-based history storage and event ordering. |
| extension/src/shared/history.test | <<Utility>> | Contains unit tests for history module. |
| DomainError | <<ValueObject>> | — |
| ExtensionError | <<ValueObject>> | — |
| extension/src/shared/errors | <<Utility>> | Handles domain error creation and normalization. |
| extension/src/shared/contentScriptHarness.test | <<Utility>> | Contains unit tests for content script harness. |
| ExtensionConfig | <<ValueObject>> | — |
| extension/src/shared/configuration | <<Utility>> | Manages extension configuration and validation of host permissions. |
| extension/src/shared/configuration.test | <<Utility>> | Contains unit tests for configuration module. |
| extension/src/shared/api | <<Gateway>> | Handles API interactions for runs, questions, and feedback. |
| FakeEventSource | <<Utility>> | Simulates an EventSource for testing purposes. |
| extension/src/shared/api.test | <<Utility>> | Contains unit tests for API module. |
| extension/src/content/index | <<Controller>> | Handles content script operations like field capture and UI interactions. |
| extension/src/background/index | <<Service>> | Manages background operations like state synchronization and tab communication. |
| extension/src/background/index.test | <<Utility>> | Contains test definitions for background module. |
| extension/dist/content | <<Controller>> | Handles content script events and DOM manipulations. |
| extension/dist/background | <<Service>> | Manages background tasks and state synchronization. |
| O | <<ValueObject>> | Represents a custom error with structured issue handling. |
| b | <<Utility>> | Provides utility methods for object and array merging. |
| C | <<ValueObject>> | Represents a path-like structure with caching. |
| y | <<Specification>> | Defines a base class for data validation and transformation. |
| A | <<Specification>> | Extends validation logic with additional data checks. |
| V | <<Specification>> | Specializes in numeric validation with range checks. |
| q | <<Specification>> | Handles numeric validation with additional constraints. |
| de | <<Specification>> | Implements parsing logic for specific data types. |
| J | <<Specification>> | Validates date ranges and constraints. |
| Je | <<Specification>> | Implements parsing logic for specific data types. |
| Ye | <<Specification>> | Implements parsing logic for specific data types. |
| Xe | <<Specification>> | Implements parsing logic for specific data types. |
| Qe | <<Adapter>> | Parses input and interacts with background extension. |
| Ee | <<Adapter>> | Parses input and interacts with background extension. |
| M | <<Adapter>> | Parses input and interacts with state management. |
| et | <<Adapter>> | Parses input and interacts with state management and background extension. |
| I | <<Utility>> | Performs calculations and interacts with state management. |
| k | <<Utility>> | Provides schema manipulation utilities and interacts with state management. |
| le | <<Adapter>> | Parses input and provides options from definitions. |
| fe | <<Adapter>> | Parses input and performs asynchronous operations. |
| z | <<Adapter>> | Handles collections and interacts with state management. |
| he | <<Adapter>> | Manages key-value schemas and interacts with state management. |
| tt | <<Adapter>> | Manages key-value schemas and interacts with state management. |
| ne | <<Utility>> | Performs size-related calculations and interacts with state management. |
| nt | <<Adapter>> | Provides schema definitions. |
| Se | <<Adapter>> | Provides value definitions and interacts with state management. |
| Y | <<Adapter>> | Handles enumerations and interacts with state management. |
| st | <<ValueObject>> | Parses and provides enumeration values. |
| me | <<ValueObject>> | Parses and unwraps data. |
| B | <<ValueObject>> | Handles schema effects and type transformations. |
| P | <<ValueObject>> | Parses and unwraps optional data. |
| X | <<ValueObject>> | Parses and unwraps nullable data. |
| Te | <<ValueObject>> | Parses and removes default values. |
| Re | <<ValueObject>> | Parses and removes catch values. |
| rt | <<ValueObject>> | Parses NaN values. |
| tn | <<ValueObject>> | Parses and unwraps lazy values. |
| Ce | <<Factory>> | Creates and parses objects. |
| Ae | <<ValueObject>> | Parses and handles readonly data. |
| Nn | <<ValueObject>> | — |
| extension/dist/assets/state-A94O9ADp | <<Utility>> | Provides utility functions for state management. |
| Yi | <<ValueObject>> | — |
| Zt | <<ValueObject>> | — |
| Vf | <<ValueObject>> | — |
| zt | <<ValueObject>> | — |
| Nx | <<Entity>> | Manages a cursor-based collection. |
| vv | <<Utility>> | Handles file path manipulations and messaging. |
| ad | <<Service>> | Processes and runs diagnostic data. |
| extension/dist/assets/sidepanel | <<Controller>> | Manages UI interactions and state for the side panel in the extension. |
