import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { normalizeAsaasBirthDate } from "./birthDate";
import { sanitizePhone, sanitizeText } from "./sanitize";

type AsaasAccountUser = {
  nome: string;
  email: string;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  cpfCnpj: string | null;
  dataNascimento: string | null;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

const DEFAULT_POSTAL_BY_UF: Record<string, string> = {
  PB: "58400000",
  SP: "01001000",
  RJ: "20040020",
  MG: "30130010",
  PE: "50010000",
  CE: "60010000",
  BA: "40010000",
  RS: "90010000",
  PR: "80010000",
  SC: "88010000",
};

function defaultPostalCode(uf: string): string {
  return DEFAULT_POSTAL_BY_UF[uf.toUpperCase()] ?? "58400000";
}

export function buildAsaasSubaccountPayload(user: AsaasAccountUser) {
  const cpfCnpj = digitsOnly(String(user.cpfCnpj));
  const mobilePhone = sanitizePhone(String(user.telefone));
  const cidade = user.cidade?.trim() || "Campina Grande";
  const uf = user.uf?.trim().toUpperCase() || "PB";

  const payload: Record<string, unknown> = {
    name: sanitizeText(user.nome, 120),
    email: user.email.trim().toLowerCase(),
    cpfCnpj,
    mobilePhone,
    incomeValue: 5000,
    address: `Centro, ${cidade}`,
    addressNumber: "S/N",
    province: "Centro",
    postalCode: defaultPostalCode(uf),
  };

  if (cpfCnpj.length === 11) {
    const birthDate = normalizeAsaasBirthDate(user.dataNascimento);
    if (!birthDate) {
      throw new PaymentProfileIncompleteError(
        ["dataNascimento"],
        "receiver",
        "Informe a data de nascimento para receber pagamentos."
      );
    }
    payload.birthDate = birthDate;
    payload.companyType = "INDIVIDUAL";
  } else if (cpfCnpj.length === 14) {
    payload.companyType = "MEI";
  }

  return payload;
}
