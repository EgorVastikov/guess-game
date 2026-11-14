import { MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from "./config.js";

export class ImageInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ImageInputError";
    this.status = status;
  }
}

export function validateDrawingImage(value) {
  const invalid = () => { throw new ImageInputError("Не удалось прочитать рисунок. Попробуй отправить его ещё раз"); };
  const prefix = "data:image/png;base64,";
  if (typeof value !== "string" || !value.startsWith(prefix)) invalid();
  const encoded = value.slice(prefix.length);
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new ImageInputError("Рисунок слишком большой. Упрости его и попробуй ещё раз", 413);
  }
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) invalid();
  let bytes;
  try {
    bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  } catch { invalid(); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageInputError("Рисунок слишком большой", 413);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 57 || !signature.every((byte, index) => bytes[index] === byte)) invalid();
  const view = new DataView(bytes.buffer);
  const kindAt = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (view.getUint32(8) !== 13 || kindAt(12) !== "IHDR") invalid();
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) invalid();
  // Canvas exports non-interlaced, 8-bit RGB/RGBA PNGs. Other formats aren't accepted.
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] || bytes[27] || bytes[28]) invalid();
  let offset = 33;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const kind = kindAt(offset + 4);
    if (offset + 12 + length > bytes.length || kind === "IHDR") invalid();
    if (kind === "IDAT" && length > 0) hasData = true;
    offset += length + 12;
    if (kind === "IEND") {
      if (length || offset !== bytes.length || !hasData) invalid();
      return { width, height };
    }
  }
  invalid();
}
