export const BICO_CATEGORIES = [
  "Assistência Técnica",
  "Reformas e Reparos",
  "Serviços Domésticos",
  "Design e Tecnologia",
  "Aulas e Consultoria",
  "Eventos",
] as const;

export const PROFESSIONAL_CATEGORIES = [
  "Eletricista",
  "Encanador",
  "Pintor",
  "Diarista",
  "Designer",
  "Professor Particular",
  "Outros Serviços",
] as const;

/** Alias legado usado em listagens tipo PRODUTO */
export const PRODUCT_CATEGORIES = PROFESSIONAL_CATEGORIES;

/** @deprecated use BICO_CATEGORIES */
export const JOB_CATEGORIES = BICO_CATEGORIES;

export type WorkCategory = (typeof BICO_CATEGORIES)[number];
export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number];
export type JobCategory = WorkCategory;

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
