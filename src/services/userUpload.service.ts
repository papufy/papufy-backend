import { assertNoError, newId, supabase } from "../lib/db";
import { uploadUserFile } from "./userFileStorage.service";

const USER_PUBLIC_SELECT =
  "id, nome, email, telefone, cidade, uf, curriculoUrl, fotoUrl, aptidoes, horariosDisponiveis, createdAt";

export class UserUploadService {
  async uploadFoto(userId: string, file: Express.Multer.File) {
    const url = await uploadUserFile("avatars", file, userId);
    const user = assertNoError(
      await supabase
        .from("User")
        .update({ fotoUrl: url, updatedAt: new Date().toISOString() })
        .eq("id", userId)
        .select(USER_PUBLIC_SELECT)
        .single()
    );
    return { user, url };
  }

  async removeFoto(userId: string) {
    const user = assertNoError(
      await supabase
        .from("User")
        .update({ fotoUrl: null, updatedAt: new Date().toISOString() })
        .eq("id", userId)
        .select(USER_PUBLIC_SELECT)
        .single()
    );
    return { user };
  }

  async uploadCurriculo(userId: string, file: Express.Multer.File) {
    const url = await uploadUserFile("curriculos", file, userId);
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
    files: Express.Multer.File[],
    nomes?: string[]
  ) {
    const rows = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const arquivoUrl = await uploadUserFile("certificados", file, userId);
      rows.push({
        id: newId(),
        userId,
        nome:
          nomes?.[index]?.trim() ||
          file.originalname.replace(/\.[^.]+$/, "") ||
          `Certificado ${index + 1}`,
        arquivoUrl,
      });
    }

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
