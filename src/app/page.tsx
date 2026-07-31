import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  GitBranch,
  MessageSquare,
  Radio,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";

// Public marketing landing at the root. Exists chiefly because Meta's
// business verification asks for "a complete website showing the
// service and the company that provides it" — but it doubles as the
// natural front door for prospects. Public and indexable (exception to
// the app-wide noindex, like /privacidade); signed-in visitors who
// click "Entrar" bounce straight to /dashboard via the middleware.
// Hardcoded pt-BR for the same reason as the privacy page: this is
// operator-reviewed marketing prose for the Brazilian market.

// Dados exibidos no rodapé. A verificação de negócio da Meta confere o
// site contra o cadastro da empresa — preencha com sua razão social e
// CNPJ para os dois baterem. Deixar vazio omite a linha.
const LEGAL_NAME = "";
const CNPJ = "";

export const metadata: Metadata = {
  title: "iMasterChat — Atendimento e CRM para WhatsApp",
  description:
    "Caixa de entrada compartilhada, contatos, funis de venda, disparos e automações sobre a API oficial do WhatsApp Business.",
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Caixa de entrada compartilhada",
    desc: "Vários atendentes em um mesmo número de WhatsApp, com atribuição de conversas, status e notas internas.",
  },
  {
    icon: Users,
    title: "Contatos organizados",
    desc: "Etiquetas, campos personalizados, importação por CSV e histórico completo de cada cliente.",
  },
  {
    icon: GitBranch,
    title: "Funis de venda",
    desc: "Quadro Kanban com negócios ligados às conversas — do primeiro contato ao fechamento.",
  },
  {
    icon: Radio,
    title: "Disparos em massa",
    desc: "Campanhas com modelos aprovados pela Meta, acompanhamento de entrega e leitura, variáveis por destinatário.",
  },
  {
    icon: Zap,
    title: "Automações sem código",
    desc: "Respostas por palavra-chave, mensagens de ausência, etiquetas automáticas e fluxos visuais.",
  },
  {
    icon: Bot,
    title: "Assistente de IA",
    desc: "Rascunhos de resposta com um clique e robô de auto-resposta opcional, com passagem limpa para humanos.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Crie sua conta",
    desc: "Cadastro em minutos, direto no navegador.",
  },
  {
    n: "2",
    title: "Conecte seu WhatsApp",
    desc: "Clique em “Conectar com o Facebook” e autorize o número da sua empresa — sem configuração técnica.",
  },
  {
    n: "3",
    title: "Atenda em equipe",
    desc: "Todo mundo respondendo pelo painel, com histórico organizado e nada perdido no celular de alguém.",
  },
];

export default function LandingPage() {
  const contact = process.env.NEXT_PUBLIC_BILLING_CONTACT ?? null;
  const contactIsLink = contact !== null && /^(https?:|mailto:|tel:)/.test(contact);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <LogoMark className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold">iMasterChat</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline" })}
          >
            Entrar
          </Link>
          <Link href="/signup" className={buttonVariants()}>
            Criar conta
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-14 text-center">
        <p className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Sobre a API oficial do WhatsApp Business (Meta)
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Atendimento e CRM para <span className="text-primary">WhatsApp</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Sua equipe inteira atendendo em um só número — caixa de entrada
          compartilhada, contatos, funis de venda, disparos em massa e
          automações, tudo em um painel na web.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>
            Começar agora
          </Link>
          {contactIsLink ? (
            <a
              href={contact}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Falar com a gente
            </a>
          ) : null}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Tudo que o atendimento da sua empresa precisa
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {f.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="mb-8 text-center text-2xl font-semibold">
            Como funciona
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                  {s.n}
                </div>
                <h3 className="text-sm font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="text-2xl font-semibold">
          Pronto para organizar o atendimento?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Crie sua conta e conecte o WhatsApp da sua empresa hoje. Sem
          instalação, sem cartão de crédito para começar.
        </p>
        <div className="mt-6">
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>
            Criar conta gratuita
          </Link>
        </div>
      </section>

      {/* Footer — company details (Meta business verification reads this) */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
              <LogoMark className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              iMasterChat
            </span>
          </div>
          {LEGAL_NAME ? (
            <p>
              {LEGAL_NAME}
              {CNPJ ? ` — CNPJ ${CNPJ}` : ""}
            </p>
          ) : null}
          {contact ? (
            <p>
              Contato:{" "}
              {contactIsLink ? (
                <a
                  href={contact}
                  className="text-primary hover:text-primary/80"
                >
                  {contact}
                </a>
              ) : (
                contact
              )}
            </p>
          ) : null}
          <nav className="flex items-center gap-4">
            <Link href="/privacidade" className="hover:text-foreground">
              Política de Privacidade
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Entrar
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Criar conta
            </Link>
          </nav>
          <p>© {new Date().getFullYear()} iMasterChat. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
