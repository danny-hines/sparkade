// Browser uploads are cropped to 512px before submission. Keep the complete
// creation form comfortably below the default 1 MB Server Action body limit.
export const MAX_WEBSITE_PHOTO_BYTES = 512 * 1024;
