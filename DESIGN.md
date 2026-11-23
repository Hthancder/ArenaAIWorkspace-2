# SiriPlus-style Assistant — Technical Design (v0.1)

**Status:** design proposal; no implementation started.  
**Target device:** iPhone 7 Plus (A10 / arm64), iOS 15.  
**Jailbreak direction:** Dopamine-roothide, subject to exact iOS 15.x/build compatibility verification.  
**Confirmed first-release priorities:** STT + AI chat. User wants spoken answers to use the current Siri voice; that is a feasibility requirement, not yet proven. System Siri activation replacement is desired, but depends on verifying injection and activation on this exact target.

## 1. Product decision

Build the useful voice-assistant core as an independently testable companion app first, then connect a thin jailbreak activation shim only after the target jailbreak is confirmed to inject the required system process. Do not make STT, network streaming, provider state, or UI rendering live inside SpringBoard.

This separates the project into two acceptance milestones:

- **Milestone A — assistant core:** app can record speech with explicit permission, transcribe, send a user-configured prompt to an AI provider, stream the answer, and cancel cleanly. No claim of replacing Siri.
- **Milestone B — system activation:** a narrow system integration launches/foregrounds or presents the assistant from the desired Siri activation paths on the target jailbreak, with native Siri fallback. This milestone is blocked until physical-device process and injection validation.

If Milestone B cannot be achieved on the target Dopamine-roothide/iOS 15 build, retain the core and expose it through app launch or another user-invoked shortcut; do not ship a fake Siri replacement.

## 2. Proposed components and boundaries

```text
[SpringBoard injection shim — tiny, only if validated]
  detect/receive supported activation -> launch/route assistant session
  fail-open to original Siri if not supported
              │ activation request (small typed message)
              ▼
[Assistant app — UI, permissions, audio, STT, chat state, TTS]
  UIKit + AVFoundation + Speech + URLSession
              │ provider request over HTTPS/SSE
              ▼
[Chosen AI provider]
              │ normalized text/tool-call events
              ▼
[Conversation coordinator]
  streaming renderer; optional later local tool registry
```

### Companion app

Owns microphone and Speech authorization UX; audio capture; recognizer task; transcript edit/submit; conversation state; provider settings; API key entry and Keychain access; text streaming; TTS; accessibility; error and retry UX. Use a UIKit app targeting iOS 15, deployment target 15.0, and test on arm64 hardware. Keep the UI usable without the tweak.

### Activation shim (conditional)

A Theos Logos/Objective-C tweak targeting only the verified system process, not all apps. It should do no HTTP requests or audio capture. It may relay a one-shot activation to the app through a tested supported handoff. Keep original method behavior available for native Siri fallback. The exact target class, selector, process filter, entry point and UI presentation mechanism are **not specified yet**: public sources do not establish a stable iOS 15 Siri replacement API, and the A10/RootHide compatibility gate is unresolved.

The shim must not be built as a system-wide UIKit hook. If a viable activation-to-app handoff cannot be proven, pause Milestone B and use the app-only fallback.

## 3. Assistant-core flow

1. User launches the app/assistant through the available entry point.
2. App requests microphone and speech recognition permissions in context. If denied, provide keyboard entry and a Settings explanation.
3. Create `SFSpeechRecognizer` for the chosen locale. Check `supportedLocales()`, recognizer creation, `isAvailable`, and `supportsOnDeviceRecognition` on the actual device. Show provisional partial transcript in UI; don't send partial revisions to the model. Stop audio capture at final result or explicit cancel.
4. User can edit the final transcript. Submit the final text to provider over HTTPS.
5. Incrementally decode provider streaming events; append text deltas to the response UI. Tool calls are not in initial milestone unless separately approved; no arbitrary function execution.
6. On completion, optionally speak response. User can stop speaking. TTS voice selection uses the exact chosen available voice identifier where possible. The desired “current Siri voice” is a separate device experiment; no fallback voice should be presented as Siri's voice unless confirmed.
7. Cancellation, app backgrounding, audio interruptions, provider errors, respring, or unavailable network close the request/audio session and leave the partial response in a recoverable state.

