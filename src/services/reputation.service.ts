import { assertNoError, newId, supabase } from "../lib/db";
import { archiveListingAfterReview } from "./listingArchive.service";
import { sanitizeText } from "../utils/sanitize";
import { forbidden, badRequest } from "../utils/errors";

export interface UserReputation {
  averageRating: number | null;
  reviewCount: number;
  completedJobsCount: number;
}

const COMPLETED_STATUSES = ["RELEASED", "WITHDRAWN"] as const;

export interface TransactionReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewedUserId: string;
}

export class ReputationService {
  async getReviewByTransaction(
    transactionId: string,
    userId: string
  ): Promise<TransactionReview | null> {
    const transaction = assertNoError<{
      contractorId: string;
      professionalId: string;
    }>(
      await supabase
        .from("Transaction")
        .select("contractorId, professionalId")
        .eq("id", transactionId)
        .maybeSingle(),
      "Pagamento não encontrado."
    );

    if (
      transaction.contractorId !== userId &&
      transaction.professionalId !== userId
    ) {
      throw forbidden("Sem permissão para ver esta avaliação.");
    }

    const { data: review, error } = await supabase
      .from("Review")
      .select("id, rating, comment, createdAt, reviewedUserId")
      .eq("transactionId", transactionId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return review ?? null;
  }

  async getForUser(userId: string): Promise<UserReputation> {
    const empty: UserReputation = {
      averageRating: null,
      reviewCount: 0,
      completedJobsCount: 0,
    };

    try {
      const { count: completedJobsCount, error: txError } = await supabase
        .from("Transaction")
        .select("id", { count: "exact", head: true })
        .eq("professionalId", userId)
        .in("status", [...COMPLETED_STATUSES]);

      if (txError) {
        console.error("[reputation] transactions:", txError.message);
        return empty;
      }

      const { data: reviews, error: reviewError } = await supabase
        .from("Review")
        .select("rating")
        .eq("reviewedUserId", userId);

      if (reviewError) {
        console.error("[reputation] reviews:", reviewError.message);
        return {
          ...empty,
          completedJobsCount: completedJobsCount ?? 0,
        };
      }

      const reviewCount = reviews?.length ?? 0;
      const averageRating =
        reviewCount > 0
          ? Math.round(
              ((reviews ?? []).reduce((sum, row) => sum + row.rating, 0) /
                reviewCount) *
                10
            ) / 10
          : null;

      return {
        averageRating,
        reviewCount,
        completedJobsCount: completedJobsCount ?? 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[reputation] getForUser:", message);
      return empty;
    }
  }

  async createReview(
    reviewerId: string,
    input: { transactionId: string; rating: number; comment?: string }
  ) {
    const transaction = assertNoError<{
      id: string;
      listingId: string;
      contractorId: string;
      professionalId: string;
      status: string;
    }>(
      await supabase
        .from("Transaction")
        .select("id, listingId, contractorId, professionalId, status")
        .eq("id", input.transactionId)
        .maybeSingle(),
      "Pagamento não encontrado."
    );

    if (transaction.contractorId !== reviewerId) {
      throw forbidden("Somente quem contratou pode avaliar este serviço.");
    }

    if (!COMPLETED_STATUSES.includes(transaction.status as (typeof COMPLETED_STATUSES)[number])) {
      throw badRequest(
        "A avaliação só pode ser feita após a conclusão do trabalho."
      );
    }

    const { data: existing } = await supabase
      .from("Review")
      .select("id")
      .eq("transactionId", input.transactionId)
      .maybeSingle();

    if (existing) {
      throw badRequest("Este trabalho já foi avaliado.");
    }

    const review = assertNoError(
      await supabase
        .from("Review")
        .insert({
          id: newId(),
          transactionId: input.transactionId,
          reviewerId,
          reviewedUserId: transaction.professionalId,
          rating: input.rating,
          comment: input.comment
            ? sanitizeText(input.comment, 500)
            : null,
        })
        .select("id, rating, comment, createdAt, reviewedUserId")
        .single()
    );

    const reputation = await this.getForUser(transaction.professionalId);

    let listingArchived = false;
    try {
      await archiveListingAfterReview(transaction.listingId);
      listingArchived = true;
    } catch {
      /* avaliação salva; arquivamento pode ser refeito manualmente */
    }

    return { review, reputation, listingArchived };
  }
}

export const reputationService = new ReputationService();
