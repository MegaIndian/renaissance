import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import * as sessionModule from '../lib/session';
import { sessionStore } from '../lib/session';
import { renderApp } from '../test/render';

describe('SignIn', () => {
  it('refuses a non-address, signs in with a password, and shows the user name afterwards', async () => {
    setLanguage('en');
    const signIn = vi
      .spyOn(sessionModule, 'signIn')
      .mockImplementation(async (server, credentials) => {
        const session = { server, userId: 'u1', userName: credentials.userName, token: 't' };
        sessionStore.set({
          status: 'signedIn',
          session,
          adapter: null,
          vault: 'encrypted',
          reason: null,
        });
        return session;
      });
    // Only plain http answers at this address.
    const pinged: string[] = [];
    vi.spyOn(sessionModule, 'createAdapter').mockImplementation(
      (server) =>
        ({
          ping: () => {
            pinged.push(server.url);
            return server.url.startsWith('https:')
              ? Promise.reject(new TypeError('fetch failed'))
              : Promise.resolve({ version: '10.10.7' });
          },
        }) as never,
    );
    renderApp('/sign-in');
    const user = userEvent.setup();
    const address = await screen.findByRole('textbox', { name: 'Server address' });
    await user.type(address, 'not an address at all');
    await user.type(screen.getByRole('textbox', { name: 'User name' }), 'mom');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That is not a web address');
    await user.clear(address);
    await user.type(address, 'nodot');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That is not a web address');
    expect(signIn).not.toHaveBeenCalled();
    expect(pinged).toEqual([]);
    // A scheme-less address: https is tried first; when only http answers, the field is rewritten
    // and the notice shows before any password is sent.
    await user.clear(address);
    await user.type(address, '192.168.1.5:8096');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(address).toHaveValue('http://192.168.1.5:8096'));
    expect(pinged).toEqual(['https://192.168.1.5:8096', 'http://192.168.1.5:8096']);
    expect(screen.getByText(/travel over the network unencrypted/)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn.mock.calls[0]?.[0]?.url).toBe('http://192.168.1.5:8096');
    expect(signIn.mock.calls[0]?.[1]).toEqual({ userName: 'mom', password: 'pw' });
    expect(localStorage.getItem('renaissance.lastServer')).toBe('http://192.168.1.5:8096');
    expect(await screen.findByText('Good morning, mom', { exact: false })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('a scheme-less address that answers on neither scheme says unreachable after two pings and sends nothing', async () => {
    setLanguage('en');
    const signIn = vi.spyOn(sessionModule, 'signIn');
    const pinged: string[] = [];
    vi.spyOn(sessionModule, 'createAdapter').mockImplementation(
      (server) =>
        ({
          ping: () => {
            pinged.push(server.url);
            return Promise.reject(new TypeError('fetch failed'));
          },
        }) as never,
    );
    renderApp('/sign-in');
    const user = userEvent.setup();
    const address = await screen.findByRole('textbox', { name: 'Server address' });
    await user.type(address, '10.255.255.1:8096');
    await user.type(screen.getByRole('textbox', { name: 'User name' }), 'mom');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach that server');
    expect(pinged).toEqual(['https://10.255.255.1:8096', 'http://10.255.255.1:8096']);
    // No third attempt: the password never left the form and the field keeps what was typed.
    expect(signIn).not.toHaveBeenCalled();
    expect(address).toHaveValue('10.255.255.1:8096');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    vi.restoreAllMocks();
  });

  it('a scheme-less address that answers on https signs in there, with no notice', async () => {
    setLanguage('en');
    const signIn = vi.spyOn(sessionModule, 'signIn').mockImplementation(async (server, c) => {
      const session = { server, userId: 'u1', userName: c.userName, token: 't' };
      sessionStore.set({ status: 'signedIn', session, adapter: null, vault: 'none', reason: null });
      return session;
    });
    vi.spyOn(sessionModule, 'createAdapter').mockReturnValue({
      ping: () => Promise.resolve({ version: '10.10.7' }),
    } as never);
    renderApp('/sign-in');
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Server address' }),
      'music.example.com',
    );
    await user.type(screen.getByRole('textbox', { name: 'User name' }), 'mom');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn.mock.calls[0]?.[0]?.url).toBe('https://music.example.com');
    expect(screen.queryByText(/unencrypted/)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('an explicit http address shows the notice at once; a revoked token lands here with a sentence', async () => {
    setLanguage('en');
    sessionStore.set({
      status: 'signedOut',
      session: null,
      adapter: null,
      vault: null,
      reason: 'expired',
    });
    renderApp('/sign-in');
    const user = userEvent.setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in expired');
    await user.type(
      await screen.findByRole('textbox', { name: 'Server address' }),
      'http://192.168.1.5:8096',
    );
    expect(screen.getByText(/http, not https/)).toBeInTheDocument();
  });

  it('explains wrong credentials and an unreachable server in full sentences', async () => {
    setLanguage('en');
    const { ServerError } = await import('@renaissance/core');
    const signIn = vi
      .spyOn(sessionModule, 'signIn')
      .mockRejectedValueOnce(new ServerError(401, '/Users/AuthenticateByName'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new ServerError(500, '/x'));
    renderApp('/sign-in');
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Server address' }),
      'https://music.example.com/',
    );
    await user.type(screen.getByRole('textbox', { name: 'User name' }), 'dad');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The user name or password is wrong.',
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/could not reach that server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/error \(500\)/)).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(3);
    signIn.mockRestore();
  });

  it('Quick Connect shows the code, polls, and signs in once approved', async () => {
    setLanguage('en');
    let polls = 0;
    const adapter = {
      ping: () => Promise.resolve({ version: '10.10.7' }),
      quickConnect: {
        enabled: () => Promise.resolve(true),
        initiate: () => Promise.resolve({ code: '424242', secret: 's' }),
        state: () => Promise.resolve(++polls > 1),
      },
    };
    vi.spyOn(sessionModule, 'createAdapter').mockReturnValue(adapter as never);
    const quick = vi
      .spyOn(sessionModule, 'signInWithQuickConnect')
      .mockImplementation(async (server) => {
        const session = { server, userId: 'u1', userName: 'kevin', token: 't' };
        sessionStore.set({
          status: 'signedIn',
          session,
          adapter: null,
          vault: 'encrypted',
          reason: null,
        });
        return session;
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/sign-in');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(await screen.findByRole('textbox', { name: 'Server address' }), 'demo.local');
    await user.click(screen.getByRole('button', { name: 'Use Quick Connect instead' }));
    expect(await screen.findByText('424242')).toBeInTheDocument();
    expect(screen.getByText(/approve the code/)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() =>
      expect(quick).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://demo.local' }),
        's',
      ),
    );
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
