import {
  toPointsArray,
  clamp,
  getAngle,
  getAngleDelta,
  getDistance,
  getPointBetween,
  projectPoint,
  lerp,
} from './utils'
import { StrokeOptions } from './types'

const { abs, min, PI } = Math,
  TAU = PI / 2,
  SHARP = TAU,
  DULL = SHARP / 2

function getStrokeRadius(
  size: number,
  thinning: number,
  easing: (t: number) => number,
  pressure = 0.5
) {
  if (thinning === undefined) return size / 2
  pressure = clamp(easing(pressure), 0, 1)
  return (
    (thinning < 0
      ? lerp(size, size + size * clamp(thinning, -0.95, -0.05), pressure)
      : lerp(size - size * clamp(thinning, 0.05, 0.95), size, pressure)) / 2
  )
}

/**
 * ## getStrokePoints
 * @description Get points for a stroke.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional.
 * @param streamline How much to streamline the stroke.
 */
export function getStrokePoints<
  T extends number[],
  K extends { x: number; y: number; pressure?: number }
>(points: (T | K)[], streamline = 0.5): number[][] {
  const pts = toPointsArray(points)

  if (pts.length === 0) return []

  pts[0] = [pts[0][0], pts[0][1], pts[0][2] || 0.5, 0, 0, 0]

  for (
    let i = 1, curr = pts[i], prev = pts[0];
    i < pts.length;
    i++, curr = pts[i], prev = pts[i - 1]
  ) {
    curr[0] = lerp(prev[0], curr[0], 1 - streamline)
    curr[1] = lerp(prev[1], curr[1], 1 - streamline)
    curr[3] = getAngle(curr, prev)
    curr[4] = getDistance(curr, prev)
    curr[5] = prev[5] + curr[4]
  }

  return pts
}

/**
 * ## getStrokeOutlinePoints
 * @description Get an array of points (as `[x, y]`) representing the outline of a stroke.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional.
 * @param options An (optional) object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.easing	An easing function to apply to each point's pressure.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 */
export function getStrokeOutlinePoints(
  points: number[][],
  options: StrokeOptions = {} as StrokeOptions
): number[][] {
  const {
    size = 8,
    thinning = 0.5,
    smoothing = 0.5,
    simulatePressure = true,
    easing = t => t,
  } = options

  const len = points.length,
    totalLength = points[len - 1][5], // The total length of the line
    minDist = size * smoothing, // The minimum distance for measurements
    leftPts: number[][] = [], // Our collected left and right points
    rightPts: number[][] = []

  let pl = points[0], // Previous left and right points
    pr = points[0],
    tl = pl, // Points to test distance from
    tr = pr,
    pa = pr[3],
    pp = 0, // Previous (maybe simulated) pressure
    r = size / 2, // The current point radius
    short = true // Whether the line is drawn far enough

  // We can't do anything with an empty array.
  if (len === 0) return []

  // If the point is only one point long, draw two caps at either end.
  if (len === 1 || totalLength <= size / 4) {
    let first = points[0],
      last = points[len - 1],
      angle = getAngle(first, last)

    if (thinning) {
      r = getStrokeRadius(size, thinning, easing, last[2])
    }

    for (let t = 0, step = 0.1; t <= 1; t += step) {
      tl = projectPoint(first, angle + PI + TAU - t * PI, r)
      tr = projectPoint(last, angle + TAU - t * PI, r)
      leftPts.push(tl)
      rightPts.push(tr)
    }

    return leftPts.concat(rightPts)
  }

  // For a point with more than one point, create an outline shape.
  for (let i = 1; i < len - 1; i++) {
    const next = points[i + 1]

    let [x, y, pressure, angle, distance, clen] = points[i]

    // 1.
    // Calculate the size of the current point.

    if (thinning) {
      if (simulatePressure) {
        // Simulate pressure by accellerating the reported pressure.
        const rp = min(1 - distance / size, 1)
        const sp = min(distance / size, 1)
        pressure = min(1, pp + (rp - pp) * (sp / 2))
      }

      // Compute the stroke radius based on the pressure, easing and thinning.
      r = getStrokeRadius(size, thinning, easing, pressure)
    }

    // 2.
    // Draw a cap once we've reached the minimum length.

    if (short) {
      if (clen < size / 4) continue

      // The first point after we've reached the minimum length.
      // Draw a cap at the first point angled toward the current point.

      short = false

      for (let t = 0, step = 0.1; t <= 1; t += step) {
        tl = projectPoint(points[0], angle + TAU - t * PI, r)
        leftPts.push(tl)
      }

      tr = projectPoint(points[0], angle + TAU, r)
      rightPts.push(tr)
    }

    // 3.
    // Handle sharp corners

    // Find the delta between the current and next angle.
    const absDelta = abs(getAngleDelta(next[3], angle))

    if (absDelta > SHARP) {
      // A sharp corner.
      // Project points (left and right) for a cap.

      for (let t = 0, step = 0.25; t <= 1; t += step) {
        tl = projectPoint([x, y], pa - TAU + t * -PI, r)
        tr = projectPoint([x, y], pa + TAU + t * PI, r)

        leftPts.push(tl)
        rightPts.push(tr)
      }

      continue
    }

    // 4. Add regular point.

    pl = projectPoint([x, y], angle - TAU, r)
    pr = projectPoint([x, y], angle + TAU, r)

    if (absDelta > DULL || getDistance(pl, tl) > minDist) {
      leftPts.push(getPointBetween(tl, pl))
      tl = pl
    }

    if (absDelta > DULL || getDistance(pr, tr) > minDist) {
      rightPts.push(getPointBetween(tr, pr))
      tr = pr
    }

    pp = pressure
    pa = angle
  }

  // Add the end cap. This is tricky because some lines end with sharp angles.
  const last = points[points.length - 1]

  for (let t = 0, step = 0.1; t <= 1; t += step) {
    rightPts.push(projectPoint(last, last[3] + TAU + t * PI, r))
  }

  return leftPts.concat(rightPts.reverse())
}

/**
 * ## getStroke
 * @description Returns a stroke as an array of points.
 * @param points An array of points (as `[x, y, pressure]` or `{x, y, pressure}`). Pressure is optional.
 * @param options An (optional) object with options.
 * @param options.size	The base size (diameter) of the stroke.
 * @param options.thinning The effect of pressure on the stroke's size.
 * @param options.smoothing	How much to soften the stroke's edges.
 * @param options.streamline How much to streamline the stroke.
 * @param options.simulatePressure Whether to simulate pressure based on velocity.
 */
export default function getStroke<
  T extends number[],
  K extends { x: number; y: number; pressure?: number }
>(points: (T | K)[], options: StrokeOptions = {} as StrokeOptions): number[][] {
  return getStrokeOutlinePoints(
    getStrokePoints(points, options.streamline),
    options
  )
}

export { StrokeOptions }
