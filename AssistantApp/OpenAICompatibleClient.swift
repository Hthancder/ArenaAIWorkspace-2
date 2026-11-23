import Foundation

struct OpenAICompatibleClient {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    private struct RequestBody: Encodable {
        let model: String
        let messages: [Message]
        let stream: Bool
    }

    private struct StreamChunk: Decodable {
        struct Choice: Decodable {
            struct Delta: Decodable { let content: String? }
            let delta: Delta?
        }
        let choices: [Choice]?
        let error: ProviderErrorBody?
    }

    private struct ProviderErrorBody: Decodable {
        let message: String?
    }

    enum ClientError: LocalizedError {
        case invalidEndpoint
        case missingAPIKey
        case httpStatus(Int, String)
        case malformedEvent
        case provider(String)
        case emptyResponse

        var errorDescription: String? {
            switch self {
            case .invalidEndpoint: return "Enter a valid HTTPS API endpoint."
            case .missingAPIKey: return "Enter an API key in Settings."
            case let .httpStatus(code, detail): return "Provider returned HTTP \(code): \(detail)"
            case .malformedEvent: return "The streaming response could not be parsed."
            case let .provider(message): return message
            case .emptyResponse: return "The provider returned no response."
            }
        }
    }

    func stream(
        endpoint: String,
        model: String,
        messages: [Message],
        onDelta: @escaping (String) -> Void
    ) async throws {
        guard let url = URL(string: endpoint), url.scheme?.lowercased() == "https", url.host != nil else {
            throw ClientError.invalidEndpoint
        }
        guard let key = KeychainStore.read(service: "com.arena.assistant", account: endpoint), !key.isEmpty else {
            throw ClientError.missingAPIKey
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(RequestBody(model: model, messages: messages, stream: true))

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.malformedEvent
        }
        guard (200..<300).contains(http.statusCode) else {
            var body = ""
            for try await line in bytes.lines {
                body += line
                if body.count > 2_000 { break }
            }
            throw ClientError.httpStatus(http.statusCode, body.isEmpty ? HTTPURLResponse.localizedString(forStatusCode: http.statusCode) : body)
        }

        var didReceiveText = false
        for try await line in bytes.lines {
            try Task.checkCancellation()
            guard line.hasPrefix("data:") else { continue }
            let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }
            guard let data = payload.data(using: .utf8) else { continue }
            let chunk: StreamChunk
            do {
                chunk = try JSONDecoder().decode(StreamChunk.self, from: data)
            } catch {
                // Ignore non-chat control events, but don't silently accept bad choice payloads.
                continue
            }
            if let message = chunk.error?.message { throw ClientError.provider(message) }
            for choice in chunk.choices ?? [] {
                if let text = choice.delta?.content, !text.isEmpty {
                    didReceiveText = true
                    onDelta(text)
                }
            }
        }
        if !didReceiveText { throw ClientError.emptyResponse }
    }
}
