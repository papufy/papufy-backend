/** Data civil em America/Sao_Paulo (YYYY-MM-DD). Brasil sem DST desde 2019. */
export function getBrazilYmd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addBrazilDays(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00.000-03:00`);
  base.setTime(base.getTime() + days * 86_400_000);
  return getBrazilYmd(base);
}

/** Início e fim do dia civil em SP, em ISO UTC. */
export function brazilDayBoundsIso(ymd: string): { start: string; end: string } {
  const start = new Date(`${ymd}T00:00:00.000-03:00`);
  const end = new Date(`${ymd}T23:59:59.999-03:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}
