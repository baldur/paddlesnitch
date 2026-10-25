import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// Getting a file under the server's request limit, as the website does
/// (apps/web/src/lib/trace-upload.ts): GPX, TCX and CSV of 1 MB or more go
/// gzipped as `<name>.gz`, which the server unpacks; anything still over
/// 4,400,000 bytes is stopped on the phone.
@Suite struct UploadFileTests {
    /// A text trace the size of a long GPX: repetitive, so it squeezes well.
    func gpx(bytes: Int) -> Data {
        let point = "<trkpt lat=\"51.45603\" lon=\"-0.96900\"><time>2026-09-01T07:30:00Z</time></trkpt>\n"
        return Data(String(repeating: point, count: bytes / point.utf8.count + 1).utf8.prefix(bytes))
    }

    @Test func aSmallFileGoesAsItIs() throws {
        let data = gpx(bytes: 999_999)
        let file = try UploadFile.prepare(name: "Morning.gpx", data: data)
        #expect(file.name == "Morning.gpx")
        #expect(file.data == data)
    }

    @Test(arguments: ["Long.gpx", "Long.TCX", "speedcoach.csv"])
    func aBigTextTraceIsGzipped(name: String) throws {
        let data = gpx(bytes: 1_000_000)
        let file = try UploadFile.prepare(name: name, data: data)
        #expect(file.name == name + ".gz")
        #expect(file.data.count < data.count / 5)
        #expect(try gunzip(file.data) == data, "standard gzip: the server unpacks it")
    }

    /// FIT and zip are already compact; the website sends them as they are.
    @Test(arguments: ["Long.fit", "Garmin.zip"])
    func aBigCompactFileGoesAsItIs(name: String) throws {
        let data = gpx(bytes: 2_000_000)
        let file = try UploadFile.prepare(name: name, data: data)
        #expect(file.name == name)
        #expect(file.data == data)
    }

    @Test func aFileStillTooBigIsStoppedBeforeSending() {
        #expect(throws: PaddleAPIError.tooLarge) {
            try UploadFile.prepare(name: "Huge.fit", data: Data(count: 4_400_001))
        }
        #expect(throws: Never.self) {
            try UploadFile.prepare(name: "Just.fit", data: Data(count: 4_400_000))
        }
    }

    @Test func aBigTraceThatSqueezesUnderTheLimitIsAllowed() throws {
        let file = try UploadFile.prepare(name: "Day.gpx", data: gpx(bytes: 20_000_000))
        #expect(file.data.count <= UploadFile.maxBytes)
    }

    @Test func theCrcIsTheStandardOne() {
        #expect(UploadFile.crc32(Data("123456789".utf8)) == 0xCBF4_3926)
    }

    /// The Mac's own gunzip: proof the output is real gzip, not just ours.
    func gunzip(_ data: Data) throws -> Data {
        let process = Process()
        process.executableURL = URL(filePath: "/usr/bin/gunzip")
        process.arguments = ["-c"]
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        let writer = Thread {
            input.fileHandleForWriting.write(data)
            try? input.fileHandleForWriting.close()
        }
        writer.start()
        let result = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        return result
    }
}
