import { useEffect } from 'react';
import { AppState } from 'react-native';
import { sweepAudioBuffers } from './nativeBufferJournal';

/** App-wide: expired storage must not depend on reopening the recording screen. */
export function useAudioBufferCleanup() {
  useEffect(() => {
    let mounted = true;
    const sweep = () => {
      if (AppState.currentState !== 'active') return;
      void sweepAudioBuffers().catch(() => {
        if (mounted) console.warn('Ses deposu temizliği doğrulanamadı; sonraki ön plan çalışmasında yeniden denenecek.');
      });
    };
    sweep();
    const timer = setInterval(sweep, 60000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') sweep(); });
    return () => { mounted = false; clearInterval(timer); listener.remove(); };
  }, []);
}
