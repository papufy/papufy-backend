export type ChatMessageType = "TEXT" | "PROPOSAL" | "SYSTEM" | "IMAGE";

const PROPOSAL_PREFIX = "[[PROPOSAL:";

export function encodeProposalContent(value: number, display: string): string {
  return `${PROPOSAL_PREFIX}${value}]] ${display}`;
}

export function isProposalSchemaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("proposalvalue") ||
    (lower.includes('"type"') && lower.includes("column")) ||
    (lower.includes("column") && lower.includes("type") && lower.includes("does not exist"))
  );
}

export function parseProposalFields(row: {
  content: string;
  type?: string | null;
  proposalValue?: number | null;
  imageUrl?: string | null;
}): {
  type: ChatMessageType;
  proposalValue: number | null;
  content: string;
  imageUrl: string | null;
} {
  if (row.type === "IMAGE") {
    return {
      type: "IMAGE",
      proposalValue: null,
      content: row.content?.trim() || "Imagem",
      imageUrl: row.imageUrl ?? null,
    };
  }

  if (row.type === "PROPOSAL" || row.proposalValue != null) {
    return {
      type: "PROPOSAL",
      proposalValue: row.proposalValue ?? null,
      content: row.content,
      imageUrl: null,
    };
  }

  const match = row.content.match(/^\[\[PROPOSAL:([\d.]+)\]\]\s*([\s\S]*)$/);
  if (match) {
    const parsed = Number.parseFloat(match[1]);
    const body = match[2]?.trim();
    return {
      type: "PROPOSAL",
      proposalValue: Number.isFinite(parsed) ? parsed : null,
      content: body || row.content,
      imageUrl: null,
    };
  }

  return {
    type: (row.type as ChatMessageType) ?? "TEXT",
    proposalValue: row.proposalValue ?? null,
    content: row.content,
    imageUrl: null,
  };
}
