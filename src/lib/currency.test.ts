import { describe, expect, it } from "vitest";
import {
  appLocale,
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatCurrencyShort,
} from "./currency";

describe("formatCurrency", () => {
  // Estes testes passam o locale EXPLICITAMENTE.
  //
  // A versão anterior chamava `formatCurrency(1234, "USD")` e exigia
  // "1,234" — separador de milhar do inglês. Passava num CI em en-US e
  // quebrava na máquina de quem desenvolve no Brasil, onde o mesmo
  // valor é "1.234".
  //
  // E o teste vermelho tinha razão sobre algo maior: `formatCurrency`
  // passava `undefined` ao Intl, ou seja, seguia o locale do NAVEGADOR
  // e não o do app. Uma instalação declarada pt-BR renderizava
  // "R$1,234" para quem estivesse num computador em inglês. Afirmar
  // um separador específico sem dizer QUAL locale é justamente o
  // descuido que escondeu isso.
  it("formats whole amounts with no minor units", () => {
    const out = formatCurrency(1234, "USD", "en-US");
    expect(out).toContain("1,234");
    expect(out).not.toContain(".00");
  });

  it("follows the locale it is given, not the machine's", () => {
    // A regressão que motivou o parâmetro. O agrupamento e o espaço
    // depois do símbolo mudam com o locale, e a cliente brasileira
    // precisa do de baixo.
    expect(formatCurrency(1234, "BRL", "en-US")).toBe("R$1,234");
    expect(formatCurrency(1234, "BRL", "pt-BR")).toContain("1.234");
    expect(formatCurrency(1234, "BRL", "pt-BR")).not.toContain("1,234");
  });

  it("defaults to the APP locale, never the browser's", () => {
    // Sem terceiro argumento cai em `appLocale()`, lido de
    // NEXT_PUBLIC_APP_LOCALE. O que não pode acontecer nunca mais é
    // cair no locale do sistema operacional de quem estiver olhando.
    const semLocale = formatCurrency(1234, "BRL");
    const comAppLocale = formatCurrency(1234, "BRL", appLocale());
    expect(semLocale).toBe(comAppLocale);
  });

  it("defaults to DEFAULT_CURRENCY (BRL) when no currency is given", () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("treats an empty-string currency as the default", () => {
    expect(formatCurrency(10, "")).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("coerces non-finite values to 0", () => {
    expect(formatCurrency(Number.NaN, "USD")).toContain("0");
  });

  it("groups thousands in whatever way the locale groups them", () => {
    // O ponto destes é "não perdeu dígito e não virou notação
    // científica", não "usa vírgula". Afirmar o separador aqui seria
    // reintroduzir a dependência de máquina por outra porta.
    for (const loc of ["en-US", "pt-BR", "ko-KR"]) {
      const out = formatCurrency(1234, "USD", loc);
      expect(out.replace(/\D/g, "")).toBe("1234");
    }
  });

  it("renders a well-formed but unknown ISO code without throwing", () => {
    // Intl is lenient here — it uses the code as the symbol.
    const out = formatCurrency(1234, "ZZZ", "en-US");
    expect(out).toContain("ZZZ");
    expect(out).toContain("1,234");
  });

  it("never throws on a structurally invalid code (no DB CHECK on deals.currency)", () => {
    for (const bad of ["United States", "US", "USDD", "12", "u$d"]) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      expect(formatCurrency(1234, bad, "en-US")).toContain("1,234");
    }
  });

  it("formats every offered currency without throwing", () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe("formatCurrencyShort", () => {
  it("abbreviates millions and thousands with the currency symbol", () => {
    expect(formatCurrencyShort(2_500_000, "USD")).toBe("$2.5M");
    expect(formatCurrencyShort(3_400, "USD")).toBe("$3.4k");
    expect(formatCurrencyShort(900, "USD")).toBe("$900");
  });

  it("uses the matching symbol for non-USD currencies", () => {
    expect(formatCurrencyShort(1_000, "EUR")).toBe("€1.0k");
    expect(formatCurrencyShort(1_000, "INR")).toBe("₹1.0k");
  });

  it("falls back to the code prefix for unknown currencies (no throw)", () => {
    expect(formatCurrencyShort(1_000, "ZZZ")).toBe("ZZZ 1.0k");
  });
});
