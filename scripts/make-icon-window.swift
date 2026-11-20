// Eye Rest & Move icon (sheet 17, R1): a rounded window with a cross bar, pale sky inside and a far hill line, in horizon blue.
// CoreGraphics only. Usage: swift scripts/make-icon-window.swift [--out <app folder>]
// Writes assets/images/{icon,favicon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png
// and assets/expo.icon/{icon.json,Assets/glyph.png,Assets/glyph-tinted.png}. icon.png is 1024 x 1024 without alpha.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

var out = FileManager.default.currentDirectoryPath
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--out"), i + 1 < args.count { out = args[i + 1] }

let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}
let paleBg: UInt32 = 0xEDF1F4, sky: UInt32 = 0xBFDDEE, blue: UInt32 = 0x3A7293

func canvas(_ size: Int, opaque: Bool) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)  // y down, like the SVG sketch
  return ctx
}
func save(_ image: CGImage, _ url: URL) {
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("dest") }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("write \(url.path)") }
}
func resized(_ image: CGImage, to size: Int) -> CGImage {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  return ctx.makeImage()!
}

enum Look { case colour, mono }

/// The window from the 64-unit SVG sketch, scaled so its 40 x 46 body fills `fraction` of the canvas height.
func drawWindow(_ ctx: CGContext, size: CGFloat, fraction: CGFloat, _ look: Look) {
  let k = size * fraction / 46
  let ox = (size - 64 * k) / 2 + 0 * k, oy = (size - 64 * k) / 2 + (32 - 33) * k
  func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * k, y: oy + y * k) }
  let body = CGRect(x: ox + 12 * k, y: oy + 10 * k, width: 40 * k, height: 46 * k)
  let bodyPath = CGPath(roundedRect: body, cornerWidth: 9 * k, cornerHeight: 9 * k, transform: nil)
  let ink = look == .colour ? rgb(blue) : rgb(0xFFFFFF)
  ctx.saveGState()
  ctx.addPath(bodyPath); ctx.clip()
  if look == .colour {
    ctx.setFillColor(rgb(sky)); ctx.fill(body)
  }
  // far hill line
  let hill = CGMutablePath()
  hill.move(to: P(12, 44))
  hill.addCurve(to: P(36, 37), control1: P(22, 36), control2: P(30, 40))
  hill.addCurve(to: P(52, 36), control1: P(42, 34), control2: P(48, 38))
  hill.addLine(to: P(52, 60)); hill.addLine(to: P(12, 60)); hill.closeSubpath()
  ctx.setFillColor(ink); ctx.addPath(hill); ctx.fillPath()
  ctx.restoreGState()
  // frame and cross bar
  ctx.setStrokeColor(ink)
  ctx.setLineWidth(4 * k)
  ctx.addPath(CGPath(roundedRect: body.insetBy(dx: 0, dy: 0), cornerWidth: 9 * k, cornerHeight: 9 * k, transform: nil)); ctx.strokePath()
  ctx.setLineWidth(3 * k)
  ctx.move(to: P(32, 10)); ctx.addLine(to: P(32, 56)); ctx.strokePath()
  ctx.move(to: P(12, 30)); ctx.addLine(to: P(52, 30)); ctx.strokePath()
  if look == .mono {
    // keep the hill readable in a single colour: cut a thin gap line above it
  }
}

func glyphLayer(_ size: Int, fraction: CGFloat, _ look: Look) -> CGImage {
  let ctx = canvas(size, opaque: false)
  drawWindow(ctx, size: CGFloat(size), fraction: fraction, look)
  return ctx.makeImage()!
}
func solid(_ size: Int, _ colour: UInt32) -> CGImage {
  let ctx = canvas(size, opaque: true)
  ctx.setFillColor(rgb(colour)); ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
  return ctx.makeImage()!
}

let root = URL(fileURLWithPath: out)
let images = root.appendingPathComponent("assets/images")
let bundle = root.appendingPathComponent("assets/expo.icon")
// Store icon: pale sky background, window about 66 % of the height.
let store = canvas(1024, opaque: true)
store.setFillColor(rgb(paleBg)); store.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
drawWindow(store, size: 1024, fraction: 0.66, .colour)
let storeImage = store.makeImage()!
save(storeImage, images.appendingPathComponent("icon.png"))
save(resized(storeImage, to: 48), images.appendingPathComponent("favicon.png"))
save(glyphLayer(1024, fraction: 0.72, .colour), images.appendingPathComponent("android-icon-foreground.png"))
save(solid(1024, paleBg), images.appendingPathComponent("android-icon-background.png"))
save(glyphLayer(1024, fraction: 0.72, .mono), images.appendingPathComponent("android-icon-monochrome.png"))
save(glyphLayer(1024, fraction: 0.9, .colour), images.appendingPathComponent("splash-icon.png"))
save(glyphLayer(1024, fraction: 0.66, .colour), bundle.appendingPathComponent("Assets/glyph.png"))
save(glyphLayer(1024, fraction: 0.66, .mono), bundle.appendingPathComponent("Assets/glyph-tinted.png"))

let json = """
{
  "fill" : { "solid" : "srgb:0.92941,0.94510,0.95686,1.00000" },
  "fill-specializations" : [
    { "value" : { "solid" : "srgb:0.92941,0.94510,0.95686,1.00000" } },
    { "appearance" : "dark", "value" : { "solid" : "srgb:0.10196,0.12549,0.14510,1.00000" } },
    { "appearance" : "tinted", "value" : { "solid" : "srgb:0.00000,0.00000,0.00000,1.00000" } }
  ],
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "glyph.png",
          "image-name-specializations" : [
            { "appearance" : "tinted", "value" : "glyph-tinted.png" }
          ],
          "name" : "glyph"
        }
      ],
      "shadow" : { "kind" : "neutral", "opacity" : 0.3 },
      "translucency" : { "enabled" : false, "value" : 0 }
    }
  ],
  "supported-platforms" : { "circles" : [ "watchOS" ], "squares" : "shared" }
}
"""
try json.write(to: bundle.appendingPathComponent("icon.json"), atomically: true, encoding: .utf8)
print("wrote icon files under \(out)")
