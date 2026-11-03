import Foundation

extension ModelsGenerator {
    /// A list answer (paddles.sameOuting) becomes a typealias. Its items must
    /// be a named schema, so the element has a type of its own.
    static func listAlias(name: String, schema: JSON, owner: String) throws -> String {
        guard let ref = schema["items"]?["$ref"]?.string, ref.hasSuffix(".schema.json") else {
            throw Failure.unsupported(type: owner, reason: "\(name): a top-level array's items must be a $ref")
        }
        return "public typealias \(name) = [\(ref.dropLast(".schema.json".count))]\n"
    }
}
