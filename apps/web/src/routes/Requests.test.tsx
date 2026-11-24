import type { HubEvent } from '@renaissance/core';
import { HubClientError } from '@renaissance/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { admin, fakeHub, member, request } from '../test/hub';
import { renderWithI18n } from '../test/render';
import { Requests } from './Requests';

describe('Requests', () => {
  it('asks to sign in without a hub session', () => {
    setLanguage('en');
    renderWithI18n(<Requests />, null);
    expect(screen.getByText('Sign in to see your requests')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it("lists the caller's requests with status, a plain reason, progress in words and the collapsed detail in advanced mode, and lets an admin see the house", async () => {
    setLanguage('en');
    const hub = fakeHub(
      {
        requests: vi.fn(async (scope?: 'mine' | 'house') =>
          scope === 'house'
            ? [
                request({
                  id: '22222222-2222-4222-8222-222222222222',
                  title: 'Red',
                  artist: 'Taylor Swift',
                  requestedByName: 'Kevin',
                  status: 'ready',
                }),
              ]
            : [
                request({
                  status: 'downloading',
                  progress: { unit: 'percent', done: 42, total: 100, etaSeconds: 130 },
                }),
                request({
                  id: '55555555-5555-4555-8555-555555555555',
                  title: 'Red',
                  artist: 'Taylor Swift',
                  kind: 'album',
                  status: 'finding',
                  progress: { unit: 'songs', done: 14, total: 18 },
                }),
                request({
                  id: '33333333-3333-4333-8333-333333333333',
                  title: 'Drowning',
                  artist: 'A Boogie',
                  status: 'failed',
                  reason: 'no_results',
                  steps: [
                    {
                      at: '2026-11-18T00:00:00.000Z',
                      status: 'failed',
                      reason: 'no_results',
                      detail: 'Soulseek: "a boogie drowning": 0 files',
                    },
                  ],
                }),
              ],
        ),
      },
      // An admin in advanced mode: the pipeline's words are available, collapsed.
      { ...admin, mode: 'advanced' },
    );
    renderWithI18n(<Requests />, hub);
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByText('42% downloaded · about 2 minutes left')).toBeInTheDocument();
    expect(screen.getByText('14 of 18 songs')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't find this one anywhere right now. Try again later"),
    ).toBeInTheDocument();
    // The pipeline's words are behind "What happened" (advanced mode), never inline.
    expect(screen.getByText(/Soulseek: "a boogie drowning"/)).not.toBeVisible();
    const details = screen.getAllByText('What happened');
    expect(details.length).toBeGreaterThan(0);
    const user0 = userEvent.setup();
    await user0.click(details[details.length - 1]!);
    expect(screen.getByText(/Soulseek: "a boogie drowning": 0 files/)).toBeVisible();
    expect(screen.getByText('Code: no_results')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Whose requests' })).getByRole('radio', {
        name: 'Whole house',
      }),
    );
    expect(await screen.findByText('Red')).toBeInTheDocument();
    expect(screen.getByText(/asked by Kevin/)).toBeInTheDocument();
    expect(hub.requests).toHaveBeenCalledWith('house');
  });

  it('hides the house switch and every machine detail from members, cancels or retries their own on tap, and only watches the rest', async () => {
    setLanguage('en');
    const hub = fakeHub(
      {
        requests: vi.fn(async () => [
          request({ requestedBy: 'u-mom', requestedByName: 'Mom' }),
          request({
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Drowning',
            status: 'failed',
            reason: 'download_failed',
            requestedBy: 'u-mom',
            requestedByName: 'Mom',
            steps: [
              {
                at: '2026-11-18T00:00:00.000Z',
                status: 'failed',
                reason: 'download_failed',
                detail: 'Lil Wayne - Fireman.mp3 from b: Completed, Errored',
              },
            ],
          }),
          request({
            id: '66666666-6666-4666-8666-666666666666',
            title: 'Stopped one',
            status: 'cancelled',
            requestedBy: 'u-mom',
            requestedByName: 'Mom',
            steps: [
              { at: '2026-11-18T00:00:00.000Z', status: 'cancelled', detail: 'Cancelled by Mom' },
            ],
          }),
          // Sahil asked first; Mom asked for the same album and watches it (design AB): the card
          // says who asked and offers no Cancel, since the hub would answer 404.
          request({
            id: '88888888-8888-4888-8888-888888888888',
            kind: 'album',
            title: 'Hoodie SZN',
            artist: 'A Boogie Wit da Hoodie',
            album: undefined,
            status: 'finding',
            watchers: ['u-mom'],
          }),
          // The requested album stays on the card; the release the file lands on is its own line.
          request({
            id: '99999999-9999-4999-8999-999999999999',
            title: 'Why This Kolaveri Di',
            artist: 'Dhanush',
            album: '3',
            status: 'finding',
            requestedBy: 'u-mom',
            requestedByName: 'Mom',
            matched: {
              title: 'Why This Kolaveri Di?: The Soup of Love',
              artist: 'Dhanush',
              album: 'The Bollywood Remix Project',
            },
          }),
        ]),
      },
      member,
    );
    renderWithI18n(<Requests />, hub);
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText('What happened')).not.toBeInTheDocument();
    expect(screen.queryByText(/Completed, Errored/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancelled by/)).not.toBeInTheDocument();
    expect(screen.getByText("The download didn't finish. Try again")).toBeInTheDocument();
    // A cancelled request: a muted pill, no reason, no retry.
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    // The watched card: "asked by Sahil" in Mine, no Cancel; Mom's own cards carry no name.
    expect(screen.getByText(/A Boogie Wit da Hoodie · asked by Sahil/)).toBeInTheDocument();
    expect(screen.queryByText(/asked by Mom/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
    // The subtitle keeps the album asked for; the import target wraps on its own line.
    expect(screen.getByText('Dhanush · 3')).toBeInTheDocument();
    const arrive = screen.getByText(
      'Will arrive as Why This Kolaveri Di?: The Soup of Love by Dhanush, on The Bollywood Remix Project',
    );
    expect(arrive.className).toContain('line-clamp-2');
    expect(arrive.className).not.toContain('truncate');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    expect(hub.cancelRequest).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    await waitFor(() => expect(screen.getAllByText('Cancelled')).toHaveLength(2));
    expect(screen.getAllByText('Failed')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(hub.retryRequest).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
    await waitFor(() => expect(screen.getByText('Requested')).toBeInTheDocument());
  });

  it('applies hub events to the list and announces Ready', async () => {
    setLanguage('en');
    let push: ((event: HubEvent) => void) | undefined;
    const hub = fakeHub({
      requests: vi.fn(async () => [request({ status: 'finding' })]),
      events: vi.fn((onEvent: (event: HubEvent) => void) => {
        push = onEvent;
        return () => undefined;
      }),
    });
    renderWithI18n(<Requests />, hub);
    expect(await screen.findByText('Finding')).toBeInTheDocument();
    push!({ type: 'ping', at: 'now' });
    push!({ type: 'request', request: request({ status: 'importing' }) });
    expect(await screen.findByText('Importing')).toBeInTheDocument();
    push!({ type: 'ready', request: request({ status: 'ready' }) });
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Fireman is ready')).toBeInTheDocument();
    push!({
      type: 'request',
      request: request({ id: '44444444-4444-4444-8444-444444444444', title: 'New one' }),
    });
    expect(await screen.findByText('New one')).toBeInTheDocument();
  });

  it('shows the empty state and the unreachable state', async () => {
    setLanguage('gu');
    const { i18n } = await import('../lib/i18n');
    const view = renderWithI18n(<Requests />, fakeHub());
    expect(await screen.findByText(i18n.t('requests.empty'))).toBeInTheDocument();
    view.unmount();
    setLanguage('en');
    const down = fakeHub({ me: vi.fn(async () => Promise.reject(new Error('down'))) });
    renderWithI18n(<Requests />, down);
    expect(await screen.findByText("Requests can't be reached right now")).toBeInTheDocument();
  });

  it('shows three placeholders while the first list loads, and the unreachable words with a Retry when it fails (design AN, AQ)', async () => {
    setLanguage('en');
    let answer: ((rows: ReturnType<typeof request>[]) => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const requests = vi.fn(
      () =>
        new Promise<ReturnType<typeof request>[]>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        }),
    );
    renderWithI18n(<Requests />, fakeHub({ requests }));
    const loading = await screen.findByLabelText('Loading requests…');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.children).toHaveLength(3);
    expect(screen.queryByText('Nothing requested yet')).not.toBeInTheDocument();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    fail!(new HubClientError(500, 'storage_error', 'the database refused'));
    expect(await screen.findByText("Requests can't be reached right now")).toBeInTheDocument();
    expect(screen.getByText('Try again in a minute.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requests' })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    answer!([request({ status: 'finding' })]);
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('says where a matched song arrived once it is ready (design AL)', async () => {
    setLanguage('en');
    const hub = fakeHub({
      requests: vi.fn(async () => [
        request({
          title: 'Billie Jean',
          artist: 'Michael Jackson',
          album: "Michael Jackson's This Is It",
          status: 'ready',
          matched: { title: 'Billie Jean', artist: 'Michael Jackson', album: 'Thriller' },
        }),
        request({
          id: '77777777-7777-4777-8777-777777777777',
          title: 'Fireman',
          artist: 'Lil Wayne',
          status: 'finding',
          matched: { title: 'Fireman', artist: 'Lil Wayne', album: 'Tha Carter II' },
        }),
      ]),
    });
    renderWithI18n(<Requests />, hub);
    expect(
      await screen.findByText('Arrived as Billie Jean by Michael Jackson, on Thriller'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Will arrive as Fireman by Lil Wayne, on Tha Carter II'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Will arrive as Billie Jean/)).not.toBeInTheDocument();
  });
});
