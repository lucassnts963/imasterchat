import { describe, it, expect } from 'vitest';

import { buildEventDescription, buildEventSummary } from './event-text';

// O que estes testes seguram: quem abre a Google Agenda de manhã
// consegue trabalhar só com o que está no evento — quem é, como falar
// com a pessoa, o que ela pediu, e por onde voltar à conversa.

const BASE = {
  contactName: 'Jaqueline Msena',
  contactPhone: '+55 91 92417473',
  conversationId: 'c0ffee00-0000-4000-8000-000000000001',
  createdVia: 'native' as const,
  siteUrl: 'https://imasterchat.com.br',
};

describe('buildEventSummary', () => {
  it('põe o assunto na frente e o cliente atrás', () => {
    expect(
      buildEventSummary({ ...BASE, title: 'Demonstração da bike dobrável' }),
    ).toBe('Demonstração da bike dobrável — Jaqueline Msena');
  });

  it('sem assunto, usa o termo do negócio', () => {
    expect(
      buildEventSummary({ ...BASE, appointmentLabel: 'visita técnica' }),
    ).toBe('visita técnica — Jaqueline Msena');
  });

  it('sem assunto e sem termo, cai no genérico', () => {
    expect(buildEventSummary(BASE)).toBe('Atendimento — Jaqueline Msena');
  });

  it('sem nome, não deixa um travessão solto', () => {
    expect(
      buildEventSummary({ createdVia: 'manual', title: 'Orçamento' }),
    ).toBe('Orçamento');
  });
});

describe('buildEventDescription', () => {
  it('traz quem é, o que pediu e o link da conversa', () => {
    const out = buildEventDescription({
      ...BASE,
      title: 'Quero ver a bike dobrável',
      contactEmail: 'jaqueline@exemplo.com',
      contactCompany: 'Solar Belém',
    });
    expect(out).toContain('Cliente: Jaqueline Msena');
    expect(out).toContain('WhatsApp: +55 91 92417473');
    expect(out).toContain('E-mail: jaqueline@exemplo.com');
    expect(out).toContain('Empresa: Solar Belém');
    expect(out).toContain('Pedido: Quero ver a bike dobrável');
    expect(out).toContain(
      'https://imasterchat.com.br/inbox?c=c0ffee00-0000-4000-8000-000000000001',
    );
    expect(out).toContain('Marcado pelo agente de IA');
  });

  it('distingue marcação manual da do agente', () => {
    const out = buildEventDescription({ ...BASE, createdVia: 'manual' });
    expect(out).toContain('Marcado manualmente');
    expect(out).not.toContain('agente de IA');
  });

  it('não monta link sem a origem pública configurada', () => {
    const out = buildEventDescription({ ...BASE, siteUrl: null });
    expect(out).not.toContain('Conversa:');
    // E o resto sobrevive — a falta do link não pode custar o telefone.
    expect(out).toContain('WhatsApp: +55 91 92417473');
  });

  it('tolera barra sobrando na origem', () => {
    const out = buildEventDescription({ ...BASE, siteUrl: 'https://x.com.br/' });
    expect(out).toContain('https://x.com.br/inbox?c=');
    expect(out).not.toContain('.br//inbox');
  });

  it('sem nada de útil, não devolve descrição', () => {
    // Só o rodapé de origem não justifica um campo preenchido: ele
    // explicaria a procedência de um evento que não diz nada mesmo.
    expect(buildEventDescription({ createdVia: 'native' })).toBeUndefined();
  });

  it('só o telefone já justifica — é o que faz a visita acontecer', () => {
    const out = buildEventDescription({
      createdVia: 'native',
      contactPhone: '+55 91 92417473',
    });
    expect(out).toContain('WhatsApp: +55 91 92417473');
  });
});
