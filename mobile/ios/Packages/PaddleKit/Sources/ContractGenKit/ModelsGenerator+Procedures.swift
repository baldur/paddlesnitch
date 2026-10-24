import Foundation

extension ModelsGenerator {
    struct ProcedureEntry {
        var path: String
        var swiftName: String
        var input: String
        var output: String
        var kind: String
        var auth: String
    }

    /// `Procedures.swift`: a typed constant per procedure, plus the decoder
    /// the contract tests use.
    static func proceduresFile(_ data: Data, known: Set<String>) throws -> String {
        let entries = try procedureEntries(data, known: known)
        var out = header + "/// Every procedure the apps call, from mobile/contract/api/procedures.json.\n"
        out += "public enum Procedures {\n"
        for entry in entries {
            out += "    public static let \(entry.swiftName) = Procedure<\(entry.input), \(entry.output)>(\n"
            out += "        path: \(literal(entry.path)), kind: .\(entry.kind), auth: .\(entry.auth))\n"
        }
        out += "\n    /// Decodes `data` as the output of the procedure at `path`. For the contract tests.\n"
        out += "    public static func decodeOutput(of path: String, from data: Data, using decoder: JSONDecoder)\n"
        out += "        throws -> any Sendable\n    {\n        switch path {\n"
        for entry in entries {
            out += "        case \(literal(entry.path)): try decoder.decode(\(entry.output).self, from: data)\n"
        }
        out += "        default: throw ProcedureError.unknownPath(path)\n        }\n    }\n}\n"
        return out
    }

    private static func procedureEntries(_ data: Data, known: Set<String>) throws -> [ProcedureEntry] {
        let procedures = try JSONDecoder().decode([String: JSON].self, from: data).sorted(by: { $0.key < $1.key })
        // A keyword needs no backticks after a dot (`.public`).
        let member = { (name: String) in Naming.lowerCamel(name).trimmingCharacters(in: ["`"]) }
        return try procedures.map { path, procedure in
            let input = procedure["input"]?.string
            guard let output = procedure["output"]?.string, let kind = procedure["kind"]?.string,
                let auth = procedure["auth"]?.string
            else { throw Failure.unsupported(type: "procedures.json", reason: "\(path) is missing a field") }
            for name in [input, output].compactMap({ $0 }) where !known.contains(name) {
                throw Failure.unknownType(name)
            }
            return ProcedureEntry(
                path: path, swiftName: Naming.lowerCamel(path), input: input ?? "NoInput", output: output,
                kind: member(kind), auth: member(auth))
        }
    }
}
