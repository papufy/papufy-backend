export type JobStatus = "OPEN" | "CLOSED";
export type ListingType = "JOB_VACANCY" | "PROFESSIONAL_PROFILE";
export type ListingStatus = "OPEN" | "CLOSED" | "IN_PROGRESS";
export type BillingType = "PIX" | "CREDIT_CARD";
export type TransactionStatus =
  | "PENDING"
  | "PAID"
  | "IN_DISPUTE"
  | "RELEASED"
  | "WITHDRAWN"
  | "FAILED"
  | "CANCELED";

/** @deprecated Aceito só em query/body legados — use normalizeListingType */
export type LegacyListingType = "BICO" | "PRODUTO";

export const JobStatusValues = ["OPEN", "CLOSED"] as const;
export const ListingTypeValues = ["JOB_VACANCY", "PROFESSIONAL_PROFILE"] as const;
export const ListingStatusValues = ["OPEN", "CLOSED", "IN_PROGRESS"] as const;
export const BillingTypeValues = ["PIX", "CREDIT_CARD"] as const;
export const TransactionStatusValues = [
  "PENDING",
  "PAID",
  "IN_DISPUTE",
  "RELEASED",
  "WITHDRAWN",
  "FAILED",
  "CANCELED",
] as const;

const LEGACY_TO_LISTING_TYPE: Record<LegacyListingType, ListingType> = {
  BICO: "JOB_VACANCY",
  PRODUTO: "PROFESSIONAL_PROFILE",
};

/** Normaliza tipo de anúncio (aceita aliases BICO/PRODUTO em requests legados). */
export function normalizeListingType(
  value?: string | null
): ListingType | undefined {
  if (!value) return undefined;
  if (value === "JOB_VACANCY" || value === "PROFESSIONAL_PROFILE") {
    return value;
  }
  if (value === "BICO" || value === "PRODUTO") {
    return LEGACY_TO_LISTING_TYPE[value];
  }
  return undefined;
}
