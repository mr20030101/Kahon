// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { UploadTile, timeLeft } from '../UploadQueue';

describe('timeLeft', () => {
  it('waits for a second of data before guessing', () => {
    expect(timeLeft(100, 1000, 500)).toBeNull();
    expect(timeLeft(0, 1000, 5000)).toBeNull();
  });

  it('estimates from the speed so far', () => {
    expect(timeLeft(250, 1000, 2000)).toBe('about 6 s left');
    expect(timeLeft(100, 10_000, 2000)).toBe('about 4 min left');
  });

  it('says nothing once everything is sent', () => {
    expect(timeLeft(1000, 1000, 9000)).toBeNull();
  });
});

const file = new File(['x'.repeat(2048)], 'brief.pdf', { type: 'application/pdf' });
const base = { key: 'k1', file, type: { kind: 'pdf', ext: 'pdf' }, preview: null, loaded: 0, total: 0, startedAt: 0, error: '' };

describe('UploadTile', () => {
  afterEach(cleanup);

  it('shows the file it received: name, size and type', () => {
    render(<UploadTile item={{ ...base, status: 'preparing' }} onRetry={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('brief.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB · PDF')).toBeTruthy();
    expect(screen.getByText('Preparing…')).toBeTruthy();
  });

  it('shows the percent while bytes go up', () => {
    render(<UploadTile item={{ ...base, status: 'uploading', loaded: 512, total: 2048, startedAt: Date.now() }} onRetry={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('offers Retry on the same file when it fails', () => {
    let retried = null;
    render(<UploadTile item={{ ...base, status: 'failed', error: 'the network dropped' }} onRetry={(k) => { retried = k; }} onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Failed: the network dropped');
    act(() => screen.getByRole('button', { name: 'Retry' }).click());
    expect(retried).toBe('k1');
  });
});
