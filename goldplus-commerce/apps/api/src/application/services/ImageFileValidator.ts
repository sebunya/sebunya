import * as path from 'path';

export interface ImageUploadInput {
  filename: string;
  mimetype: string;
  size: number;
}

export class ImageFileValidator {
  private static ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  private static ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
  private static MAX_BYTES = 5 * 1024 * 1024; // 5MB

  public static validate(input: ImageUploadInput): string | null {
    // Check size
    if (input.size > this.MAX_BYTES) {
      return `File "${input.filename}" exceeds size limit of 5MB.`;
    }

    // Check MIME type
    if (!this.ALLOWED_MIMES.includes(input.mimetype.toLowerCase())) {
      return `File "${input.filename}" has unsupported format "${input.mimetype}". Allowed: JPG, PNG, WEBP.`;
    }

    // Check extension
    const ext = path.extname(input.filename).toLowerCase();
    if (!this.ALLOWED_EXTS.includes(ext)) {
      return `File "${input.filename}" has invalid extension "${ext}".`;
    }

    return null;
  }
}
