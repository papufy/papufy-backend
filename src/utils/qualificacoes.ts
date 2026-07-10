/** Helpers de validação para qualificações do perfil. */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type HorarioDisponivel = {
  diaSemana: number;
  horaInicio: string;
  horaFim: string;
};

export function normalizeAptidoes(input: unknown): string[] {
  if (!Array.isArray(input)) {
    const error = new Error("Aptidões devem ser uma lista.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  if (input.length > 30) {
    const error = new Error("Máximo de 30 aptidões.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

export function normalizeHorarios(input: unknown): HorarioDisponivel[] {
  if (!Array.isArray(input)) {
    const error = new Error("Horários devem ser uma lista.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  if (input.length > 21) {
    const error = new Error("Máximo de 21 horários (3 por dia).");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const result: HorarioDisponivel[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const diaSemana = Number(item.diaSemana);
    const horaInicio = String(item.horaInicio ?? "");
    const horaFim = String(item.horaFim ?? "");

    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
      const error = new Error("Dia da semana inválido (0=Dom … 6=Sáb).");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    if (!TIME_RE.test(horaInicio) || !TIME_RE.test(horaFim)) {
      const error = new Error("Horário inválido. Use o formato HH:mm.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    if (horaInicio >= horaFim) {
      const error = new Error("Horário de início deve ser antes do fim.");
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    result.push({ diaSemana, horaInicio, horaFim });
  }

  return result.sort(
    (a, b) =>
      a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio)
  );
}

export function parseAptidoes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function parseHorarios(value: unknown): HorarioDisponivel[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is HorarioDisponivel =>
        !!v &&
        typeof v === "object" &&
        typeof (v as HorarioDisponivel).diaSemana === "number" &&
        typeof (v as HorarioDisponivel).horaInicio === "string" &&
        typeof (v as HorarioDisponivel).horaFim === "string"
    )
    .map((v) => ({
      diaSemana: v.diaSemana,
      horaInicio: v.horaInicio,
      horaFim: v.horaFim,
    }));
}
