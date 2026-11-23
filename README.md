# SiriPlus-compatible iOS assistant — research & implementation brief

> This repository is currently an empty scaffold. It does **not** contain SiriPlus source code, an iOS project, Theos, an Apple SDK, signing assets, or a device test environment. No working tweak can honestly be claimed yet.

## What SiriPlus does (public product information)

SiriPlus is a paid jailbreak tweak by uckermark, currently listed as version 1.4. The developer's Havoc listing describes an AI assistant replacing the Siri interaction: activation through the side/home button or “Hey Siri”, a floating orb/reply UI, streaming model responses spoken with the configured Siri voice, on-device speech recognition, rich Markdown/link responses, and optional device actions.

Listed capabilities include OpenAI, Gemini, Claude and OpenAI-compatible custom endpoints (with user-supplied credentials); managed mode; web search; app launching; email drafting; calendar entries; phone calls; Maps directions; limited device information and pasteboard access; delegation to actual Siri; and user-selected Shortcuts. The listing says rootful and rootless jailbreaks are supported, but explicitly says **roothide is not tested**. Its current compatibility listing is iOS 14–18.7.9; that does not prove every device/version combination works.

## Important boundary: “clone exactly”

The package is proprietary and its implementation is not published in the product listing. This repository cannot reproduce its private source, assets, backend, managed service, or exact internal hooks. The sensible deliverable is an independently implemented, clearly branded alternative with comparable user-facing features—not a byte-for-byte copy or a claim of affiliation.

There is no public iOS API that lets an ordinary app replace Siri's system activation globally. A jailbreak tweak generally has to integrate with private Siri/Assistant processes and undocumented interfaces, which can change between iOS point releases. “Use only public APIs”, “replace system Siri globally”, and “guaranteed no errors on iOS 15” cannot all be promised together. Rootless and roothide are distinct packaging/injection environments; roothide requires its own compatibility validation, not just a rootless package label.

## Production requirements before claiming a real release

1. Define supported jailbreaks (e.g. Dopamine rootless, roothide jailbreak) and exact iOS 15 device/build matrix.
2. Implement a Theos/Objective-C(++) tweak and preferences bundle, with separate rootless/roothide packaging and explicit dependency/filter declarations.
3. Reverse-engineer only the minimum Siri activation/presentation seam needed, isolate it behind version-specific adapters, and fail open to native Siri if unavailable. Keep hooks narrow; do not indiscriminately hook all UIKit classes or hide unrelated assistant UI.
4. Build the assistant UI and conversation lifecycle, audio session handling, speech recognition, streaming transport and speech synthesis. Use platform frameworks where they genuinely apply (Speech, AVFoundation, EventKit, Contacts, MapKit, UIKit/URL schemes); use documented permission prompts and explicit opt-in for sensitive actions. Some operations (notably making calls or launching apps) remain restricted or require user confirmation.
5. Provide provider-specific networking with secure key storage (Keychain), cancellation/timeouts, bounded retries, streaming parsers, redacted diagnostics, and no secrets in logs. Do not ship an undocumented managed backend or collect user prompts silently.
6. Add an allowlisted tool/intent layer: validate every model-produced action, show confirmation for consequential actions, and never execute arbitrary generated code or URLs.
7. Test on physical iOS 15 devices for activation, Siri fallback, audio interruption, lock-screen behavior, respring/uninstall, permissions, networking failures, and each jailbreak flavor. Build success alone is not device validation.

## Current status

Research only; no implementation or compatibility claim has been made. Since the checkout contains only this brief, a “working, polished, error-free SiriPlus clone” cannot be truthfully delivered without choosing a non-proprietary scope and obtaining a Theos + iOS SDK build/test setup and supported test devices.

## Source

