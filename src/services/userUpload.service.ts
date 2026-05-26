import { assertNoError, newId, supabase } from "../lib/db";
import { publicFileUrl } from "../middleware/upload";

const USER_PUBLIC_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, createdAt";

export class UserUploadService {
  async uploadCurriculo(userId: string, filename: string) {
    const url = publicFileUrl(`curriculos/${filename}`);
    const user = assertNoError(
      await supabase
        .from("User")
        .update({ curriculoUrl: url, updatedAt: new Date().toISOString() })
        .eq("id", userId)
        .select(USER_PUBLIC_SELECT)
        .single()
    );
    return { user, url };
  }

  async uploadCertificados(
    userId: string,
    files: { originalname: string; filename: string }[],
    nomes?: string[]
  ) {
    const rows = files.map((file, index) => ({
      id: newId(),
      userId,
      nome:
        nomes?.[index]?.trim() ||
        file.originalname.replace(/\.[^.]+$/, "") ||
        `Certificado ${index + 1}`,
      arquivoUrl: publicFileUrl(`certificados/${file.filename}`),
    }));

    const created = assertNoError(
      await supabase.from("Certificate").insert(rows).select()
    );

    return { certificates: created };
  }

  async listCertificates(userId: string) {
    const certificates = assertNoError(
      await supabase
        .from("Certificate")
        .select("*")
        .eq("userId", userId)
        .order("createdAt", { ascending: false })
    );

    return { certificates };
  }
}

export const userUploadService = new UserUploadService();
