#pragma once

// The public half of the firmware signing key. The tracker installs an update
// only if its manifest carries a signature this key verifies (src/ota_verify.cpp).
//
// The private half is NOT in this repo: it is the FIRMWARE_SIGNING_KEY secret
// in GitHub's `production` environment (used by firmware-release.yml), with an
// offline copy kept by the owner. Changing this key means every tracker in the
// field refuses updates until it is cable-flashed with the new one -- so rotate
// only if the private key is lost or leaked.
static const char FW_SIGNING_PUBKEY[] =
    "-----BEGIN PUBLIC KEY-----\n"
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm0+X5NW5ePmyRsxVvFW/iiQWCeUC\n"
    "16fupStc1YTF6Gj7oqeVmtb/7RefMvHLcVyE/xwuMoDSdf2SO3cCZqHNkw==\n"
    "-----END PUBLIC KEY-----\n";
