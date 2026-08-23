import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo";

// Public privacy-policy page. Meta requires a reachable Privacy Policy
// URL (App Settings → Basic) before an app can go live, and the same
// page's #exclusao-de-dados anchor serves the "Data deletion
// instructions URL" field. Deliberately outside every auth gate (the
// middleware only guards listed paths) and hardcoded pt-BR: legal text
// is operator-reviewed prose for the Brazilian market, not UI strings —
// running it through the message catalogue would triple the upkeep for
// no reader benefit.
//
// Operator contact comes from NEXT_PUBLIC_BILLING_CONTACT (the same
// channel the /blocked page shows), so there is one support channel to
// keep current.
export const metadata: Metadata = {
  title: "Política de Privacidade",
  // The root layout noindexes the whole app (it's a private tool); the
  // privacy policy is the one page meant to be publicly referenced.
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

export default function PrivacyPolicyPage() {
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
          <h1 className="text-3xl font-bold text-foreground">
            Política de Privacidade
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última atualização: 30 de julho de 2026
          </p>
        </header>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <section>
            <h2>1. Quem somos</h2>
            <p className="mt-2">
              O iMasterChat é uma plataforma de atendimento e CRM para
              WhatsApp, operada sobre a API oficial do WhatsApp Business
              (Meta). Esta política descreve como tratamos dados pessoais em
              conformidade com a Lei Geral de Proteção de Dados (Lei
              13.709/2018 — LGPD).
            </p>
            <p className="mt-2">
              No papel da LGPD, a empresa cliente que usa o iMasterChat é a
              <strong className="text-foreground"> controladora</strong> dos
              dados dos seus contatos e conversas; o iMasterChat atua como
              <strong className="text-foreground"> operador</strong>,
              tratando esses dados exclusivamente para prestar o serviço.
            </p>
          </section>

          <section>
            <h2>2. Dados que tratamos</h2>
            <ul className="mt-2">
              <li>
                <strong className="text-foreground">Dados de conta:</strong>{" "}
                nome, e-mail e senha (armazenada apenas como hash) de quem cria
                uma conta na plataforma.
              </li>
              <li>
                <strong className="text-foreground">
                  Dados de atendimento:
                </strong>{" "}
                contatos (nome, telefone, campos personalizados) e mensagens de
                WhatsApp trocadas com o número conectado, recebidas por meio da
                API oficial da Meta.
              </li>
              <li>
                <strong className="text-foreground">
                  Credenciais de integração:
                </strong>{" "}
                tokens de acesso do WhatsApp Business, armazenados
                criptografados (AES-256-GCM).
              </li>
              <li>
                <strong className="text-foreground">Dados de uso:</strong>{" "}
                registros técnicos necessários à operação e segurança do
                serviço (por exemplo, logs de acesso).
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Para que usamos</h2>
            <ul className="mt-2">
              <li>Prestar o serviço: caixa de entrada, contatos, funis, disparos e automações.</li>
              <li>Gerir a assinatura e a cobrança da conta.</li>
              <li>Prestar suporte e manter a segurança da plataforma.</li>
            </ul>
            <p className="mt-2">
              Não vendemos dados pessoais nem os usamos para publicidade.
            </p>
          </section>

          <section>
            <h2>4. Com quem compartilhamos</h2>
            <ul className="mt-2">
              <li>
                <strong className="text-foreground">Meta (WhatsApp):</strong>{" "}
                o envio e o recebimento de mensagens passam pela API oficial do
                WhatsApp Business, sujeitos às políticas da Meta.
              </li>
              <li>
                <strong className="text-foreground">
                  Provedores de IA (opcional):
                </strong>{" "}
                se a conta ativar o assistente de IA com a própria chave
                (OpenAI ou Anthropic), trechos das conversas são enviados ao
                provedor escolhido exclusivamente para gerar as respostas.
              </li>
              <li>
                <strong className="text-foreground">Infraestrutura:</strong>{" "}
                servidores e banco de dados usados para hospedar o serviço.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Segurança e retenção</h2>
            <p className="mt-2">
              Todo o tráfego usa HTTPS; tokens de integração são guardados
              criptografados; o acesso aos dados é isolado por conta. Os dados
              são mantidos enquanto a conta existir e removidos quando ela é
              excluída, ressalvadas obrigações legais de guarda.
            </p>
          </section>

          <section id="exclusao-de-dados">
            <h2>6. Exclusão de dados</h2>
            <p className="mt-2">
              Para excluir sua conta e os dados associados (contatos,
              conversas, configurações e credenciais de integração), solicite
              pelo canal de suporte abaixo, a partir do e-mail cadastrado na
              conta. A exclusão é concluída em até 15 dias e é irreversível.
              Usuários finais que conversaram com um número atendido pela
              plataforma podem solicitar a exclusão dos próprios dados à
              empresa responsável pelo número (a controladora) ou pelo mesmo
              canal abaixo.
            </p>
          </section>

          <section>
            <h2>7. Seus direitos (LGPD)</h2>
            <p className="mt-2">
              Você pode solicitar confirmação de tratamento, acesso, correção,
              anonimização, portabilidade, exclusão e informação sobre
              compartilhamentos, além de revogar consentimentos. Atendemos às
              solicitações nos prazos da LGPD.
            </p>
          </section>

          <section>
            <h2>8. Cookies</h2>
            <p className="mt-2">
              Usamos apenas cookies essenciais de autenticação (sessão). Não
              usamos cookies de publicidade ou rastreamento de terceiros.
            </p>
          </section>

          <section>
            <h2>9. Contato</h2>
            <p className="mt-2">
              Para exercer seus direitos ou tirar dúvidas sobre esta política,
              fale com <ContactLine />.
            </p>
          </section>

          <section>
            <h2>10. Alterações</h2>
            <p className="mt-2">
              Esta política pode ser atualizada; a data no topo indica a versão
              vigente. Mudanças relevantes serão comunicadas dentro da
              plataforma.
            </p>
          </section>
        </div>
      </article>
    </div>
  );
}
