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

const ADDRESS_PATTERNS: RegExp[] = [
  /\b(?:rua|r\.|avenida|av\.|travessa|trav\.|alameda|praça|praca|rodovia|estrada)\s+[\w\u00C0-\u017F][\w\u00C0-\u017F\s.'-]{2,}\b/i,
  /\b(?:n[úu]mero|nº|num\.?|apto|apartamento|bloco|casa|lote|quadra|cep)\b/i,
  /\b\d{5}-?\d{3}\b/,
];

export const CONTACT_VIOLATION_MESSAGE =
  "Não é permitido compartilhar telefone, endereço, e-mail ou redes sociais no chat antes da confirmação do pagamento.";

export function containsContactLeak(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return CONTACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsAddressLeak(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return ADDRESS_PATTERNS.some((pattern) => pattern.test(normalized));
}
