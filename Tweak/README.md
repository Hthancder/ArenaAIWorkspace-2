# Arena Assistant — combined RootHide package

The single `.deb` built by `.github/workflows/tweak-build.yml` contains both:

- `ArenaSiriBridge.dylib` + SpringBoard filter, to redirect an assistant activation to the app's URL scheme when the target private selector exists.
- `ArenaAssistant.app`, the actual STT/chat frontend that requests microphone/Speech permission, transcribes audio, sends text to the configured AI endpoint and displays the streaming reply.

The app is required: the tweak is only the small activation shim and does not perform STT, chat, permissions or settings. The app's Settings are under its gear button and include the redirect switch. **There is no separate PreferenceLoader pane in iOS Settings.**

Install the one combined `.deb` from the GitHub Actions artifact `arena-assistant-roothide-combined-arm64` using Sileo/Zebra in the matching RootHide environment. A post-install script registers the app with `uicache`. No manual IPA install is needed.

The app is ad-hoc signed for jailbroken-device use, not App Store distribution. CI verifies build and package contents. Runtime behavior still needs physical-device validation; the SpringBoard method is private and the hook is guarded, so native Siri remains unchanged if that selector isn't present. TTS using Siri's exact voice is not implemented in this first combined package.
