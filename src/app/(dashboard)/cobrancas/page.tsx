"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";

// ============================================================
// Cobrança — a régua, a carteira e as integrações.
//
// Três blocos numa página só porque é uma operação só: sem carteira a
// régua não tem o que cobrar, e sem integração a carteira não enche.
// Separar em três telas faria o operador descobrir a dependência
// clicando.
// ============================================================

interface Degrau {
  id?: string;
  offset_dias: number;
  template_name: string;
  template_language?: string | null;
  template_vars?: Record<string, string>;
  hora_do_dia?: string;
  is_active: boolean;
}

interface Regua {
  id: string;
  nome: string;
  is_active: boolean;
  janela: Record<string, unknown>;
  max_contatos_periodo: number;
  periodo_dias: number;
  intervalo_minimo_dias: number;
  pausa_apos_resposta_dias: number;
}

interface CobrancaRow {
  id: string;
  contact_id: string | null;
  telefone_bruto: string | null;
  descricao: string | null;
  valor: number;
  vencimento: string;
  status: string;
  origem: string;
  contact?: { name: string | null; phone: string } | null;
}

interface IntegracaoRow {
  id: string;
  label: string;
  descricao: string;
  entrega: string;
  disponivel: boolean;
  conexao: { is_active: boolean; last_sync_at: string | null } | null;
}

