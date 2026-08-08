import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { paymentsService } from "../services/payments.service";
import { BillingTypeValues } from "../types/enums";
import { badRequest } from "../utils/errors";

const bankAccountSchema = z.object({
  holderName: z.string().min(3),
  holderType: z.enum(["individual", "company"]).default("individual"),
  holderDocument: z.string().min(11),
  bank: z.string().min(1),
  branchNumber: z.string().min(1),
  branchCheckDigit: z.string().optional(),
  accountNumber: z.string().min(1),
  accountCheckDigit: z.string().min(1),
  type: z.enum(["checking", "savings"]).default("checking"),
});

const recipientAddressSchema = z.object({
  street: z.string().min(2),
  streetNumber: z.string().min(1),
  complementary: z.string().optional(),
  neighborhood: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2).max(2),
  zipCode: z.string().min(8),
  referencePoint: z.string().optional(),
});

const onboardingSchema = z.object({
  name: z.string().min(3),
  cpfCnpj: z.string().min(11),
  email: z.string().email(),
  mobilePhone: z.string().min(8),
  dataNascimento: z.string().min(8),
  motherName: z.string().min(3).optional(),
  professionalOccupation: z.string().min(2).optional(),
  incomeValue: z.coerce.number().positive().optional(),
  bankAccount: bankAccountSchema,
  recipientAddress: recipientAddressSchema,
});

const creditCardSchema = z.object({
  holderName: z.string().min(3),
  number: z.string().min(13),
  expiryMonth: z.string().min(1).max(2),
  expiryYear: z.string().min(2).max(4),
  ccv: z.string().min(3).max(4),
});

const creditCardHolderSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  cpfCnpj: z.string().min(11),
  postalCode: z.string().min(8),
  addressNumber: z.string().min(1),
  phone: z.string().min(8),
});

const payerProfileSchema = z.object({
  cpfCnpj: z.string().min(11).optional(),
  telefone: z.string().min(8).optional(),
});

const checkoutSchema = z
  .object({
    listingId: z.string().uuid(),
    billingType: z.enum(BillingTypeValues),
    creditCard: creditCardSchema.optional(),
    creditCardHolderInfo: creditCardHolderSchema.optional(),
    payerProfile: payerProfileSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billingType !== "CREDIT_CARD") return;
    if (!data.creditCard) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dados do cartão são obrigatórios.",
        path: ["creditCard"],
      });
    }
    if (!data.creditCardHolderInfo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dados do titular são obrigatórios.",
        path: ["creditCardHolderInfo"],
      });
    }
  });

const proposalCheckoutSchema = z
  .object({
    billingType: z.enum(BillingTypeValues),
    creditCard: creditCardSchema.optional(),
    creditCardHolderInfo: creditCardHolderSchema.optional(),
    payerProfile: payerProfileSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.billingType !== "CREDIT_CARD") return;
    if (!data.creditCard) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dados do cartão são obrigatórios.",
        path: ["creditCard"],
      });
    }
    if (!data.creditCardHolderInfo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dados do titular são obrigatórios.",
        path: ["creditCardHolderInfo"],
      });
    }
  });

const reportSchema = z.object({
  descricao: z.string().min(10).max(2000),
});

const subaccountWithdrawSchema = z.object({
  value: z.coerce.number().positive(),
  /** Opcional — saque vai para a conta bancária cadastrada no recipient */
  pixAddressKey: z.string().min(3).max(120).optional(),
});

function assertPaymentsEnabled(): void {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos temporariamente indisponíveis. Tente novamente em instantes."
    );
  }
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? "127.0.0.1";
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(",")[0]?.trim() ?? "127.0.0.1";
  }
  return req.socket.remoteAddress ?? "127.0.0.1";
}

export class PaymentsController {
  async onboardRecipient(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const body = onboardingSchema.parse(req.body);
      const result = await paymentsService.createRecipientAccount(
        req.userId!,
        body
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async checkout(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const body = checkoutSchema.parse(req.body);
      const result = await paymentsService.createCheckout(req.userId!, {
        ...body,
        remoteIp: resolveClientIp(req),
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async checkoutFromProposal(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const messageId = String(req.params.messageId);
      const body = proposalCheckoutSchema.parse(req.body);
      const result = await paymentsService.createCheckoutFromProposal(
        req.userId!,
        messageId,
        { ...body, remoteIp: resolveClientIp(req) }
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async transactionStatus(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const id = String(req.params.id);
      const tx = await paymentsService.getTransactionStatus(id, req.userId!);
      res.json({ transaction: tx });
    } catch (err) {
      next(err);
    }
  }

  async listMyTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const data = await paymentsService.listMyTransactions(req.userId!);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  async walletSummary(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const summary = await paymentsService.getWalletSummary(req.userId!);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }

  async subaccountBalance(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const result = await paymentsService.getSubaccountBalance(req.userId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async subaccountWithdraw(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const body = subaccountWithdrawSchema.parse(req.body);
      const result = await paymentsService.requestSubaccountWithdraw(
        req.userId!,
        body
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();

      // Pagar.me: header opcional (configure no dashboard + PAGARME_WEBHOOK_SECRET)
      const pagarmeSecret = env.PAGARME_WEBHOOK_SECRET?.trim();
      if (pagarmeSecret) {
        const auth =
          req.headers["authorization"]?.toString() ||
          req.headers["x-hub-signature"]?.toString() ||
          req.headers["x-pagarme-signature"]?.toString();
        // Se o payload parece Pagar.me e o secret está setado, exige match simples
        const looksPagarme =
          typeof req.body?.type === "string" &&
          (req.body.type.startsWith("charge.") ||
            req.body.type.startsWith("order."));
        if (looksPagarme && auth && !auth.includes(pagarmeSecret)) {
          res.status(401).json({ error: "Webhook Pagar.me não autorizado." });
          return;
        }
      }

      const result = await paymentsService.handleWebhook(req.body ?? {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async reportProblem(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const transactionId = String(req.params.id);
      const { descricao } = reportSchema.parse(req.body);
      const file = req.file;
      const result = await paymentsService.reportTransactionProblem({
        transactionId,
        reporterId: req.userId!,
        descricao,
        comprovanteFilename: file?.filename,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async confirmCompletion(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const transactionId = String(req.params.id);
      const result = await paymentsService.confirmCompletion(
        transactionId,
        req.userId!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async renewListing(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const listingId = String(req.params.id);
      const body = z
        .object({ payerProfile: payerProfileSchema.optional() })
        .parse(req.body ?? {});
      const result = await paymentsService.createListingRenewal(
        req.userId!,
        listingId,
        body.payerProfile
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listingRenewalStatus(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const renewalId = String(req.params.id);
      const result = await paymentsService.getListingRenewalStatus(
        renewalId,
        req.userId!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

}

export const paymentsController = new PaymentsController();
