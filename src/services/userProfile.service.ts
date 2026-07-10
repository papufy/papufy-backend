import { assertNoError, supabase } from "../lib/db";
import { parseAptidoes, parseHorarios } from "../utils/qualificacoes";
import { listingsService } from "./listings.service";
import { reputationService } from "./reputation.service";

type PublicUserRow = {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  email: string;
  telefone: string;
  createdAt: string;
  updatedAt: string;
  aptidoes: unknown;
  horariosDisponiveis: unknown;
  curriculoUrl: string | null;
};

export class UserProfileService {
  async getPublicProfile(userId: string) {
    const user = assertNoError<PublicUserRow>(
      await supabase
        .from("User")
        .select(
          "id, nome, cidade, uf, email, telefone, createdAt, updatedAt, aptidoes, horariosDisponiveis, curriculoUrl"
        )
        .eq("id", userId)
        .maybeSingle(),
      "Usuário não encontrado."
    );

    let reputation = {
      averageRating: null as number | null,
      reviewCount: 0,
      completedJobsCount: 0,
    };
    try {
      reputation = await reputationService.getForUser(userId);
    } catch {
      /* reputação opcional */
    }

    const { listings, total } = await listingsService.listPublicByUser(userId, {
      limit: 12,
    });

    const { data: certificates } = await supabase
      .from("Certificate")
      .select("id, nome, arquivoUrl, createdAt")
      .eq("userId", userId)
      .order("createdAt", { ascending: false })
      .limit(20);

    return {
      user: {
        id: user.id,
        nome: user.nome,
        cidade: user.cidade,
        uf: user.uf,
        memberSince: user.createdAt,
        lastSeenAt: user.updatedAt,
        verifiedEmail: Boolean(user.email),
        verifiedPhone: Boolean(user.telefone),
        aptidoes: parseAptidoes(user.aptidoes),
        horariosDisponiveis: parseHorarios(user.horariosDisponiveis),
        hasCurriculo: Boolean(user.curriculoUrl),
      },
      certificates: certificates ?? [],
      reputation,
      listings,
      totalListings: total,
    };
  }
}

export const userProfileService = new UserProfileService();
