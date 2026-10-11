#include "ota_verify.h"
#include "ota_sign.h"
#include "fw_signing_key.h"

#include <string.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>

bool otaSignatureValid(const char *pubkeyPem, const char *version,
                       const char *sha256hex, const char *signatureB64)
{
    if (!pubkeyPem || !signatureB64 || !*signatureB64) return false;

    char msg[160];
    size_t msgLen = otaSignedMessage(version, sha256hex, msg, sizeof(msg));
    if (!msgLen) return false;

    // A DER P-256 signature is at most 72 bytes.
    unsigned char sig[80];
    size_t sigLen = 0;
    if (mbedtls_base64_decode(sig, sizeof(sig), &sigLen,
                              (const unsigned char *)signatureB64, strlen(signatureB64)) != 0) return false;

    unsigned char hash[32];
    mbedtls_sha256((const unsigned char *)msg, msgLen, hash, 0);

    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);
    // The PEM parser needs the terminating NUL counted in the length.
    bool ok = mbedtls_pk_parse_public_key(&pk, (const unsigned char *)pubkeyPem, strlen(pubkeyPem) + 1) == 0
           && mbedtls_pk_can_do(&pk, MBEDTLS_PK_ECDSA)
           && mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, sigLen) == 0;
    mbedtls_pk_free(&pk);
    return ok;
}

bool otaSignatureSelfTest()
{
    // Signed with the production key over version 0.0.0-selftest and the sha256
    // of the empty string. Not an image -- nothing will ever be installed by it.
    static const char *V   = "0.0.0-selftest";
    static const char *SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    static const char *SIG = "MEQCIDb85+LjRRUtYebi0+B09CPOBHwbLPe6SL8DxQM2OpGIAiA7ktVXuWBplr5LSQS7Gcu5pyiziw5rkfNip6eWsQPkWQ==";
    static const char *OTHER_SHA = "f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const bool good       = otaSignatureValid(FW_SIGNING_PUBKEY, V, SHA, SIG);
    const bool otherImage = otaSignatureValid(FW_SIGNING_PUBKEY, V, OTHER_SHA, SIG);
    const bool otherVer   = otaSignatureValid(FW_SIGNING_PUBKEY, "0.0.1-selftest", SHA, SIG);
    const bool unsigned_  = otaSignatureValid(FW_SIGNING_PUBKEY, V, SHA, "");
    return good && !otherImage && !otherVer && !unsigned_;
}
