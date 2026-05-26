export type JobStatus = "OPEN" | "CLOSED";
export type ListingType = "BICO" | "PRODUTO";
export type ListingStatus = "OPEN" | "CLOSED";

export const JobStatusValues = ["OPEN", "CLOSED"] as const;
export const ListingTypeValues = ["BICO", "PRODUTO"] as const;
export const ListingStatusValues = ["OPEN", "CLOSED"] as const;
