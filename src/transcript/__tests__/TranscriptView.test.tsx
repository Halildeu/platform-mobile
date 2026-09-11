import { fireEvent, render } from '@testing-library/react-native';
import { TranscriptView } from '../TranscriptView';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const lines = [{ seq: 0, text: 'Merhaba', confirmed: 'Merhaba', tentative: '', status: 'stabilizing' as const }];

it('allows manual scroll and an explicit return to live text', () => {
  const screen = render(<TranscriptView lines={lines} />);
  expect(screen.getByText(/transcript.stabilizingTag/)).toBeTruthy();
  fireEvent.scroll(screen.getByTestId('transcript-list'), { nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 200 },
  } });
  expect(screen.getByText('transcript.followLatest')).toBeTruthy();
  screen.rerender(<TranscriptView lines={[...lines, { ...lines[0], seq: 1 }]} />);
  expect(screen.getByText('transcript.followLatest')).toBeTruthy();
  fireEvent.press(screen.getByText('transcript.followLatest'));
  expect(screen.queryByText('transcript.followLatest')).toBeNull();
});

it('does not offer automatic follow when explicitly disabled', () => {
  const screen = render(<TranscriptView lines={lines} autoScroll={false} />);
  fireEvent.scroll(screen.getByTestId('transcript-list'), { nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 200 },
  } });
  expect(screen.queryByText('transcript.followLatest')).toBeNull();
});
