import { prisma } from "../lib/prisma";
import { publicFileUrl } from "../middleware/upload";

export class UserUploadService {
  async uploadCurriculo(userId: string, filename: string) {
    const url = publicFileUrl(`curriculos/${filename}`);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { curriculoUrl: url },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cidade: true,
        uf: true,
        curriculoUrl: true,
        createdAt: true,
      },
    });
    return { user, url };
  }

  async uploadCertificados(
    userId: string,
    files: { originalname: string; filename: string }[],
    nomes?: string[]
  ) {
    const created = await Promise.all(
      files.map((file, index) =>
        prisma.certificate.create({
          data: {
            userId,
            nome:
              nomes?.[index]?.trim() ||
              file.originalname.replace(/\.[^.]+$/, "") ||
              `Certificado ${index + 1}`,
            arquivoUrl: publicFileUrl(`certificados/${file.filename}`),
          },
        })
      )
    );

    return { certificates: created };
  }

  async listCertificates(userId: string) {
    const certificates = await prisma.certificate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { certificates };
  }
}

export const userUploadService = new UserUploadService();
