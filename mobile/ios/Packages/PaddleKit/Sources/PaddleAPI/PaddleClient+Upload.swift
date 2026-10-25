import Foundation

extension PaddleClient {
    /// Adds a paddle from a GPS file: `POST /paddles/api/analyse`, multipart
    /// with one part, `file` (mobile/contract/README.md). The file name's
    /// extension picks the server's parser. If the server turns the ID token
    /// down, it gets a fresh one and sends the file once more.
    public func upload(fileName: String, data: Data) async throws -> Analysed {
        guard let token = try await idToken(false) else { throw PaddleAPIError.signedOut }
        let boundary = "paddlesnitch-\(UUID().uuidString)"
        let body = Self.multipart(fileName: fileName, data: data, boundary: boundary)
        var (answer, response) = try await transport.send(uploadRequest(body: body, boundary: boundary, token: token))
        if response.statusCode == 401, let fresh = try await idToken(true), fresh != token {
            (answer, response) = try await transport.send(uploadRequest(body: body, boundary: boundary, token: fresh))
        }
        switch response.statusCode {
        case 401: throw PaddleAPIError.signedOut
        case 413: throw PaddleAPIError.tooLarge
        default: return try decodeREST(Analysed.self, from: answer, status: response.statusCode)
        }
    }

    private func uploadRequest(body: Data, boundary: String, token: String) -> URLRequest {
        let endpoint = Endpoints.analyse
        var request = URLRequest(url: baseURL.appending(path: String(endpoint.path.drop { $0 == "/" })))
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(app, forHTTPHeaderField: "x-paddlesnitch-app")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = body
        return request
    }

    static func multipart(fileName: String, data: Data, boundary: String) -> Data {
        // A quote or line break would end the header early.
        // Per scalar: Swift counts "\r\n" as one Character.
        let name = String(
            String.UnicodeScalarView(fileName.unicodeScalars.map { "\"\r\n".unicodeScalars.contains($0) ? "_" : $0 }))
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n".utf8))
        body.append(Data("Content-Type: application/octet-stream\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }
}
