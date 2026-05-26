/**
 * Bloqueia vazamento de contato fora do fluxo seguro da plataforma (chat moderado).
 * Espelhado no frontend em `frontend/src/lib/contactPolicy.ts`.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /\b(?:whatsapp|wpp|zap|telegram|tiktok|facebook|insta(?:gram)?)\b/i,
  /\bwa\.me\b/i,
  /\bt\.me\b/i,
  /\b(?:e-?mail|mailto)\b/i,
  /@[\w][\w.-]{2,}/,
  /\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/,
  /\b\d{10,13}\b/,
  /\(\d{2}\)\s?\d{4,5}[-\s]?\d{4}/,
];

export const CONTACT_VIOLATION_MESSAGE =
  "Não é permitido compartilhar telefone, e-mail ou redes sociais no chat. Use apenas o Papufy para combinar o serviço.";

export function containsContactLeak(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return CONTACT_PATTERNS.some((pattern) => pattern.test(normalized));
}
