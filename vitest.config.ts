import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // Fuso fixo, e São Paulo em vez de UTC de propósito.
    //
    // Cinco testes passavam num CI em UTC e falhavam na máquina do
    // desenvolvedor brasileiro — ou seja, quebravam justamente onde o
    // ambiente se parecia com o da cliente. Rodar a suíte no fuso do
    // mercado faz o inverso: se algo só funciona em UTC, quebra aqui,
    // que é onde deve quebrar.
    //
    // Isto NÃO substitui escrever teste independente de ambiente — é a
    // rede embaixo. Datas em teste devem ser construídas com
    // `new Date(ano, mês, dia)`, que é local e sem ambiguidade, e não
    // com `new Date("2026-05-18")`, que é meia-noite UTC.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      TZ: "America/Sao_Paulo",
      // Dummy secrets — encryption.ts / webhook-signature.ts read these
      // at module load. Tests never hit a real Meta/Supabase service, so
      // any 32-byte hex / non-empty string will do; keep them lexically
      // identical to the CI build env so behaviour matches.
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});
