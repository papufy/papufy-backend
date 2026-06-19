import { badRequest } from "./errors";

/** Normaliza para YYYY-MM-DD (aceita ISO, YYYY-MM-DD ou DD/MM/YYYY). */
export function parseBirthDateInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw badRequest("Informe a data de nascimento.");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  throw badRequest("Data de nascimento inválida. Use DD/MM/AAAA.");
}

export function isValidBirthDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }
  const now = new Date();
  const age =
    now.getFullYear() -
    year -
    (now.getMonth() < month - 1 ||
    (now.getMonth() === month - 1 && now.getDate() < day)
      ? 1
      : 0);
  return age >= 18 && age <= 120;
}

/** Formato exigido pelo Asaas: YYYY-MM-DD */
export function normalizeAsaasBirthDate(
  value: string | null | undefined
): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  try {
    return parseBirthDateInput(trimmed);
  } catch {
    return undefined;
  }
}
