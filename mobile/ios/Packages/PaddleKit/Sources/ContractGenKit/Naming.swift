/// Turns contract names into Swift names.
enum Naming {
    /// `no_gps` → `noGps`, `paddles.get` → `paddlesGet`, `K1` → `k1`.
    static func lowerCamel(_ name: String) -> String {
        let words = words(name)
        guard let first = words.first else { return name }
        let head = first == first.uppercased() ? first.lowercased() : first.prefix(1).lowercased() + first.dropFirst()
        return escaped(head + words.dropFirst().map(capitalized).joined())
    }

    /// `no_gps` → `NoGps`, `surface-2` → `Surface2`.
    static func upperCamel(_ name: String) -> String {
        words(name).map(capitalized).joined()
    }

    /// Swift keywords used as a property or case name need backticks.
    static func escaped(_ name: String) -> String {
        keywords.contains(name) ? "`\(name)`" : name
    }

    static func isIdentifier(_ name: String) -> Bool {
        guard let first = name.first, first.isLetter || first == "_" else { return false }
        return name.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
    }

    private static func words(_ name: String) -> [String] {
        name.split(whereSeparator: { "_-. ".contains($0) }).map(String.init)
    }

    private static func capitalized(_ word: String) -> String {
        word.prefix(1).uppercased() + word.dropFirst()
    }

    private static let keywords: Set<String> = [
        "associatedtype", "case", "class", "default", "defer", "deinit", "do", "else", "enum", "extension",
        "fallthrough", "false", "for", "func", "guard", "if", "import", "in", "init", "inout", "internal", "is",
        "let", "nil", "operator", "private", "protocol", "public", "repeat", "return", "self", "static", "struct",
        "subscript", "super", "switch", "throw", "throws", "true", "try", "var", "where", "while",
    ]
}
