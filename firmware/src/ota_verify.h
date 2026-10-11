#pragma once

// Is `signatureB64` (base64 of a DER ECDSA P-256 signature) a valid signature by
// `pubkeyPem` over otaSignedMessage(version, sha256hex)? Any malformed input is
// simply "no". See include/ota_sign.h for the message and why it names the version.
bool otaSignatureValid(const char *pubkeyPem, const char *version,
                       const char *sha256hex, const char *signatureB64);

// Checks the verifier itself against the production key: a vector signed by the
// real key must pass and the same vector with one byte changed must fail. For the
// bench SIGTEST command -- it proves the key parses and the check can say both
// yes and no on real hardware, without publishing a release to find out.
bool otaSignatureSelfTest();