## 4. iOS 15 API choices

| Concern | Initial implementation | Constraints / checks |
| --- | --- | --- |
| Audio input | AVAudioEngine input node, AVAudioSession; `Speech` streaming request | Microphone permission; install/remove tap exactly once; interruption and route change handling; no background recording by default. |
| Speech-to-text | `SFSpeechRecognizer` + `SFSpeechAudioBufferRecognitionRequest` | Speech authorization separate from mic; one locale per recognizer; dynamic `supportedLocales()` and `isAvailable`; on-device support is per recognizer and cannot be assumed. |
| Chat transport | `URLSession` HTTPS streaming, provider adapter | Incremental UTF-8/SSE parser; cancellation; bounded time/response; status/error handling; no logging prompts/keys. |
| API credentials | Keychain item per provider and endpoint identity | User enters their own key initially; never hardcode a shared key. Jailbroken device owner/root can still inspect process memory. |
| Text UI | UIKit conversation view + transcript composer | Dynamic Type, VoiceOver, tap-to-stop, clear history; no overlay dependency for Milestone A. |
| Spoken answer | `AVSpeechSynthesizer`/`AVSpeechUtterance` | Verify exact Siri voice separately. `speechVoices()` availability doesn't promise the selected Siri TTS voice is exposed to AVFoundation. |
| Preferences | App-owned settings storage; Keychain for secrets | Tweak/app shared prefs only if required for activation switch; don't synchronously read/write on SpringBoard launch. |
| Siri activation | Private/injected seam only after test | No stable public API; discover exact process on exact build; hook narrowly; preserve native behavior. |

## 5. Provider adapter contract

Keep provider-specific code behind a small interface:

```text
ProviderConfiguration { providerKind, endpoint, model, keychainAccount }
ProviderRequest { conversationMessages, stream=true, cancellationToken }
ProviderEvent = TextDelta(text) | Completed | ProviderError(code, retryable)
```

For initial delivery, choose one provider to implement first; do not spend the first milestone building three adapters or a generic agent runtime. A provider can be swapped later if the interface proves useful. For OpenAI-compatible endpoints, let the user configure base URL and model, but verify endpoint supports streaming. Claude/Gemini require their own auth and streaming parsers rather than assuming OpenAI wire compatibility.

No server is required for user-owned keys: the companion app sends HTTPS requests directly. If managed mode is later requested, it is a separate backend/privacy/cost project and must not be represented as already existing.

## 6. TTS acceptance experiment

The user requests the default Siri voice. Before promising it:

1. On this iPhone/iOS build, enumerate `AVSpeechSynthesisVoice.speechVoices()` and record identifiers/languages/qualities without collecting personal data.
2. Determine the currently selected Siri voice through a user-observable Settings check; don't assume it equals `AVSpeechSynthesisVoice.currentLanguageCode()`.
3. Test if the selected Siri voice is present and selectable using public AVFoundation. Verify actual spoken audio, not merely a non-nil object.
4. If unavailable, report that limitation and ask whether the closest public system voice is acceptable. Do not silently use a different voice while claiming Siri voice.

Success criterion: user confirms output matches their Siri voice on the actual device, and it continues to work after respring/reboot, voice/language change and Siri voice download. Otherwise TTS is deferred or downgraded only with explicit approval.

## 7. Jailbreak feasibility gate for the specified hardware

iPhone 7 Plus is A10/arm64. The original Dopamine-roothide 1.x README was scoped to A12–A15/M1, while the official RootHide Dopamine release history later records a specific A9–A10 addition for iOS 15.8.7. Thus “iOS 15” does not yet establish that the intended jailbreak is usable on this exact phone; the iOS minor/build must match the official release matrix. This does not require knowing the installed RootHide app version now.

