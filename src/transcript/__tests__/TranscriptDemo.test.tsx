import { act, fireEvent, render } from '@testing-library/react-native';
import TranscriptDemoScreen from '../../../app/transcript-demo';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('clears completed lines on restart and replays from the first draft', () => {
  jest.useFakeTimers();
  const screen = render(<TranscriptDemoScreen />);
  act(() => jest.advanceTimersByTime(6500));
  expect(screen.getByText(/Salı saat 14/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('restart-transcript-demo'));
  expect(screen.queryByText(/Salı saat 14/)).toBeNull();
  act(() => jest.advanceTimersByTime(500));
  expect(screen.getByText(/Bugünkü toplantıyı/)).toBeTruthy();
  expect(screen.queryByText(/Salı saat 14/)).toBeNull();
  screen.unmount();
  jest.useRealTimers();
});
