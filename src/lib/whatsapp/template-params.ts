// ============================================================
// Variáveis de template, na ordem que a Meta espera.
//
// Templates da Meta usam marcadores POSICIONAIS — `{{1}}`, `{{2}}`, … —
// então os parâmetros têm de sair em ordem numérica estrita.
//
// A ordenação lexicográfica de "1", "2", …, "10" dá "1", "10", "2", …, o
// que embaralha silenciosamente todo template com dez ou mais variáveis:
// o cliente recebe o nome no lugar do valor e ninguém vê erro nenhum,
// porque para a Meta a mensagem foi entregue.
//
// Vive aqui, e não dentro de um motor, porque três lugares mandam
// template — automação, fluxo e broadcast — e a ordem tem de ser a mesma
// nos três. Era esta função copiada que a fase 1 existe para não deixar
// acontecer de novo.
// ============================================================

export function templateParams(
  variables: Record<string, unknown> | null | undefined,
  /** Aplicado a cada valor antes de virar string. É por onde o motor
   *  passa a própria interpolação de `{{ vars.X }}`. */
  transform: (value: string) => string = (v) => v,
): string[] {
  if (!variables) return []
  return Object.keys(variables)
    .sort(compareKeys)
    .map((key) => transform(String(variables[key])))
}

/**
 * Numérico quando os dois lados são números, e só então. Chaves não
 * numéricas existem em configurações antigas e em templates nomeados;
 * ordenar essas alfabeticamente é arbitrário, mas estável — e estável é
 * o que importa para o mesmo template render sempre igual.
 */
function compareKeys(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  const aNum = Number.isFinite(na)
  const bNum = Number.isFinite(nb)
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a.localeCompare(b)
}
