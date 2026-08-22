import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import type { PageConfig } from '@/pageConfig';

// Independent fixture literal: a required text field and an email field with
// a pattern constraint.
const fixture: PageConfig = {
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Full name', minLength: 2 },
      email: {
        type: 'string',
        title: 'Email',
        pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      },
    },
    required: ['name', 'email'],
  },
  uiSchema: {
    type: 'VerticalLayout',
    elements: [
      { type: 'Control', scope: '#/properties/name' },
      { type: 'Control', scope: '#/properties/email' },
    ],
  },
};

function mountAppWithConfig(config: PageConfig) {
  document.body.innerHTML = `
    <div id="root"></div>
    <script type="application/json" id="jsonform-config">${JSON.stringify(config)}</script>
  `;
  return render(<App />);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('served form page', () => {
  it('renders the fixture form fields from the configuration blob', () => {
    mountAppWithConfig(fixture);

    expect(screen.getByText('Full name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('shows client-side validation feedback and keeps submit disabled before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    mountAppWithConfig(fixture);

    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getAllByLabelText(/full name/i)[0], 'Ada');
    expect(submit).toBeDisabled();

    const emailInput = screen.getAllByLabelText(/email/i)[0];
    await user.type(emailInput, 'not-an-email');
    await waitFor(() => expect(submit).toBeDisabled());

    await user.clear(emailInput);
    await user.type(emailInput, 'ada@example.com');
    // JSONForms propagates store updates a tick behind the input events.
    await waitFor(() => expect(submit).toBeEnabled());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('submission loop', () => {
    async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getAllByLabelText(/full name/i)[0], 'Ada Lovelace');
      await user.type(screen.getAllByLabelText(/email/i)[0], 'ada@example.com');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled(),
      );
    }

    function mockFetchOnce(response: { ok: boolean; status: number; body?: object }) {
      return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(response.body ?? {}), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    it('posts the entered values as JSON to the current URL and swaps to a success card on 2xx', async () => {
      const fetchSpy = mockFetchOnce({ ok: true, status: 200 });
      const user = userEvent.setup();
      mountAppWithConfig({ ...fixture, completionMessage: 'Thanks for your submission!' });

      await fillValidForm(user);
      await user.click(screen.getByRole('button', { name: /submit/i }));

      await waitFor(() =>
        expect(
          screen.getByText('Thanks for your submission!'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('http://');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(JSON.parse(String(init?.body))).toEqual({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
    });

    it('falls back to the stock completion message when the configuration omits one', async () => {
      mockFetchOnce({ ok: true, status: 200 });
      const user = userEvent.setup();
      mountAppWithConfig(fixture);

      await fillValidForm(user);
      await user.click(screen.getByRole('button', { name: /submit/i }));

      await waitFor(() =>
        expect(
          screen.getByText('Thank you! Your submission has been received.'),
        ).toBeInTheDocument(),
      );
    });

    it('shows an inline error alert and preserves entered values on failed submit', async () => {
      mockFetchOnce({
        ok: false,
        status: 500,
        body: { error: 'Workflow execution failed.' },
      });
      const user = userEvent.setup();
      mountAppWithConfig(fixture);

      await fillValidForm(user);
      await user.click(screen.getByRole('button', { name: /submit/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Workflow execution failed.');

      // Entered values survive for retry, and the form can be submitted again.
      expect(screen.getAllByLabelText(/full name/i)[0]).toHaveValue('Ada Lovelace');
      expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
    });
  });
});
