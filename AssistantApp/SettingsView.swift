import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AssistantStore
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = ""
    @State private var notice = ""
    @State private var isKeyVisible = false
    @AppStorage("replaceSystemAssistant") private var replaceSystemAssistant = true

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Provider"), footer: Text("This first build uses the OpenAI Chat Completions streaming format. Endpoint must use HTTPS.")) {
                    TextField("HTTPS endpoint", text: $store.endpoint)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Model name", text: $store.model)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section(header: Text("API key"), footer: Text("Stored in the iOS Keychain on this device. The key is sent directly to the endpoint you configure.")) {
                    HStack {
                        Group {
                            if isKeyVisible {
                                TextField("API key", text: $apiKey)
                            } else {
                                SecureField("API key", text: $apiKey)
                            }
                        }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        Button(isKeyVisible ? "Hide" : "Show") { isKeyVisible.toggle() }
                            .font(.caption)
                    }
                    Button("Save API key") { saveKey() }
                    Button("Delete saved API key", role: .destructive) { deleteKey() }
                }

                Section(header: Text("Siri integration"), footer: Text("When the bridge tweak is installed and its SpringBoard hook is available, assistant activation opens this app and starts voice input.")) {
                    Toggle("Redirect Siri activation", isOn: $replaceSystemAssistant)
                }

                Section {
                    Text("Speech locale: \(Locale.current.identifier)")
                    Text("Speech recognition availability is checked when you start voice input. On-device recognition varies by locale and device.")
                        .font(.footnote).foregroundColor(.secondary)
                } header: { Text("Speech") }

                if !notice.isEmpty {
                    Section { Text(notice).font(.footnote) }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Done") { dismiss() } }
            }
            .onAppear { apiKey = store.loadAPIKey() ?? "" }
        }
    }

    private func saveKey() {
        do {
            try store.saveAPIKey(apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
            notice = "API key saved."
        } catch {
            notice = error.localizedDescription
        }
    }

    private func deleteKey() {
        do {
            try KeychainStore.delete(service: "com.arena.assistant", account: store.endpoint)
            apiKey = ""
            notice = "Saved key deleted."
        } catch {
            notice = error.localizedDescription
        }
    }
}
