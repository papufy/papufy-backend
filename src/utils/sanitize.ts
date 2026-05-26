import { containsContactLeak } from "./contactPolicy";
import { badRequest } from "./errors";

const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ENTITY_MAP[ch] ?? ch);
}

export function sanitizeText(value: string, maxLength = 5000): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
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

export function sanitizeChatMessage(content: string): string {
  const trimmed = sanitizeText(content, 2000);
  if (!trimmed) {
    throw badRequest("Mensagem vazia.");
  }
  if (containsContactLeak(trimmed)) {
    throw badRequest(
      "Não é permitido compartilhar telefone, e-mail ou redes sociais no chat."
    );
  }
  return trimmed;
}
