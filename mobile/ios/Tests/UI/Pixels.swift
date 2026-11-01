import XCTest

/// An image's pixels, read in points.
struct Pixels {
    struct RGB: CustomStringConvertible {
        let r: Int, g: Int, b: Int
        func near(_ other: RGB) -> Bool { abs(r - other.r) + abs(g - other.g) + abs(b - other.b) < 60 }
        var description: String { "(\(r), \(g), \(b))" }
    }

    let data: [UInt8]
    let width: Int
    let scale: CGFloat

    init?(_ image: UIImage) {
        guard let cg = image.cgImage else { return nil }
        width = cg.width
        scale = CGFloat(cg.width) / image.size.width
        var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                    bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
            return true
        }
        guard drawn else { return nil }
        data = bytes
    }

    func at(x: CGFloat, y: CGFloat) -> RGB {
        let i = (Int(y * scale) * width + Int(x * scale)) * 4
        return RGB(r: Int(data[i]), g: Int(data[i + 1]), b: Int(data[i + 2]))
    }
}
