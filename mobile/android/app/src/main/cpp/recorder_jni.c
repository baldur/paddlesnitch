/*
 * The Kotlin side's way into recorder_phone.h (Recorder.kt). Nothing here
 * converts or orders anything: each call passes the platform's values to the
 * phone layer as they are, and each line it writes goes back to Kotlin as
 * bytes. Every call comes from one thread (the recorder's HandlerThread), so
 * the JNIEnv of the current call is the one the write callback uses.
 */
#include <jni.h>
#include <stdlib.h>
#include "recorder_phone.h"

typedef struct {
    rc_phone  phone;   /* ~100 KB: malloc'd, never on the stack */
    JNIEnv   *env;
    jobject   self;
    jmethodID write;
} recorder;

static void write_line(void *user, rc_stream stream, const char *line, size_t len)
{
    recorder *r = user;
    JNIEnv *env = r->env;
    /* A line that failed in Kotlin leaves its exception pending until this
       native call returns; no more JNI calls until then. */
    if ((*env)->ExceptionCheck(env)) return;
    jbyteArray bytes = (*env)->NewByteArray(env, (jsize)len);
    if (!bytes) return;
    (*env)->SetByteArrayRegion(env, bytes, 0, (jsize)len, (const jbyte *)line);
    (*env)->CallVoidMethod(env, r->self, r->write, (jint)stream, bytes);
    (*env)->DeleteLocalRef(env, bytes);
}

static recorder *on(JNIEnv *env, jobject self, jlong handle)
{
    recorder *r = (recorder *)(intptr_t)handle;
    r->env = env;
    r->self = self;
    return r;
}

#define FN(name) Java_com_paddlesnitch_app_record_RecorderCore_##name

JNIEXPORT jlong JNICALL FN(nativeInit)(JNIEnv *env, jobject self, jint platform, jint has, jboolean motion)
{
    recorder *r = calloc(1, sizeof *r);
    if (!r) return 0;
    jclass cls = (*env)->GetObjectClass(env, self);
    r->write = (*env)->GetMethodID(env, cls, "line", "(I[B)V");
    if (!r->write) { free(r); return 0; }
    rc_phone_config cfg = { write_line, r, (rc_platform)platform, (uint32_t)has, motion ? 1 : 0 };
    on(env, self, (jlong)(intptr_t)r);
    rc_phone_init(&r->phone, &cfg);
    return (jlong)(intptr_t)r;
}

JNIEXPORT void JNICALL FN(nativeAccel)(JNIEnv *env, jobject self, jlong h, jlong t, jdouble x, jdouble y, jdouble z)
{ rc_phone_accel(&on(env, self, h)->phone, t, x, y, z); }

JNIEXPORT void JNICALL FN(nativeGyro)(JNIEnv *env, jobject self, jlong h, jlong t, jdouble x, jdouble y, jdouble z)
{ rc_phone_gyro(&on(env, self, h)->phone, t, x, y, z); }

JNIEXPORT void JNICALL FN(nativeLocation)(JNIEnv *env, jobject self, jlong h, jlong t, jlong utc, jdouble lat, jdouble lon,
                                          jboolean altValid, jdouble alt, jboolean speedValid, jdouble speed,
                                          jboolean courseValid, jdouble course)
{
    rc_phone_location l = { t, utc, lat, lon, altValid ? 1 : 0, alt, speedValid ? 1 : 0, speed, courseValid ? 1 : 0, course };
    rc_phone_location_update(&on(env, self, h)->phone, &l);
}

JNIEXPORT void JNICALL FN(nativeTick)(JNIEnv *env, jobject self, jlong h, jlong t, jint battMv)
{ rc_phone_tick(&on(env, self, h)->phone, t, (unsigned)battMv); }

JNIEXPORT void JNICALL FN(nativeFinish)(JNIEnv *env, jobject self, jlong h)
{ rc_phone_finish(&on(env, self, h)->phone); }

JNIEXPORT void JNICALL FN(nativeLive)(JNIEnv *env, jobject self, jlong h, jfloatArray out)
{
    rc_live_values v;
    rc_phone_live(&((recorder *)(intptr_t)h)->phone, &v);
    jfloat f[8] = { v.spm, v.roll_deg, v.pitch_deg, v.evenness_pct, v.speed_kmh, v.distance_m,
                    (jfloat)v.fix, v.since_fix_s };
    (*env)->SetFloatArrayRegion(env, out, 0, 8, f);
}

JNIEXPORT jlong JNICALL FN(nativeDroppedLate)(JNIEnv *env, jobject self, jlong h)
{ return (jlong)rc_phone_dropped_late(&((recorder *)(intptr_t)h)->phone); }

JNIEXPORT jlong JNICALL FN(nativeDroppedUnpaired)(JNIEnv *env, jobject self, jlong h)
{ return (jlong)rc_phone_dropped_unpaired(&((recorder *)(intptr_t)h)->phone); }

JNIEXPORT void JNICALL FN(nativeFree)(JNIEnv *env, jobject self, jlong h)
{ free((recorder *)(intptr_t)h); }
