import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

// Public terms-of-service page. Meta requires a reachable Terms of
// Service URL (App Settings → Basic) before a use case can be reviewed,
// and the app's field pointed at `https://www.facebook.com/` — a
// placeholder that gets a review rejected.
//
// Mirrors `privacidade/page.tsx` deliberately: same chrome, same
// hardcoded pt-BR, same reason. Legal text is operator-reviewed prose
// for the Brazilian market, not UI strings — running it through the
// message catalogue would triple the upkeep for no reader benefit.
export const metadata: Metadata = {
  title: "Termos de Uso",
  // The root layout noindexes the whole app (it's a private tool); the
  // legal pages are the ones meant to be publicly referenced.
  robots: { index: true, follow: true },
};

function ContactLine() {
  const contact = process.env.NEXT_PUBLIC_BILLING_CONTACT ?? null;
  if (!contact) {
    return <span>o canal de suporte informado dentro da plataforma</span>;
  }
  if (/^(https?:|mailto:|tel:)/.test(contact)) {
    return (
      <a href={contact} className="text-primary hover:text-primary/80">
        nosso canal de suporte
      </a>
    );
  }
  return <span>{contact}</span>;
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <article className="mx-auto max-w-2xl">
        <header className="mb-10">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <LogoMark className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">
              iMasterChat
            </span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Termos de Uso</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última atualização: 3 de agosto de 2026
          </p>
        </header>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <section>
            <h2>1. O que é este serviço</h2>
            <p className="mt-2">
              O iMasterChat é uma plataforma de atendimento e CRM para
              WhatsApp, operada sobre a API oficial do WhatsApp Business
              (Meta). Ao criar uma conta ou usar a plataforma, você concorda
              com estes termos.
            </p>
            <p className="mt-2">
              Estes termos convivem com a{" "}
              <Link
                href="/privacidade"
                className="text-primary hover:text-primary/80"
              >
                Política de Privacidade
              </Link>
              , que descreve como tratamos dados pessoais sob a LGPD.
            </p>
          </section>

          <section>
            <h2>2. Quem pode usar</h2>
            <p className="mt-2">
              A plataforma é destinada a pessoas jurídicas e profissionais que
              atendem clientes por WhatsApp. É necessário ser maior de 18 anos
              e ter poderes para aceitar estes termos em nome da empresa que
              representa.
            </p>
          </section>

          <section>
            <h2>3. Sua conta</h2>
            <ul className="mt-2">
              <li>
                Você é responsável pelas credenciais de acesso e por tudo que
                acontece na sua conta.
              </li>
              <li>
                As informações de cadastro devem ser verdadeiras e mantidas
                atualizadas.
              </li>
              <li>
                Contas com mais de uma pessoa: cada membro deve ter o próprio
                acesso. Senhas não devem ser compartilhadas.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. Conexão com o WhatsApp</h2>
            <p className="mt-2">
              Para operar, a plataforma se conecta a uma conta do WhatsApp
              Business por meio da API oficial da Meta. Ao conectar,{" "}
              <strong className="text-foreground">
                você autoriza o iMasterChat a enviar e receber mensagens em nome
                do número conectado
              </strong>
              , exclusivamente para prestar o serviço.
            </p>
            <p className="mt-2">
              O uso do WhatsApp está sujeito às políticas da Meta, entre elas a
              Política Comercial e a Política de Mensagens do WhatsApp. O
              descumprimento delas pode levar a Meta a limitar ou banir o número
              — decisão que é dela, e sobre a qual não temos controle.
            </p>
          </section>

          <section>
            <h2>5. Uso aceitável</h2>
            <p className="mt-2">Você concorda em não usar a plataforma para:</p>
            <ul className="mt-2">
              <li>
                Enviar mensagens não solicitadas a quem não deu consentimento
                (spam).
              </li>
              <li>
                Conteúdo ilegal, enganoso, ofensivo ou que viole direitos de
                terceiros.
              </li>
              <li>
                Golpes, phishing, ou se passar por outra pessoa ou empresa.
              </li>
              <li>
                Vender ou anunciar produtos e serviços proibidos pelas
                políticas da Meta.
              </li>
              <li>
                Tentar burlar limites técnicos, acessar dados de outras contas
                ou sobrecarregar a infraestrutura.
              </li>
            </ul>
            <p className="mt-2">
              Podemos suspender uma conta que descumpra esta seção, com aviso
              sempre que possível e imediatamente quando houver risco à
              plataforma ou a terceiros.
            </p>
          </section>

          <section>
            <h2>6. Agente de inteligência artificial</h2>
            <p className="mt-2">
              A plataforma oferece um agente de IA que pode responder
              automaticamente e, quando configurado, marcar compromissos. Duas
              coisas importam aqui:
            </p>
            <ul className="mt-2">
              <li>
                A chave do provedor de IA é sua. O custo das chamadas é cobrado
                diretamente pelo provedor, não por nós.
              </li>
              <li>
                Respostas geradas por IA podem conter erros.{" "}
                <strong className="text-foreground">
                  A responsabilidade pelo que é dito ao seu cliente é sua
                </strong>
                , e a plataforma oferece controles — guardrails, limite de
                respostas e transferência para humano — para você exercê-la.
              </li>
            </ul>
          </section>

          <section>
            <h2>7. Seus dados e conteúdo</h2>
            <p className="mt-2">
              Os contatos, conversas e demais conteúdos da sua conta são seus.
              Não os usamos para treinar modelos, não os vendemos e não os
              compartilhamos, salvo para prestar o serviço ou por obrigação
              legal.
            </p>
            <p className="mt-2">
              Você pode exportar ou solicitar a exclusão dos seus dados a
              qualquer momento — o procedimento está na{" "}
              <Link
                href="/privacidade#exclusao-de-dados"
                className="text-primary hover:text-primary/80"
              >
                Política de Privacidade
              </Link>
              .
            </p>
          </section>

          <section>
            <h2>8. Assinatura e pagamento</h2>
            <p className="mt-2">
              O acesso depende de assinatura ativa. A cobrança é combinada
              diretamente com você e confirmada manualmente pela nossa equipe;
              enquanto um pagamento estiver pendente, a conta pode ficar
              bloqueada, sem perda de dados.
            </p>
            <p className="mt-2">
              Não há fidelidade: você pode encerrar quando quiser. Valores já
              pagos referentes ao período em curso não são reembolsados
              proporcionalmente, salvo determinação legal.
            </p>
          </section>

          <section>
            <h2>9. Disponibilidade</h2>
            <p className="mt-2">
              Trabalhamos para manter o serviço no ar, mas ele depende de
              terceiros — a Meta, o provedor de IA que você escolher, o
              provedor de hospedagem. Não garantimos operação ininterrupta nem
              respondemos por indisponibilidade causada por esses terceiros.
            </p>
            <p className="mt-2">
              Manutenções programadas serão avisadas com antecedência sempre
              que possível.
            </p>
          </section>

          <section>
            <h2>10. Limitação de responsabilidade</h2>
            <p className="mt-2">
              Na máxima extensão permitida em lei, nossa responsabilidade
              total por qualquer reclamação relacionada ao serviço fica
              limitada ao valor pago por você nos 12 meses anteriores ao fato.
            </p>
            <p className="mt-2">
              Não respondemos por lucros cessantes, perda de oportunidade
              comercial, ou por banimento de número aplicado pela Meta.
            </p>
          </section>

          <section>
            <h2>11. Encerramento</h2>
            <p className="mt-2">
              Você pode encerrar sua conta a qualquer momento. Podemos encerrar
              ou suspender o acesso em caso de descumprimento destes termos, de
              inadimplência prolongada, ou se formos obrigados por lei.
            </p>
            <p className="mt-2">
              Após o encerramento, os dados da conta são mantidos pelo prazo
              descrito na Política de Privacidade e depois eliminados.
            </p>
          </section>

          <section>
            <h2>12. Mudanças nestes termos</h2>
            <p className="mt-2">
              Podemos atualizar estes termos. Mudanças relevantes serão
              comunicadas dentro da plataforma com antecedência razoável. O uso
              continuado após a vigência significa concordância.
            </p>
          </section>

          <section>
            <h2>13. Lei aplicável e foro</h2>
            <p className="mt-2">
              Estes termos são regidos pelas leis brasileiras. Fica eleito o
              foro da comarca de Belém, Pará, com renúncia a qualquer outro.
            </p>
          </section>

          <section>
            <h2>14. Contato</h2>
            <p className="mt-2">
              Dúvidas sobre estes termos: fale conosco por <ContactLine />.
            </p>
          </section>
        </div>

        <footer className="mt-12 border-t border-border pt-6">
          <Link
            href="/privacidade"
            className="text-sm text-primary hover:text-primary/80"
          >
            Política de Privacidade
          </Link>
        </footer>
      </article>
    </div>
  );
}
