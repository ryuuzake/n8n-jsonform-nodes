import { compileForm } from '../../src/form-definition';
import type { CompiledForm, Form } from '../../src/form-definition';

/**
 * The fixed sample Form served while configuration is still a fixture (until
 * the builder slice swaps it for node parameters).
 *
 * This single Form drives both directions of the submission loop: GET serves
 * its compiled {schema, uiSchema}, and POST shapes incoming payloads with the
 * same Field constraints, so client-side and server-side validation agree.
 */
export const sampleForm: Form = {
  title: 'Sample form',
  description: 'Tell us a little about yourself.',
  fields: [
    { name: 'name', label: 'Full name', type: 'text', required: true, maxLength: 100 },
    { name: 'email', label: 'Email', type: 'text', required: true, maxLength: 254 },
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      choices: ['Developer', 'Designer', 'Manager'],
    },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'newsletter', label: 'Subscribe to the newsletter', type: 'boolean' },
  ],
};

/** The compiled page configuration served on webhook GET. */
export const sampleFormConfig: CompiledForm = compileForm(sampleForm);
