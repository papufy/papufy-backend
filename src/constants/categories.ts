/** Categorias para pedidos de serviço (JOB_VACANCY) */
export const JOB_VACANCY_CATEGORIES = [
  "Assistência Técnica",
  "Reformas e Reparos",
  "Serviços Domésticos",
  "Design e Tecnologia",
  "Aulas e Consultoria",
  "Eventos",
] as const;

/** Categorias para perfil profissional (PROFESSIONAL_PROFILE) */
export const PROFESSIONAL_PROFILE_CATEGORIES = [
  "Eletricista",
  "Encanador",
  "Pintor",
  "Diarista",
  "Designer",
  "Professor Particular",
  "Outros Serviços",
] as const;

export type JobVacancyCategory = (typeof JOB_VACANCY_CATEGORIES)[number];
export type ProfessionalProfileCategory =
  (typeof PROFESSIONAL_PROFILE_CATEGORIES)[number];

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
