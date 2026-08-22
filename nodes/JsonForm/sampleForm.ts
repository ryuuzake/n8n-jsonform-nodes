/**
 * The fixed sample Form served while the rendering pipeline is being built
 * (RYU-6). Later slices replace this fixture with Fields compiled by the Form
 * Definition module (RYU-5 / RYU-8).
 *
 * Keep in sync with the equivalent fixture blob embedded in web/index.html so
 * the standalone dev server renders the same form the node serves.
 */
export const sampleFormConfig = {
  schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        title: 'Full name',
        description: 'Your given name and surname.',
        minLength: 2,
      },
      email: {
        type: 'string',
        title: 'Email',
        pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      },
      role: {
        type: 'string',
        title: 'Role',
        enum: ['Developer', 'Designer', 'Manager'],
      },
      startDate: {
        type: 'string',
        title: 'Start date',
        format: 'date',
      },
      newsletter: {
        type: 'boolean',
        title: 'Subscribe to the newsletter',
        default: true,
      },
    },
    required: ['name', 'email'],
  },
  uiSchema: {
    type: 'VerticalLayout',
    elements: [
      { type: 'Control', scope: '#/properties/name' },
      { type: 'Control', scope: '#/properties/email' },
      { type: 'Control', scope: '#/properties/role' },
      { type: 'Control', scope: '#/properties/startDate' },
      { type: 'Control', scope: '#/properties/newsletter' },
    ],
  },
};
