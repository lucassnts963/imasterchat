# Fase 5 — Módulo de integrações

> Especificação. **Nenhum código escrito.**
>
> Fundamentação em [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §3.
>
> O **item 1** (planilha + webhook genérico) entra **junto com a fase 4** — é a
> fonte de dados que a régua precisa. O resto vem depois.

---

## 1. Objetivo

Duas coisas ao mesmo tempo:

1. **Técnica:** dar à régua uma fonte de dados sem amarrá-la a nenhum fornecedor.
2. **Comercial:** ter uma **seção de integrações** no produto, com um catálogo
   visível, que é argumento de venda mesmo antes de metade dela existir.

---

## 2. O desenho — já construímos esse padrão

O catálogo de provedores de IA (`src/lib/ai/providers/catalog.ts`) é exatamente
a forma: uma lista única do que o sistema sabe falar, um adaptador por formato, e
a tela lendo da **mesma lista** que o executor.

```
src/lib/integrations/
  catalog.ts          ← a lista: id, rótulo, o que faz, onde pegar a chave
  types.ts            ← a interface que todo adaptador implementa
  planilha/           ← importador CSV/XLSX
  webhook/            ← endpoint genérico de entrada
  asaas/
  clube-associados/
```

### R-29 · Catálogo e contrato — `M`

- **A1** `catalog.ts` com uma entrada por sistema: id, rótulo, o que faz, onde
  pegar a credencial, e o que a integração **fornece** (cobranças · pagamentos ·
  contatos).
- **A2** A tela lê do catálogo. **Uma lista, não duas** — foi essa duplicação que
  já corrigimos duas vezes neste repositório.
- **A3** Interface pequena, e é o que mantém a régua ignorante de quem manda os
  dados:
  - `listarCobrancasAbertas(desde)` — o que está em aberto
  - `consultarCobranca(idExterno)` — pagou?
  - `verificarWebhook(req)` — quando o sistema empurra (opcional)
- **A4** Tabela `integrations` por conta: provedor, credenciais cifradas com o
  **mesmo AES-256-GCM** do resto, status, último sync, último erro. Nenhum
  mecanismo novo.
- **A5** Adaptador que não implementa `verificarWebhook` é varrido; o catálogo
  declara qual dos dois é, e a tela mostra a **janela de erro** que isso implica
  (fase 4, R-25 H3).

### R-30 · Estado e diagnóstico — `P`

Integração que falha em silêncio é pior que integração que não existe.

- **B1** Última sincronização, quantos registros vieram, quantos casaram com
  contato, quantos ficaram órfãos.
- **B2** Último erro, com a mensagem do fornecedor, visível ao operador.
- **B3** Botão "sincronizar agora", que é também o teste de credencial — mesma
  disciplina de "verificar antes de salvar" que a configuração de IA e a do
  WhatsApp já usam.

---

## 3. A ordem de implementação

| # | Sistema | Por que nesta posição |
|---|---|---|
| **1** | **Planilha + webhook genérico** | atende **todo cliente cujo sistema não tem API** — que vai ser a maioria. Faz o módulo de cobrança funcionar no primeiro dia, sem integração nenhuma. **Comercialmente, é a peça mais importante da fase** |
| **2** | **Asaas** | [documentação pública](https://docs.asaas.com/), webhooks de cobrança gerada, paga, falha e cancelada. Enorme entre PMEs brasileiras. É o que dá para construir **hoje**, sem depender de ninguém |
| **3** | **Clube de Associados** | o caso concreto do cliente, mas ainda sem documentação em mãos (D-2) |
| 4 | Iugu · Vindi · Superlógica | recorrência e assinaturas, APIs e webhooks documentados; Superlógica é forte em condomínio e imobiliária |
| 5 | Conta Azul · Omie · Bling | ERPs com API; entram quando aparecer cliente pedindo |

---

## 4. Item 1 — o genérico (entra com a fase 4)

### R-31 · Importador de planilha — `M`

- **C1** Upload de CSV/XLSX com mapeamento de colunas na tela — o cliente não vai
  reformatar a planilha dele.
- **C2** Pré-visualização antes de gravar: quantas linhas, quantas casam com
  contato existente, quantas ficam órfãs, quantas são duplicata de importação
  anterior.
- **C3** Chave de deduplicação declarada pelo operador (id externo, ou
  telefone + vencimento + valor). Sem isso, reimportar a planilha do mês duplica
  a carteira.
- **C4** Importação é **transacional por arquivo**: ou entra inteira, ou não
  entra. Meia carteira importada é pior que nenhuma.
- **C5** Registro de qual importação criou cada cobrança, e desfazer de uma
  importação inteira.

### R-32 · Webhook genérico de entrada — `M`

Um endpoint nosso que qualquer sistema chama.

- **D1** `POST /api/v1/cobrancas` com token por conta — reusa a autenticação da
  API pública que já existe (`docs/public-api.md`).
- **D2** Mapeamento de campos configurável por conta: o cliente aponta qual
  chave do JSON dele é valor, vencimento, telefone.
- **D3** Idempotente por `(origem, id_externo)`. Reentrega do fornecedor não
  duplica.
- **D4** Endpoint irmão para **baixa**: `POST /api/v1/cobrancas/{id}/pagamento`.
  É o que dá parada em segundos a quem não tem webhook de plataforma.
- **D5** Payload cru guardado por N dias para depuração — sem isso, "o meu
  sistema mandou e não chegou" é indiscutível.

---

## 5. Item 3 — Clube de Associados (D-2)

O cliente diz que tem API aberta. **Não foi possível confirmar**: o produto
existe ([clubesassociados.com.br](https://clubesassociados.com.br/), gestão para
clubes e associações), mas não há documentação pública de API e o site está
bloqueado pelo proxy deste ambiente.

**Três respostas antes de estimar:**

1. **A documentação.** URL, ou o PDF que o fornecedor mandou.
2. **Como autentica** — chave fixa, OAuth, token por sessão?
3. **Empurra ou a gente puxa?** Tem webhook de "pagamento recebido", ou vamos ter
   de varrer periodicamente?

A terceira muda o desenho. Com webhook, um pagamento cancela o próximo degrau em
segundos. Sem webhook, existe a janela de erro do R-29 A5.

> **Enquanto não chegar:** o cliente do Clube usa o item 1. Planilha exportada do
> sistema dele, ou o webhook genérico se o Clube souber chamar uma URL. Isso não
> é gambiarra de transição — é o desenho, e o adaptador dedicado só melhora a
> frequência de atualização.

---

## 6. Critérios de aceite

1. A tela de integrações lista o catálogo inteiro, com o que está conectado e o
   que não está — e a lista vem do mesmo lugar que o executor usa.
2. Uma planilha de 500 linhas importa, mostra o resumo antes de gravar, e
   reimportar o mesmo arquivo não duplica nada.
3. Um POST no webhook genérico cria uma cobrança e um segundo POST igual não cria
   outra.
4. Uma baixa via webhook para o próximo degrau daquele título.
5. Credencial errada é recusada no "sincronizar agora", com a mensagem do
   fornecedor na tela, e **não** é salva.
6. Trocar de fornecedor troca o adaptador — a régua não muda uma linha.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| **Catálogo e tela divergirem** | A2: uma lista só. É o defeito que este repositório já teve duas vezes |
| **Importação parcial** | C4: transacional por arquivo |
| **Reimportação duplicando carteira** | C3 + D3: chave de deduplicação obrigatória |
| **Depender do Clube para entregar** | §5: o cliente do Clube é atendido pelo item 1 desde o primeiro dia |
| **Credencial de terceiro vazando** | A4: mesmo AES-256-GCM já usado para chave de IA e token da Meta |

---

## 8. Estimativa

| Item | Esforço | Quando |
|---|---|---|
| R-29 catálogo e contrato | ~3 dias | com a fase 4 |
| R-30 estado e diagnóstico | ~2 dias | com a fase 4 |
| R-31 importador de planilha | ~5 dias | com a fase 4 |
| R-32 webhook genérico | ~4 dias | com a fase 4 |
| Asaas | ~1 semana | depois |
| Clube de Associados | **não estimável** | quando D-2 for respondida |

**Núcleo ~2,5 semanas**, sobreposto à fase 4. Asaas e Clube são incrementos.
