import { prisma } from "@/lib/db";
import { brl, competenciaBr, dataBr, diasEmAtraso } from "@/lib/format";
import { calcularEncargosAtraso } from "@/lib/financeiro";
import type { PerfilConversa } from "@prisma/client";

// A geração de respostas fica em lib/agentes.ts (executarAgente) — aqui ficam
// o contexto do cliente e o fallback local sem chave de API.

// Papéis de uma pessoa na carteira: a mesma pessoa pode ser inquilina de um
// imóvel E proprietária de outro. Base para o sistema "entender quem é quem".
export type PapeisPessoa = {
  ehInquilino: boolean;
  ehProprietario: boolean;
  contratosAtivos: number;
  imoveis: number;
  papelPrincipal: PerfilConversa; // usado como perfil da conversa
};

export async function papeisDaPessoa(pessoaId: number): Promise<PapeisPessoa> {
  const [contratosAtivos, imoveis] = await Promise.all([
    prisma.contrato.count({ where: { inquilinoId: pessoaId, status: "ATIVO" } }),
    prisma.imovel.count({ where: { proprietarioId: pessoaId } }),
  ]);
  return {
    ehInquilino: contratosAtivos > 0,
    ehProprietario: imoveis > 0,
    contratosAtivos,
    imoveis,
    // Inquilino ativo tem prioridade (assuntos de fatura são mais frequentes);
    // se só possui imóveis, é proprietário.
    papelPrincipal: contratosAtivos > 0 ? "LOCATARIO" : "PROPRIETARIO",
  };
}

// Monta o contexto real do cliente a partir do banco do ERP.
// A IA responde APENAS com base nesses dados — nunca inventa valores.
// Mostra os DOIS lados quando a pessoa é inquilina e proprietária ao mesmo tempo.
export async function montarContexto(pessoaId: number, perfil: PerfilConversa): Promise<string> {
  const pessoa = await prisma.pessoa.findUniqueOrThrow({ where: { id: pessoaId } });
  const papeis = await papeisDaPessoa(pessoaId);
  const rotulo = [papeis.ehInquilino ? "locatário" : null, papeis.ehProprietario ? "proprietário" : null]
    .filter(Boolean)
    .join(" e ") || (perfil === "LOCATARIO" ? "locatário" : "proprietário");
  const linhas: string[] = [`Cliente: ${pessoa.nome} — papel na carteira: ${rotulo}.`];

  if (papeis.ehInquilino) {
    linhas.push("\n== Como LOCATÁRIO ==");
    const contratos = await prisma.contrato.findMany({
      where: { inquilinoId: pessoaId, status: "ATIVO" },
      include: {
        imovel: true,
        faturas: { orderBy: { vencimento: "desc" }, take: 6 },
        reajustes: { orderBy: { data: "desc" }, take: 1 },
      },
    });
    if (contratos.length === 0) linhas.push("Nenhum contrato ativo encontrado.");
    for (const ct of contratos) {
      linhas.push(
        `\nContrato ${ct.codigo} — ${ct.imovel.tipo} em ${ct.imovel.endereco} (${ct.imovel.codigo})`,
        `Aluguel: ${brl(ct.valorAluguel)}/mês, vencimento todo dia ${ct.diaVencimento}, vigência até ${dataBr(ct.fim)}, índice de reajuste ${ct.indiceReajuste}, garantia: ${ct.garantia ?? "não informada"}.`
      );
      for (const f of ct.faturas) {
        if (f.status === "PAGA") {
          linhas.push(`Fatura ${competenciaBr(f.competencia)}: PAGA em ${dataBr(f.pagaEm)} (${brl(f.valorPago)}, via ${f.formaPagamento}).`);
        } else {
          const atraso = diasEmAtraso(f.vencimento);
          const { multa, juros } = calcularEncargosAtraso(f.valorTotal, atraso);
          linhas.push(
            `Fatura ${competenciaBr(f.competencia)}: ${f.status} — vencimento ${dataBr(f.vencimento)}, valor ${brl(f.valorTotal)}` +
              (atraso > 0 ? ` (${atraso} dias de atraso; com multa e juros: ${brl(f.valorTotal.plus(multa).plus(juros))})` : "") +
              ". Pagável por PIX, boleto ou cartão."
          );
        }
      }
    }
  }

  if (papeis.ehProprietario) {
    linhas.push("\n== Como PROPRIETÁRIO ==");
    const imoveis = await prisma.imovel.findMany({
      where: { proprietarioId: pessoaId },
      include: {
        contratos: {
          where: { status: "ATIVO" },
          include: {
            inquilino: true,
            faturas: { orderBy: { vencimento: "desc" }, take: 3, include: { repasse: true } },
          },
        },
      },
    });
    if (imoveis.length === 0) linhas.push("Nenhum imóvel encontrado na carteira.");
    for (const im of imoveis) {
      linhas.push(`\nImóvel ${im.codigo} — ${im.tipo} em ${im.endereco}: status ${im.status}.`);
      for (const ct of im.contratos) {
        linhas.push(
          `Alugado para ${ct.inquilino.nome} por ${brl(ct.valorAluguel)}/mês (contrato ${ct.codigo}, taxa de administração ${ct.taxaAdmPercent}%).`
        );
        for (const f of ct.faturas) {
          if (f.status === "PAGA") {
            const rep = f.repasse;
            linhas.push(
              `Aluguel ${competenciaBr(f.competencia)}: inquilino pagou ${brl(f.valorPago)} em ${dataBr(f.pagaEm)}. ` +
                (rep
                  ? rep.status === "PAGO"
                    ? `Repasse de ${brl(rep.valorRepasse)} transferido em ${dataBr(rep.pagoEm)}.`
                    : `Repasse de ${brl(rep.valorRepasse)} (após taxa adm de ${brl(rep.valorTaxaAdm)}) agendado — aguardando transferência.`
                  : "Repasse ainda não gerado.")
            );
          } else if (f.status === "ATRASADA") {
            linhas.push(
              `Aluguel ${competenciaBr(f.competencia)}: inquilino EM ATRASO desde ${dataBr(f.vencimento)} (${diasEmAtraso(f.vencimento)} dias). Régua de cobrança em andamento.`
            );
          } else {
            linhas.push(`Aluguel ${competenciaBr(f.competencia)}: em aberto, vence ${dataBr(f.vencimento)}.`);
          }
        }
      }
    }
    if (pessoa.chavePix || pessoa.banco) {
      linhas.push(`\nDados de repasse cadastrados: ${pessoa.chavePix ? `PIX ${pessoa.chavePix}` : `${pessoa.banco} ag. ${pessoa.agencia} conta ${pessoa.conta}`}.`);
    }
  }

  return linhas.join("\n");
}

