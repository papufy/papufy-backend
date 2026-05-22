export function sanitizeText(value: string, maxLength = 5000): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

export function sanitizePhone(value: string): string {
  return value.replace(/[^\d+()\s-]/g, "").trim().slice(0, 20);
}

export function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, 254);
}
