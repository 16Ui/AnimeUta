export interface ArtworkPalette {
  base: string
  deep: string
  soft: string
  accent: string
}

export const defaultArtworkPalette: ArtworkPalette = {
  base: 'hsl(340 18% 18%)',
  deep: 'hsl(340 16% 7%)',
  soft: 'hsl(340 15% 13%)',
  accent: 'hsl(350 74% 68%)',
}

interface ColorBucket {
  red: number
  green: number
  blue: number
  count: number
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { hue: 0, saturation: 0, lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return { hue: hue < 0 ? hue + 360 : hue, saturation, lightness }
}

function paletteFromRgb(red: number, green: number, blue: number): ArtworkPalette {
  const { hue, saturation } = rgbToHsl(red, green, blue)
  const backgroundSaturation = Math.round(Math.min(58, Math.max(16, saturation * 72)))
  const accentSaturation = Math.round(Math.min(82, Math.max(42, saturation * 100)))
  return {
    base: `hsl(${Math.round(hue)} ${backgroundSaturation}% 22%)`,
    deep: `hsl(${Math.round(hue)} ${Math.max(12, backgroundSaturation - 8)}% 7%)`,
    soft: `hsl(${Math.round(hue)} ${Math.max(14, backgroundSaturation - 5)}% 14%)`,
    accent: `hsl(${Math.round(hue)} ${accentSaturation}% 68%)`,
  }
}

export function paletteFromPixels(pixels: Uint8ClampedArray): ArtworkPalette {
  const buckets = new Map<string, ColorBucket>()
  for (let offset = 0; offset < pixels.length; offset += 16) {
    const alpha = pixels[offset + 3]
    if (alpha < 200) continue
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const { saturation, lightness } = rgbToHsl(red, green, blue)
    if (lightness < 0.08 || lightness > 0.92) continue

    const key = `${Math.round(red / 32)}:${Math.round(green / 32)}:${Math.round(blue / 32)}`
    const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, count: 0 }
    const weight = 0.35 + saturation
    bucket.red += red * weight
    bucket.green += green * weight
    bucket.blue += blue * weight
    bucket.count += weight
    buckets.set(key, bucket)
  }

  let selected: ColorBucket | undefined
  let selectedScore = -1
  for (const bucket of buckets.values()) {
    const red = bucket.red / bucket.count
    const green = bucket.green / bucket.count
    const blue = bucket.blue / bucket.count
    const { saturation, lightness } = rgbToHsl(red, green, blue)
    const score = bucket.count * (0.55 + saturation) * (1 - Math.abs(lightness - 0.48) * 0.45)
    if (score > selectedScore) {
      selected = bucket
      selectedScore = score
    }
  }

  if (!selected) return defaultArtworkPalette
  return paletteFromRgb(
    selected.red / selected.count,
    selected.green / selected.count,
    selected.blue / selected.count,
  )
}

export async function extractArtworkPalette(source: string): Promise<ArtworkPalette> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = source
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return defaultArtworkPalette
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return paletteFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data)
}