// Fallback determinístico (sem chave de API): responde às intenções mais
// comuns consultando o mesmo contexto do banco.
export function respostaLocal(mensagem: string, perfil: PerfilConversa, contexto: string): string {
  const msg = mensagem.toLowerCase();
  const linhasContexto = contexto.split("\n").filter(Boolean);

  const buscar = (termos: string[]) =>
    linhasContexto.filter((l) => termos.some((t) => l.toLowerCase().includes(t)));

  if (perfil === "LOCATARIO") {
    if (/(boleto|segunda via|2a via|2ª via|pix|pagar|fatura)/.test(msg)) {
      const abertas = buscar(["aberta", "atrasada"]);
      if (abertas.length > 0) {
        return `Claro! ${abertas[0]} Estou enviando o código PIX copia-e-cola. Posso ajudar em algo mais?`;
      }
      return "Verifiquei aqui e você não tem nenhuma fatura em aberto no momento. Posso ajudar em algo mais?";
    }
    if (/(reajuste|aumento|valor do aluguel)/.test(msg)) {
      const info = buscar(["aluguel:", "reajuste"]);
      return info.length > 0
        ? `${info[0]} O reajuste é aplicado anualmente no aniversário do contrato, pelo índice previsto.`
        : "Não localizei os dados do seu contrato. Vou transferir para um atendente humano.";
    }
    if (/(vistoria|manuten|reparo|conserto|vazamento|problema)/.test(msg)) {
      return "Vou abrir um chamado de manutenção para o seu imóvel e nossa equipe entrará em contato para agendar a visita. Pode me descrever o problema com mais detalhes?";
    }
    if (/(rescis|sair do imovel|sair do imóvel|entregar|devolver|negociar|desconto|divida|dívida)/.test(msg)) {
      return "Esse assunto precisa de um atendimento personalizado. Vou transferir você para um dos nossos atendentes, tudo bem?";
    }
  } else {
    if (/(repasse|transfer|quando cai|pagamento|receber)/.test(msg)) {
      const repasses = buscar(["repasse"]);
      if (repasses.length > 0) {
        return `${repasses[0]} Qualquer novidade eu te aviso por aqui!`;
      }
      return "Ainda não há repasses gerados neste período. Assim que o inquilino efetuar o pagamento, o repasse é calculado automaticamente.";
    }
    if (/(inquilino|pagou|em dia|atraso|inadimpl)/.test(msg)) {
      const status = buscar(["pagou", "atraso", "em aberto"]);
      return status.length > 0
        ? status.slice(0, 2).join(" ")
        : "Não localizei faturas recentes dos seus contratos. Vou verificar com a equipe e retorno.";
    }
    if (/(vago|vazio|alugar|anunciar|disponivel|disponível)/.test(msg)) {
      const imoveis = buscar(["status"]);
      return imoveis.length > 0
        ? `Situação atual dos seus imóveis: ${imoveis.join(" ")}`
        : "Não encontrei imóveis na sua carteira. Vou transferir para um atendente.";
    }
    if (/(informe|imposto|ir |dimob|rendimento)/.test(msg)) {
      return "O informe de rendimentos anual fica disponível em março, junto com os dados para a sua declaração de IR. Posso enviar o extrato de repasses do período, se preferir.";
    }
  }

  if (/(oi|olá|ola|bom dia|boa tarde|boa noite)/.test(msg)) {
    return `Oi, aqui é a Maitê. Como posso te ajudar?`;
  }

  return "Pra te ajudar melhor com isso, um atendente da equipe vai continuar por aqui com você.";
}


