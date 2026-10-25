import Foundation
import PaddleAPI

/// Getting a GPS file under the server's request limit, as the website does
/// (apps/web/src/lib/trace-upload.ts). A request can be at most ~4.6 MB
/// (AWS's limit for a Lambda request, before our code runs). Text traces
/// shrink about ten times gzipped, so a big one is gzipped on the phone and
/// sent as `<name>.gz`, which the server unpacks.
public enum UploadFile {
    /// What one upload may weigh, with room for the form around the file.
    public static let maxBytes = 4_400_000
    /// Smaller files go as they are.
    static let compressFrom = 1_000_000
    /// FIT and zip are already compact; gzip gains little on them.
    static let compressible: Set<String> = ["gpx", "tcx", "csv"]

    /// The website's words (TOO_BIG_MESSAGE), for a file stopped here or
    /// refused by the server (413).
    public static let tooBigMessage =
        "That file is too big to upload. Export the activity as FIT, which is much smaller, or as a Garmin .zip."

    /// The file to send: gzipped when that helps. Throws
    /// `PaddleAPIError.tooLarge` when it still can't fit.
    public static func prepare(name: String, data: Data) throws -> (name: String, data: Data) {
        var file = (name: name, data: data)
        let ext = (name as NSString).pathExtension.lowercased()
        if compressible.contains(ext), data.count >= compressFrom {
            file = (name + ".gz", try gzip(data))
        }
        if file.data.count > maxBytes { throw PaddleAPIError.tooLarge }
        return file
    }

    /// RFC 1952: a 10-byte header, raw DEFLATE (what Foundation's `.zlib`
    /// writes), then the CRC-32 and length of the original, little-endian.
    static func gzip(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF])
        out.append(deflated)
        for value in [crc32(data), UInt32(truncatingIfNeeded: data.count)] {
            withUnsafeBytes(of: value.littleEndian) { out.append(contentsOf: $0) }
        }
        return out
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFF_FFFF
    }

    private static let crcTable: [UInt32] = (0..<256).map { index in
        (0..<8).reduce(UInt32(index)) { crc, _ in crc & 1 == 1 ? 0xEDB8_8320 ^ (crc >> 1) : crc >> 1 }
    }
}
