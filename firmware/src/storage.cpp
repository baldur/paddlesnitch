#include "storage.h"
#include "board.h"
#include "board_pins.h"
#include <SD.h>
#include <FS.h>
#include <Preferences.h>

// Monotonic session counter for the no-clock fallback name. Lives in its own NVS
// namespace (NVS is a separate partition, so it survives an SD reformat) -- the
// whole point is a name that is never reused even with no GPS/RTC time.
static uint32_t nextFallbackSeq()
{
    Preferences p;
    p.begin("paddlestore", false);
    uint32_t seq = p.isKey("fseq") ? p.getULong("fseq", 0) : 0;
    seq++;
    p.putULong("fseq", seq);
    p.end();
    return seq;
}

static File     logFile;
static bool     ready = false;
static char     filename[32] = "";
static uint32_t rows = 0;

// Raw motion-capture sidecar (see docs/motion-capture-spec.md).
static File     imuFile;
static char     imuFilename[48] = "";
static uint32_t imuRows = 0;
static const char *IMU_HEADER = "ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps\n";

// Raw SD protocol probe, bypassing the filesystem entirely.
//
// Separates two very different failures that SD.begin() reports identically:
//   CMD0 -> 0x01  card is present, powered and wired correctly; the problem is
//                 the filesystem (exFAT is NOT supported -- reformat as FAT32)
//   CMD0 -> 0xFF  nothing is responding: wrong CS pin, wrong bus pins, no power
//                 on the card's rail, or the card is not seated
static uint8_t sdCmd(uint8_t cmd, uint32_t arg, uint8_t crc)
{
    sdSPI.transfer(0x40 | cmd);
    sdSPI.transfer(arg >> 24);
    sdSPI.transfer(arg >> 16);
    sdSPI.transfer(arg >> 8);
    sdSPI.transfer(arg);
    sdSPI.transfer(crc);
    for (int i = 0; i < 16; i++) {
        uint8_t r = sdSPI.transfer(0xFF);
        if (!(r & 0x80)) return r;
    }
    return 0xFF;
}

void sdRawProbe()
{
    pinMode(SDCARD_CS, OUTPUT);
    sdSPI.beginTransaction(SPISettings(400000, MSBFIRST, SPI_MODE0));

    digitalWrite(SDCARD_CS, HIGH);
    for (int i = 0; i < 10; i++) sdSPI.transfer(0xFF);   // >=74 clocks to wake

    digitalWrite(SDCARD_CS, LOW);
    uint8_t r0 = sdCmd(0, 0, 0x95);                      // GO_IDLE_STATE
    uint8_t r8 = sdCmd(8, 0x1AA, 0x87);                  // SEND_IF_COND (v2)
    digitalWrite(SDCARD_CS, HIGH);

    sdSPI.endTransaction();

    Serial.printf("SD raw probe: CMD0=0x%02X CMD8=0x%02X -> %s\n", r0, r8,
                  (r0 == 0x01) ? "card responding; suspect filesystem (exFAT?)"
                               : "no response; suspect wiring/CS/power");
}

static const char *CSV_HEADER =
    // `timestamp`, `lat` and `lon` are the columns paddlesnitch's generic CSV
    // parser looks for (packages/timing/src/csv.ts). Keeping those exact names
    // means the server needs no device-specific parser at all. Everything after
    // tx_seq is ours and is ignored by that parser.
    "timestamp,ms,utc_date,utc_time,fix,lat,lon,alt_m,speed_kmh,course_deg,"
    "sats,hdop,batt_mv,tx_seq,"
    "ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,"
    "accel_mag_max_g,gyro_mag_max_dps,imu_temp_c,imu_samples\n";

bool storageInit()
{
    // BLDO1 powers the card; initPMU() has already enabled it. The bus is
    // shared with the IMU, so it is brought up once in boardInit().
    // Try progressively slower clocks. Cards vary a lot in what they tolerate
    // on a bus shared with another device, and a card that fails at 4 MHz will
    // often mount happily at 1 MHz.
    const uint32_t freqs[] = {4000000, 1000000, 400000};
    bool mounted = false;
    for (uint32_t f : freqs) {
        if (SD.begin(SDCARD_CS, sdSPI, f)) { 
            Serial.printf("SD: mounted at %lu Hz\n", (unsigned long)f);
            mounted = true;
            break;
        }
        Serial.printf("SD: begin failed at %lu Hz\n", (unsigned long)f);
        SD.end();
        delay(50);
    }
    if (!mounted) { sdRawProbe(); return false; }

    uint8_t type = SD.cardType();
    if (type == CARD_NONE) {
        Serial.println("SD: mounted but cardType()==CARD_NONE");
        return false;
    }
    Serial.printf("SD: type=%d size=%lluMB\n", type, SD.cardSize() / (1024ULL * 1024ULL));

    ready = true;
    return true;
}

