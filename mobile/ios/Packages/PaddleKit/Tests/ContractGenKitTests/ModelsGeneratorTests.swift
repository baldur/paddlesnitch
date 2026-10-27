import Foundation
import Testing

@testable import ContractGenKit

@Suite struct ModelsGeneratorTests {
    @Test func aPathParameterReadsAsByIt() {
        #expect(
            ModelsGenerator.endpointName(
                method: "GET", path: "/api/account/devices/sessions/{sessionId}", pathIsShared: false)
                == "getAccountDevicesSessionsBySessionId")
        #expect(
            ModelsGenerator.endpointName(method: "GET", path: "/api/account/devices/sessions", pathIsShared: false)
                == "getAccountDevicesSessions")
    }

    let noProcedures = Data("{}".utf8)

    func generate(_ schemas: [String: String], procedures: String = "{}") throws -> [String: String] {
        try ModelsGenerator.generate(
            schemas: schemas.mapValues { Data($0.utf8) }, procedures: Data(procedures.utf8))
    }

    @Test func committedModelsMatchTheContract() throws {
        let api = mobileDir.appending(path: "contract/api")
        var schemas: [String: Data] = [:]
        for file in try FileManager.default.contentsOfDirectory(atPath: api.path) where file.hasSuffix(".schema.json") {
            schemas[file] = try Data(contentsOf: api.appending(path: file))
        }
        let expected = try ModelsGenerator.generate(
            schemas: schemas, procedures: try Data(contentsOf: api.appending(path: "procedures.json")),
            rest: try? Data(contentsOf: api.appending(path: "rest.json")),
            constants: try? Data(contentsOf: api.appending(path: "constants.json")))

        let generated = mobileDir.appending(path: "ios/Packages/PaddleKit/Sources/PaddleAPI/Generated")
        let committed = try FileManager.default.contentsOfDirectory(atPath: generated.path).filter {
            $0.hasSuffix(".swift")
        }
        #expect(Set(committed) == Set(expected.keys), "Generated/ is out of date: run `make generate` in mobile/ios")
        for (file, text) in expected {
            let onDisk = try? String(contentsOf: generated.appending(path: file), encoding: .utf8)
            #expect(onDisk == text, "\(file) is out of date: run `make generate` in mobile/ios")
        }
    }

    @Test func requiredFieldsAreRequiredAndTheRestOptional() throws {
        let swift = try #require(
            try generate([
                "Card.schema.json": """
                {"type":"object","properties":{"id":{"type":"string"},"sr":{"type":["number","null"]},
                 "note":{"type":"string"},"at":{"type":"string","format":"date-time"},"n":{"type":"integer"}},
                 "required":["id","sr","at","n"]}
                """
            ])["Card.swift"])
        #expect(swift.contains("public var id: String\n"))
        #expect(swift.contains("public var sr: Double?\n"))
        #expect(swift.contains("public var note: String?\n"))
        #expect(swift.contains("public var at: Date\n"))
        #expect(swift.contains("public var n: Int\n"))
        #expect(swift.contains("note: String? = nil"))
    }

    @Test func stringEnumsGetAnUnknownCaseAndReadableNames() throws {
        let swift = try #require(
            try generate(["BoatClass.schema.json": #"{"type":"string","enum":["K1","1X","4X+"]}"#])["BoatClass.swift"])
        #expect(swift.contains("case k1\n"))
        #expect(swift.contains("case single\n"))
        #expect(swift.contains("case coxedQuad\n"))
        #expect(swift.contains("case unknown(String)\n"))
        #expect(swift.contains(#"case "4X+": self = .coxedQuad"#))
    }

    @Test func anEnumWithItsOwnUnknownValueNamesTheCatchAllUnrecognised() throws {
        let swift = try #require(
            try generate(["State.schema.json": #"{"type":"string","enum":["up_to_date","unknown"]}"#])["State.swift"])
        #expect(swift.contains("case unknown\n"))
        #expect(swift.contains("case unrecognised(String)\n"))
        #expect(!swift.contains("case unknown(String)"))
        #expect(swift.contains(#"case "unknown": self = .unknown"#))
        #expect(swift.contains("default: self = .unrecognised(rawValue)"))
    }

    @Test func anInlineTypeEnumBecomesANestedKind() throws {
        let swift = try #require(
            try generate([
                "Source.schema.json":
                    #"{"type":"object","properties":{"type":{"type":"string","enum":["file"]}},"required":["type"]}"#
            ])["Source.swift"])
        #expect(swift.contains("public var type: Kind\n"))
        #expect(swift.contains("public enum Kind: Codable"))
    }

    @Test func kindUnionsBecomeEnumsWithAssociatedValues() throws {
        let swift = try #require(
            try generate([
                "Reason.schema.json": """
                {"oneOf":[{"type":"object","properties":{"kind":{"const":"no_gps"},"s":{"type":"number"}},
                 "required":["kind","s"]}]}
                """
            ])["Reason.swift"])
        #expect(swift.contains("case noGps(NoGps)\n"))
        #expect(swift.contains("case unknown(kind: String)\n"))
        #expect(swift.contains("public struct NoGps: Codable"))
        #expect(!swift.contains("public var kind: String\n"), "the variant structs drop kind")
    }

    @Test func aRouteOfLatLngTuplesIsAnArrayOfCoordinates() throws {
        let swift = try #require(
            try generate([
                "Card.schema.json": """
                {"type":"object","properties":{"route":{"type":"array","items":{"type":"array",
                 "items":[{"type":"number"},{"type":"number"}]}}},"required":["route"]}
                """
            ])["Card.swift"])
        #expect(swift.contains("public var route: [Coordinate]\n"))
    }

    @Test func arrayElementTypesAreSingular() throws {
        let swift = try #require(
            try generate([
                "Log.schema.json": """
                {"type":"object","properties":{
                 "weeks":{"type":"array","items":{"type":"object","properties":{"km":{"type":"number"}},"required":["km"]}},
                 "sameOuting":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}}},
                 "required":["weeks"]}
                """
            ])["Log.swift"])
        #expect(swift.contains("public var weeks: [Week]\n"))
        #expect(swift.contains("public struct Week: Codable"))
        #expect(swift.contains("public var sameOuting: [SameOutingItem]?\n"))
    }

    static func object(field: String) -> String {
        #"{"type":"object","properties":{"\#(field)":{"type":"string"}},"required":["\#(field)"]}"#
    }

    @Test func restRoutesBecomeTypedEndpoints() throws {
        let swift = try #require(
            try ModelsGenerator.generate(
                schemas: [
                    "Login.schema.json": Data(Self.object(field: "email").utf8),
                    "SignIn.schema.json": Data(Self.object(field: "id").utf8),
                ],
                procedures: noProcedures,
                rest: Data(
                    #"{"POST /att/api/auth/otp-verify":{"input":"Login","output":"SignIn","errors":[400,500]}}"#.utf8)
            )["Endpoints.swift"])
        #expect(swift.contains("public static let authOtpVerify = Endpoint<Login, SignIn>("))
        #expect(
            swift.contains(
                #"method: "POST", path: "/att/api/auth/otp-verify", auth: .public, errorStatuses: [400, 500])"#))
    }

    /// `"auth": "user"` routes send the Bearer token; no `auth` is public.
    @Test func aRoutesAuthIsCarried() throws {
        let swift = try #require(
            try ModelsGenerator.generate(
                schemas: ["Ok.schema.json": Data(Self.object(field: "ok").utf8)],
                procedures: noProcedures,
                rest: Data(
                    #"{"POST /api/account/export":{"auth":"user","input":null,"output":"Ok","errors":[401]}}"#.utf8)
            )["Endpoints.swift"])
        #expect(swift.contains(#"path: "/api/account/export", auth: .user, errorStatuses: [401])"#))
    }

    /// One path, several methods (GET, POST, DELETE /api/account/contact):
    /// each needs its own name. A lone POST keeps the plain name.
    @Test func routesSharingAPathAreNamedByMethod() throws {
        let swift = try #require(
            try ModelsGenerator.generate(
                schemas: ["Ok.schema.json": Data(Self.object(field: "ok").utf8)],
                procedures: noProcedures,
                rest: Data(
                    #"""
                    {"GET /api/account/contact":{"input":null,"output":"Ok","errors":[401]},
                     "POST /api/account/contact":{"input":null,"output":"Ok","errors":[401]},
                     "DELETE /api/account":{"input":null,"output":"Ok","errors":[401]},
                     "POST /api/account/export":{"input":null,"output":"Ok","errors":[401]}}
                    """#.utf8)
            )["Endpoints.swift"])
        for name in ["getAccountContact", "postAccountContact", "deleteAccount", "accountExport"] {
            #expect(swift.contains("public static let \(name) = Endpoint<"), "\(name)")
        }
    }

    @Test func constantsBecomeStaticStrings() throws {
        let swift = try #require(
            try ModelsGenerator.generate(
                schemas: [:], procedures: noProcedures, constants: Data(#"{"tosVersion":"002"}"#.utf8)
            )["Constants.swift"])
        #expect(swift.contains(#"public static let tosVersion = "002""#))
    }

    /// A table of words (stravaConnectResults): result → what to say.
    @Test func aTableOfStringsBecomesADictionarySortedByKey() throws {
        let swift = try #require(
            try ModelsGenerator.generate(
                schemas: [:], procedures: noProcedures,
                constants: Data(#"{"results":{"denied":"You cancelled.","connected":"Say \"hi\"."}}"#.utf8)
            )["Constants.swift"])
        #expect(
            swift.contains(
                #"public static let results: [String: String] = ["connected": "Say \"hi\".", "denied": "You cancelled."]"#
            ))
    }

    @Test func aTableWithANonStringIsRefused() {
        #expect(throws: ModelsGenerator.Failure.self) {
            try ModelsGenerator.generate(
                schemas: [:], procedures: noProcedures, constants: Data(#"{"t":{"a":1}}"#.utf8))
        }
    }

    @Test func aConstantThatIsntAStringIsRefused() {
        #expect(throws: ModelsGenerator.Failure.self) {
            try ModelsGenerator.generate(schemas: [:], procedures: noProcedures, constants: Data(#"{"n":2}"#.utf8))
        }
    }

    @Test func aRouteNamingAMissingTypeIsRefused() {
        #expect(throws: ModelsGenerator.Failure.unknownType("Ghost")) {
            try ModelsGenerator.generate(
                schemas: [:], procedures: noProcedures,
                rest: Data(#"{"POST /api/x":{"input":null,"output":"Ghost","errors":[]}}"#.utf8))
        }
    }

    @Test func aUnionWithoutKindIsRefused() {
        #expect(throws: ModelsGenerator.Failure.self) {
            try generate(["Bad.schema.json": #"{"oneOf":[{"type":"object","properties":{"x":{"type":"string"}}}]}"#])
        }
    }

    @Test func anyOfOtherThanNullableIsRefused() {
        #expect(throws: ModelsGenerator.Failure.self) {
            try generate([
                "Bad.schema.json":
                    #"{"type":"object","properties":{"x":{"anyOf":[{"type":"string"},{"type":"number"}]}}}"#
            ])
        }
    }

    @Test func aProcedureNamingAMissingTypeIsRefused() {
        #expect(throws: ModelsGenerator.Failure.unknownType("Ghost")) {
            try generate(
                [:], procedures: #"{"ghost.get":{"kind":"query","auth":"user","input":null,"output":"Ghost"}}"#)
        }
    }

    @Test func proceduresBecomeTypedConstants() throws {
        let swift = try #require(
            try generate(
                ["ById.schema.json": #"{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}"#],
                procedures: #"{"paddles.get":{"kind":"query","auth":"user","input":"ById","output":"ById"}}"#
            )["Procedures.swift"])
        #expect(swift.contains("public static let paddlesGet = Procedure<ById, ById>("))
        #expect(swift.contains(#"path: "paddles.get", kind: .query, auth: .user)"#))
    }
}