export default function CobrancasPage() {
  const t = useTranslations("Cobrancas");
  const { accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [regua, setRegua] = useState<Regua | null>(null);
  const [degraus, setDegraus] = useState<Degrau[]>([]);
  const [cobrancas, setCobrancas] = useState<CobrancaRow[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegracaoRow[]>([]);
  const [filtro, setFiltro] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [r, c, i] = await Promise.all([
        fetch("/api/cobrancas/regua", { cache: "no-store" }),
        fetch("/api/cobrancas", { cache: "no-store" }),
        fetch("/api/integracoes", { cache: "no-store" }),
      ]);
      if (r.ok) {
        const json = await r.json();
        setRegua(json.regua ?? null);
        setDegraus(json.degraus ?? []);
      }
      if (c.ok) setCobrancas((await c.json()).cobrancas ?? []);
      if (i.ok) setIntegracoes((await i.json()).integracoes ?? []);
    })();
  }, []);

  async function salvar() {
    setSaving(true);
    try {
      const res = await fetch("/api/cobrancas/regua", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: regua?.nome ?? "Régua",
          is_active: regua?.is_active ?? false,
          janela: regua?.janela ?? {},
          max_contatos_periodo: regua?.max_contatos_periodo ?? 4,
          periodo_dias: regua?.periodo_dias ?? 30,
          intervalo_minimo_dias: regua?.intervalo_minimo_dias ?? 2,
          pausa_apos_resposta_dias: regua?.pausa_apos_resposta_dias ?? 3,
          degraus,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "erro");
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const visiveis = cobrancas.filter((c) => {
    if (!filtro.trim()) return true;
    const alvo = `${c.descricao ?? ""} ${c.telefone_bruto ?? ""} ${c.contact?.name ?? ""}`;
    return alvo.toLowerCase().includes(filtro.toLowerCase());
  });
  const orfas = cobrancas.filter((c) => !c.contact_id).length;

  if (profileLoading) return null;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {/* ---------- A régua ---------- */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-foreground">{t("ruler")}</h2>
            <p className="text-xs text-muted-foreground">{t("rulerHint")}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{t("active")}</span>
            <Switch
              checked={regua?.is_active ?? false}
              disabled={!canEdit}
              onCheckedChange={(v) =>
                setRegua((r) => ({ ...(r ?? blankRegua()), is_active: v }))
              }
            />
          </div>
        </div>

        {/* A janela legal e o teto aparecem como ESTADO, não como campo
            escondido: quem configura precisa ver o que já está imposto. */}
        <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("legalWindow", {
            max: regua?.max_contatos_periodo ?? 4,
            dias: regua?.periodo_dias ?? 30,
          })}
        </p>

        <div className="mt-4 space-y-2">
          {degraus.map((d, i) => (
            <div
              key={d.id ?? i}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
            >
              <Input
                type="number"
                value={d.offset_dias}
                disabled={!canEdit}
                onChange={(e) =>
                  setDegraus(patch(degraus, i, { offset_dias: Number(e.target.value) }))
                }
                className="w-20 bg-muted text-xs"
                aria-label={t("offsetLabel")}
              />
              <span className="text-xs text-muted-foreground">{t("daysFromDue")}</span>
              <Input
                value={d.template_name}
                disabled={!canEdit}
                placeholder={t("templatePlaceholder")}
                onChange={(e) =>
                  setDegraus(patch(degraus, i, { template_name: e.target.value }))
                }
                className="min-w-40 flex-1 bg-muted text-xs"
              />
              <Input
                type="time"
                value={(d.hora_do_dia ?? "09:00").slice(0, 5)}
                disabled={!canEdit}
                onChange={(e) =>
                  setDegraus(patch(degraus, i, { hora_do_dia: e.target.value }))
                }
                className="w-28 bg-muted text-xs"
              />
              <Switch
                checked={d.is_active}
                disabled={!canEdit}
                onCheckedChange={(v) => setDegraus(patch(degraus, i, { is_active: v }))}
              />
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDegraus(degraus.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {degraus.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("noSteps")}</p>
          )}
        </div>

        {canEdit && (
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDegraus([
                  ...degraus,
                  {
                    offset_dias: degraus.length === 0 ? 0 : 2,
                    template_name: "",
                    hora_do_dia: "09:00",
                    is_active: true,
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t("addStep")}
            </Button>
            <Button size="sm" onClick={salvar} disabled={saving}>
              {t("save")}
            </Button>
          </div>
        )}
      </section>

      {/* ---------- A carteira ---------- */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-foreground">
            {t("wallet", { count: cobrancas.length })}
          </h2>
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-56 bg-muted text-xs"
          />
        </div>

        {orfas > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t("orphans", { count: orfas })}
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">{t("colWho")}</th>
                <th className="py-1 pr-3">{t("colDescription")}</th>
                <th className="py-1 pr-3">{t("colValue")}</th>
                <th className="py-1 pr-3">{t("colDue")}</th>
                <th className="py-1">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.slice(0, 200).map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    {c.contact?.name ?? c.telefone_bruto ?? (
                      <span className="text-amber-400">{t("unmatched")}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{c.descricao}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatBrl(Number(c.valor))}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatBr(c.vencimento)}</td>
                  <td className="py-1.5">{t(`status.${c.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiveis.length === 0 && (
            <p className="py-4 text-xs text-muted-foreground">{t("emptyWallet")}</p>
          )}
        </div>

        {canEdit && <ImportBlock t={t} />}
      </section>

      {/* ---------- Integrações ---------- */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-foreground">{t("integrations")}</h2>
        <p className="text-xs text-muted-foreground">{t("integrationsHint")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {integracoes.map((i) => (
            <div
              key={i.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{i.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {i.conexao
                    ? t("connected")
                    : i.disponivel
                      ? t("available")
                      : t("soon")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{i.descricao}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * A importação por colagem.
 *
 * CSV colado, e não upload de XLSX: parsear planilha no servidor pediria
 * uma dependência grande para resolver um problema que o cliente já
 * resolve melhor — ele tem o arquivo aberto e copia.
 *
 * Sempre pré-visualiza antes de gravar. Meia carteira importada é pior
 * que nenhuma.
 */
function ImportBlock({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{
    validas: number;
    rejeitadas: number;
    duplicadasNoArquivo: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function enviar(modo: "preview" | "commit") {
    setBusy(true);
    try {
      const linhas = parseCsv(csv);
      if (linhas.length === 0) throw new Error(t("csvEmpty"));
      const res = await fetch("/api/cobrancas/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linhas, modo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "erro");
      setPreview(json.resumo);
      if (modo === "commit") {
        toast.success(t("imported", { count: json.gravadas }));
        setCsv("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-sm font-medium text-foreground">{t("import")}</p>
      <p className="text-xs text-muted-foreground">{t("importHint")}</p>
      <Textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"telefone,valor,vencimento,descricao\n11987654321,80.00,09/09/2026,Mensalidade"}
        className="mt-2 min-h-24 bg-muted font-mono text-xs"
      />
      {preview && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("previewSummary", {
            validas: preview.validas,
            rejeitadas: preview.rejeitadas,
            duplicadas: preview.duplicadasNoArquivo,
          })}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => enviar("preview")}>
          <Upload className="h-3.5 w-3.5" />
          {t("checkFirst")}
        </Button>
        <Button size="sm" disabled={busy || !preview} onClick={() => enviar("commit")}>
          {t("importNow")}
        </Button>
      </div>
    </div>
  );
}

/** CSV com cabeçalho, separado por vírgula ou ponto e vírgula. */
function parseCsv(texto: string): Record<string, string>[] {
  const linhas = texto.trim().split(/\r?\n/).filter(Boolean);
  if (linhas.length < 2) return [];
  // Ponto e vírgula é o padrão do Excel em português, e uma planilha
  // brasileira quase sempre chega assim.
  const sep = linhas[0].includes(";") ? ";" : ",";
  const cabecalho = linhas[0].split(sep).map((c) => c.trim());
  return linhas.slice(1).map((linha) => {
    const celulas = linha.split(sep);
    const obj: Record<string, string> = {};
    cabecalho.forEach((chave, i) => {
      obj[chave] = (celulas[i] ?? "").trim();
    });
    return obj;
  });
}

function patch(lista: Degrau[], i: number, campos: Partial<Degrau>): Degrau[] {
  return lista.map((d, j) => (j === i ? { ...d, ...campos } : d));
}

function blankRegua(): Regua {
  return {
    id: "",
    nome: "Régua",
    is_active: false,
    janela: {},
    max_contatos_periodo: 4,
    periodo_dias: 30,
    intervalo_minimo_dias: 2,
    pausa_apos_resposta_dias: 3,
  };
}

function formatBrl(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valor,
  );
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
