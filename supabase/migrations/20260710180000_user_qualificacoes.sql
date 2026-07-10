-- Qualificações do profissional: aptidões e horários disponíveis
ALTER TABLE IF EXISTS "User"
ADD COLUMN IF NOT EXISTS "aptidoes" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS "User"
ADD COLUMN IF NOT EXISTS "horariosDisponiveis" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "User"."aptidoes" IS 'Lista de aptidões/habilidades do usuário (string[])';
COMMENT ON COLUMN "User"."horariosDisponiveis" IS 'Horários semanais: [{diaSemana:0-6,horaInicio,horaFim}]';