bool storageStartSession(const char *stamp)
{
    if (!ready || logFile) return false;

    // Build a base name shared by the track file and its raw-IMU sidecar.
    char base[32];
    if (stamp && stamp[0]) {
        // Timestamped name (GPS time at record-start). Globally unique in normal
        // use, so the server never sees a reused filename.
        snprintf(base, sizeof(base), "track_%s", stamp);
        snprintf(filename, sizeof(filename), "/%s.csv", base);
        // Two sessions started in the same second is vanishingly unlikely, but
        // disambiguate rather than clobber if it ever happens.
        for (int i = 1; i < 100 && SD.exists(filename); i++) {
            snprintf(base, sizeof(base), "track_%s_%d", stamp, i);
            snprintf(filename, sizeof(filename), "/%s.csv", base);
        }
    } else {
        // No wall-clock time: fall back to an NVS counter that never repeats.
        snprintf(base, sizeof(base), "track_n%06lu", (unsigned long)nextFallbackSeq());
        snprintf(filename, sizeof(filename), "/%s.csv", base);
    }
    logFile = SD.open(filename, FILE_WRITE);
    if (!logFile) {
        Serial.printf("SD: could not create %s\n", filename);
        return false;
    }
    logFile.print(CSV_HEADER);
    logFile.flush();
    rows = 0;

    // Raw motion-capture sidecar. Best-effort: if it cannot be created, the
    // session still records the track -- only the offline IMU data is lost.
    snprintf(imuFilename, sizeof(imuFilename), "/%s_imu.csv", base);
    imuFile = SD.open(imuFilename, FILE_WRITE);
    imuRows = 0;
    if (imuFile) { imuFile.print(IMU_HEADER); imuFile.flush(); }
    else         { Serial.printf("SD: could not create %s\n", imuFilename); }

    Serial.printf("SD: recording to %s%s%s\n", filename,
                  imuFile ? " + " : "", imuFile ? imuFilename : "");
    return true;
}

void storageStopSession()
{
    if (!logFile) return;
    logFile.close();
    if (imuFile) {
        imuFile.flush();
        imuFile.close();
        Serial.printf("SD: stopped %s (%lu rows) + %s (%lu rows)\n",
                      filename, (unsigned long)rows, imuFilename, (unsigned long)imuRows);
    } else {
        Serial.printf("SD: stopped %s (%lu rows)\n", filename, (unsigned long)rows);
    }
    filename[0] = 0;
    imuFilename[0] = 0;
}

bool storageRecording() { return (bool)logFile; }

bool        storageReady()    { return ready; }
const char *storageFilename() { return filename; }
uint32_t    storageRowCount() { return rows; }

void storageLogRow(const char *csvLine)
{
    if (!ready || !logFile) return;
    logFile.print(csvLine);
    logFile.flush();        // deliberate: see header comment
    rows++;
}

void storageLogImuRow(const char *csvLine)
{
    if (!ready || !imuFile) return;
    imuFile.print(csvLine);
    // Buffered: flush ~once a second (every 50 rows) rather than per row. This
    // is analysis data, not the authoritative track, so a <1 s loss on an abrupt
    // power-off is fine, and 50 flushes/second would be needless wear + power.
    if (++imuRows % 50 == 0) imuFile.flush();
}

void storageClose()
{
    storageStopSession();
    ready = false;
}

void storageList()
{
    Serial.println("<<<LS>>>");
    if (ready) {
        File root = SD.open("/");
        for (File f = root.openNextFile(); f; f = root.openNextFile()) {
            if (!f.isDirectory()) Serial.printf("%s\t%lu\n", f.name(), (unsigned long)f.size());
            f.close();
        }
        root.close();
    }
    Serial.println("<<<END>>>");
}

void storageCat(const char *name)
{
    // Blocking on purpose: the loop is single-threaded, so nothing else can
    // interleave status lines into the middle of the dump.
    char path[64];
    snprintf(path, sizeof(path), "%s%s", name[0] == '/' ? "" : "/", name);

    File f = ready ? SD.open(path, FILE_READ) : File();
    if (!f) {
        Serial.printf("<<<ERR>>> cannot open %s\n", path);
        return;
    }
    Serial.printf("<<<CAT %s %lu>>>\n", path, (unsigned long)f.size());
    uint8_t buf[512];
    while (f.available()) {
        size_t n = f.read(buf, sizeof(buf));
        Serial.write(buf, n);
    }
    f.close();
    Serial.println("\n<<<END>>>");
}
