# Arena Assistant app

Companion app included in the combined RootHide package. It provides on-demand Speech framework transcription, editable transcript/chat composer, OpenAI Chat Completions-compatible streaming, Keychain API-key storage and an in-app Settings screen (gear button). Its Settings include a `Redirect Siri activation` switch read by the SpringBoard bridge tweak; there is no separate PreferenceLoader page in Settings.app.

## Build/package

The combined package workflow is `.github/workflows/tweak-build.yml`. It builds the iPhoneOS app, ad-hoc signs it for jailbroken-device use, stages it with the SpringBoard bridge, builds one RootHide `.deb`, verifies both payloads, and uploads a single artifact. It does not put build products in Git. Xcode can also open `AssistantApp.xcodeproj` for local app development.

The companion app's purpose is to own microphone/Speech permissions, audio capture, transcription, chat UI, provider settings, API key management and the URL activation handoff. The SpringBoard dylib is deliberately a small redirect shim; it does not do speech recognition or network work.

## Runtime behavior and limitations

- First launch, enter an HTTPS endpoint, model and API key. The default is OpenAI Chat Completions-compatible; custom providers must support the SSE `choices[].delta.content` shape.
- For Vietnamese, Speech uses the device's current locale. Actual locale support and availability must be checked on-device. This build doesn't force on-device recognition; recognized text is sent to the configured provider after submission.
- Chat history is in memory only. This first build has no model tools, spoken TTS, web search, managed backend or cross-app overlay.
- The activation hook is a private SpringBoard selector guarded at runtime. CI confirms build/package contents only, not that the selector is reached or that recording/permissions work on a physical iPhone 7 Plus.
- The Siri-voice TTS request is not implemented yet; this app currently returns text responses.
