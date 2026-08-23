import { cn } from '@/lib/utils'

// ============================================================
// O padrão de navegação por seção do app: uma fita de chips que rola
// SOZINHA quando não cabe, em vez de esticar a página.
//
// Vive fora de quem usa porque duas telas o adotam por caminhos
// diferentes — `settings-rail.tsx` monta `<nav>` com botões (é
// navegação, e vira coluna no desktop), e a tela de agentes monta
// `<TabsList variant="rail">` do Base UI (são painéis, e precisa do
// teclado e do `aria-selected` que vêm de graça ali). Sem este arquivo
// as duas ficariam com o mesmo visual escrito duas vezes, que dura até
// a primeira vez que alguém ajusta uma delas.
//
// A variante `rail` em `tabs.tsx` ESPELHA `sectionNavItem` classe por
// classe. Não dá para importar de lá: cada classe precisa do prefixo
// `group-data-[variant=rail]/tabs-list:` para valer só naquela
// variante, e prefixo é coisa que o Tailwind lê no fonte, não em
// tempo de execução. Mexeu aqui, mexe lá.
// ============================================================

/**
 * O contêiner da fita.
 *
 * `overflow-x-auto` é o ponto inteiro: um contêiner de rolagem tem
 * tamanho mínimo automático ZERO, então ele encolhe até caber e leva a
 * rolagem para dentro de si. Sem isso a fita empurra a largura do
 * `<main>`, e quem rola de lado é a tela toda — cabeçalho junto.
 *
 * A barra some (`scrollbar-width:none` + o pseudo-elemento do WebKit)
 * porque no desktop ela apareceria por cima do conteúdo sem nunca ser
 * usada; no toque a rolagem é o próprio dedo.
 */
export const SECTION_NAV_SCROLLER =
  'flex gap-1 overflow-x-auto border-b border-border pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/**
 * Um chip da fita.
 *
 * `shrink-0` + `whitespace-nowrap`: o item mantém o tamanho do rótulo e
 * transborda de propósito — é o transbordo que a rolagem do contêiner
 * resolve. Deixá-lo encolher espremeria cinco rótulos em nada legível.
 */
export function sectionNavItem(isActive: boolean, className?: string) {
  return cn(
    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
    isActive
      ? 'bg-primary-soft text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    className,
  )
}
