import { AppError } from "../utils/errors";

export class PaymentProfileIncompleteError extends AppError {
  readonly code = "PAYMENT_PROFILE_INCOMPLETE" as const;
  readonly missingFields: string[];
  readonly role: "payer" | "receiver";

  constructor(
    missingFields: string[],
    role: "payer" | "receiver",
    message?: string
  ) {
    const defaultMessage =
      role === "payer"
        ? "Para pagar, complete os dados pedidos na tela de pagamento."
        : "Para receber pagamentos, complete os dados abaixo.";
    super(message ?? defaultMessage, 422);
    this.name = "PaymentProfileIncompleteError";
    this.missingFields = missingFields;
    this.role = role;
  }
}
