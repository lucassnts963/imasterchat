import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Stub mínimo do SupabaseClient. O builder é THENABLE, como o de
  // verdade: qualquer cadeia de filtros resolve quando aguardada.
  //
  // Antes o stub resolvia em `.like()`, o que amarrava o teste à forma
  // exata da consulta — e ele quebrou quando a busca passou a usar
  // igualdade sobre `phone_suffix8` (migração 064), sem que o
  // comportamento tivesse mudado. Um teste que quebra por refatoração
  // que preserva comportamento está medindo a coisa errada.
  //
  // `filters` fica exposto para o teste que confere QUE coluna foi
  // consultada — essa parte, sim, importa: voltar para `LIKE '%sufixo'`
  // não teria índice e não seria pego por nenhuma outra asserção.
  function stubDb(rows: Array<{ id: string; phone: string }>): {
    db: SupabaseClient;
    filters: Array<[string, unknown]>;
  } {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      like: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return {
      db: { from: () => builder } as unknown as SupabaseClient,
      filters,
    };
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const { db } = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const { db } = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const { db } = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });

  // Esta consulta roda em TODA mensagem recebida. Antes da 064 ela era
  // `LIKE '%<8 dígitos>'` sobre a coluna crua — curinga à esquerda, que
  // nenhum índice atende, então o custo de receber uma mensagem crescia
  // com o tamanho da agenda do cliente.
  //
  // Nada mais neste arquivo pegaria uma volta a `LIKE`: o resultado
  // seria idêntico. Por isso o teste olha a consulta, e não a resposta.
  it("filtra pela coluna indexada, e não por LIKE com curinga à esquerda", async () => {
    const { db, filters } = stubDb([{ id: "c1", phone: "37063949836" }]);
    await findExistingContact(db, "acct", "+370 063 949 836");

    expect(filters).toContainEqual(["account_id", "acct"]);
    expect(filters).toContainEqual(["phone_suffix8", "63949836"]);
    expect(filters.every(([col]) => col !== "phone")).toBe(true);
  });

  // Número curto: `right(x, 8)` no banco devolve a string inteira, e o
  // `slice(-8)` do TS também. Os dois lados precisam concordar, senão a
  // busca não acha o contato e o sistema cria duplicata em silêncio.
  it("usa o número inteiro como sufixo quando ele tem menos de 8 dígitos", async () => {
    const { db, filters } = stubDb([]);
    await findExistingContact(db, "acct", "12345");
    expect(filters).toContainEqual(["phone_suffix8", "12345"]);
  });
});
