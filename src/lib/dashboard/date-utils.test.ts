import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOW_SHORT_MON_FIRST,
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from "./date-utils";

describe("startOfLocalDay", () => {
  it("zeroes out the time of a given date", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const out = startOfLocalDay(d);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
    expect(out.getFullYear()).toBe(d.getFullYear());
    expect(out.getMonth()).toBe(d.getMonth());
    expect(out.getDate()).toBe(d.getDate());
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const before = d.getTime();
    startOfLocalDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns midnight N days before today", () => {
    const out = daysAgoStart(3);
    expect(out.getHours()).toBe(0);
    expect(out.getDate()).toBe(15);
    expect(out.getMonth()).toBe(4); // May
    expect(out.getFullYear()).toBe(2026);
  });

  it("daysAgoStart(0) is today at midnight", () => {
    const out = daysAgoStart(0);
    expect(out.getDate()).toBe(18);
    expect(out.getHours()).toBe(0);
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    const out = daysAgoStart(5);
    expect(out.getMonth()).toBe(3); // April (0-indexed)
    expect(out.getDate()).toBe(27);
  });
});

describe("localDayKey", () => {
  it("emits YYYY-MM-DD in local components", () => {
    const d = new Date(2026, 0, 9, 23, 59); // Jan 9, locally
    expect(localDayKey(d)).toBe("2026-01-09");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2026, 8, 5); // Sep 5
    expect(localDayKey(d)).toBe("2026-09-05");
  });

  it("accepts ISO strings as input", () => {
    expect(localDayKey("2026-12-31T23:00:00")).toBe("2026-12-31");
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(3)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    expect(lastNDayKeys(4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("mondayIndex", () => {
  // `new Date(ano, mês, dia)` e NÃO `new Date("2026-05-18")`.
  //
  // A string só-data é parseada como meia-noite UTC. Em São Paulo
  // (UTC−3) isso é domingo às 21h, então `getDay()` devolve domingo e
  // o teste falha — mas só em fuso atrás de Greenwich. Era assim que
  // estes dois passavam num CI em UTC e quebravam na máquina de quem
  // desenvolve aqui.
  //
  // A forma numérica é meia-noite LOCAL em qualquer fuso, que é
  // exatamente o contrato de `mondayIndex`: o dia da semana de quem
  // está olhando. Os chamadores reais passam instantes de verdade
  // (`new Date()` e o timestamptz do Postgres), nunca strings assim.
  const seg = new Date(2026, 4, 18); // segunda, 18/05/2026
  const ter = new Date(2026, 4, 19);
  const sab = new Date(2026, 4, 23);
  const dom = new Date(2026, 4, 24);

  it("maps Monday → 0 and Sunday → 6", () => {
    expect(mondayIndex(seg)).toBe(0);
    expect(mondayIndex(ter)).toBe(1);
    expect(mondayIndex(sab)).toBe(5);
    expect(mondayIndex(dom)).toBe(6);
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(DOW_SHORT_MON_FIRST[mondayIndex(seg)]).toBe("Mon");
    expect(DOW_SHORT_MON_FIRST[mondayIndex(dom)]).toBe("Sun");
  });

  it("reads the LOCAL day, which is what the dashboard charts want", () => {
    // Fixa a armadilha para ela não voltar. Num fuso atrás de UTC, o
    // mesmo "18 de maio" escrito das duas formas é dia da semana
    // diferente — e a diferença não é bug de `mondayIndex`, é o
    // significado de cada construtor.
    const meiaNoiteUtc = new Date("2026-05-18T00:00:00Z");
    const offsetMin = meiaNoiteUtc.getTimezoneOffset();
    if (offsetMin > 0) {
      // Atrás de Greenwich (o caso do Brasil): ainda é domingo.
      expect(mondayIndex(meiaNoiteUtc)).toBe(6);
    }
    expect(mondayIndex(seg)).toBe(0);
  });
});