- [SiriPlus on Havoc](https://havoc.app/package/siriplus) — feature list, version, compatibility, rootless statement, and the developer's roothide caveat.
- [SiriPlus announcement](https://www.reddit.com/r/jailbreak/comments/1b5mac1/paid_release_siriplus_replace_chatgpt/) — initial release details; older announcement, so use the Havoc listing for current public details.

---

## Technical product map (independent implementation)

### 1. Runtime architecture

A practical design has five layers, with the tweak intentionally kept thin:

```text
Siri activation / user launch
  -> integration shim (per-iOS adapter; native-Siri fallback)
  -> assistant UI + conversation/session coordinator
  -> provider adapter (OpenAI | Anthropic | Gemini | compatible endpoint)
  -> tool broker (allowlist, validation, consent, execution)
  -> iOS framework / URL handoff
```

A separate settings app or PreferenceLoader bundle configures provider, model, language, UI, enabled tools and privacy. Shared preferences must use a stable suite/domain and write atomically; API credentials belong in Keychain, not plist/UserDefaults. The tweak should avoid doing network requests, speech recognition, or calendar work on the SpringBoard main thread. Prefer a small app/service process and narrowly scoped IPC; do not add a privileged daemon unless a demonstrable capability requires it. Define IPC messages as versioned, typed requests with size limits and authorization checks.

### 2. User turn and streaming lifecycle

1. Start a session only after explicit activation; request microphone permission in a user-visible context.
2. Capture audio with AVAudioEngine/audio session management. Feed buffers to `SFSpeechAudioBufferRecognitionRequest`; check `SFSpeechRecognizer.isAvailable`, request authorization, and handle partial/final results, cancellation and interruption. `requiresOnDeviceRecognition` is conditional: not every locale/device supports it. Apple's Speech API is not an unconditional “offline speech” guarantee.
3. Send final/partial transcript to the selected provider using TLS. OpenAI and compatible APIs commonly stream Server-Sent Events; treat network chunks as bytes, decode UTF-8 incrementally, parse SSE event/data boundaries, and honor cancellation/timeouts. Do not assume a single network chunk equals a JSON object or token.
4. Render plain-text deltas immediately. Do **not** speak every token: buffer until sentence/clause boundaries, sanitize Markdown for speech, enqueue utterances, and support stop/interrupt. Use `AVSpeechSynthesizer`/`AVSpeechUtterance` for system TTS. Voice matching is by available `AVSpeechSynthesisVoice` identifier/language; an app cannot promise access to Siri's exact premium voice in every jailbreak/process context. Audio session interruptions, route changes, Bluetooth, mute/ducking and the user stopping speech must be handled.
5. If a tool call is returned, stop treating that response as user-facing prose. Collect the complete call, validate it, get consent if needed, execute, then return a compact result to the model. Continue the provider turn for a natural-language summary. Bound the number of tool rounds (e.g. 4), call count, output size and wall-clock time to prevent loops.
6. On cancellation, dismiss, app termination, respring, permission denial, offline/network/API error, or unsupported private interface, release audio/network resources and fail safely to native Siri or a clear error. Never leave the microphone running in the background unexpectedly.

### 3. Tool calling: should the model be allowed to call tools?

**Yes. Tool calling is useful for the advertised device actions, as long as the app maps model tool names to real, predefined handlers and checks their arguments. The model returns a structured request; the app executes the handler and returns its result. Keep user confirmation for actions with real-world side effects (calls, calendar writes, sending).

Recommended policy:

| Tool | Default | Execution/consent policy |
|---|---|---|
| Search web | Off until enabled | Send a concise query to a documented search provider; return a few useful results with titles and links. |
| Open app | Allowlist only | Map a validated app identifier to a known application/approved URL scheme; confirm if target is ambiguous. `UIApplication` restrictions apply outside the foreground app. |
| Draft email/message | Draft only | Populate a compose UI via supported APIs where available; user reviews and taps Send. Never silently send. |
| Create calendar event | Ask each time (or explicit user preference) | Parse date/time/time zone carefully; show title, calendar and time for confirmation; use EventKit authorization and report actual save result. |
| Phone call | Confirm each time | Resolve contact locally only after Contacts permission; disambiguate; use a `tel:` handoff and let system UI/user initiate. Do not promise silent calls. |
| Maps directions | User-confirmed handoff | Resolve destination to coordinates/address and open Maps with a safe URL; user completes navigation. |
| Device/system info | Minimal allowlist | Expose only non-sensitive, explicitly enumerated fields; never dump filesystem, identifiers, notifications or private databases. |
| Pasteboard | Off by default; read/write per-call consent | Read only in response to a clear user request and disclose content is sent to provider; write only after preview/confirmation. Avoid background polling. |
| Run Shortcuts | Opt-in per shortcut | Invoke only user-selected shortcuts through documented Shortcuts handoff/API available on target OS; show the shortcut and obtain confirmation for consequential effects. |
| Delegate to Siri | Explicit handoff | Hand control to native Siri rather than trying to imitate or replace every native intent. |

**High-risk actions** (send, purchase, delete, share, call, unlock/security, home controls) should never execute solely because the model said so. Require a confirmation UI containing the resolved action and relevant parameters. On lock screen, disable sensitive tools unless the device is authenticated; do not bypass device security. Keep returned content bounded and display it as text, not executable content.

### 4. Tool schema, streaming parse and dispatch

Use provider adapters that normalize vendor responses into an internal type, for example:

```text
ToolCall { providerCallID, name, rawArguments }
ToolResult { providerCallID, ok, boundedJSON, userFacingSummary }
```

Declare each tool with a strict JSON Schema where supported: fixed name, object arguments, required keys, enums/ranges, `additionalProperties: false`, short descriptions and conservative maximum string/array sizes. Keep provider schema separate from the actual executor. A central registry maps names to typed handlers; never use reflection/`NSSelectorFromString`/dynamic class lookup from model output.

**Streaming parsing rules:**

- OpenAI: accumulate tool-call deltas independently by call index/ID; names and argument JSON may arrive in fragments. Execute only after the documented completed/terminal event, not on partial JSON.
- Anthropic: track content blocks by index; accumulate `input_json_delta` for a `tool_use` block; dispatch once the block/turn is complete, then send `tool_result` with its matching tool-use ID.
- Gemini: inspect typed `functionCall` parts; execute the named function locally and return a matching function response. Do not infer calls from natural-language text.
- For every provider: parse the complete JSON once; enforce UTF-8/size/depth limits, schema validation, semantic validation (e.g. dates not in the past, coordinates sane), authorization, consent and rate limits. Unknown tool -> structured error, not fallback execution. Duplicate IDs -> deduplicate. Tool timeout/failure -> return bounded error and offer recovery. Never execute partial arguments or arguments embedded in prose/code fences.

Pseudo-flow:

```text
response = provider.stream(messages, toolSchemas)
for event in response:
    if text_delta: render_and_buffer_for_tts(event.text)
    if tool_delta: buffer_by_provider_call_identity(event)
when turn_complete:
    calls = providerAdapter.finalize(buffer)
    for call in calls:
        args = parseJSON(call.arguments)
        schemaValidate(call.name, args)
        policyCheck(call.name, args, currentDeviceState)
        if requiresConsent: await userConfirmation(resolvedAction)
        result = await allowlistedRegistry[call.name].execute(args)
        appendProviderToolResult(call.id, boundedSanitized(result))
    if calls: request_followup_turn_with_results()
```

Never execute as argument fragments arrive. Avoid `eval`, shell commands, arbitrary URL fetch, arbitrary file access, dynamic Objective-C invocation, model-selected class/selector names, or model-controlled SQL. For navigation/web tools, defend against URL schemes such as `javascript:`, file URLs, local-network probing/SSRF (if a server fetches URLs), redirects to private IPs, and oversized responses.

### 5. Provider API and key management

Provider adapters should each own request construction, authentication, model selection, streaming decode, tool schema translation, error mapping, and cancellation. Do not assume identical tool semantics across vendors or that every “OpenAI-compatible” endpoint supports streaming/tool calling in the same way. Probe/configure endpoint capabilities; expose a compatibility warning and allow text-only mode.

- **OpenAI:** Chat Completions tool calls or Responses API function tools; send tools and conversation, stream typed events/SSE, accumulate function argument deltas, execute locally, submit tool output, continue for final response. Official guide: https://platform.openai.com/docs/guides/function-calling and streaming: https://platform.openai.com/docs/guides/streaming-responses
- **Anthropic Claude:** Messages API with `tools`/`input_schema`; parse `tool_use`, run client tool, add corresponding `tool_result`, continue conversation. Streaming is block/event based, not OpenAI's delta shape. Official docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use and https://docs.anthropic.com/en/docs/build-with-claude/streaming
- **Google Gemini:** Gemini API function declarations; inspect returned function-call parts; execute locally and return function response. Official docs: https://ai.google.dev/gemini-api/docs/function-calling
- **Custom OpenAI-compatible:** configurable HTTPS base URL, model, key and feature flags. Treat custom endpoints as third-party recipients; prevent HTTP downgrade, restrict unsafe URL schemes, warn before sending sensitive data. Compatibility is not a guarantee.

API keys: store in iOS Keychain with device-only accessibility where practical; never in tweak preferences, source, logs, crash reports, URLs, analytics or prompt history. Mask keys in UI; support revoke/delete; redact authorization headers and prompts from diagnostics. A user-provided key can still be extracted from a jailbroken device by its owner or malware with equivalent privilege—Keychain is at-rest protection, not a defense against a compromised OS. Do not embed a shared vendor key in a distributed tweak. Managed mode requires a real backend, documented privacy/retention, abuse controls, cost limits and a transparent disclosure; it cannot be invented client-side.

### 6. Native iOS APIs and constraints (especially iOS 15)

- **Speech:** `Speech` framework (`SFSpeechRecognizer`, `SFSpeechAudioBufferRecognitionRequest`) with user authorization and availability/locale checks. Apple's documentation: https://developer.apple.com/documentation/speech/sfspeechrecognizer and https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition
- **Audio/TTS:** AVAudioSession + AVAudioEngine for capture; `AVSpeechSynthesizer` and `AVSpeechUtterance` for system speech output. Audio session category/activation is stateful and must coordinate with Siri/media/phone interruptions. Docs: https://developer.apple.com/documentation/avfoundation/avspeechsynthesizer and https://developer.apple.com/documentation/avfoundation/avaudiosession
- **Calendar:** on iOS 15 use EventKit's `requestAccess(to: .event)` and `EKEventStore`; later iOS versions introduced different full/write-only authorization APIs, so gate by availability rather than compiling iOS 17 API assumptions into an iOS 15 deployment. Docs: https://developer.apple.com/documentation/eventkit/ekeventstore/1507547-requestaccess and https://developer.apple.com/documentation/eventkit/ekeventstore
- **Contacts:** use Contacts framework authorization and local resolution; ask only when needed and avoid uploading entire address books. Docs: https://developer.apple.com/documentation/contacts
- **Maps:** MapKit for geocoding/search where licensed and appropriate, or safe Apple Maps URL handoff. Never claim a route was started just because opening a URL succeeded.
- **Apps/phone/mail:** URL/open and system compose handoffs are not blanket permission to silently control other apps. They are subject to app/OS policy, app installation, URL schemes and foreground state. User confirmation is part of correct behavior.
- **Shortcuts/Siri:** App Intents are a framework for exposing an app's own actions, not a magic API that can run any installed Shortcut or replace Siri on iOS 15. Prefer documented Shortcuts handoff and delegation. A jailbreak tweak's injection into Siri is a separate, private integration concern.

### 7. Jailbreak, injection, compatibility and packaging

Rootless changes package paths/dependencies and requires rootless-built dependencies; it is not merely a runtime flag. Theos uses `THEOS_PACKAGE_SCHEME=rootless` for rootless packages; iOS 15 rootless package architecture is distinct from traditional rootful. RootHide needs a RootHide-compatible toolchain/package/injection setup and device testing independently. Do not ship one `.deb` labeled “rootless + roothide” without validating both install, injection, preference paths, dependencies and uninstall behavior.

For the Siri seam, private classes/selectors can be inspected in the target firmware, but names/signatures are undocumented and can change. Use a per-version adapter, runtime class/selector existence checks, signature checks, minimal hooks, and a kill switch. If adapter checks fail, leave native Siri untouched. Never run broad hooks over every UIKit class. Maintain clean uninstall and avoid modifying sealed system files. Build matrix should include iOS 15 minor releases, device/architecture (arm64/arm64e), jailbreak flavor, and fresh install/update/uninstall/respring.

Theos references: https://theos.dev/docs/ and rootless migration context: https://theapplewiki.com/wiki/Dev:Updating_extensions_for_iOS_15/16. Product's own compatibility note remains the most relevant evidence for SiriPlus: https://havoc.app/package/siriplus (rootless supported; roothide not tested in the listing).

### 8. What must be measured before “production-ready”

Maintain a test matrix and reproducible build artifacts. Test speech permissions denied/revoked; unsupported locale/offline recognition; quiet/noisy audio; incoming call/Siri/media interruption; SSE disconnect/invalid UTF-8/partial JSON; duplicate/unknown tool; malformed/oversized schema input; API 401/429/5xx; slow endpoint and cancellation; VoiceOver/Dynamic Type; light/dark mode; lock screen and authentication; calendar timezone/DST; ambiguous contacts; app absent; pasteboard consent; shortcut failure; respring during active audio; safe-mode/uninstall. For device actions assert both the displayed confirmation and the actual OS result. Unit-test providers and parser using recorded fixtures, but do not treat simulator tests as jailbreak injection/device validation.

No version-specific Siri hook, exact Siri voice access, SiriPlus backend/API key, nor roothide success is established by public product information alone. Those require an authorized physical-device investigation and testing; do not fake these with a prototype or claim them as complete.

## Further findings: product evolution, integration boundaries, and unresolved evidence

### What the public release history tells us

Havoc's history adds engineering clues beyond the feature list:

- v1.1 added Type to Siri, a Control Center toggle, model/temperature selection, and fixes for Hey Siri, multiturn requests, chat rotation and corrupted conversations.
- v1.2 added web search and experimental Shortcuts; added model picker and configurable OpenAI base URL; fixed provider key separation, managed-mode chat rotation, Gemini multipart handling and date-format confusion; pre-synthesized TTS text; reduced function-schema token cost; removed Comet dependency and reworked preferences.
- v1.3 notes contact matching, memory use/client overhead, Gemini tool calls and date ambiguity fixes.
- v1.4 notes managed-mode model change to GPT-4o, pasteboard tools, web improvements, provider API fixes, model defaults, and an option to disable custom UI for compatibility.

These changelog entries are useful evidence of real complexity (conversation state, locale/date parsing, provider-specific tool protocols, TTS queueing, performance), but are not proof of internal implementation details. “Managed mode uses GPT-4o” does not disclose its endpoint, prompts, data retention, intermediary services or backend architecture. Do not guess those.

### Injection is a separate feasibility gate

“RootHide support” is ambiguous unless the exact RootHide product and injection capabilities are named. RootHide's developer docs describe a randomized jailbreak root and dedicated path/linking compatibility. The separate TrollStore-based RootHide Bootstrap documentation says it does not inject tweaks into SpringBoard (and its repository says third-party injection is opt-in/app-scoped). A Siri replacement requiring SpringBoard/system assistant integration therefore cannot be assumed to work in every product called RootHide. Must identify and test: (a) Dopamine with rootless package scheme, (b) a jailbreak flavor branded Dopamine-roothide if specifically targeted, and/or (c) RootHide Bootstrap, with system-process injection enabled/available. If target environment cannot inject into SpringBoard or Siri processes, a global replacement is not feasible there; offer only app-based/shortcut activation instead. Sources: https://github.com/roothide/Developer and https://github.com/roothide/Bootstrap.

RootHide implementation findings to verify against the maintained developer repository before build: do not hardcode `/var/jb`; use the RootHide path API (`jbroot()`/documented macros) for jailbreak files, use its toolchain and package scheme, inspect required entitlements only for the executable that needs them, and validate library load paths. A package architecture label or successful `make package` says nothing about injection eligibility or runtime correctness. Source: https://github.com/roothide/Developer (README and interface docs).

### Process boundary and data flow decision points (research, not final design)

There are at least three plausible arrangements, each with tradeoffs to resolve before coding:

1. **All work inside SpringBoard/Siri process:** simplest access to some private activation/UI state, but network/audio/provider bugs can crash or hang a critical system process; unacceptable default for broad feature code.
2. **Injected shim + separate app/service:** shim observes the narrow activation seam and sends a session request via documented Apple IPC where feasible; assistant UI/audio/provider logic runs in a less critical process. IPC activation, background lifetime, microphone entitlement/permission UX, and presentation above other apps are hard constraints that must be proven on-device.
3. **No system injection:** user launches app/widget/shortcut/Control Center entry; safest and portable, but not equivalent to holding the hardware Siri button or “Hey Siri”. This should be the explicit fallback if the target jailbreak cannot inject into system processes.

Do not pick one until a device experiment proves the exact process that receives the relevant activation event, whether the tweak loader injects there on each chosen jailbreak, and whether an app-owned audio/UI session can be started and presented in that state.

### iOS 15 API/version details worth pinning down

- Speech recognition and microphone are distinct authorization/privacy surfaces. Verify both permissions and the required purpose strings in the actual host executable/bundle; injected code does not automatically inherit a separate app's usage descriptions or user-facing authorization flow. For voice privacy, check the locale recognizer's `supportsOnDeviceRecognition`; set `requiresOnDeviceRecognition` if local-only is promised and fail with a clear unsupported-locale state rather than silently using Apple servers. Apple's official request setup: https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition and recognizer: https://developer.apple.com/documentation/speech/sfspeechrecognizer
- iOS 15 EventKit authorization API is the older `requestAccess(to:completion:)`; later OS versions add newer full-access/write-only methods. Runtime availability branches and matching usage-description keys are required. A jailbreak tweak has no exemption from the target app's privacy/authorization mechanics just because it can hook a process.
- `AVSpeechSynthesizer` is public speech output, but public API voice enumeration is not evidence that the same voice, quality, or premium Siri voice used by Siri is available to the tweak. Promise “system voice chosen from available voices”, not “exact Siri voice”, unless proven on every supported build.
- Activation paths (hardware button, Hey Siri, Type to Siri, Control Center) are not one public API. A Control Center toggle can be user-owned and public-ish integration, while intercepting the hardware activation or replacing Hey Siri depends on private framework/process behavior and can be version/jailbreak dependent. Type to Siri is separately configured by the OS and needs a keyboard/text-session path, not microphone-only assumptions.

### Feature contracts to specify before implementation

Each capability should have an explicit contract: input schema, permission, whether remote data leaves device, confirmation rule, returned success criteria, failure modes, undo/cancel path, and supported iOS/jailbreak matrix. In particular:

- **Contacts:** match locally, normalize names/locale, rank candidates, and ask the user when more than one plausible match exists. Send no contact list to an LLM. If a user confirms a specific call, send only the minimum chosen number needed to initiate handoff.
- **Calendar:** dates must be parsed relative to an explicit locale/time zone and anchored to a reference timestamp; ask a clarifying question for missing/ambiguous date/time/duration; account for DST; check calendar permission; only claim “created” after EventKit completion confirms a saved event.
- **Pasteboard:** clipboard may contain passwords, tokens, health or private content. Require an explicit “use clipboard” interaction (not automatic background reads), preview what is sent, and make sending to the configured provider a separate disclosure/consent point. Clipboard writes should be previewed and user-triggered.
- **Web:** search provider/backend must be named and privacy documented. Return a few relevant results with title, URL and short snippet; let the assistant summarize and show the source links.
- **Conversation state:** define per-session memory vs persisted history, rotation policy, deletion/export, token budget, provider retention settings, and handling of incomplete tool rounds. The v1.1/v1.2 fixes around chat rotation/corruption demonstrate this deserves explicit state-machine tests.
- **Markdown/TTS:** render text safely (no arbitrary HTML or remote image loads), preserve tappable links with host confirmation as needed, and derive spoken text separately so URLs/code/markdown markers are not read literally. Queue sentence chunks with sequence IDs so late TTS cannot speak after cancel/new turn.

### Research sources added

- SiriPlus public history: https://havoc.app/package/siriplus/changes
- Theos packaging and process filters: https://theos.dev/docs/packaging
- RootHide developer documentation/toolchain/path API: https://github.com/roothide/Developer
- RootHide Bootstrap injection constraints: https://github.com/roothide/Bootstrap
- Provider tool round trips: OpenAI https://platform.openai.com/docs/guides/function-calling ; Anthropic https://docs.anthropic.com/en/docs/build-with-claude/tool-use ; Gemini https://ai.google.dev/gemini-api/docs/function-calling
- Apple Speech authorization/recognizer: https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition and https://developer.apple.com/documentation/speech/sfspeechrecognizer
- Apple EventKit legacy authorization and event store: https://developer.apple.com/documentation/eventkit/ekeventstore/1507547-requestaccess and https://developer.apple.com/documentation/eventkit/ekeventstore

### Research completion status

This is still discovery, not product design or implementation. Public evidence now supports a functional decomposition and identifies major feasibility/privacy gates. It does **not** establish the exact SiriPlus private hooks, protocol/backend, prompt/system messages, UI assets, source code, or reliable RootHide system injection. Before architecture is frozen, the remaining high-value evidence is a specific target test matrix (exact jailbreak distribution/version + iOS 15 build + device), physical-device inspection of where Siri activation is handled and where injection is permitted, and a privacy decision for speech/provider/web/managed service. Without those, any exact private-hook implementation would be speculation and a production guarantee would be dishonest.

## Continued investigation: implementation contracts and evidentiary limits

### Original product behavior: facts vs engineering inference

The Havoc listing and changelog are the primary available sources for SiriPlus behavior. They establish marketed capabilities and selected release changes, but reveal no source code or wire protocol. Do not reverse engineer the paid binary, redistribute its assets, imitate its branding, or claim its private internals as facts. A compatible product can implement equivalent outcomes independently; exact internal behavior cannot be asserted from marketing text.

Observed release history makes these product requirements explicit:

- v1.1: Type to Siri, CC toggle, configurable temperature/model, Hey Siri and multi-turn/chat rotation fixes.
- v1.2: web search, experimental Shortcuts, OpenAI base URL, GPT/Gemini model picker, independent API keys, Gemini multipart/function-call fixes, managed chat rotation fixes, date-format fixes, pre-synthesized TTS, lower schema token cost, and removal of Comet dependency.
- v1.3: contact matching and memory/client overhead improvements, Gemini tools/date confusion fixes.
- v1.4: GPT-4o in managed mode, pasteboard functions, web updates, API/default model fixes, custom UI disable switch.

This changelog is unusually informative because it confirms provider-specific adapters and multi-turn state are not optional details. It still does **not** disclose whether remote web search is performed by a vendor, SiriPlus server, or another provider; whether managed mode proxies all prompts; how contact matching is implemented; or how the UI is attached to the system.

### Calls and user-controlled handoff: precise claims

For iOS actions, the implementation should report the actual level of completion:

- A `tel:` handoff means “opened the Phone handoff/dial UI”, not “call completed”. Do not state a call was placed or answered based only on successful URL opening.
- A Maps URL means “opened Maps with a destination/search”, not “navigation started”.
- An email compose handoff means “draft opened”, not “email sent”.
- Calendar success requires EventKit save completion without error; a draft/confirmation preview is not a saved event.
- “Open app” success requires an OS handoff for a known application/deep link; `canOpenURL` is limited by registered query schemes and iOS 15 has limits for linked schemes. Prefer a curated mapping rather than probing arbitrary installed apps.
- For iOS 15, query-scheme inspection has a maximum of 50 entries for apps linked on/after iOS 15, so don't architect an app catalog that depends on enumerating every installed app. Apple forum context: https://developer.apple.com/forums/thread/689011. Official UIKit open API: https://developer.apple.com/documentation/uikit/uiapplication/open(_:options:completionhandler:)

Useful official API references for contracts: Contacts authorization https://developer.apple.com/documentation/contacts/cncontactstore/authorizationstatus(for:) ; EventKit save https://developer.apple.com/documentation/eventkit/ekeventstore/1507295-saveevent ; SiriKit intent handling https://developer.apple.com/documentation/sirikit/intent-handling-infrastructure. These do not grant a jailbreak tweak the ability to bypass OS permission prompts.

### Internal Siri integration: what public evidence can and cannot tell us

Open-source jailbreak discussion and tweaks show that developers have historically interacted with private SpringBoard Assistant classes, and an iOS 15 assistant-UI hiding tweak reports filtering injection into SpringBoard, SiriViewService and Settings. This suggests candidate processes to inspect, not a stable API contract. Older community snippets mentioning `SBAssistantController` or `AssistantServices` are years old and cannot be treated as valid iOS 15 method signatures or a safe design. The public search did not establish a supported iOS 15 hook sequence for replacing Siri's UI/audio/session. Therefore no hardcoded selector list should be treated as verified at this stage.

A research proof must inspect a legally obtained target device's exact OS build and image/framework metadata, identify which process receives each activation mode, observe lifecycle callbacks without changing behavior, and prove process injection is enabled for that bundle on the exact jailbreak. Then test the least invasive interception point with a reversible no-op/telemetry patch and native-Siri fallback before attempting UI replacement. If the target process is not injectable, stop and scope the experience to a launcher/shortcut instead. Do not infer injection permission from a package installing successfully.

The independent Disable Assistants project is an example of a different, narrower behavior (hide assistant UI). It describes runtime class discovery and window fallback. That strategy is not evidence for replacing Siri and is not recommended as a template for broad UI interception; it could hide unrelated content or break across point releases. Source: https://github.com/tachibana-shin/disable-assistants.

### Provider protocol rules: strengthen the adapter boundary

A provider adapter must preserve each provider's continuation semantics, not merely convert `tool_call` JSON to a common dictionary:

- OpenAI Chat Completions: assistant message with tool calls, then tool messages keyed by call ID; Responses API uses typed response events and function-call/output items. Do not mix these formats. A call can contain multiple tools; sequentially execute side-effecting tools unless the policy proves they are independent and both already authorized.
- Anthropic Messages: assistant `tool_use` blocks followed by a user message containing matching `tool_result` blocks. Streaming JSON arrives as block deltas; concatenate by content block index and wait for completion.
- Gemini: function call parts have their own call/response representation. Preserve the model's turn/parts and correlate the function response with the call. Changelog fixes around Gemini multipart handling mean tests must cover mixed text + multiple function-call parts, not just one simple tool.
- A common internal model should retain provider, conversation/turn ID, call ID, call order, name and exact canonical args. Normalize only after provider-specific decoding; serialize responses back using the provider's expected structure.
- Tool outputs should be minimized and bounded. Avoid sending raw device objects, full contact records, unfiltered web pages or secrets back into the model context. Keep a strict maximum tool execution/round-trip budget and detect repeated identical calls.

Official API descriptions: OpenAI https://platform.openai.com/docs/guides/function-calling ; Anthropic https://docs.anthropic.com/en/docs/build-with-claude/tool-use ; Gemini https://ai.google.dev/gemini-api/docs/function-calling. Provider docs change over time; pin API version/model compatibility in implementation, log the selected API mode (not secrets), and test contract fixtures against the live provider before release.

### Required test artifacts before any implementation can be called “working”

1. **Capability sheet per environment:** exact product name/build, iOS build number, device model/chip, arm64/arm64e, injection targets allowed, package scheme, installation and removal tested.
2. **Process map:** activation source -> receiving process -> presentation process -> audio owner. Record separately for hardware, Hey Siri, Type to Siri, CC toggle, lock screen and unlocked state.
3. **API behavior matrix:** Speech locale/on-device support and authorization; audio interruptions/routes; EventKit authorization/save; Contacts matching; URL/handoff completion; provider stream/error/tool-round-trip behavior.
4. **Privacy map:** data item, source, destination (Apple speech service/provider/managed backend/search endpoint/local only), trigger/consent, retention, deletion. A “local transcription” promise is only valid when on-device support is checked and required.
5. **Failure/recovery matrix:** if injection fails, API fails, tool args fail validation, the user denies access, or a call is canceled, confirm native Siri remains functional and there is no partial side effect.
6. **Release evidence:** reproducible rootless and roothide packages built with the respective toolchains; dependency/architecture inspection; install/update/uninstall tests; physical-device logs and test reports. A simulator, static analysis, successful compile, or package metadata is not proof of jailbreak runtime compatibility.

### Updated research boundary

Research has now mapped public features, version history, provider tool round trips, relevant public Apple APIs, rootless/roothide package distinctions, security policy, and the principal runtime unknown. The gap is no longer broad documentation: it is device-specific empirical evidence. Without an exact device/jailbreak and access to a physical test device, the remaining claims about Siri activation interception and system UI/audio replacement cannot be resolved by web research alone. Design should wait for that evidence rather than silently assume it.

## Final feature-centric research (beyond injection)

### Conversation coordinator and state correctness

The product is an asynchronous state machine, not a “send prompt, show text” call. Keep explicit states such as `idle → listening → transcribing → requesting → streamingText/collectingTools → awaitingConsent → executingTool → followUp → speaking → idle`, with a cancellation transition valid from every state. Every state update should carry a session/turn generation token so late callbacks from an old request cannot overwrite a newer transcript, start stale TTS, or execute a tool after the overlay was dismissed. Serialize mutation of conversation history; store user/assistant/tool messages with stable IDs and ordering; keep partial assistant text separate until a turn is complete. Provider errors must not leave incomplete tool calls in history. On retries, distinguish retrying an idempotent read from re-running a side effect. A failed/uncertain calendar write or call handoff must never be automatically repeated.

A “chat rotation” feature (called out in SiriPlus history) likely means session/context management, but its exact semantics are undisclosed. Independently implement an explicit context-budget policy: retain recent turns, summarize only with user-visible/privacy-aware rules, preserve tool call/result pairs atomically, and do not truncate half of a tool interaction. Offer clear-session and persisted-history controls; avoid saving audio by default.

### Streaming transport and perceived latency

For SSE, use a streaming byte parser: incremental UTF-8 decoding, recognize CRLF/LF/CR line endings, buffer across arbitrary network chunk boundaries, dispatch only on a blank line, collect multiple `data:` lines with newline joining, ignore comment lines, and recognize provider-specific `[DONE]` or typed terminal events only in the adapter. A TCP chunk may split inside a Unicode scalar, JSON string, SSE line, or event. Set request timeouts and cancellation; bound total bytes, line length, event payload and reconnect behavior. Do not blindly reconnect a POST that may already have executed a tool or generated billable output.

Latency engineering is a pipeline: start rendering text deltas quickly; sentence-segment for TTS without waiting for the entire answer; do not speak unfinished/incomplete tool-call arguments; while a side-effect tool is pending show a clear progress state; use cancellable provider requests; configure bounded token budgets and reasonable tool-round caps. TTS sentence chunking needs a carry buffer for punctuation/abbreviations/decimals/URLs and a maximum wait/character threshold so short answers do not wait indefinitely for a period. Cancel queued utterances on interruption, dismissal, new turn or user stop, and never play stale speech.

Primary standards/API sources: WHATWG HTML Living Standard, Server-sent events: https://html.spec.whatwg.org/multipage/server-sent-events.html ; Apple speech queue/cancel callbacks: https://developer.apple.com/documentation/avfoundation/avspeechsynthesizer and https://developer.apple.com/documentation/avfoundation/avspeechsynthesizerdelegate ; spoken audio session behavior: https://developer.apple.com/documentation/avfoundation/avaudiosession/mode/1616510-spokenaudio.

### Speech/audio product contract

Speech recognition and TTS are separate paths with separate failure/permission issues. Recognition requires both microphone and speech-recognition authorization, recognizer availability for the requested locale, an audio tap lifecycle, and orderly end/cancel of the recognition task. Do not keep an engine tap installed after stop; avoid duplicate taps after retry. Treat partial recognition as revisable UI, not as final intent: do not execute device tools from a partial transcript. Consider an explicit confirmation/edit step for ambiguous transcription, especially for names, dates, addresses and numbers.

On-device recognition must be truthfully enforced: only enable `requiresOnDeviceRecognition` when supported, and if the product promises local-only speech, fail closed when unsupported rather than silently uploading audio. Even if ASR stays local, the resulting transcript is sent to the selected LLM unless the user is told otherwise. Track separately “audio processed locally/by Apple” and “transcript sent to provider”.

For speech output use `AVSpeechSynthesizer` delegate callbacks to track start/finish/cancel and sequence sentence chunks; do not assume `speak()` completion means heard. Choose a language-compatible available voice and respect user-selected rate/pitch. `AVAudioSession` interruptions and route changes (phone call, Siri, Bluetooth, other spoken prompts) require pausing/resuming or cancelling and restoring the previous audio state. The app cannot claim Apple Siri's identical voice unless it verifies the required voice is exposed and selectable on the exact OS/device. Sources: https://developer.apple.com/documentation/speech/sfspeechrecognizer ; https://developer.apple.com/documentation/avfoundation/avspeechsynthesizer ; https://developer.apple.com/documentation/avfoundation/avaudiosession.

### Orb/bubble UI and overlays

The advertised orb/reply bubble is a presentation requirement, but exact SiriPlus implementation is private. There are two technically distinct product variants:

- An app-owned interface/scene: ordinary UIKit, predictable lifecycle and public APIs; it cannot remain above arbitrary foreground apps or impersonate a system Siri surface.
- A jailbreak-owned cross-app overlay: requires a system-level presentation mechanism, correct window/scene ownership, safe touch pass-through, rotation/insets/keyboard handling, app transition/lock behavior, display cutouts, external displays, and careful dismissal. These are not ordinary app capabilities and should not be modeled as a normal `UIWindow` public API guarantee.

For a custom orb, define a state model (idle/listening/thinking/speaking/error), interrupt/tap behavior, drag/position persistence, safe-area placement, contrast/reduce-motion behavior, and what happens when the user taps outside. Touch outside dismissal must not steal touches unexpectedly or make host app controls inaccessible. Prevent overlay from intercepting system privacy indicators, emergency controls, authentication screens or protected UI. Provide a conventional app conversation/settings screen if the overlay cannot be shown. No private window level or scene API is established here as a supported cross-iOS-15 solution.

UIKit accessibility guidance: https://developer.apple.com/documentation/uikit/accessibility-for-uikit. Every orb control needs a label/value/trait and VoiceOver alternative to gestures; streamed text updates should not announce every token. Use deliberate announcements for state changes, logical focus management, Dynamic Type, sufficient touch targets and reduced motion. Test VoiceOver, Switch Control and Voice Control on device.

### Search and citation behavior

Search is separate from the model's parametric answer. A robust search tool returns structured items (title, canonical URL, snippet, source/time metadata) from a documented provider; the model receives only bounded results and must cite the result IDs/URLs in its final response. Verify allowed schemes (`https`/`http` only), reject credentials in URL, avoid arbitrary page fetch unless necessary, limit redirects and response size, and do not expose local network/private device endpoints to a remote fetcher. If fetching a result page, extract readable article text and cap its size. Keep the search implementation simple and use a documented provider.

If web search is provided by a managed backend, every query and potentially identifying context goes to that operator even when a user's model key is direct-to-provider; disclose this accurately. SiriPlus listing says web searches go to its server even with user API key (product listing), which is a privacy distinction worth reproducing transparently—not necessarily reproducing that exact architecture. Sources: https://havoc.app/package/siriplus and provider function/tool docs linked above.

### Calendar, dates, contacts, and maps: data correctness

**Dates:** Parse relative phrases against a captured reference instant and explicit locale/calendar/time zone. “Next Friday”, “tomorrow at 8”, ambiguous numeric dates, missing year, daylight-saving gaps/overlaps, and travel time zones require deterministic clarification rules. Foundation date parsing is not an authoritative natural-language intent parser; the LLM may propose ISO-8601 fields, but app-side validation must check them and render a localized confirmation (including time zone) before save. SiriPlus v1.3 specifically lists a fix for date-format confusion, reinforcing this test requirement.

**Calendar:** Create an `EKEvent` using an authorized `EKEventStore`, select a writable target calendar, set start/end/time zone, then call EventKit save and inspect its error/completion. EventKit save is a local data-store operation; it may sync later through the user's configured calendar account, so distinguish “saved to calendar” from “synced to invitees”. Creating an event is different from sending invitations. For range queries use `predicateForEvents(withStart:end:calendars:)`; don't query an unbounded history. Docs: https://developer.apple.com/documentation/eventkit/ekeventstore/1507295-saveevent and https://developer.apple.com/documentation/eventkit/ekeventstore/1507479-predicateforevents.

**Contacts/calls:** Query only fields needed (name, phone), handle localized labels and duplicate contacts, and keep the contact-store lookup on device. Pass a chosen number to a user-visible handoff only after confirmation. Contacts permission is distinct from Siri authorization. Apple docs: https://developer.apple.com/documentation/contacts/cncontactstore/authorizationstatus(for:) and SiriKit call intent handler reference https://developer.apple.com/documentation/sirikit/instartcallintenthandling/3165948-handle. SiriKit documents app intent handling; it does not mean a generic third-party assistant can silently place a call.

**Maps:** For a destination handoff, encode a safely percent-escaped destination in Apple's documented Maps URL (or resolve with MapKit and show candidates). Ask when geocoding returns multiple plausible places; distinguish destination selection from active turn-by-turn guidance. Unified Maps URLs: https://developer.apple.com/documentation/mapkit/unified-map-urls ; MapKit search: https://developer.apple.com/documentation/mapkit/mklocalsearch.

### Key storage and privacy implementation detail

Keychain is the correct public iOS storage API for provider keys, with an accessibility class chosen to match whether access while locked is actually required; a device-only class reduces migration to another device but does not protect against compromise by a process with equivalent jailbreak/root privileges. Do not put secrets in CFPreferences, shared app groups, tweak plist, URL query, or analytics. Separate credentials by provider and endpoint, prevent accidental cross-provider key reuse (a SiriPlus 1.2 changelog fix explicitly cites this), and delete credentials on user request/uninstall where feasible. Avoid logging prompts by default; diagnostics should include request ID, provider/model/API mode, error class and timing with secrets/content redacted. Document retention, provider data policies and key deletion limitations. Apple Keychain docs: https://developer.apple.com/documentation/security/keychain_services/keychain_items/using_the_keychain_to_manage_user_secrets and https://developer.apple.com/documentation/security/keychain_services/keychain_items/restricting_keychain_item_accessibility.

### Settings, Control Center, and compatibility switches

A product needs separate toggles for feature permissions (web, contacts/calls, calendar, clipboard, shortcuts), provider/model/API endpoint, voice/language, UI, and privacy/history. Store booleans as opt-in for sensitive tools. A master “disable custom UI” (SiriPlus v1.4) is an integration escape hatch: logically separate assistant activation/backend from the custom overlay so users can disable presentation without corrupting the turn lifecycle. The changelog's Control Center toggle suggests a direct user activation affordance, but public information does not specify its implementation or whether it is an Apple Control Center module, jailbreak CCSupport module, or another method. Don't assume a public iOS 15 API can add arbitrary system toggles; scope a supported control to an app/shortcut or target-jailbreak-specific integration.

Preferences should be read asynchronously/off the critical SpringBoard launch path, validated/defaulted, and changes should update via a documented/in-scope notification mechanism without synchronously writing from SpringBoard startup. A compatibility switch should restore native UI/action path immediately, not require reinstalls. Test corrupted/missing preference files, upgrades/migrations, disabled provider, invalid key, key deletion, package uninstall and respring.

### Source corrections/interpretations

- SiriPlus v1.2 changelog explicitly says **Comet dependency removed**. Earlier initial-release community posts said SiriPlus depended on Comet; that historical statement must not be carried forward as a current requirement.
- The product listing says iOS 14–18.7.9 and supports rootless; it labels roothide “not tested”. That is the current vendor statement, not a compatibility matrix for every device/build.
- “Speech recognition on device” in the listing concerns the recognition phase. It does not imply the transcript remains local when sent to an AI provider.
- Public docs substantiate standard Apple API behavior and vendor tool protocols, not Apple private assistant integration or SiriPlus internals.

## Research stop criteria (ready to transition only when satisfied)

The broad product-research pass is complete enough to outline requirements, but a grounded implementation design is **not** ready until the following facts are supplied or empirically measured:

1. Exact target jailbreak distribution/build and whether SpringBoard/Siri processes can be injected; exact iOS 15 build + device.
2. Whether requirement truly means hardware/Hey Siri replacement, or whether a shortcut/CC/app launcher is acceptable on environments without system injection.
3. Voice privacy choice: local-only ASR required or Apple server ASR acceptable; transcript/provider/search destinations and whether a managed backend is permitted.
4. Which capabilities must be in v1 and their consent policy; which provider/API and who supplies keys.
5. A physical-device process/activation experiment and test matrix. Web-only research cannot establish the runtime hook or overlay feasibility.

Until those gates are answered, freeze no architecture, declare no iOS 15/RootHide support, and do not start a nominal “production” implementation. The research report is intended to make these decisions explicit, not obscure them.


## Scope adjustment from user: prioritize useful assistant features

The implementation goal is a useful voice assistant, not an elaborate security-research project. Keep basic secure engineering (don't execute arbitrary code, don't leak API keys, ask before consequential actions), but do **not** build a special prompt-injection detection/filtering subsystem, unneeded threat scoring, or complex browsing sandbox for the first version. These do not improve core STT/chat usefulness enough to justify delaying the product.

Recommended feature priority for a first functional release:

1. **Voice input / STT:** record on explicit activation, show live partial transcription, let the user correct it, then submit final text. For Vietnamese, query `SFSpeechRecognizer.supportedLocales()` on-device and instantiate the actual locale (likely `vi-VN` if present); check `isAvailable` and `supportsOnDeviceRecognition` on the target iOS 15 device. Apple materials document broad language support historically, but availability and offline support differ by locale/device/OS, so do not hardcode success. If Vietnamese is unavailable, offer keyboard input and a clearly explained provider STT fallback rather than a broken microphone button.
2. **Streaming chat:** provider adapters for selected API(s), render response incrementally, cancel/retry cleanly, and show clear network/API errors. Start with one provider and one OpenAI-compatible endpoint if that is the user's preference; add Claude/Gemini adapters only if actually needed.
3. **Spoken response / TTS:** use available system voices and let the user choose language/voice/rate; queue sentence chunks and provide stop/replay. Check available voices with `AVSpeechSynthesisVoice.speechVoices()`; don't promise an exact Siri voice.
4. **Useful tools:** web search, open Maps/app, draft email, create calendar entry, contact lookup/call handoff, and optional pasteboard/Shortcuts. Keep tools opt-in, provide confirmation for calls/calendar writes and preserve native user UI for the final handoff.
5. **Assistant UI and settings:** readable conversation, orb/listening state if cross-app presentation is proven feasible, provider/key setup, language/voice, tool switches, privacy/history clear, and a “disable custom UI” fallback.

For Siri/STT interaction, partial transcripts should be visibly provisional; do not submit every partial revision to the model. User can tap to edit/finalize or use a configurable end-of-speech rule. Do not record/store raw audio by default. Distinguish whether audio goes to Apple Speech services from whether recognized text goes to the selected AI provider. A practical Vietnamese-first test must use real Vietnamese speech with names, accents, numbers, addresses and noisy-room audio on the exact target device.

Official locale and voice discovery APIs: https://developer.apple.com/documentation/speech/sfspeechrecognizer (`supportedLocales()`, `isAvailable`, `supportsOnDeviceRecognition`) and https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices(). Apple WWDC's Speech framework material notes language coverage and availability checks, not guaranteed identical local/offline support: https://developer.apple.com/videos/play/wwdc2016/509/ and https://developer.apple.com/videos/play/wwdc2019/256/.

This changes prioritization only; the system-injection feasibility gate remains. STT, chat and TTS can be developed/tested as a normal app-level assistant independently, but exact hardware/Hey Siri replacement still requires verifying injection and activation on the selected jailbreak/device.

## User-confirmed direction for next phase (2026-11-23)

- Target environment: **Dopamine-roothide** (user selected this label; exact release/build still required).
- Siri integration: **system Siri activation replacement is required**.
- Initial feature scope: **STT + AI chat first**.
- TTS: user wants the **existing/default Siri voice**, rather than a separately selected generic system voice.

### TTS feasibility warning for that requirement

The public `AVSpeechSynthesizer` API exposes installed voices and lets a caller select a voice identifier, but Apple documentation does not promise that an app can select the exact currently configured Siri voice or the Siri service's premium voice. Community reports about `com.apple.ttsbundle.siri_*` IDs are not a supported API guarantee and report differing results. SiriPlus's product listing says it speaks using the voice configured in Settings > Siri, which is evidence about SiriPlus's claimed behavior—not evidence that public AVFoundation can reproduce it.

Therefore treat “Siri's exact current voice” as an explicit feasibility experiment on the target iOS 15 build, not a solved public-API feature. Test (1) `AVSpeechSynthesisVoice.speechVoices()` and the actual Siri voice selection on that device, (2) whether AVSpeechSynthesizer can use it and track the selection change, (3) language/voice download state, and (4) whether the Siri service's own speech output can be invoked through a documented or target-specific mechanism without causing native Siri to speak unexpectedly. If the exact voice is inaccessible, the honest fallback choices are use the closest available system voice or defer TTS; do not silently claim it's Siri's voice.

Apple public references: https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices() and https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/init(language:). Community reports are not normative: https://stackoverflow.com/questions/60113241/automatic-loading-of-voices-for-avspeechsynthesizer.

## Device correction after target confirmation: iPhone 7 Plus / iOS 15

User target is now specified as **iPhone 7 Plus on iOS 15**; asking for the installed RootHide app version was unnecessary at this stage. The important compatibility fact is the phone's SoC: iPhone 7 Plus is **A10**, not A12+ / arm64e.

The original `roothide/Dopamine-roothide` 1.x project README explicitly scoped that branch to iOS 15.0–15.4.1 on A12–A15/M1 (arm64e); it did not include iPhone 7 Plus. The official RootHide Dopamine release history later adds DarkSword support for **iOS 15.8.7 (A9–A10)** in release 2.4.9.22, and current official releases are on the 3.x line. This means “iOS 15 + iPhone 7 Plus + RootHide Dopamine” is not a single uniform compatibility claim: if the phone is on 15.8.7, current RootHide Dopamine releases list a specific A9–A10 path; if it is on an earlier 15.x build, that release note alone does not establish support. Do not assume the old Dopamine-roothide branch supports this device. Sources: official GitHub releases https://github.com/roothide/Dopamine-roothide/releases ; original branch README https://github.com/roothide/Dopamine-roothide/blob/1.x/README.md ; Apple-device identifier/spec reference lists iPhone 7 Plus as `iPhone9,2`/`iPhone9,4`, A10, arm64: https://github.com/DevYeom/apple-wiki.

This is why the **iOS minor/build** matters more than the installed RootHide app version for a feasibility claim. It is enough to proceed with an iPhone 7 Plus target at the product-scope level; before claiming or building a jailbreak-specific package, read the exact iOS version/build in Settings > General > About and match it to the official release matrix. No need to ask for RootHide's app version unless diagnosing a specific install issue.

### Final target correction

The user has now specified **iPhone 7 Plus, iOS 15.8.3**. This resolves the minor-version question; do not ask it again. It is an A10/arm64 device. Official RootHide Dopamine release notes document A9–A10 support specifically for iOS 15.8.7 in release 2.4.9.22, but that note alone does not prove the situation for 15.8.3, and the current 3.x branch follows a newer Dopamine base. The exact 15.8.3 + A10 + RootHide injection matrix remains a source/device verification task, not a reason to keep interrogating the user. Official sources: https://github.com/roothide/Dopamine-roothide/releases and https://github.com/roothide/Dopamine-roothide/tree/3.x.
