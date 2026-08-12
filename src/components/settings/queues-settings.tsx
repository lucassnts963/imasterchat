"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Loader2, Plus, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPanelHead } from "./settings-panel-head";

// ============================================================
// Filas de atendimento.
//
// Toda conversa está sempre em exatamente uma fila, e a fila diz quem
// atende: o robô ou um time. Toda conta nasce com a fila do robô
// ("Atendimento automático"), que é onde a conversa começa.
//
// O campo que mais importa nesta tela é o menos óbvio: a DESCRIÇÃO. Ela
// não é anotação interna — é o texto que o agente vai ler para decidir
// para onde encaminhar. Quem escrever "fila 2" vai ter encaminhamento
// ruim e não vai saber por quê, então o formulário diz isso.
// ============================================================

interface QueueRow {
  id: string;
  name: string;
  description: string | null;
  attended_by: "ai" | "humans";
  responsible_user_id: string | null;
  auto_assign: boolean;
  sla_seconds: number | null;
  overflow_queue_id: string | null;
  overflow_after_seconds: number | null;
  is_default: boolean;
  position: number;
}

interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function QueuesSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const t = useTranslations("Settings.queues");

  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data: qs }, { data: ms }] = await Promise.all([
      supabase
        .from("queues")
        .select(
          "id, name, description, attended_by, responsible_user_id, auto_assign, sla_seconds, overflow_queue_id, overflow_after_seconds, is_default, position",
        )
        .eq("account_id", accountId)
        .eq("active", true)
        .order("position")
        .order("name"),
      supabase.from("profiles").select("user_id, full_name, email"),
    ]);
    setQueues((qs ?? []) as QueueRow[]);
    setMembers((ms ?? []) as Member[]);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createQueue() {
    const name = newName.trim();
    if (!name || !accountId) return;
    setCreating(true);
    try {
      const { error } = await supabase.from("queues").insert({
        account_id: accountId,
        name,
        description: newDescription.trim() || null,
        attended_by: "humans",
        position: queues.length,
      });
      if (error) {
        // O índice único por (conta, nome em minúsculas) é o que impede
        // "Financeiro" e "financeiro" convivendo — duas filas que
        // ninguém consegue distinguir na tela.
        toast.error(
          error.code === "23505" ? t("errorDuplicate") : error.message,
        );
        return;
      }
      setNewName("");
      setNewDescription("");
      toast.success(t("created"));
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, patchBody: Partial<QueueRow>) {
    // Otimista: a tela responde na hora e reverte se o banco recusar.
    setQueues((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patchBody } : q)),
    );
    const { error } = await supabase
      .from("queues")
      .update(patchBody)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      await load();
    }
  }

  async function remove(q: QueueRow) {
    if (q.is_default) return;
    // As conversas que estiverem nela caem para `queue_id = null` pelo
    // ON DELETE SET NULL. É o comportamento certo: apagar uma fila não
    // pode apagar conversa nem histórico de passagem.
    if (!confirm(t("confirmDelete", { name: q.name }))) return;
    const { error } = await supabase.from("queues").delete().eq("id", q.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("deleted"));
    await load();
  }

  function memberLabel(m: Member) {
    return m.full_name?.trim() || m.email || m.user_id.slice(0, 8);
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <div className="space-y-3">
        {queues.map((q) => (
          <Card key={q.id}>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 shrink-0 text-muted-foreground">
                  {q.attended_by === "ai" ? (
                    <Bot className="size-4" />
                  ) : (
                    <Users className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={q.name}
                      onChange={(e) =>
                        setQueues((prev) =>
                          prev.map((x) =>
                            x.id === q.id ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void patch(q.id, { name: e.target.value.trim() })
                      }
                      disabled={!canEditSettings}
                      className="h-8 max-w-xs"
                      maxLength={60}
                    />
                    {q.is_default && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("badgeDefault")}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("descriptionLabel")}</Label>
                    <Textarea
                      value={q.description ?? ""}
                      onChange={(e) =>
                        setQueues((prev) =>
                          prev.map((x) =>
                            x.id === q.id
                              ? { ...x, description: e.target.value }
                              : x,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void patch(q.id, {
                          description: e.target.value.trim() || null,
                        })
                      }
                      disabled={!canEditSettings}
                      rows={2}
                      maxLength={200}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("descriptionHint")}
                    </p>
                  </div>

                  {/* A fila do robô não tem responsável nem atribuição
                      automática: quem atende ali é o assistente. */}
                  {q.attended_by === "humans" && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          {t("responsibleLabel")}
                        </Label>
                        <Select
                          value={q.responsible_user_id ?? "none"}
                          onValueChange={(v) =>
                            void patch(q.id, {
                              responsible_user_id:
                                String(v) === "none" ? null : String(v),
                            })
                          }
                          disabled={!canEditSettings}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue>
                              {(value) => {
                                const id = String(value);
                                if (id === "none") return t("noResponsible");
                                const m = members.find((x) => x.user_id === id);
                                return m ? memberLabel(m) : id.slice(0, 8);
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              {t("noResponsible")}
                            </SelectItem>
                            {members.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {memberLabel(m)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t("responsibleHint")}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("slaLabel")}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={
                            q.sla_seconds ? Math.round(q.sla_seconds / 60) : ""
                          }
                          placeholder={t("slaPlaceholder")}
                          onChange={(e) =>
                            setQueues((prev) =>
                              prev.map((x) =>
                                x.id === q.id
                                  ? {
                                      ...x,
                                      sla_seconds: e.target.value
                                        ? Number(e.target.value) * 60
                                        : null,
                                    }
                                  : x,
                              ),
                            )
                          }
                          onBlur={(e) =>
                            void patch(q.id, {
                              // Vazio = sem SLA. É o padrão de propósito:
                              // alerta que ninguém pediu vira ruído, e
                              // ruído treina a equipe a ignorar alerta.
                              sla_seconds: e.target.value
                                ? Number(e.target.value) * 60
                                : null,
                            })
                          }
                          disabled={!canEditSettings}
                          className="h-8"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("slaHint")}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("autoAssignLabel")}</Label>
                        <div className="flex items-center gap-2 pt-1">
                          <Switch
                            checked={q.auto_assign}
                            onCheckedChange={(v) =>
                              void patch(q.id, { auto_assign: Boolean(v) })
                            }
                            disabled={!canEditSettings}
                          />
                          <span className="text-xs text-muted-foreground">
                            {q.auto_assign
                              ? t("autoAssignOn")
                              : t("autoAssignOff")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("autoAssignHint")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Transbordo. Avisar resolve quando existe quem
                      atenda; não resolve o Financeiro numa sexta às 19h.
                      Passado o prazo, a conversa muda de fila sozinha —
                      um salto só, para não virar pingue-pongue. */}
                  {q.attended_by === "humans" && queues.length > 1 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("overflowLabel")}</Label>
                        <Select
                          value={q.overflow_queue_id ?? "none"}
                          onValueChange={(v) =>
                            void patch(q.id, {
                              overflow_queue_id:
                                String(v) === "none" ? null : String(v),
                            })
                          }
                          disabled={!canEditSettings}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue>
                              {(value) => {
                                const id = String(value);
                                if (id === "none") return t("noOverflow");
                                return (
                                  queues.find((x) => x.id === id)?.name ?? id
                                );
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              {t("noOverflow")}
                            </SelectItem>
                            {queues
                              .filter((x) => x.id !== q.id)
                              .map((x) => (
                                <SelectItem key={x.id} value={x.id}>
                                  {x.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          {t("overflowAfterLabel")}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={
                            q.overflow_after_seconds
                              ? Math.round(q.overflow_after_seconds / 60)
                              : ""
                          }
                          placeholder={t("slaPlaceholder")}
                          onBlur={(e) =>
                            void patch(q.id, {
                              overflow_after_seconds: e.target.value
                                ? Number(e.target.value) * 60
                                : null,
                            })
                          }
                          onChange={(e) =>
                            setQueues((prev) =>
                              prev.map((x) =>
                                x.id === q.id
                                  ? {
                                      ...x,
                                      overflow_after_seconds: e.target.value
                                        ? Number(e.target.value) * 60
                                        : null,
                                    }
                                  : x,
                              ),
                            )
                          }
                          disabled={!canEditSettings}
                          className="h-8"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("overflowHint")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {canEditSettings && !q.is_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(q)}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {canEditSettings && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Label className="text-sm font-medium">{t("newTitle")}</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newNamePlaceholder")}
                maxLength={60}
              />
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t("newDescriptionPlaceholder")}
                maxLength={200}
              />
            </div>
            <Button
              size="sm"
              onClick={() => void createQueue()}
              disabled={!newName.trim() || creating}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("create")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("newHint")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
