#include "identity.h"
#include "dbg.h"

#include <Preferences.h>
#include <esp_random.h>
#include <mbedtls/pk.h>
#include <mbedtls/ecp.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

static const char *NS = "ident";        // NOT "paddle": a factory reset keeps this
static const char *K_KEY = "sk";        // private key, DER (mbedtls_pk_write_key_der)
static const char *K_REG = "reg";       // public key registered with the server

static SemaphoreHandle_t s_mux = nullptr;

void identityInit() { if (!s_mux) s_mux = xSemaphoreCreateMutex(); }

// The hardware RNG. Seeded by RF noise once WiFi or Bluetooth is up, and by the
// bootloader's entropy source before that -- either is fine for a key.
static int hwRng(void *, unsigned char *out, size_t len) { esp_fill_random(out, len); return 0; }

static String b64(const unsigned char *p, size_t n)
{
    size_t olen = 0;
    unsigned char out[200];
    if (mbedtls_base64_encode(out, sizeof(out) - 1, &olen, p, n) != 0) return "";
    out[olen] = 0;
    return String((const char *)out);
}

// Load the key into `pk`, making and storing one if there is none.
static bool loadKey(mbedtls_pk_context &pk)
{
    Preferences p;
    if (!p.begin(NS, false)) return false;
    unsigned char der[160];
    size_t n = p.isKey(K_KEY) ? p.getBytes(K_KEY, der, sizeof(der)) : 0;
    if (n && mbedtls_pk_parse_key(&pk, der, n, nullptr, 0) == 0) { p.end(); return true; }

    mbedtls_pk_free(&pk);
    mbedtls_pk_init(&pk);
    bool ok = mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) == 0
           && mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk), hwRng, nullptr) == 0;
    if (ok) {
        // write_key_der fills from the END of the buffer.
        int len = mbedtls_pk_write_key_der(&pk, der, sizeof(der));
        ok = len > 0 && p.putBytes(K_KEY, der + sizeof(der) - len, len) == (size_t)len;
        p.remove(K_REG);   // a new key has not been registered
        DBGI("ident", ok ? "made a new key" : "could not store the new key");
        Serial.println(ok ? "identity: made a new key" : "identity: COULD NOT STORE KEY");
    }
    p.end();
    return ok;
}

String identityPublicKey()
{
    String out;
    xSemaphoreTake(s_mux, portMAX_DELAY);
    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);
    if (loadKey(pk)) {
        unsigned char der[128];
        int len = mbedtls_pk_write_pubkey_der(&pk, der, sizeof(der));
        if (len > 0) out = b64(der + sizeof(der) - len, len);
    }
    mbedtls_pk_free(&pk);
    xSemaphoreGive(s_mux);
    return out;
}

String identitySign(const char *msg, size_t len)
{
    String out;
    unsigned char hash[32];
    mbedtls_sha256((const unsigned char *)msg, len, hash, 0);
    xSemaphoreTake(s_mux, portMAX_DELAY);
    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);
    if (loadKey(pk)) {
        unsigned char sig[MBEDTLS_PK_SIGNATURE_MAX_SIZE];
        size_t sigLen = 0;
        if (mbedtls_pk_sign(&pk, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, &sigLen, hwRng, nullptr) == 0)
            out = b64(sig, sigLen);
    }
    mbedtls_pk_free(&pk);
    xSemaphoreGive(s_mux);
    return out;
}

bool identityRegistered()
{
    Preferences p;
    if (!p.begin(NS, false)) return false;
    bool r = p.isKey(K_REG) && p.getBool(K_REG, false);
    p.end();
    return r;
}

void identitySetRegistered()
{
    Preferences p;
    if (!p.begin(NS, false)) return;
    p.putBool(K_REG, true);
    p.end();
}
