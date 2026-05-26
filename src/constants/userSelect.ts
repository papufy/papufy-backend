/** Campos de User expostos em req.user (sem senha). */
export const authUserSelect = {
  id: true,
  nome: true,
  email: true,
  cpfCnpj: true,
  telefone: true,
  cidade: true,
  uf: true,
  asaasCustomerId: true,
  asaasWalletId: true,
  curriculoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;
