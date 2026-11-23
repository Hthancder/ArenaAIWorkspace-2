import SwiftUI

@main
struct AssistantAppApp: App {
    @StateObject private var store = AssistantStore()

    var body: some Scene {
        WindowGroup {
            ConversationView()
                .environmentObject(store)
        }
    }
}
