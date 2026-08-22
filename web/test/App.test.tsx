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
});
