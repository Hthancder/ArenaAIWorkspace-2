import AVFoundation
import Combine
import Foundation
import Speech
import SwiftUI

struct ChatMessage: Identifiable, Codable, Equatable {
    enum Role: String, Codable { case user, assistant }
    let id: UUID
    let role: Role
    var text: String
    let createdAt: Date

    init(role: Role, text: String) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.createdAt = Date()
    }
}

@MainActor
final class AssistantStore: ObservableObject {
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var transcript = ""
    @Published private(set) var isListening = false
    @Published private(set) var isSending = false
    @Published private(set) var status = "Ready"
    @Published var draft = ""

    @Published var endpoint: String {
        didSet { UserDefaults.standard.set(endpoint, forKey: "assistant.endpoint") }
    }
    @Published var model: String {
        didSet { UserDefaults.standard.set(model, forKey: "assistant.model") }
    }

    private let speech = SpeechCapture()
    private let client = OpenAICompatibleClient()
    private var requestTask: Task<Void, Never>?

    init() {
        endpoint = UserDefaults.standard.string(forKey: "assistant.endpoint") ?? "https://api.openai.com/v1/chat/completions"
        model = UserDefaults.standard.string(forKey: "assistant.model") ?? "gpt-4o-mini"
        speech.onPartial = { [weak self] text in
            Task { @MainActor in self?.transcript = text }
        }
        speech.onState = { [weak self] listening, message in
            Task { @MainActor in
                self?.isListening = listening
                self?.status = message
            }
        }
        speech.onFinal = { [weak self] text in
            Task { @MainActor in
                self?.transcript = text
                self?.draft = text
            }
        }
    }

    func toggleListening() {
        if isListening {
            speech.stop()
        } else {
            transcript = ""
            speech.start(localeIdentifier: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
        }
    }

    func sendDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        draft = ""
        transcript = ""
        let userMessage = ChatMessage(role: .user, text: text)
        let assistantMessage = ChatMessage(role: .assistant, text: "")
        messages.append(userMessage)
        messages.append(assistantMessage)
        isSending = true
        status = "Connecting…"

        let history = Array(messages.dropLast()).map {
            OpenAICompatibleClient.Message(role: $0.role.rawValue, content: $0.text)
        }
        requestTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await client.stream(endpoint: endpoint, model: model, messages: history) { [weak self] delta in
                    Task { @MainActor in
                        guard let self, let index = self.messages.firstIndex(where: { $0.id == assistantMessage.id }) else { return }
                        self.messages[index].text += delta
                        self.status = "Responding…"
                    }
                }
                status = "Ready"
            } catch is CancellationError {
                status = "Cancelled"
            } catch {
                if let index = messages.firstIndex(where: { $0.id == assistantMessage.id }) {
                    messages[index].text = "Request failed: \(error.localizedDescription)"
                }
                status = "Check settings or connection"
            }
            isSending = false
        }
    }

    func cancelResponse() {
        requestTask?.cancel()
        requestTask = nil
        isSending = false
        status = "Cancelled"
    }

    func clearConversation() {
        cancelResponse()
        messages.removeAll()
        transcript = ""
        draft = ""
        status = "Ready"
    }

    func saveAPIKey(_ key: String) throws {
        try KeychainStore.save(key, service: "com.arena.assistant", account: endpoint)
    }

    func loadAPIKey() -> String? {
        KeychainStore.read(service: "com.arena.assistant", account: endpoint)
    }
}

private final class SpeechCapture: NSObject, SFSpeechRecognizerDelegate {
    var onPartial: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onState: ((Bool, String) -> Void)?

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var isTapInstalled = false

    func start(localeIdentifier: String) {
        guard !engine.isRunning else { return }
        onState?(false, "Checking speech access…")
        SFSpeechRecognizer.requestAuthorization { [weak self] speechStatus in
            guard let self else { return }
            AVAudioSession.sharedInstance().requestRecordPermission { microphoneAllowed in
                DispatchQueue.main.async {
                    guard speechStatus == .authorized, microphoneAllowed else {
                        self.onState?(false, "Allow Speech Recognition and Microphone in Settings")
                        return
                    }
                    self.begin(localeIdentifier: localeIdentifier)
                }
            }
        }
    }

    private func begin(localeIdentifier: String) {
        let locale = Locale(identifier: localeIdentifier)
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            onState?(false, "Speech locale \(localeIdentifier) is unavailable")
            return
        }
        guard recognizer.isAvailable else {
            onState?(false, "Speech recognition is unavailable right now")
            return
        }
        self.recognizer = recognizer
        recognizer.delegate = self

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            // Do not force on-device mode silently: iOS 15 support depends on locale/device.
            self.request = request

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    self.onPartial?(text)
                    if result.isFinal {
                        self.onFinal?(text)
                        self.stop(withStatus: "Transcription complete")
                    }
                }
                if let error {
                    self.stop(withStatus: "Speech error: \(error.localizedDescription)")
                }
            }

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.channelCount > 0 else {
                stop(withStatus: "Microphone input is unavailable")
                return
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
                request?.append(buffer)
            }
            isTapInstalled = true
            engine.prepare()
            try engine.start()
            onState?(true, "Listening… tap the microphone to stop")
        } catch {
            stop(withStatus: "Could not start microphone: \(error.localizedDescription)")
        }
    }

    func stop() {
        stop(withStatus: "Transcription stopped")
    }

    private func stop(withStatus message: String) {
        if engine.isRunning { engine.stop() }
        if isTapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            isTapInstalled = false
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onState?(false, message)
    }

    func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        if !available { stop(withStatus: "Speech recognition became unavailable") }
    }
}
