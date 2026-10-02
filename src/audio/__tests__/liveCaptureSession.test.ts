import { LiveCaptureSession } from '../liveCaptureSession';
import { OfflineAudioBuffer, type PendingChunk } from '../offlineBuffer';

const pcm = new Uint8Array([1, 0]);

describe('LiveCaptureSession', () => {
  it('bağlantı açıkken parça anında gider, kuyruk boş kalır', () => {
    const sent: number[] = [];
    const session = new LiveCaptureSession({
      sessionId: 'session-test',
      send: (c: PendingChunk) => {
        sent.push(c.chunkSeq);
        return true;
      },
    });
    session.pushPcm16(1, 20, pcm);
    session.pushPcm16(2, 40, pcm);
    expect(sent).toEqual([1, 2]);
    expect(session.pending()).toBe(2);
    session.acknowledge({ sessionId: 'session-test', chunkSeq: 1 });
    session.acknowledge({ sessionId: 'session-test', chunkSeq: 2 });
    expect(session.pending()).toBe(0);
  });

  it('bağlantı düşükken parçalar kuyruğa yazılır, sıra korunur', () => {
    let online = false;
    const sent: number[] = [];
    const session = new LiveCaptureSession({
      sessionId: 'session-test',
      send: (c: PendingChunk) => {
        if (!online) return false;
        sent.push(c.chunkSeq);
        return true;
      },
    });
    session.pushPcm16(1, 20, pcm); // offline -> kuyrukta
    session.pushPcm16(2, 40, pcm);
    session.pushPcm16(3, 60, pcm);
    expect(session.pending()).toBe(3);
    expect(sent).toEqual([]);

    online = true;
    session.onReconnected(); // reconnect -> backlog sırayla akar
    expect(sent).toEqual([1, 2, 3]);
    expect(session.pending()).toBe(3);
  });

  it('parça göndermeden ÖNCE kuyruğa yazılır (dayanıklılık): ilk sendde düşerse kaybolmaz', () => {
    let online = false;
    const sent: number[] = [];
    const session = new LiveCaptureSession({
      sessionId: 'session-test',
      send: (c: PendingChunk) => {
        if (!online) return false;
        sent.push(c.chunkSeq);
        return true;
      },
    });
    session.pushPcm16(7, 140, pcm); // send başarısız ama kuyrukta durur
    expect(session.pending()).toBe(1);
    online = true;
    session.flush();
    expect(sent).toEqual([7]);
  });

  it('paylaşılan buffer enjekte edilebilir', () => {
    const buffer = new OfflineAudioBuffer({ maxChunks: 1 });
    const session = new LiveCaptureSession({ sessionId: 'session-test', send: () => false, buffer });
    session.pushPcm16(1, 20, pcm);
    session.pushPcm16(2, 40, pcm); // kapasite 1 -> en eski düşer
    expect(session.pending()).toBe(1);
    expect(session.dropped()).toBe(1);
  });
});
