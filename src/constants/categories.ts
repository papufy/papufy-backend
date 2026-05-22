export const BICO_CATEGORIES = [
  "Assistência Técnica",
  "Reformas e Reparos",
  "Serviços Domésticos",
  "Design e Tecnologia",
  "Aulas e Consultoria",
  "Eventos",
] as const;

export const PRODUCT_CATEGORIES = [
  "Eletrônicos",
  "Móveis e Decoração",
  "Veículos",
  "Moda e Beleza",
  "Esportes",
  "Casa e Jardim",
  "Outros",
] as const;

/** @deprecated use BICO_CATEGORIES */
export const JOB_CATEGORIES = BICO_CATEGORIES;

export type BicoCategory = (typeof BICO_CATEGORIES)[number];
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type JobCategory = BicoCategory;

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
