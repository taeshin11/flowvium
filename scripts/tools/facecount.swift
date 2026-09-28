// facecount <image> — prints the number of faces (macOS Vision), or -1 on error.
import Foundation
import Vision
let args = CommandLine.arguments
guard args.count > 1, let url = Optional(URL(fileURLWithPath: args[1])) else { print(-1); exit(1) }
let req = VNDetectFaceRectanglesRequest()
let h = VNImageRequestHandler(url: url, options: [:])
do { try h.perform([req]); print(req.results?.count ?? 0) } catch { print(-1); exit(1) }
