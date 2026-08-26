import { describe, expect, it } from "vitest";
import {
  CADENCIA_ATIVIDADES_HORAS,
  dentroDoExpediente,
  proximaAtividadeDaCadencia,
  proximoExpediente,
  type NegocioParaCadencia,
} from "@/lib/atividades-cadencia";

// Horários de parede de São Paulo (UTC-3), escritos em UTC para não depender do
// fuso da máquina que roda o teste — é o mesmo cuidado de lib/followup.ts.
const sp = (dia: number, hora: number) => new Date(Date.UTC(2026, 7, dia, hora + 3, 0, 0));

const base = (over: Partial<NegocioParaCadencia> = {}): NegocioParaCadencia => ({
  id: 1,
  faseDesde: sp(3, 10), // segunda 03/08, 10h
  degrausJaCriados: 0,
  temPendente: false,
  ultimoContatoEm: null,
  ...over,
});

describe("cadência de atividades", () => {
  it("não cria nada enquanto o degrau não venceu", () => {
    // 12h depois da entrada na fase; o primeiro degrau é 24h.
    expect(proximaAtividadeDaCadencia(base(), sp(3, 22))).toBeNull();
  });

  it("cria o primeiro toque quando o silêncio completa o intervalo", () => {
    const a = proximaAtividadeDaCadencia(base(), sp(4, 11));
    expect(a).not.toBeNull();
    expect(a!.tipo).toBe("LIGACAO");
    expect(a!.explicacao).toContain("1 dia(s) sem contato");
  });

  it("não empilha em cima de tarefa pendente", () => {
    expect(proximaAtividadeDaCadencia(base({ temPendente: true }), sp(9, 11))).toBeNull();
  });

  it("para depois do último degrau — daí é decisão humana", () => {
    const n = base({ degrausJaCriados: CADENCIA_ATIVIDADES_HORAS.length });
    expect(proximaAtividadeDaCadencia(n, sp(30, 11))).toBeNull();
  });

  it("conta do último contato, não da entrada na fase", () => {
    // Falaram com a pessoa ontem: mesmo com o card parado há uma semana, não há
    // o que cobrar hoje de manhã.
    const n = base({ ultimoContatoEm: sp(9, 15) });
    expect(proximaAtividadeDaCadencia(n, sp(10, 11))).toBeNull();
    expect(proximaAtividadeDaCadencia(n, sp(10, 16))).not.toBeNull();
  });

  it("o segundo degrau espera três dias, não mais um", () => {
    const n = base({ degrausJaCriados: 1, ultimoContatoEm: sp(3, 10) });
    expect(proximaAtividadeDaCadencia(n, sp(5, 11))).toBeNull(); // 2 dias
    expect(proximaAtividadeDaCadencia(n, sp(6, 11))).not.toBeNull(); // 3 dias
  });

  it("nunca marca tarefa fora do expediente", () => {
    // Domingo 09/08 às 3h da manhã: o degrau venceu, mas a tarefa cai na
    // segunda às 9h.
    const a = proximaAtividadeDaCadencia(base(), sp(9, 3));
    expect(a).not.toBeNull();
    expect(dentroDoExpediente(a!.quando)).toBe(true);
    expect(a!.quando.getTime()).toBe(sp(10, 9).getTime());
  });

  it("expediente é seg-sex 9h-18h", () => {
    expect(dentroDoExpediente(sp(3, 9))).toBe(true);
    expect(dentroDoExpediente(sp(3, 17))).toBe(true);
    expect(dentroDoExpediente(sp(3, 18))).toBe(false);
    expect(dentroDoExpediente(sp(8, 10))).toBe(false); // sábado
    expect(dentroDoExpediente(sp(9, 10))).toBe(false); // domingo
  });

  it("antes de abrir num dia útil, vale o mesmo dia às 9h", () => {
    expect(proximoExpediente(sp(4, 7)).getTime()).toBe(sp(4, 9).getTime());
  });

  it("sexta à noite cai na segunda, não no sábado", () => {
    expect(proximoExpediente(sp(7, 20)).getTime()).toBe(sp(10, 9).getTime());
  });
});
