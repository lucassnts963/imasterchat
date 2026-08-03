"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // A fita de chips de `section-nav.ts` — o mesmo desenho da
        // navegação de Configurações, para uma tela de painéis não
        // parecer outro app. Ela ROLA SOZINHA: sem
        // `group-data-horizontal/tabs:h-auto` a lista fica presa nos 8
        // de altura da variante padrão e os chips (py-2) vazam por
        // fora; sem `w-full`+`overflow-x-auto` ela cresce além da
        // viewport e quem rola de lado é a página inteira.
        rail:
          "flex w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 pb-2" +
          " group-data-horizontal/tabs:h-auto" +
          " [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Variante `rail` — ESPELHA `sectionNavItem` em
        // `src/components/ui/section-nav.ts`, classe por classe. O
        // prefixo por variante é obrigatório (o Tailwind precisa lê-lo
        // no fonte), e é por isso que não dá para importar de lá.
        // Mexeu em um, mexe no outro.
        //
        // `flex-none` desfaz o `flex-1` da base: aqui os chips guardam
        // a largura do rótulo e transbordam de propósito — é esse
        // transbordo que a rolagem da lista resolve. Com `flex-1` eles
        // se espremeriam e nunca haveria o que rolar.
        "group-data-[variant=rail]/tabs-list:h-auto group-data-[variant=rail]/tabs-list:flex-none group-data-[variant=rail]/tabs-list:shrink-0 group-data-[variant=rail]/tabs-list:justify-start group-data-[variant=rail]/tabs-list:gap-2.5 group-data-[variant=rail]/tabs-list:rounded-lg group-data-[variant=rail]/tabs-list:border-transparent group-data-[variant=rail]/tabs-list:px-3 group-data-[variant=rail]/tabs-list:py-2 group-data-[variant=rail]/tabs-list:text-left group-data-[variant=rail]/tabs-list:text-muted-foreground group-data-[variant=rail]/tabs-list:transition-colors group-data-[variant=rail]/tabs-list:hover:bg-muted group-data-[variant=rail]/tabs-list:hover:text-foreground",
        "group-data-[variant=rail]/tabs-list:data-active:bg-primary-soft group-data-[variant=rail]/tabs-list:data-active:text-primary dark:group-data-[variant=rail]/tabs-list:data-active:border-transparent dark:group-data-[variant=rail]/tabs-list:data-active:bg-primary-soft dark:group-data-[variant=rail]/tabs-list:data-active:text-primary",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "flex-1 text-sm outline-none",
        // Hide the panel on its way out.
        //
        // Base UI keeps an exiting panel mounted until its CSS
        // transition ends, and marks it `inert` meanwhile. These panels
        // declare no transition, so `transitionend` never fires and the
        // panel stays mounted — laid out, taking full height, forever.
        // Every tab on a screen ended up stacked: on /admin the pricing
        // card started 1200px down, and on the agents page all five
        // panels ran at once, canvas animation loop included.
        //
        // Keyed on `inert` because that is what Base UI actually sets,
        // and it is exactly the elements that should not be on screen.
        "[&[inert]]:hidden",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
