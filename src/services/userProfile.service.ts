import { assertNoError, supabase } from "../lib/db";
import { listingsService } from "./listings.service";
import { reputationService } from "./reputation.service";

export class UserProfileService {
  async getPublicProfile(userId: string) {
    const user = assertNoError(
      await supabase
        .from("User")
        .select("id, nome, cidade, uf, email, telefone, createdAt, updatedAt")
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
      },
      reputation,
      listings,
      totalListings: total,
    };
  }
}

export const userProfileService = new UserProfileService();
