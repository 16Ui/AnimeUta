export interface TimedTranscriptSegment {
  start: number
  end: number
  text: string
}

export interface AlignedLyricLine {
  start: number
  end: number
  confidence: number
}

type AlignmentStep =
  | { kind: 'match'; lineCount: 1 | 2; segmentCount: 1 | 2 | 3; distance: number }
  | { kind: 'skip-line' }
  | { kind: 'skip-segment' }

const skipLineCost = 0.75
const skipSegmentCost = 0.55
const mergeSegmentCost = 0.2
const splitLineCost = 0.25

function normalizeJapanese(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\p{P}\p{S}\s]/gu, '')
}

function normalizedEditDistance(left: string, right: string): number {
  const a = normalizeJapanese(left)
  const b = normalizeJapanese(right)
  if (!a && !b) return 0
  if (!a || !b) return 1
  const previous = new Uint32Array(b.length + 1)
  const current = new Uint32Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous.set(current)
  }
  return previous[b.length]! / Math.max(a.length, b.length)
}

function splitSegment(segment: TimedTranscriptSegment, lines: string[]): AlignedLyricLine[] {
  const weights = lines.map((line) => Math.max(1, normalizeJapanese(line).length))
  const total = weights.reduce((sum, value) => sum + value, 0)
  const duration = Math.max(0.1, segment.end - segment.start)
  let cursor = segment.start
  return weights.map((weight, index) => {
    const end = index === weights.length - 1 ? segment.end : cursor + duration * weight / total
    const aligned = { start: cursor, end: Math.max(cursor + 0.1, end), confidence: 0 }
    cursor = aligned.end
    return aligned
  })
}

function fillMissingLines(
  aligned: Array<AlignedLyricLine | undefined>,
  lines: string[],
  segments: TimedTranscriptSegment[],
): AlignedLyricLine[] {
  const totalEnd = segments.at(-1)?.end ?? Math.max(1, lines.length * 2)
  let index = 0
  while (index < aligned.length) {
    if (aligned[index]) {
      index += 1
      continue
    }
    const startIndex = index
    while (index < aligned.length && !aligned[index]) index += 1
    const endIndex = index
    const previousEnd = startIndex > 0 ? aligned[startIndex - 1]?.end ?? 0 : 0
    const nextStart = endIndex < aligned.length ? aligned[endIndex]?.start ?? totalEnd : totalEnd
    const available = Math.max(0.1 * (endIndex - startIndex), nextStart - previousEnd)
    const missingLines = lines.slice(startIndex, endIndex)
    const weights = missingLines.map((line) => Math.max(1, normalizeJapanese(line).length))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    let cursor = previousEnd
    for (let offset = 0; offset < missingLines.length; offset += 1) {
      const lineIndex = startIndex + offset
      const end = offset === missingLines.length - 1
        ? Math.max(cursor + 0.1, nextStart)
        : cursor + available * weights[offset]! / totalWeight
      aligned[lineIndex] = { start: cursor, end, confidence: 0 }
      cursor = end
    }
  }

  let previousStart = 0
  return aligned.map((value) => {
    const start = Math.max(previousStart, value?.start ?? previousStart)
    const end = Math.max(start + 0.1, value?.end ?? start + 2)
    previousStart = start
    return { start, end, confidence: value?.confidence ?? 0 }
  })
}

export function alignLyricLines(lines: string[], segments: TimedTranscriptSegment[]): AlignedLyricLine[] {
  if (lines.length === 0) return []
  if (segments.length === 0) return fillMissingLines(new Array(lines.length), lines, segments)

  const rows = lines.length + 1
  const columns = segments.length + 1
  const costs = new Float64Array(rows * columns)
  costs.fill(Number.POSITIVE_INFINITY)
  costs[0] = 0
  const steps = new Array<AlignmentStep | undefined>(rows * columns)
  const indexOf = (lineIndex: number, segmentIndex: number) => lineIndex * columns + segmentIndex

  const relax = (lineIndex: number, segmentIndex: number, cost: number, step: AlignmentStep) => {
    const index = indexOf(lineIndex, segmentIndex)
    if (cost < costs[index]!) {
      costs[index] = cost
      steps[index] = step
    }
  }

  for (let lineIndex = 0; lineIndex <= lines.length; lineIndex += 1) {
    for (let segmentIndex = 0; segmentIndex <= segments.length; segmentIndex += 1) {
      const cost = costs[indexOf(lineIndex, segmentIndex)]!
      if (!Number.isFinite(cost)) continue
      if (lineIndex < lines.length) {
        relax(lineIndex + 1, segmentIndex, cost + skipLineCost, { kind: 'skip-line' })
      }
      if (segmentIndex < segments.length) {
        relax(lineIndex, segmentIndex + 1, cost + skipSegmentCost, { kind: 'skip-segment' })
      }
      if (lineIndex < lines.length && segmentIndex < segments.length) {
        for (const segmentCount of [1, 2, 3] as const) {
          if (segmentIndex + segmentCount > segments.length) continue
          const text = segments.slice(segmentIndex, segmentIndex + segmentCount).map((segment) => segment.text).join('')
          const distance = normalizedEditDistance(lines[lineIndex]!, text)
          relax(
            lineIndex + 1,
            segmentIndex + segmentCount,
            cost + distance + (segmentCount - 1) * mergeSegmentCost,
            { kind: 'match', lineCount: 1, segmentCount, distance },
          )
        }
      }
      if (lineIndex + 2 <= lines.length && segmentIndex < segments.length) {
        const text = lines.slice(lineIndex, lineIndex + 2).join('')
        const distance = normalizedEditDistance(text, segments[segmentIndex]!.text)
        relax(
          lineIndex + 2,
          segmentIndex + 1,
          cost + distance + splitLineCost,
          { kind: 'match', lineCount: 2, segmentCount: 1, distance },
        )
      }
    }
  }

  const aligned: Array<AlignedLyricLine | undefined> = new Array(lines.length)
  let lineIndex = lines.length
  let segmentIndex = segments.length
  while (lineIndex > 0 || segmentIndex > 0) {
    const step = steps[indexOf(lineIndex, segmentIndex)]
    if (!step) break
    if (step.kind === 'skip-line') {
      lineIndex -= 1
      continue
    }
    if (step.kind === 'skip-segment') {
      segmentIndex -= 1
      continue
    }
    const firstLine = lineIndex - step.lineCount
    const firstSegment = segmentIndex - step.segmentCount
    const matchedSegments = segments.slice(firstSegment, segmentIndex)
    const segment = {
      start: matchedSegments[0]!.start,
      end: matchedSegments.at(-1)!.end,
      text: matchedSegments.map((value) => value.text).join(''),
    }
    const split = splitSegment(segment, lines.slice(firstLine, lineIndex))
    const confidence = Math.max(0, Math.min(1, 1 - step.distance))
    split.forEach((value, offset) => {
      aligned[firstLine + offset] = { ...value, confidence }
    })
    lineIndex = firstLine
    segmentIndex = firstSegment
  }
  return fillMissingLines(aligned, lines, segments)
}
