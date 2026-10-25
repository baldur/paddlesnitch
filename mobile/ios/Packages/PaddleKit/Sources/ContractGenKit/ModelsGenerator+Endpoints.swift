import Foundation

extension ModelsGenerator {
    struct EndpointEntry {
        var method: String
        var path: String
        var swiftName: String
        var input: String
        var output: String
        var auth: String
        var errors: [Int]
    }

    /// `Endpoints.swift` from rest.json: a typed constant per REST route, plus
    /// the decoder the contract tests use.
    static func endpointsFile(_ data: Data, known: Set<String>) throws -> String {
        let entries = try endpointEntries(data, known: known)
        var out = header + "/// Every REST route the apps call, from mobile/contract/api/rest.json.\n"
        out += "public enum Endpoints {\n"
        for entry in entries {
            let errors = entry.errors.map(String.init).joined(separator: ", ")
            out += "    public static let \(entry.swiftName) = Endpoint<\(entry.input), \(entry.output)>(\n"
            let path = literal(entry.path)
            out += "        method: \(literal(entry.method)), path: \(path), auth: .\(entry.auth),"
            out += " errorStatuses: [\(errors)])\n"
        }
        out += "\n    /// Decodes `data` as the answer of the route `\"POST /path\"`. For the contract tests.\n"
        out += "    public static func decodeOutput(of route: String, from data: Data, using decoder: JSONDecoder)\n"
        out += "        throws -> any Sendable\n    {\n        switch route {\n"
        for entry in entries {
            let route = literal("\(entry.method) \(entry.path)")
            out += "        case \(route): try decoder.decode(\(entry.output).self, from: data)\n"
        }
        out += "        default: throw ProcedureError.unknownPath(route)\n        }\n    }\n}\n"
        return out
    }

    /// `Constants.swift` from constants.json: values the server decides, like
    /// the Terms version sign-up must agree to. Strings only, for now.
    static func constantsFile(_ data: Data) throws -> String {
        let constants = try JSONDecoder().decode([String: JSON].self, from: data).sorted(by: { $0.key < $1.key })
        var out = header + "/// Values the server decides, from mobile/contract/api/constants.json.\n"
        out += "public enum Constants {\n"
        for (key, value) in constants {
            guard Naming.isIdentifier(key), let text = value.string else {
                throw Failure.unsupported(
                    type: "constants.json", reason: "\(key) must be a string with an identifier name")
            }
            out += "    public static let \(Naming.escaped(key)) = \(literal(text))\n"
        }
        return out + "}\n"
    }

    /// `POST /att/api/auth/otp-verify` → `authOtpVerify`: the path after
    /// `/api/`, so `att` (where the route happens to live) doesn't show.
    static func endpointName(_ path: String) -> String {
        let afterAPI = path.components(separatedBy: "/api/").last ?? path
        return Naming.lowerCamel(afterAPI.replacingOccurrences(of: "/", with: "-"))
    }

    /// `endpointName`, with the method in front (`getAccountContact`) when
    /// it isn't a POST or another method shares the path; a lone POST keeps
    /// the plain name, as every route had before.
    static func endpointName(method: String, path: String, pathIsShared: Bool) -> String {
        let name = endpointName(path)
        guard method != "POST" || pathIsShared else { return name }
        return method.lowercased() + Naming.upperCamel(name)
    }

    private static func endpointEntries(_ data: Data, known: Set<String>) throws -> [EndpointEntry] {
        let routes = try JSONDecoder().decode([String: JSON].self, from: data).sorted(by: { $0.key < $1.key })
        let paths = routes.map { $0.key.split(separator: " ", maxSplits: 1).last.map(String.init) ?? $0.key }
        return try routes.map { route, spec in
            let parts = route.split(separator: " ", maxSplits: 1).map(String.init)
            guard parts.count == 2, let output = spec["output"]?.string else {
                throw Failure.unsupported(type: "rest.json", reason: "\(route) is not \"METHOD /path\" with an output")
            }
            let input = spec["input"]?.string
            let auth = spec["auth"]?.string ?? "public"
            guard ["public", "user"].contains(auth) else {
                throw Failure.unsupported(type: "rest.json", reason: "\(route) has auth \(auth)")
            }
            for name in [input, output].compactMap({ $0 }) where !known.contains(name) {
                throw Failure.unknownType(name)
            }
            let errors = (spec["errors"]?.array ?? []).compactMap { value -> Int? in
                if case .number(let status) = value { Int(status) } else { nil }
            }
            return EndpointEntry(
                method: parts[0], path: parts[1],
                swiftName: endpointName(
                    method: parts[0], path: parts[1], pathIsShared: paths.filter { $0 == parts[1] }.count > 1),
                input: input ?? "NoInput",
                output: output, auth: auth, errors: errors)
        }
    }
}
