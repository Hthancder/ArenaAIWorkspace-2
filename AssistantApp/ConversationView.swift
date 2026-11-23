import SwiftUI
import UIKit

struct ConversationView: View {
    @EnvironmentObject private var store: AssistantStore
    @State private var showingSettings = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Circle().fill(store.isListening ? Color.red : Color.green).frame(width: 8, height: 8)
                    Text(store.status).font(.footnote).foregroundColor(.secondary)
                    Spacer()
                    if !store.messages.isEmpty {
                        Button("Clear") { store.clearConversation() }
                            .font(.footnote)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                if !store.transcript.isEmpty && store.draft == store.transcript {
                    Text("Live transcript — review before sending")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                }

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if store.messages.isEmpty {
                                ContentUnavailableViewCompat()
                                    .padding(.top, 80)
                            }
                            ForEach(store.messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: store.messages.count) { _ in
                        guard let last = store.messages.last else { return }
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                    .onChange(of: store.messages.last?.text) { _ in
                        guard let last = store.messages.last else { return }
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }

                Divider()
                HStack(alignment: .bottom, spacing: 10) {
                    Button(action: store.toggleListening) {
                        Image(systemName: store.isListening ? "stop.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 34))
                            .foregroundColor(store.isListening ? .red : .accentColor)
                    }
                    .accessibilityLabel(store.isListening ? "Stop listening" : "Start voice input")
                    .disabled(store.isSending)

                    TextField("Ask anything…", text: $store.draft)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Message")

                    if store.isSending {
                        Button(action: store.cancelResponse) {
                            Image(systemName: "stop.fill").font(.title3)
                        }
                        .accessibilityLabel("Stop response")
                    } else {
                        Button(action: store.sendDraft) {
                            Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
                        }
                        .disabled(store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("Send message")
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
            }
            .navigationTitle("Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView().environmentObject(store) }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onOpenURL { url in
            guard url.scheme == "arenaassistant", url.host == "activate" else { return }
            store.startListening()
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage
    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            Text(message.text.isEmpty && !isUser ? "…" : message.text)
                .textSelection(.enabled)
                .padding(12)
                .foregroundColor(isUser ? .white : .primary)
                .background(isUser ? Color.accentColor : Color(UIColor.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
            if !isUser { Spacer(minLength: 40) }
        }
    }
}

private struct ContentUnavailableViewCompat: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "waveform").font(.system(size: 42)).foregroundColor(.accentColor)
            Text("Talk or type to get started").font(.headline)
            Text("Your speech is transcribed before it is sent to the configured AI provider.")
                .font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
    }
}