// ─── Identidade do interlocutor (M4) ────────────────────────────────────────
// Ferramenta que devolve dado financeiro de terceiro NUNCA pode confiar num id
// vindo do input do modelo: quem manda a mensagem no WhatsApp é o "atacante"
// aqui. Este helper resolve QUEM está falando pelo telefone da conversa e
// devolve exatamente o que aquela pessoa tem direito de ver. Todas as
// ferramentas do proprietário passam por aqui.

export type Interlocutor = {
  pessoa: { id: number; nome: string } | null;
  perfil: "LOCATARIO" | "PROPRIETARIO" | "AMBOS" | null;
  contratosComoInquilino: number[];
  imoveisComoProprietario: number[];
};

export async function resolverInterlocutor(
  imobiliariaId: number,
  telefone: string | null | undefined
): Promise<Interlocutor> {
  const vazio: Interlocutor = {
    pessoa: null,
    perfil: null,
    contratosComoInquilino: [],
    imoveisComoProprietario: [],
  };
  if (!telefone) return vazio;

  const { pessoaPorTelefone } = await import("@/lib/whatsapp");
  const achada = await pessoaPorTelefone(telefone, imobiliariaId);
  if (!achada) return vazio;

  // Reconsulta escopada ao tenant: nunca aceita uma pessoa de outra imobiliária.
  const pessoa = await prisma.pessoa.findFirst({
    where: { id: achada.id, imobiliariaId },
    select: { id: true, nome: true },
  });
  if (!pessoa) return vazio;

  const [contratos, imoveis] = await Promise.all([
    prisma.contrato.findMany({
      where: { imobiliariaId, inquilinoId: pessoa.id, status: "ATIVO" },
      select: { id: true },
    }),
    prisma.imovel.findMany({
      where: { imobiliariaId, proprietarioId: pessoa.id },
      select: { id: true },
    }),
  ]);

  const ehLocatario = contratos.length > 0;
  const ehProprietario = imoveis.length > 0;
  return {
    pessoa,
    perfil: ehLocatario && ehProprietario ? "AMBOS" : ehLocatario ? "LOCATARIO" : ehProprietario ? "PROPRIETARIO" : null,
    contratosComoInquilino: contratos.map((c) => c.id),
    imoveisComoProprietario: imoveis.map((i) => i.id),
  };
}
