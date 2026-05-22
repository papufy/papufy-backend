export function validatePasswordStrength(senha: string): string | null {
  if (senha.length < 8) {
    return "Senha deve ter ao menos 8 caracteres.";
  }
  if (!/[A-Za-z]/.test(senha)) {
    return "Senha deve conter letras.";
  }
  if (!/\d/.test(senha)) {
    return "Senha deve conter ao menos um número.";
  }
  return null;
}
