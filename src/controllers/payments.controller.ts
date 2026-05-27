import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { paymentsService } from "../services/payments.service";
import { BillingTypeValues } from "../types/enums";
import { badRequest } from "../utils/errors";

const onboardingSchema = z.object({
  name: z.string().min(3),
  cpfCnpj: z.string().min(11),
  email: z.string().email(),
  mobilePhone: z.string().min(8),
  incomeValue: z.coerce.number().positive().optional(),
  address: z.string().optional(),
  addressNumber: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
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

const checkoutSchema = z
  .object({
    listingId: z.string().uuid(),
    billingType: z.enum(BillingTypeValues),
    creditCard: creditCardSchema.optional(),
    creditCardHolderInfo: creditCardHolderSchema.optional(),
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

const withdrawSchema = z.object({
  pixKey: z.string().min(3).max(120),
});

function assertPaymentsEnabled(): void {
  if (!env.paymentsEnabled) {
    throw badRequest(
      "Pagamentos não configurados. Defina ASAAS_API_URL e ASAAS_API_KEY no Render."
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

  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      if (env.ASAAS_WEBHOOK_TOKEN) {
        const token = req.headers["asaas-access-token"]?.toString();
        if (token !== env.ASAAS_WEBHOOK_TOKEN) {
          res.status(401).json({ error: "Webhook não autorizado." });
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

  async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      assertPaymentsEnabled();
      const transactionId = String(req.params.id);
      const { pixKey } = withdrawSchema.parse(req.body);
      const result = await paymentsService.withdrawViaPix({
        transactionId,
        professionalId: req.userId!,
        pixKey,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const paymentsController = new PaymentsController();
