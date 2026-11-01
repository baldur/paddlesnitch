import Foundation
import Testing

@testable import Account

@Suite struct PkceTests {
    /// RFC 7636, appendix B.
    @Test func theChallengeIsTheRFCsS256() {
        #expect(
            Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func aVerifierIs32RandomBytesInBase64URL() {
        let verifier = Pkce.verifier()
        #expect(verifier.count == 43)
        #expect(verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(Pkce.verifier() != verifier)
        #expect(Pkce.challenge(verifier).count == 43)
    }
}
