/// Where the paddler sat in a crew boat: a seat number, or the cox. Mapped by
/// hand (mobile/contract/README.md, rule 3): the contract sends an integer or
/// `"C"`.
public enum Seat: Codable, Hashable, Sendable {
    case number(Int)
    case cox
    /// A value this version of the app doesn't know yet.
    case unknown(String)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Int.self) {
            self = .number(number)
        } else {
            let value = try container.decode(String.self)
            self = value == "C" ? .cox : .unknown(value)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .number(let number): try container.encode(number)
        case .cox: try container.encode("C")
        case .unknown(let value): try container.encode(value)
        }
    }
}
