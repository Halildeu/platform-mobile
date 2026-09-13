import type {
  WsFinalEvent,
  WsPartialEvent,
  WsReadyEvent,
} from '../../contracts/wsStreamEvents';
import {
  applyTranscriptEvent,
  applyTranscriptEvents,
  initialTranscriptState,
  type TranscriptState,
} from '../transcriptState';

function partial(
  seq: number,
  confirmed: string,
  tentative: string,
): WsPartialEvent {
  return {
    type: 'partial',
    seq,
    confirmed,
    tentative,
    elapsed_ms: 10,
    rms: 0.05,
    source: 'gateway',
  };
}

function final(seq: number, text: string): WsFinalEvent {
  return { type: 'final', seq, text, reason: 'silence', elapsed_ms: 20, rms: 0.05 };
}

function fold(
  events: (WsPartialEvent | WsFinalEvent)[],
): TranscriptState {
  return applyTranscriptEvents(initialTranscriptState(), events);
}

describe('transcriptState', () => {
  it('draft becomes stabilizing only when confirmed text arrives', () => {
    const draft = fold([partial(0, '', 'belki')]);
    expect(draft.lines[0].status).toBe('draft');
    const stable = applyTranscriptEvent(draft, partial(0, 'bugün', 'toplantı'));
    expect(stable.lines[0].status).toBe('stabilizing');
    expect(applyTranscriptEvent(stable, final(0, 'Bugün toplantı.')).lines[0].status).toBe('final');
  });
  it('identical replay of final does not invent a revision', () => {
    const before = fold([final(0, 'Aynı metin')]);
    expect(applyTranscriptEvent(before, final(0, 'Aynı metin'))).toBe(before);
  });
  it('starts empty', () => {
    expect(initialTranscriptState().lines).toEqual([]);
  });

  it('partial ekler ve taslak (draft) olur — confirmed + tentative', () => {
    const state = fold([partial(0, 'bugün toplantı', 'başladı')]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({
      seq: 0,
      status: 'stabilizing',
      text: 'bugün toplantı başladı',
    });
  });

  it('aynı seq için yeni partial öncekini günceller (biriktirmez)', () => {
    const state = fold([partial(0, 'bugün', 'top'), partial(0, 'bugün toplantı', 'başladı')]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].text).toBe('bugün toplantı başladı');
    expect(state.lines[0].status).toBe('stabilizing');
  });

  it('partial sonrası final gelince taslak -> final (siyah) olur', () => {
    const state = fold([partial(0, 'bugün toplantı', 'başladı'), final(0, 'Bugünkü toplantı başladı.')]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({
      seq: 0,
      status: 'final',
      text: 'Bugünkü toplantı başladı.',
      tentative: '',
    });
  });

  it('partial olmadan gelen final doğrudan final olur', () => {
    const state = fold([final(3, 'Karar verildi.')]);
    expect(state.lines).toEqual([
      { seq: 3, confirmed: 'Karar verildi.', tentative: '', text: 'Karar verildi.', status: 'final' },
    ]);
  });

  it('final üstüne gelen ikinci final -> revised (sonradan düzeltildi)', () => {
    const state = fold([final(0, 'Salı saat 10.'), final(0, 'Salı saat 14.')]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({ status: 'revised', text: 'Salı saat 14.' });
  });

  it('settled (final) satırı geç gelen partial DİRİLTMEZ', () => {
    const state = fold([final(0, 'Kesin metin.'), partial(0, 'kesin', 'yanlış')]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({ status: 'final', text: 'Kesin metin.' });
  });

  it('satırlar seq sırasına göre tutulur (out-of-order gelse bile)', () => {
    const state = fold([final(2, 'iki'), final(0, 'sıfır'), partial(1, 'bir', '')]);
    expect(state.lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(state.lines.map((l) => l.text)).toEqual(['sıfır', 'bir', 'iki']);
  });

  it('transkript-dışı olaylar (ready) satırları değiştirmez', () => {
    const ready: WsReadyEvent = {
      type: 'ready',
      sample_rate: 16000,
      live_model: 'medium',
      final_model: 'large-v3',
    };
    const before = fold([partial(0, 'metin', '')]);
    const after = applyTranscriptEvent(before, ready);
    expect(after).toBe(before); // referans aynı = değişmedi
  });

  it('boş tentative sadece confirmed metni verir', () => {
    const state = fold([partial(0, 'sadece bu', '')]);
    expect(state.lines[0].text).toBe('sadece bu');
  });
});
