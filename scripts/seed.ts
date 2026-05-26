import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import type { ListingType } from "../src/types/enums";
import { assertNoError, newId, supabase } from "../src/lib/db";

dotenv.config();

const BICO_CATEGORIES = [
  "Assistência Técnica",
  "Reformas e Reparos",
  "Serviços Domésticos",
  "Design e Tecnologia",
  "Aulas e Consultoria",
  "Eventos",
] as const;

const PRODUCT_CATEGORIES = [
  "Eletrônicos",
  "Móveis e Decoração",
  "Veículos",
  "Moda e Beleza",
  "Esportes",
  "Casa e Jardim",
  "Outros",
] as const;

async function upsertUserByEmail(data: {
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
}) {
  const { data: existing } = await supabase
    .from("User")
    .select("id")
    .eq("email", data.email)
    .maybeSingle();

  if (existing) {
    return assertNoError(
      await supabase.from("User").select("*").eq("id", existing.id).single()
    );
  }

  return assertNoError(
    await supabase
      .from("User")
      .insert({
        id: newId(),
        nome: data.nome,
        email: data.email,
        senha: data.senha,
        telefone: data.telefone ?? null,
        cidade: data.cidade ?? null,
        uf: data.uf ?? null,
      })
      .select("*")
      .single()
  );
}

async function clearTable(table: "ListingImage" | "Listing" | "Certificate" | "Job") {
  const { error } = await supabase.from(table).delete().neq("id", "");
  if (error) throw error;
}

