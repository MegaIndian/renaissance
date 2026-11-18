import type { HubEvent } from '@renaissance/core';
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

  it('hides the house switch and every machine detail from members, and cancels or retries on tap', async () => {
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
            steps: [
              { at: '2026-11-18T00:00:00.000Z', status: 'cancelled', detail: 'Cancelled by Mom' },
            ],
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
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
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
});
