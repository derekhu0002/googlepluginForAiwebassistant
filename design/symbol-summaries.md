# Symbol Summaries

| Symbol | Stereotype | Business Effect |
|--------|-----------|-----------------|
| test_site/server | <<Utility>> | Starts a local HTTP server for testing purposes. |
| DrawerBarItem | <<ValueObject>> | — |
| MainAgentOption | <<ValueObject>> | — |
| extension/src/sidepanel/useSidepanelController | <<Controller>> | Manages side panel state and synchronization with background processes. |
| extension/src/sidepanel/useScrollFollowController | <<Controller>> | Controls scroll behavior for a side panel. |
| extension/src/sidepanel/useRunHistory | <<Utility>> | Provides access to historical run data. |
| _FakeResponse | <<ValueObject>> | — |
| python_adapter/tests/test_probe_opencode | <<Test>> | Tests the behavior of the probe_opencode module. |
| FakeStreamContext | <<Utility>> | Simulates an asynchronous context manager for HTTP responses. |
| FakeAsyncClient | <<Utility>> | Simulates an asynchronous HTTP client for testing. |
| python_adapter/tests/test_opencode_adapter | <<Test>> | Tests the behavior of the OpencodeAdapter. |
| python_adapter/tests/test_config | <<Test>> | Tests configuration settings for the Python adapter. |
| python_adapter/tests/test_app | <<Test>> | Tests the application flow for starting runs and handling events. |
| OpenCodeReferenceInput | <<ValueObject>> | — |
| ChatStreamViewProps | <<ValueObject>> | — |
| extension/src/sidepanel/reasoningTimelineView | <<View>> | Renders the reasoning timeline view for the side panel. |
| extension/src/sidepanel/reasoningTimelineView.test | <<Test>> | Tests the rendering and behavior of the reasoning timeline view. |
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
| extension/src/sidepanel/reasoningTimeline | <<Service>> | Processes and aggregates reasoning timeline data. |
| extension/src/sidepanel/reasoningTimeline.test | <<Test>> | Tests the reasoning timeline data processing. |
| extension/src/sidepanel/reasoningTimeline.chromeSandbox.test | <<Test>> | Tests the reasoning timeline in a Chrome sandbox environment. |
| extension/src/sidepanel/reasoningTimeline.chromeSandbox.entry | <<Utility>> | Provides a sandboxed fixture for Chrome-specific reasoning timeline. |
| extension/src/sidepanel/questionState | <<Utility>> | Manages question state and transitions for normalized run events. |
| extension/src/sidepanel/questionState.test | <<Utility>> | Provides test utilities for question state management. |
| SessionNavigationItem | <<ValueObject>> | — |
| RunEventAcceptanceResult | <<ValueObject>> | — |
| extension/src/sidepanel/model | <<Service>> | Handles run event normalization, state merging, and diagnostics. |
| extension/src/sidepanel/model.test | <<Utility>> | Provides test utilities for the sidepanel model. |
| RunDiagnosticsSource | <<ValueObject>> | — |
| RunDiagnosticsSnapshot | <<ValueObject>> | — |
| extension/src/sidepanel/diagnostics | <<Service>> | Generates and formats diagnostics snapshots for runs. |
| extension/src/sidepanel/diagnostics.test | <<Utility>> | Provides test utilities for diagnostics generation. |
| SidepanelDebugLogEntry | <<ValueObject>> | — |
| extension/src/sidepanel/debugLogStore | <<Repository>> | Manages debug log entries for the sidepanel. |
| extension/src/sidepanel/components/stage/MainStage | <<Controller>> | Renders the main stage component for the sidepanel UI. |
| python_adapter/scripts/probe_opencode | <<Utility>> | Probes and validates OpenCode service endpoints. |
| extension/src/sidepanel/components/shell/StatusRail | <<Controller>> | Renders the status rail component for the sidepanel UI. |
| extension/src/sidepanel/components/shell/ShellHeader | <<Controller>> | Renders the shell header component for the sidepanel UI. |
| extension/src/sidepanel/components/shared/icons | <<Utility>> | Provides shared icon components for the sidepanel. |
| RunNotFoundError | <<Entity>> | Represents an error for missing run identifiers. |
| OpencodeAdapter | <<Adapter>> | Adapts and manages interactions with the OpenCode service. |
| NormalizedRunEventTool | <<ValueObject>> | Represents metadata about a tool used in a normalized run event. |
| RunContext | <<ValueObject>> | Captures contextual information about a run, including user and source details. |
| RunStartRequest | <<ValueObject>> | — |
| QuestionAnswerRequest | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| QuestionOption | <<ValueObject>> | Defines an option for a question with an identifier, label, and value. |
| QuestionPayload | <<ValueObject>> | — |
| NormalizedRunEventSemantic | <<ValueObject>> | Encapsulates semantic details of a normalized run event, including channel and identity. |
| NormalizedRunEvent | <<Entity>> | Represents a normalized run event with metadata, tool, question, and semantic details. |
| RunStartResult | <<ValueObject>> | Holds the result of a run start operation, including session and agent details. |
| python_adapter/app/main | <<Controller>> | Implements API endpoints and error handling for managing runs and feedback. |
| JsonlInvocationLogger | <<Utility>> | Logs invocation payloads to a JSONL file for auditing or debugging. |
| Settings | <<ValueObject>> | Defines application configuration settings with environment variable support. |
| python_adapter/app/config | <<Utility>> | Provides utility functions for parsing configuration values. |
| extension/src/sidepanel/components/panels/SessionsPanel | <<Adapter>> | Manages session-related UI interactions in the side panel. |
| extension/src/sidepanel/components/panels/RulesPanel | <<Adapter>> | Handles rule management UI interactions in the side panel. |
| extension/src/sidepanel/components/panels/ContextPanel | <<Adapter>> | Displays context-related information and handles permission requests. |
| extension/src/sidepanel/components/composer/Composer | <<Adapter>> | Manages the composition of prompts and agent interactions. |
| extension/src/sidepanel/App | <<Controller>> | Main entry point for the side panel application, managing UI components. |
| ChromeStubOptions | <<ValueObject>> | — |
| extension/src/sidepanel/App.test | <<Utility>> | Mocks and stubs various components and behaviors for testing the side panel application. |
| UsernameExtractionInput | <<ValueObject>> | — |
| extension/src/shared/username | <<Utility>> | Extracts and normalizes username context from various DOM sources. |
| extension/src/shared/username.test | <<Utility>> | Contains test cases for username extraction utilities. |
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
| extension/src/shared/scripting | <<Utility>> | Provides scripting utilities for managing content script readiness and delays. |
| RulesStorageLike | <<ValueObject>> | — |
| extension/src/shared/rules | <<Service>> | Manages rules for capturing and validating field data from web pages. |
| extension/src/shared/rules.test | <<Utility>> | Contains test cases for rule management utilities. |
| TranscriptTraceCorrelation | <<ValueObject>> | — |
| TranscriptTraceRecord | <<ValueObject>> | — |
| TranscriptObservabilityEnvelope | <<ValueObject>> | — |
| RunEventCanonicalMetadata | <<ValueObject>> | — |
| RunEventTransportMetadata | <<ValueObject>> | — |
| RunEventFrontier | <<ValueObject>> | — |
| RunEventDiagnostic | <<ValueObject>> | — |
| RunEventState | <<ValueObject>> | — |
| RunStateSyncMetadata | <<ValueObject>> | — |
| QuestionOption | <<ValueObject>> | Defines an option for a question with an identifier, label, and value. |
| QuestionPayload | <<ValueObject>> | — |
| NormalizedRunEvent | <<Entity>> | Represents a normalized run event with metadata, tool, question, and semantic details. |
| RunStreamLifecycle | <<ValueObject>> | — |
| RunStartRequest | <<ValueObject>> | — |
| QuestionAnswerRequest | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| MessageFeedbackResponse | <<ValueObject>> | — |
| RunRecord | <<ValueObject>> | — |
| AnswerRecord | <<ValueObject>> | — |
| RunHistoryDetail | <<ValueObject>> | — |
| extension/src/shared/protocol | <<Utility>> | Handles operations on normalized run events and their metadata. |
| PageAccessResult | <<ValueObject>> | — |
| extension/src/shared/pageAccess | <<Utility>> | Evaluates and validates page access based on URL patterns. |
| extension/src/shared/pageAccess.test | <<Utility>> | Contains test cases for page access utilities. |
| HistoryStore | <<ValueObject>> | — |
| extension/src/shared/history | <<Repository>> | Manages IndexedDB storage for historical run events. |
| extension/src/shared/history.test | <<Utility>> | Contains test cases for history storage utilities. |
| DomainError | <<ValueObject>> | — |
| ExtensionError | <<ValueObject>> | — |
| extension/src/shared/errors | <<Utility>> | Defines and normalizes domain-specific errors. |
| extension/src/shared/contentScriptHarness.test | <<Utility>> | Contains test cases for content script harness utilities. |
| ExtensionConfig | <<ValueObject>> | — |
| extension/src/shared/configuration | <<Service>> | Manages extension configuration and validation of environment-specific settings. |
| extension/src/shared/configuration.test | <<Utility>> | Contains test cases for configuration utilities. |
| extension/src/shared/api | <<Gateway>> | Provides API utilities for starting runs, submitting answers, and handling event streams. |
| FakeEventSource | <<Utility>> | Simulates an EventSource for testing purposes. |
| extension/src/shared/api.test | <<Utility>> | Tests API utilities for correctness and integration. |
| extension/src/content/index | <<Controller>> | Implements content scripts for field capture and UI interactions. |
| extension/src/background/index | <<Service>> | Manages background tasks, state synchronization, and messaging. |
| extension/src/background/index.test | <<Utility>> | Tests background script functionality. |
| extension/dist/content | <<Controller>> | Implements compiled content script logic. |
| extension/dist/background | <<Service>> | Implements compiled background script logic. |
| O | <<ValueObject>> | Represents a custom error type with structured validation. |
| b | <<Utility>> | Provides utility methods for merging and managing data. |
| C | <<ValueObject>> | Represents a path-like structure with caching. |
| y | <<Utility>> | Implements a base class for data validation and transformation. |
| A | <<Utility>> | Extends validation utilities with additional checks. |
| V | <<Utility>> | Provides numeric validation utilities. |
| q | <<Utility>> | Implements additional numeric validation logic. |
| de | <<Utility>> | Parses input data using inherited and external dependencies. |
| J | <<Utility>> | Performs validation checks and computes date constraints. |
| Ye | <<Utility>> | Parses input data using inherited and external dependencies. |
| Xe | <<Utility>> | Parses input data using inherited and external dependencies. |
| Qe | <<Utility>> | Parses input data using inherited and external dependencies. |
| et | <<Utility>> | Initializes and parses input data using inherited dependencies. |
| Ee | <<Utility>> | Initializes and parses input data using inherited dependencies. |
| M | <<Utility>> | Parses input data using inherited and external dependencies. |
| tt | <<Utility>> | Parses input data using inherited and external dependencies. |
| I | <<Utility>> | Performs validation and computes constraints on elements. |
| k | <<Utility>> | Provides utilities for object manipulation and schema validation. |
| le | <<Utility>> | Parses input data and retrieves configuration options. |
| fe | <<Utility>> | Parses input data using inherited dependencies. |
| z | <<Utility>> | Parses input data and processes collections. |
| he | <<Factory>>, <<Utility>> | Handles schema creation and retrieves key-value schema definitions. |
| nt | <<ValueObject>> | Parses and validates key-value schemas. |
| ne | <<Utility>> | Provides utility methods for size and range validation. |
| st | <<ValueObject>> | Handles schema retrieval and parsing. |
| Se | <<ValueObject>> | Manages value retrieval and parsing. |
| Y | <<ValueObject>> | Handles enumeration and value extraction. |
| rt | <<ValueObject>> | Provides enumeration value access. |
| me | <<ValueObject>> | Handles unwrapping and resolution of values. |
| B | <<ValueObject>> | Manages type information and parsing. |
| P | <<ValueObject>> | Handles value unwrapping. |
| X | <<ValueObject>> | Handles value unwrapping. |
| Te | <<Utility>> | Removes default values during parsing. |
| Re | <<Utility>> | Removes catch handlers during parsing. |
| at | <<ValueObject>> | Handles generic parsing operations. |
| nn | <<ValueObject>> | Handles value unwrapping. |
| Ce | <<Factory>> | Creates instances with parsing capabilities. |
| Ae | <<Utility>> | Parses and unwraps data, likely related to background processing. |
| $n | <<ValueObject>> | — |
| extension/dist/assets/state-DGP8eNBi | <<Service>> | Manages application state and performs various data transformations. |
| Xi | <<ValueObject>> | — |
| Ft | <<ValueObject>> | — |
| Jf | <<ValueObject>> | — |
| zt | <<ValueObject>> | — |
| aA | <<ValueObject>> | Implements a data structure with cursor-based manipulation. |
| wv | <<Utility>> | Handles path manipulation and message logging. |
| od | <<Service>> | Processes and runs data pipelines with support for synchronous and asynchronous operations. |
| extension/dist/assets/sidepanel | <<Controller>> | Manages UI interactions and state for the side panel. |
| AnalyzeRequest | <<ValueObject>> | — |
| AnalyzeResult | <<ValueObject>> | — |
| MessageFeedbackRequest | <<ValueObject>> | — |
| MessageFeedbackResult | <<ValueObject>> | — |
| AnalysisProvider | <<ValueObject>> | — |
| backend/src/timeout | <<Utility>> | Provides a utility for handling promises with timeouts. |
| MockAnalysisProvider | <<Adapter>> | Mocks an analysis provider for testing purposes. |
| backend/src/providers/mockAnalysisProvider | <<Utility>> | Provides a sleep utility with optional signal handling. |
| backend/src/providers/index | <<Factory>> | Creates an analysis provider instance. |
| backend/src/index | <<Utility>> | Entry point for the backend module. |
| AppError | <<ValueObject>> | Defines a custom error type with additional metadata. |
| ErrorBody | <<ValueObject>> | — |
| AuthError | <<ValueObject>> | — |
| PermissionError | <<ValueObject>> | — |
| ValidationError | <<ValueObject>> | — |
| TimeoutError | <<ValueObject>> | — |
| AnalysisError | <<ValueObject>> | — |
| backend/src/config | <<Utility>> | Parses and validates configuration values. |
| backend/src/app | <<Factory>> | Creates the application instance with a given provider and environment. |
| ImmediateProvider | <<Adapter>> | Provides immediate analysis functionality for testing. |
| backend/src/app.test | <<Utility>> | contains test definitions with no business logic |
| backend/dist/index | <<Utility>> | provides application setup and utility functions for origin validation and timeout handling |
