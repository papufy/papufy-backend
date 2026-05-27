import { assertNoError, supabase } from "../lib/db";
import { asaasRequest } from "../lib/asaasClient";
import { env } from "../config/env";
import { PaymentProfileIncompleteError } from "../errors/paymentProfile";
import { badRequest } from "../utils/errors";
import type { PaymentProfilePatch } from "../utils/paymentCheckout";
import { sanitizePhone, sanitizeText } from "../utils/sanitize";

const USER_PAYMENT_SELECT =
  "id, nome, email, telefone, cidade, uf, cpfCnpj, asaasCustomerId, asaasWalletId";

export type { PaymentProfilePatch };

type PaymentUserRow = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  cpfCnpj: string | null;
  asaasCustomerId: string | null;
  asaasWalletId: string | null;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function missingPayerFields(user: PaymentUserRow): string[] {
  const missing: string[] = [];
  if (!user.cpfCnpj || digitsOnly(user.cpfCnpj).length < 11) {
    missing.push("cpfCnpj");
  }
  return missing;
}

function missingReceiverFields(user: PaymentUserRow): string[] {
  const missing: string[] = [];
  if (!user.cpfCnpj || digitsOnly(user.cpfCnpj).length < 11) {
    missing.push("cpfCnpj");
  }
  if (!user.telefone || digitsOnly(user.telefone).length < 10) {
    missing.push("telefone");
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

/**
 * Cria cliente Asaas (pagador) na primeira cobrança — sem fluxo manual.
 */
export async function ensureAsaasCustomer(
  userId: string,
  patch?: PaymentProfilePatch
): Promise<string> {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos não configurados. Defina ASAAS_API_URL e ASAAS_API_KEY no Render."
    );
  }

  const user = await applyPaymentProfilePatch(userId, patch);
  const missing = missingPayerFields(user);
  if (missing.length > 0) {
    throw new PaymentProfileIncompleteError(missing, "payer");
  }

  if (user.asaasCustomerId) return user.asaasCustomerId;

  const customer = await asaasRequest<{ id: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: user.nome,
      email: user.email,
      cpfCnpj: digitsOnly(String(user.cpfCnpj)),
      mobilePhone: user.telefone ? sanitizePhone(user.telefone) : undefined,
    }),
  });

  await supabase
    .from("User")
    .update({
      asaasCustomerId: customer.id,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", userId);

  return customer.id;
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

  if (user.asaasWalletId) return user.asaasWalletId;

  const cpfCnpj = digitsOnly(String(user.cpfCnpj));
  const mobilePhone = sanitizePhone(String(user.telefone));
  const cidade = user.cidade?.trim() || "Centro";
  const uf = user.uf?.trim().toUpperCase() || "PB";

  const account = await asaasRequest<{ walletId: string; id: string }>(
    "/accounts",
    {
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
      }),
    }
  );

  await supabase
    .from("User")
    .update({
      cpfCnpj,
      asaasWalletId: account.walletId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", userId);

  return account.walletId;
}
