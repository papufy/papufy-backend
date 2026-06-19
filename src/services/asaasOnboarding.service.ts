import { assertNoError, supabase } from "../lib/db";
import { asaasRequest } from "../lib/asaasClient";
import { env } from "../config/env";
import { parseBirthDateInput, isValidBirthDate } from "../utils/birthDate";
import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { badRequest } from "../utils/errors";
import type { PaymentProfilePatch } from "../utils/paymentCheckout";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, cpfCnpj, dataNascimento, asaasCustomerId, asaasWalletId, asaasAccountId, asaasSubaccountApiKey";

export type { PaymentProfilePatch };

type PaymentUserRow = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  cpfCnpj: string | null;
  dataNascimento: string | null;
  asaasCustomerId: string | null;
  asaasWalletId: string | null;
  asaasAccountId: string | null;
  asaasSubaccountApiKey: string | null;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function missingReceiverFields(user: PaymentUserRow): string[] {
  const missing: string[] = [];
  if (!user.cpfCnpj || digitsOnly(user.cpfCnpj).length < 11) {
    missing.push("cpfCnpj");
  }
  if (!user.telefone || digitsOnly(user.telefone).length < 10) {
    missing.push("telefone");
  }
  const doc = user.cpfCnpj ? digitsOnly(user.cpfCnpj) : "";
  if (doc.length === 11 && !user.dataNascimento) {
    missing.push("dataNascimento");
  }
  return missing;
}

async function loadPaymentUser(userId: string): Promise<PaymentUserRow> {
  return assertNoError<PaymentUserRow>(
    await supabase
      .from("User")
      .select(USER_PAYMENT_SELECT)
      .eq("id", userId)
      .maybeSingle(),
    "Usuário não encontrado."
  );
}

async function applyPaymentProfilePatch(
  userId: string,
  patch?: PaymentProfilePatch
): Promise<PaymentUserRow> {
  if (!patch) return loadPaymentUser(userId);

  const update: {
    updatedAt: string;
    cpfCnpj?: string;
    telefone?: string | null;
    cidade?: string | null;
    uf?: string | null;
    dataNascimento?: string | null;
  } = {
    updatedAt: new Date().toISOString(),
  };

  if (patch.cpfCnpj !== undefined) {
    const doc = digitsOnly(patch.cpfCnpj);
    if (doc.length !== 11 && doc.length !== 14) {
      throw badRequest("CPF/CNPJ inválido.");
    }
    update.cpfCnpj = doc;
  }
  if (patch.telefone !== undefined) {
    const phone = digitsOnly(patch.telefone);
    if (phone.length < 10) {
      throw badRequest("Telefone inválido.");
    }
    update.telefone = sanitizePhone(patch.telefone);
  }
  if (patch.cidade !== undefined) {
    update.cidade = patch.cidade ? sanitizeText(patch.cidade, 80) : null;
  }
  if (patch.uf !== undefined) {
    update.uf = patch.uf ? patch.uf.toUpperCase().slice(0, 2) : null;
  }
  if (patch.dataNascimento !== undefined) {
    const birthDate = parseBirthDateInput(patch.dataNascimento);
    if (!isValidBirthDate(birthDate)) {
      throw badRequest("Data de nascimento inválida. Informe uma data válida (18+ anos).");
    }
    update.dataNascimento = birthDate;
  }

  if (Object.keys(update).length <= 1) {
    return loadPaymentUser(userId);
  }

  return assertNoError<PaymentUserRow>(
    await supabase
      .from("User")
      .update(update)
      .eq("id", userId)
      .select(USER_PAYMENT_SELECT)
      .single()
  );
}

/** Tenta gerar nova API key da subconta (conta master + asaasAccountId). */
async function tryRecoverSubaccountApiKey(
  userId: string,
  user: PaymentUserRow
): Promise<boolean> {
  if (!user.asaasAccountId?.trim()) return false;
  try {
    const token = await asaasRequest<{ apiKey?: string }>(
      `/accounts/${user.asaasAccountId}/accessTokens`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Papufy" }),
        expectedStatus: [200],
      }
    );
    const apiKey = token.apiKey?.trim();
    if (!apiKey) return false;
    await supabase
      .from("User")
      .update({
        asaasSubaccountApiKey: apiKey,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cria subconta/carteira Asaas (recebedor) no primeiro recebimento ou proposta.
 */
export async function ensureAsaasRecipientWallet(
  userId: string,
  patch?: PaymentProfilePatch
): Promise<string> {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos não configurados. Defina ASAAS_API_URL e ASAAS_API_KEY no Render."
    );
  }

  const user = await applyPaymentProfilePatch(userId, patch);
  const missing = missingReceiverFields(user);
  if (missing.length > 0) {
    throw new PaymentProfileIncompleteError(missing, "receiver");
  }

  if (user.asaasWalletId && user.asaasSubaccountApiKey) {
    return user.asaasWalletId;
  }

  if (user.asaasWalletId && !user.asaasSubaccountApiKey) {
    const recovered = await tryRecoverSubaccountApiKey(userId, user);
    if (recovered) return user.asaasWalletId;
    throw badRequest(
      "Sua carteira Asaas existe, mas a chave de API da subconta não está registrada. Entre em contato com o suporte Papufy."
    );
  }

  const cpfCnpj = digitsOnly(String(user.cpfCnpj));
  const mobilePhone = sanitizePhone(String(user.telefone));
  const cidade = user.cidade?.trim() || "Centro";
  const uf = user.uf?.trim().toUpperCase() || "PB";

  const account = await asaasRequest<{
    walletId: string;
    id: string;
    apiKey: string;
  }>("/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: sanitizeText(user.nome, 120),
      email: user.email.trim().toLowerCase(),
      cpfCnpj,
      mobilePhone,
      incomeValue: 5000,
      address: cidade,
      addressNumber: "S/N",
      province: uf,
      postalCode: "58010000",
      ...(cpfCnpj.length === 11
        ? { birthDate: user.dataNascimento }
        : {}),
    }),
  });

  if (!account.apiKey?.trim()) {
    throw badRequest(
      "Subconta Asaas criada sem chave de API. Contate o suporte Papufy."
    );
  }

  await supabase
    .from("User")
    .update({
      cpfCnpj,
      asaasWalletId: account.walletId,
      asaasAccountId: account.id,
      asaasSubaccountApiKey: account.apiKey.trim(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", userId);

  return account.walletId;
}

/** Credenciais da subconta Asaas do profissional (wallet + API key). */
export async function getAsaasSubaccountCredentials(userId: string): Promise<{
  walletId: string;
  apiKey: string;
}> {
  await ensureAsaasRecipientWallet(userId);
  const user = await loadPaymentUser(userId);
  if (!user.asaasWalletId || !user.asaasSubaccountApiKey) {
    throw badRequest(
      "Carteira de recebimento não configurada. Complete CPF e telefone no perfil."
    );
  }
  return {
    walletId: user.asaasWalletId,
    apiKey: user.asaasSubaccountApiKey,
  };
}
