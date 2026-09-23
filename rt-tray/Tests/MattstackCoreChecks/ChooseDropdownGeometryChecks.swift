import CoreGraphics
import Foundation
import MattstackCore

let chooseDropdownGeometryChecks: [Check] = [
    Check("ChooseDropdownGeometry.rectsOutside: a centered hole yields four non-overlapping strips covering the rest of bounds") { c in
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let hole = CGRect(x: 20, y: 30, width: 40, height: 10)
        let rects = ChooseDropdownGeometry.rectsOutside(hole, in: bounds)
        c.expectEqual(rects.count, 4)
        for r in rects { c.expect(!r.intersects(hole) || r.width == 0 || r.height == 0, "a returned rect overlaps the hole: \(r)") }
        let totalArea = rects.reduce(0) { $0 + $1.width * $1.height }
        c.expectEqual(totalArea, bounds.width * bounds.height - hole.width * hole.height)
    },
    Check("ChooseDropdownGeometry.rectsOutside: a hole flush with bounds' top-left drops the degenerate top and left strips") { c in
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let hole = CGRect(x: 0, y: 0, width: 40, height: 30)
        let rects = ChooseDropdownGeometry.rectsOutside(hole, in: bounds)
        c.expectEqual(rects.count, 2, "top and left strips have zero size and are dropped")
        for r in rects { c.expect(r.width > 0 && r.height > 0, "a degenerate rect leaked through: \(r)") }
    },
    Check("ChooseDropdownGeometry.rectsOutside: a hole covering the whole bounds yields nothing") { c in
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        c.expectEqual(ChooseDropdownGeometry.rectsOutside(bounds, in: bounds), [])
    },
    Check("ChooseDropdownGeometry.rectsOutside: a hole past the bounds' edge does not produce a negative-sized rect") { c in
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let hole = CGRect(x: 80, y: -20, width: 60, height: 200)
        let rects = ChooseDropdownGeometry.rectsOutside(hole, in: bounds)
        for r in rects { c.expect(r.width >= 0 && r.height >= 0, "negative-sized rect: \(r)") }
    },
]
