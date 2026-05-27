export type JobStatus = "OPEN" | "CLOSED";
export type ListingType = "BICO" | "PRODUTO";
export type ListingStatus = "OPEN" | "CLOSED" | "IN_PROGRESS";
export type BillingType = "PIX" | "CREDIT_CARD";
export type TransactionStatus =
  | "PENDING"
  | "PAID"
  | "IN_DISPUTE"
  | "FAILED"
  | "CANCELED";

export type ApiListingType = "JOB_VACANCY" | "PROFESSIONAL_PROFILE";

export const JobStatusValues = ["OPEN", "CLOSED"] as const;
export const ListingTypeValues = ["BICO", "PRODUTO"] as const;
export const ListingStatusValues = ["OPEN", "CLOSED", "IN_PROGRESS"] as const;
export const BillingTypeValues = ["PIX", "CREDIT_CARD"] as const;
export const TransactionStatusValues = [
  "PENDING",
  "PAID",
  "IN_DISPUTE",
  "FAILED",
  "CANCELED",
] as const;

export function apiListingTypeToDbTipo(
  listingType?: ApiListingType
): ListingType | undefined {
  if (listingType === "JOB_VACANCY") return "BICO";
  if (listingType === "PROFESSIONAL_PROFILE") return "PRODUTO";
  return undefined;
}
