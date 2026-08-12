# Whisper: o limite medido e como sair dele

Como a transcrição local se comporta sob carga, por que ela **não**
escala aumentando a máquina, e o que muda para movê-la a uma VPS
própria.

Tudo aqui foi medido ou lido no código-fonte. As medições estão
identificadas com a máquina e a data; refaça antes de confiar em número
velho.

---

## O achado que governa tudo o mais

**O serviço transcreve um áudio por vez. Sempre. Independente de quantos
núcleos você der a ele.**

Não é configuração nem limite de recurso — é um mutex no código do
`openai-whisper-asr-webservice`. A classe base declara o cadeado como
atributo de **classe**, portanto compartilhado por todas as requisições:

```python
# app/asr_models/asr_model.py
class ASRModel(ABC):
    model = None
    model_lock = Lock()
```

E o motor do faster-whisper embrulha a transcrição inteira nele:

```python
# app/asr_models/faster_whisper_engine.py
with self.model_lock:
    segment_generator, info = self.model.transcribe(audio, beam_size=5, **options_dict)
    for segment in segment_generator:
        ...
```

Não há variável de ambiente que desligue isso. A documentação oficial de
variáveis não expõe nenhum ajuste de concorrência — e é coerente: o
cadeado existe porque o modelo carregado é um objeto só.

### A medição

Feita **em produção, 11/08/2026**, no container `whisper-whisper-1`
(faster_whisper, modelo `small`, `int8`, limite de `cpus: "2.0"`),
disparando o mesmo áudio de 20 s várias vezes:

| pedidos simultâneos | tempo de parede | se fosse paralelo | se fosse fila |
|---|---|---|---|
| 1 | **5,3 s** | 5,3 s | 5,3 s |
| 2 | **10,3 s** | 5,3 s | 10,6 s |
| 4 | **21,0 s** | 5,3 s | 21,2 s |

Linear, dentro do erro de medição. É fila.

E repare na coluna que não está na tabela: com 4 simultâneos, **os
quatro** levaram 21,0 s — ninguém termina cedo. Quem chega por último
paga a fila inteira, e é isso que quebra sob pico.

O primeiro pedido depois de o container subir levou 6,2 s: é o
carregamento do modelo, pago uma vez (com `MODEL_IDLE_TIMEOUT=0`, o
padrão, ele nunca é descarregado).

> **Ressalva honesta:** o áudio usado foi sintético (tom + ruído), não
> fala real. O custo do *encoder* — que domina — independe do conteúdo,
> e a conclusão sobre serialização independe por completo dele. Mas o
> tempo absoluto com fala real pode diferir; trate 5,3 s como ordem de
> grandeza, não como constante.

---

## O limite prático de hoje

O app chama o serviço em `src/lib/audio/transcribe.ts:148`, com timeout
de 120 s (`TIMEOUT_MS`, linha 48). Combinando com a fila medida:

```
120 s de timeout ÷ 5,3 s por áudio ≈ 22 áudios
```

**A partir do 23º áudio simultâneo, o pedido estoura o timeout.** O que
acontece então está em `transcribe.ts:68` — devolve `null`, sem lançar —
e a política cai no aviso (`decideAudioAction` trata transcrição vazia
como `notice`). O cliente recebe "não consegui ouvir, pode escrever?"
em vez de silêncio, que é o comportamento correto para uma falha. Mas em
escala isso é o produto se degradando sem ninguém ver.

Pior: `handleInboundAudio` roda **antes** do insert da mensagem
(`src/lib/audio/inbound.ts`), dentro do processamento do webhook. Cada
áudio na fila segura uma execução do lado do app enquanto espera.

> Isso se conecta ao item 1 de [`pendencias.md`](./pendencias.md): com a
> fila de webhook persistida em banco, o dreno passa a ser o regulador
> natural também da transcrição, e um pico de áudio deixa de ser um
> pico de requisições paradas.

### Quantos áudios simultâneos são realistas?

Depende inteiramente do ramo. Numa ótica, áudio é minoria das mensagens.
Num cliente de cobrança ou suporte, pode ser maioria. **Não estime —
meça**: a coluna `content_type = 'audio'` em `messages` responde isso
para cada conta que já esteja rodando.

---

## Por que aumentar a máquina resolve pouco

Aumentar núcleos deixa **cada** transcrição mais rápida (o CTranslate2
usa vários threads por transcrição), mas **não** aumenta quantas rodam
ao mesmo tempo — o cadeado continua deixando passar uma.

O ganho por núcleo também satura: dobrar de 2 para 4 núcleos não corta o
tempo pela metade, porque parte do trabalho não paraleliza. Vale medir
antes de comprar máquina.

**A escala aqui é horizontal: mais réplicas, não mais máquina.** Cada
réplica é um processo com o próprio modelo carregado — e portanto o
próprio cadeado.

Custo de memória por réplica, modelo `small` em `int8`: o limite atual
de 3 GB foi dimensionado com folga; o consumo real de regime fica bem
abaixo. Meça com `docker stats` antes de dimensionar a VPS nova.

---

## Mover para uma VPS própria

