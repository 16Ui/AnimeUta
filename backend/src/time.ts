interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, value)
  }
  return value
}

function partsAt(date: Date, timeZone: string): ZonedDateParts {
  const values = Object.fromEntries(
    formatter(timeZone).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>
  const required = (name: keyof ZonedDateParts): number => {
    const value = values[name]
    if (value === undefined || !Number.isFinite(value)) throw new RangeError(`Unable to resolve ${name} in time zone ${timeZone}`)
    return value
  }
  return {
    year: required('year'),
    month: required('month'),
    day: required('day'),
    hour: required('hour'),
    minute: required('minute'),
    second: required('second'),
  }
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = partsAt(date, timeZone)
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const desiredWallTime = Date.UTC(year, month - 1, day)
  let instant = desiredWallTime
  for (let iteration = 0; iteration < 4; iteration += 1) {
    instant = desiredWallTime - offsetAt(new Date(instant), timeZone)
  }
  return new Date(instant)
}

function shiftedLocalDate(reference: Date, timeZone: string, dayOffset: number): Pick<ZonedDateParts, 'year' | 'month' | 'day'> {
  const current = partsAt(reference, timeZone)
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + dayOffset))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

export function zonedDateKey(date: Date, timeZone: string): string {
  const parts = partsAt(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function zonedDayRange(timeZone: string, reference = new Date(), dayOffset = 0): { start: Date; end: Date; key: string } {
  const local = shiftedLocalDate(reference, timeZone, dayOffset)
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
  return {
    start: zonedMidnightUtc(local.year, local.month, local.day, timeZone),
    end: zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
    key: `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`,
  }
}