async function main() {
  const senhaHash = await bcrypt.hash("Senha123", 12);

  const contratante = await upsertUserByEmail({
    nome: "Maria Silva",
    email: "maria@papufy.com",
    senha: senhaHash,
    telefone: "(83) 99999-1111",
    cidade: "Campina Grande",
    uf: "PB",
  });

  const prestador = await upsertUserByEmail({
    nome: "João Encanador",
    email: "joao@papufy.com",
    senha: senhaHash,
    telefone: "(83) 98888-2222",
    cidade: "Campina Grande",
    uf: "PB",
  });

  await clearTable("ListingImage");
  await clearTable("Listing");
  await clearTable("Certificate");
  await clearTable("Job");

  const samples = [
    {
      titulo: "Preciso de encanador para vazamento na cozinha",
      descricao:
        "Vazamento embaixo da pia da cozinha. Preciso de alguém com experiência para avaliar e consertar ainda hoje, se possível.",
      preco: 150,
      aCombinar: false,
      categoria: BICO_CATEGORIES[1],
      cep: "58400-000",
      cidade: "Campina Grande",
      bairro: "Centro",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Pintura de quarto 12m²",
      descricao:
        "Quarto com parede manchada. Cor desejada: branco neve. Material por conta do profissional.",
      preco: null,
      aCombinar: true,
      categoria: BICO_CATEGORIES[1],
      cep: "58410-100",
      cidade: "Campina Grande",
      bairro: "Malvinas",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Limpeza pesada pós-obra apartamento",
      descricao:
        "Apartamento 2 quartos após pequena reforma. Remoção de pó, vidros e banheiro completo.",
      preco: 280,
      aCombinar: false,
      categoria: BICO_CATEGORIES[2],
      cidade: "João Pessoa",
      bairro: "Manaíra",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Logo + identidade visual para food truck",
      descricao:
        "Marca nova de hamburguer artesanal. Preciso de logo, paleta e aplicação simples no cardápio.",
      preco: 800,
      aCombinar: false,
      categoria: BICO_CATEGORIES[3],
      cidade: "Recife",
      bairro: "Boa Viagem",
      uf: "PE",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Aulas de Excel para pequenos negócios",
      descricao:
        "2 encontros de 2h. Foco em planilhas financeiras e dashboards básicos.",
      preco: null,
      aCombinar: true,
      categoria: BICO_CATEGORIES[4],
      cidade: "Campina Grande",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Garçom e copeira para festa de 50 pessoas",
      descricao:
        "Evento sábado à noite em salão fechado. Uniforme preto. Experiência com buffet.",
      preco: 600,
      aCombinar: false,
      categoria: BICO_CATEGORIES[5],
      cidade: "Campina Grande",
      bairro: "Catolé",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
    {
      titulo: "Conserto de notebook que não liga",
      descricao:
        "Dell Inspiron 15, parou após queda de energia. LED de carga acende mas não inicia.",
      preco: 120,
      aCombinar: false,
      categoria: BICO_CATEGORIES[0],
      cidade: "Campina Grande",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
    },
  ];

  for (const job of samples) {
    assertNoError(
      await supabase.from("Job").insert({
        id: newId(),
        ...job,
        status: "OPEN",
      })
    );
  }

  const listingSamples: Array<{
    tipo: ListingType;
    titulo: string;
    descricao: string;
    preco: number | null;
    aCombinar: boolean;
    categoria: string;
    cidade: string;
    bairro?: string;
    uf: string;
    telefone: string;
    userId: string;
    placeholder: string;
  }> = [
    {
      tipo: "BICO",
      titulo: "Eletricista residencial urgente",
      descricao: "Curto-circuito no quadro. Atendimento hoje se possível.",
      preco: 200,
      aCombinar: false,
      categoria: BICO_CATEGORIES[0],
      cidade: "Campina Grande",
      bairro: "Centro",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
      placeholder: "bico-eletrica",
    },
    {
      tipo: "BICO",
      titulo: "Montagem de móveis planejados",
      descricao: "Cozinha completa, 8 módulos. Ferramentas do profissional.",
      preco: null,
      aCombinar: true,
      categoria: BICO_CATEGORIES[1],
      cidade: "Campina Grande",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
      placeholder: "bico-moveis",
    },
    {
      tipo: "PRODUTO",
      titulo: "iPhone 13 128GB seminovo",
      descricao: "Bateria 87%, sem trincas, com caixa e cabo original.",
      preco: 2800,
      aCombinar: false,
      categoria: PRODUCT_CATEGORIES[0],
      cidade: "Campina Grande",
      uf: "PB",
      telefone: "(83) 98888-2222",
      userId: prestador.id,
      placeholder: "prod-iphone",
    },
    {
      tipo: "PRODUTO",
      titulo: "Sofá retrátil 3 lugares cinza",
      descricao: "Usado 1 ano, excelente estado. Retirada no bairro Universitário.",
      preco: 950,
      aCombinar: false,
      categoria: PRODUCT_CATEGORIES[1],
      cidade: "Campina Grande",
      bairro: "Universitário",
      uf: "PB",
      telefone: "(83) 98888-2222",
      userId: prestador.id,
      placeholder: "prod-sofa",
    },
    {
      tipo: "PRODUTO",
      titulo: "Bicicleta MTB aro 29",
      descricao: "Marchas Shimano, freio a disco. Pequeno risco no guidão.",
      preco: 1200,
      aCombinar: true,
      categoria: PRODUCT_CATEGORIES[4],
      cidade: "João Pessoa",
      uf: "PB",
      telefone: "(83) 98888-2222",
      userId: prestador.id,
      placeholder: "prod-bike",
    },
    {
      tipo: "PRODUTO",
      titulo: "Geladeira Consul 342L frost free",
      descricao: "Funcionando perfeitamente. Troca por mudança.",
      preco: 1500,
      aCombinar: false,
      categoria: PRODUCT_CATEGORIES[5],
      cidade: "Campina Grande",
      uf: "PB",
      telefone: "(83) 99999-1111",
      userId: contratante.id,
      placeholder: "prod-geladeira",
    },
  ];

  for (const item of listingSamples) {
    const listingId = newId();
    assertNoError(
      await supabase.from("Listing").insert({
        id: listingId,
        tipo: item.tipo,
        titulo: item.titulo,
        descricao: item.descricao,
        preco: item.preco,
        aCombinar: item.aCombinar,
        categoria: item.categoria,
        cidade: item.cidade,
        bairro: item.bairro ?? null,
        uf: item.uf,
        telefone: item.telefone,
        userId: item.userId,
      })
    );

    assertNoError(
      await supabase.from("ListingImage").insert({
        id: newId(),
        listingId,
        url: `placeholders/${item.placeholder}.jpg`,
        ordem: 0,
      })
    );
  }

  console.log("Seed concluído:", {
    contratante: contratante.email,
    prestador: prestador.email,
    jobs: samples.length,
    listings: listingSamples.length,
    senhaDemo: "Senha123",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