Before implementing the shim, verify from device Settings the iOS version/build and identify whether the installed jailbreak actually provides a rootless tweak bootstrap with SpringBoard injection. A successful jailbreak does not prove arbitrary tweak injection. Confirm installation of a harmless test tweak in SpringBoard and its bundle/process filter. If no injection into the required process, global Siri replacement is out of scope for that environment.

Build tooling should be chosen after this check: iOS 15 SDK/deployment target; arm64 compile target; RootHide-compatible Theos packaging only if the current target release documents it. RootHide package architecture/layout details must be taken from the corresponding official toolchain docs. Never hardcode `/var/jb` for randomized RootHide paths.

## 8. Minimum tests and acceptance criteria

### Milestone A

- Microphone and Speech permissions independently granted, denied, revoked.
- Vietnamese locale present/absent; device network on/off; on-device recognition supported/unsupported.
- Test Vietnamese names, addresses, times, numbers, English loan words, accents and ordinary room noise.
- Partial transcript corrections; stop before final; repeated sessions without duplicate audio taps.
- Provider 401/429/5xx, timeout, invalid stream, offline, cancellation and response interruption.
- API key remains absent from logs/preferences; user can replace/remove it.
- Dynamic Type, VoiceOver basics, dark/light mode and landscape on 7 Plus.
- TTS Siri voice experiment is a separate pass/fail result.

### Milestone B

- Exact iOS build and jailbreak; arm64 package install/update/uninstall.
- Activation paths tested separately (side/home button, Hey Siri, Type to Siri) and only claim the paths that work.
- Native Siri works when disabled, when the tweak fails to load, and after removal.
- App launches/presents with explicit microphone authorization; no hidden recording.
- Lock screen/authentication, incoming call, audio interruption, respring and jailbreak reboot behavior.

“Production-ready” requires physical-device results, not just successful compilation or a simulator demo.

## 9. Deferred from first milestone

Web search, calendar/contact/call tools, pasteboard, Shortcuts, multi-provider support, managed backend, conversation sync, complex browsing safeguards, and final orb/overlay design. Add only after STT/chat and target system activation are verified; calendar/call actions additionally need UI confirmation and permission handling.

## 10. Immediate next engineering step

1. Get the exact iOS 15 minor/build from Settings (the RootHide app version is not needed).
2. Match that build against the official Dopamine-roothide release support for A10 and verify tweak injection into SpringBoard.
3. If compatible, create a tiny no-op SpringBoard injection validation package before implementing any Siri hook. If incompatible, decide between changing jailbreak environment or app/shortcut activation.
4. In parallel, build the companion STT/chat core as a normal app so it can be tested independently of private Siri hooks.
5. Run the Siri-voice feasibility experiment before committing to exact-Siri-voice TTS.

## References

- Official RootHide Dopamine releases: https://github.com/roothide/Dopamine-roothide/releases
- Original RootHide Dopamine 1.x README: https://github.com/roothide/Dopamine-roothide/blob/1.x/README.md
- RootHide developer docs: https://github.com/roothide/Developer
- SiriPlus public feature list: https://havoc.app/package/siriplus
- Apple Speech recognizer: https://developer.apple.com/documentation/speech/sfspeechrecognizer
- Apple Speech permissions: https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition
- Apple AVSpeechSynthesizer: https://developer.apple.com/documentation/avfoundation/avspeechsynthesizer
- Apple AVSpeechSynthesisVoice list: https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices()

### Target now confirmed

The user has confirmed the exact target OS as **iOS 15.8.3** on iPhone 7 Plus. Do not ask again for the iOS minor/build or installed RootHide app version. This is A10/arm64. The official RootHide Dopamine repo's 3.x branch tracks current Dopamine 3; its release history adds A9–A10 support on iOS 15.8.7 in a specific release. The available official README does not state whether the same A10 path covers 15.8.3. Treat jailbreak compatibility for this exact combo as **not yet proven**, not automatically unsupported; confirm against the source/release matrix or device. The design's next work is now implementation planning/core coding, not further user questionnaires.
