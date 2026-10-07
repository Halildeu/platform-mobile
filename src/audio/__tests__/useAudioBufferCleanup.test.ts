import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useAudioBufferCleanup } from '../useAudioBufferCleanup';
import { sweepAudioBuffers } from '../nativeBufferJournal';
jest.mock('../nativeBufferJournal', () => ({ sweepAudioBuffers: jest.fn(async () => {}) }));

test('root cleanup runs at launch/foreground, skips background and cancels timers on unmount', async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const listener = jest.spyOn(AppState, 'addEventListener');
  const { unmount } = renderHook(useAudioBufferCleanup);
  await act(async () => {});
  expect(sweepAudioBuffers).toHaveBeenCalledTimes(1);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  await act(async () => jest.advanceTimersByTime(60000));
  expect(sweepAudioBuffers).toHaveBeenCalledTimes(1);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  await act(async () => listener.mock.calls[0][1]('active'));
  expect(sweepAudioBuffers).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => jest.advanceTimersByTime(60000));
  expect(sweepAudioBuffers).toHaveBeenCalledTimes(2);
  listener.mockRestore(); jest.useRealTimers();
});
