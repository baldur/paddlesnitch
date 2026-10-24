import Foundation

extension JSONDecoder {
    /// Decodes the contract: ISO 8601 timestamps with or without fractional
    /// seconds, with `Z` or an offset.
    public static var paddlesnitch: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = parseTimestamp(text) { return date }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "\(text) is not an ISO 8601 timestamp")
        }
        return decoder
    }
}

extension JSONEncoder {
    /// Encodes timestamps as the server writes them: UTC, milliseconds.
    public static var paddlesnitch: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.formatted(withFractions))
        }
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

private let withFractions = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
private let withoutFractions = Date.ISO8601FormatStyle()

func parseTimestamp(_ text: String) -> Date? {
    (try? withFractions.parse(text)) ?? (try? withoutFractions.parse(text))
}
