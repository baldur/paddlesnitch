#pragma once
#include <Arduino.h>

// The tracker's own key: how it proves it is itself when it is added to an
// account (the server checks the signature; see include/claim_proof.h and
// "Proof of possession" in packages/core/src/devices.ts).
//
// An ECDSA P-256 key, made on the tracker the first time it is needed and kept
// in its own NVS namespace ("ident"), which a factory reset does NOT clear --
// otherwise every reset would need a cable to enrol the new key. Only a full
// flash erase loses it; then tools/enroll.sh enrols the new one.
//
// Safe from either core once identityInit() has run (early in setup()): a
// mutex guards the NVS read and key generation.
void identityInit();

// Base64 of the public key (SPKI DER), making the key if there is none. "" on failure.
String identityPublicKey();

// Base64 DER ECDSA signature over `msg` (sha256). "" on failure.
String identitySign(const char *msg, size_t len);

// Has this key been registered with the server over the device token?
// (POST /api/devices/identity). Set once, never cleared by a factory reset.
bool identityRegistered();
void identitySetRegistered();