O app já está pronto: ele fala com o serviço por HTTP, pelo endereço em
`WHISPER_URL` (`transcribe.ts:129`). Trocar `http://whisper:9000` por um
endereço remoto é mudança de variável de ambiente, sem rebuild — ela
não é `NEXT_PUBLIC_*`.

O que **não** está pronto é a segurança do salto.

### O problema: o serviço não tem autenticação nenhuma

Confirmado no código-fonte e na documentação: não há chave de API, nem
token, nem qualquer verificação antes do `/asr`. Hoje isso é aceitável
porque ele vive só na rede interna do Docker, sem porta publicada — a
regra da infra é que **só o Caddy publica porta**.

No momento em que ele passa a atender outra máquina, essa premissa cai.
Um `/asr` aberto na internet é CPU grátis para quem achar, e o abuso
aparece como "o WhatsApp ficou lento", não como um alerta.

**Três formas de fechar, em ordem de preferência:**

1. **Rede privada entre as VPS** (WireGuard, ou a rede privada do
   provedor). O serviço continua sem autenticação porque continua
   inalcançável de fora. É o desenho que preserva a invariante atual em
   vez de abrir exceção a ela.
2. **Caddy na frente, com autenticação.** O Whisper fica em `127.0.0.1`
   na VPS nova, o Caddy publica com `basic_auth` ou verificação de
   cabeçalho, e o app manda a credencial. Exige um campo novo no app —
   hoje `viaLocal` não envia cabeçalho nenhum (`transcribe.ts:148`).
3. **mTLS.** Mais forte e mais trabalhoso; só vale se o áudio de saúde
   ou jurídico exigir por contrato.

A opção 1 não exige tocar no código do app. As outras duas exigem, e
esse é o principal argumento a favor da primeira.

### Balanceamento entre réplicas

Com duas ou mais réplicas, alguma coisa precisa distribuir. O Caddy faz
isso nativamente (`reverse_proxy` com vários upstreams), e a política
que importa aqui é **`least_conn`**, não round-robin: como cada réplica
processa um áudio por vez, mandar para a que tem menos conexões abertas
é exatamente mandar para a que está livre.

Round-robin, com transcrições de durações diferentes, empilha pedido em
réplica ocupada enquanto outra está ociosa.

### Um detalhe que economiza minutos por deploy

O modelo (~500 MB) baixa na primeira execução. Sem volume nomeado, **toda
recriação do container baixa de novo**, e o primeiro áudio depois do
deploy demora minutos — que o cliente lê como "parou de responder". O
compose atual já resolve isso com o volume `whisper-models`; a VPS nova
precisa do mesmo cuidado, e cada réplica precisa do seu (ou de um
volume compartilhado somente-leitura, se o provedor permitir).

---

## Quando NÃO fazer nada disso

A ElevenLabs é escolha de tela, por conta, em **Agentes → Regras**. Ela
não tem fila nossa, não gasta CPU e é mais precisa em áudio ruim de
celular. O preço é por minuto, e o áudio sai para um terceiro.

Para a maioria dos clientes, subir uma VPS de transcrição é engenharia
para um problema que uma caixa de seleção resolve. O caso do Whisper
local é específico e forte, e é sempre o mesmo: **o áudio não pode sair
da nossa máquina** — paciente, contrato, cobrança.

A ordem de decisão que faz sentido:

1. O cliente exige que o áudio não saia? Se não, ElevenLabs e acabou.
2. Exige, e o volume de áudio é baixo? Whisper na mesma VPS, como hoje.
3. Exige, e o volume derruba o tempo de resposta? Aí sim: VPS própria,
   réplicas, `least_conn` e rede privada.

Chegar em 3 sem medir o 2 é gastar máquina para não descobrir nada.

---

## O que medir antes de decidir

| pergunta | onde responder |
|---|---|
| Quantos áudios por dia, e em que horário? | `messages` com `content_type = 'audio'` |
| Qual a duração típica? | a duração vem no payload da Meta |
| Quantos chegam na mesma janela de 30 s? | a mesma consulta, agrupada por minuto |
| A transcrição está estourando timeout? | `[audio] transcrição falhou` no log do app |
| Quanto o container realmente consome? | `docker stats whisper-whisper-1` |

O terceiro é o número que decide. Os outros contextualizam.

---

## Fontes

- Código do serviço: [`asr_model.py`](https://github.com/ahmetoner/whisper-asr-webservice/blob/main/app/asr_models/asr_model.py)
  e [`faster_whisper_engine.py`](https://github.com/ahmetoner/whisper-asr-webservice/blob/main/app/asr_models/faster_whisper_engine.py) — o cadeado
- [Variáveis de ambiente](http://ahmetoner.com/whisper-asr-webservice/environmental-variables/) — confirma `ASR_QUANTIZATION`,
  `MODEL_IDLE_TIMEOUT` (padrão 0 = nunca descarrega) e a ausência de
  qualquer ajuste de concorrência
- Medição própria em produção, 11/08/2026 (tabela acima)
- Lado do app: `src/lib/audio/transcribe.ts`, `src/lib/audio/inbound.ts`
- Infra: `infra/services/whisper/compose.yml`
