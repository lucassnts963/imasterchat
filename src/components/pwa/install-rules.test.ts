import { describe, it, expect } from 'vitest';

import { detectPlatform, shouldOffer } from './install-rules';

// A promessa que estes testes seguram: marcar "não exibir novamente"
// vale para sempre neste aparelho. Um convite que reaparece depois de
// dispensado é pior do que convite nenhum.

describe('shouldOffer', () => {
  const base = { dismissedForever: false, snoozed: false, installed: false };

  it('oferece para quem ainda não disse nada e não instalou', () => {
    expect(shouldOffer(base)).toBe(true);
  });

  it('não oferece depois de "não exibir novamente"', () => {
    expect(shouldOffer({ ...base, dismissedForever: true })).toBe(false);
  });

  it('a recusa definitiva vence tudo, inclusive sessão nova', () => {
    // `snoozed: false` é exatamente o estado de quem fechou o navegador
    // e voltou: a sessão zerou. A caixa marcada tem que continuar
    // valendo — é aqui que um "|| " trocado por "&&" seria pego.
    expect(
      shouldOffer({ dismissedForever: true, snoozed: false, installed: false }),
    ).toBe(false);
  });

  it('não oferece a quem só fechou o card nesta sessão', () => {
    expect(shouldOffer({ ...base, snoozed: true })).toBe(false);
  });

  it('não oferece a quem já está com o app instalado', () => {
    expect(shouldOffer({ ...base, installed: true })).toBe(false);
  });
});

describe('detectPlatform', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const IPAD_AS_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
  const MAC_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  it('reconhece iPhone', () => {
    expect(detectPlatform(IPHONE)).toBe('ios');
  });

  it('reconhece Android', () => {
    expect(detectPlatform(ANDROID)).toBe('android');
  });

  it('trata o iPad disfarçado de Mac como iOS', () => {
    // O iPad manda um UA de Macintosh. Sem o toque, cairia em desktop e
    // receberia a instrução de um ícone na barra de endereço que o
    // Safari do iPad não tem.
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe('ios');
  });

  it('não confunde um Mac de verdade com iPad', () => {
    expect(detectPlatform(MAC_CHROME, 0)).toBe('desktop');
  });

  it('trata trackpad de Mac (maxTouchPoints 0 ou 1) como desktop', () => {
    expect(detectPlatform(MAC_CHROME, 1)).toBe('desktop');
  });
});
