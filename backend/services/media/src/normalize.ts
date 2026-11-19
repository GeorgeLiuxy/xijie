import sharp, { type Metadata, type OutputInfo } from "sharp"

import { MediaError, MAX_OUTPUT } from "./contracts.js"

export async function normalize(input: Buffer, mime: string) {
  const options = {
    limitInputPixels: 32_000_000,
    failOn: "warning" as const,
    animated: false,
  }
  let meta: Metadata
  try {
    meta = await sharp(input, options).metadata()
  } catch {
    throw new MediaError(422, "MEDIA_INVALID_IMAGE")
  }
  const formats: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  }
  if (
    meta.format !== formats[mime] ||
    !meta.width ||
    !meta.height ||
    meta.width * meta.height > 32_000_000 ||
    (meta.pages ?? 1) > 1
  )
    throw new MediaError(422, "MEDIA_INVALID_IMAGE")
  for (const edge of [2048, 1600, 1280, 1024])
    for (const quality of [82, 68, 50]) {
      let data: Buffer, info: OutputInfo
      try {
        const result = await sharp(input, options)
          .rotate()
          .resize({
            width: edge,
            height: edge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality, effort: 4 })
          .toBuffer({ resolveWithObject: true })
        data = result.data
        info = result.info
      } catch {
        throw new MediaError(422, "MEDIA_INVALID_IMAGE")
      }
      if (data.length <= MAX_OUTPUT)
        return {
          data,
          width: info.width,
          height: info.height,
          mime: "image/webp" as const,
        }
    }
  throw new MediaError(422, "MEDIA_IMAGE_TOO_COMPLEX")
}
