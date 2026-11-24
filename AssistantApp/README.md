# Assistant app core

Companion-app implementation for iOS 15.0+, with on-demand Speech framework transcription, editable transcript/chat composer, OpenAI Chat Completions-compatible streaming, and Keychain API-key storage. This app does not yet replace Siri or provide spoken TTS; the system activation tweak and Siri-voice feasibility are separate gates.

## Open/build

Open `AssistantApp.xcodeproj` in Xcode 14 or newer and run the `Assistant` scheme on a physical iPhone. The app requires microphone and Speech permissions. First launch, enter an HTTPS endpoint, model and API key in Settings. The default endpoint/model are OpenAI Chat Completions-compatible; a provider must support streaming responses with `data:` SSE records and the `choices[].delta.content` shape.

GitHub Actions workflow `.github/workflows/ios-build.yml` builds both a simulator target and an iPhoneOS device target. The device build is packaged as an **unsigned IPA** artifact (`arena-assistant-unsigned-ipa`) for sideloading/signing; the workflow does not commit build output into the repository. Unsigned IPA is not an App Store install package and requires a compatible sideload/install method. Build success does not prove microphone behavior on iPhone, jailbreak injection, or Siri voice.

For Vietnamese, the recognizer uses the device's current locale. Check `SFSpeechRecognizer.supportedLocales()` and actual recognizer availability on the target. Current implementation does not force on-device recognition because locale/device support varies; the UI warns that recognized text is sent to the configured provider when submitted.

## Current limitations

- Not compiled or device-tested in this environment (no Xcode/iOS SDK is installed here).
- Uses the OpenAI Chat Completions streaming wire format; Anthropic/Gemini need separate adapters.
- No conversation persistence, tools, TTS, Siri activation interception, cross-app overlay or managed backend.
- Uses bearer-key auth; some custom endpoints need another auth scheme.
- Error responses are surfaced in the conversation; do not paste production secrets into logs/issues.
