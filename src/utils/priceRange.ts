/** Normaliza preço fixo ou faixa de negociação. */

export type PriceFields = {
  preco: number | null;
  precoMin: number | null;
  precoMax: number | null;
  aCombinar: boolean;
};

function badRequest(message: string): never {
  const error = new Error(message);
  (error as Error & { statusCode: number }).statusCode = 400;
  throw error;
}

export function resolvePriceFields(input: {
  aCombinar?: boolean;
  preco?: number | null;
  precoMin?: number | null;
  precoMax?: number | null;
}): PriceFields {
  if (input.aCombinar) {
    return {
      preco: null,
      precoMin: null,
      precoMax: null,
      aCombinar: true,
    };
  }

  const min =
    input.precoMin != null && Number.isFinite(input.precoMin)
      ? Number(input.precoMin)
      : null;
  const max =
    input.precoMax != null && Number.isFinite(input.precoMax)
      ? Number(input.precoMax)
      : null;
  const fixed =
    input.preco != null && Number.isFinite(input.preco)
      ? Number(input.preco)
      : null;

  // Faixa explícita
  if (min != null || max != null) {
    const lo = min ?? max!;
    const hi = max ?? min!;
    if (lo <= 0 || hi <= 0) {
      badRequest("Informe valores maiores que zero.");
    }
    if (lo > hi) {
      badRequest("O valor mínimo não pode ser maior que o máximo.");
    }
    const isRange = lo !== hi;
    return {
      preco: isRange ? null : lo,
      precoMin: lo,
      precoMax: hi,
      aCombinar: false,
    };
  }

  // Preço fixo legado
  if (fixed != null && fixed > 0) {
    return {
      preco: fixed,
      precoMin: fixed,
      precoMax: fixed,
      aCombinar: false,
    };
  }

  // Sem valor informado (compatível com anúncios antigos)
  return {
    preco: null,
    precoMin: null,
    precoMax: null,
    aCombinar: false,
  };
}
