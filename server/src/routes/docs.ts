import type { FastifyInstance } from 'fastify';

/**
 * The public integration surface, documented: a hand-authored OpenAPI spec
 * for the endpoints integrations actually use, rendered by Swagger UI at
 * /api/docs. Auth: an admin-minted API key in the x-api-key header (or
 * `Authorization: Bearer mets_…`) — the key acts as its bound METS user.
 */

const ticketSummary = {
  type: 'object',
  properties: {
    id: { type: 'integer' }, number: { type: 'string', example: 'T-1000042' },
    type: { type: 'string', enum: ['incident', 'request', 'change'] },
    subject: { type: 'string' }, priority: { type: 'integer', minimum: 1, maximum: 4 },
    score: { type: 'integer' },
    status: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, category: { type: 'string' } } },
    queue: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    requester: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, isVip: { type: 'boolean' } } },
    assignee: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    category: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'METS API',
    version: '1.0',
    description: `Master Electronics Ticketing System — public REST API.

**Auth**: create an API key in Admin → API, then send it as \`x-api-key\`
(or \`Authorization: Bearer mets_…\`). The key acts as the METS user it was
bound to — role and queue-visibility rules apply exactly as they would in
the app. Bind a readonly user for read-only integrations.

**Conventions**: JSON everywhere; validation errors return 400 with an
\`error\` message; missing permissions return 403. Tickets created here go
through the full intake pipeline — AI triage (category, queue, priority,
subject), SLA attachment, and scoring — a few seconds after creation.`,
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'x-api-key' },
      bearer: { type: 'http' as const, scheme: 'bearer' as const },
    },
    schemas: { TicketSummary: ticketSummary },
  },
  security: [{ apiKey: [] }, { bearer: [] }],
  paths: {
    '/api/tickets': {
      get: {
        summary: 'List tickets',
        tags: ['Tickets'],
        parameters: [
          { name: 'view', in: 'query', schema: { type: 'string', enum: ['open', 'mine', 'unassigned', 'my_queues', 'snoozed', 'closed', 'all'], default: 'open' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['date', 'newest', 'score', 'priority', 'requester', 'description'], default: 'date' } },
          { name: 'queueId', in: 'query', schema: { type: 'integer' } },
          { name: 'assigneeId', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Matches subject, ticket number, and imported legacy numbers (e.g. INC0010021)' },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500, default: 200 } },
          { name: 'unassigned', in: 'query', schema: { type: 'string', enum: ['1'] } },
          { name: 'myQueues', in: 'query', schema: { type: 'string', enum: ['1'] }, description: "Scope to the key user's team queues" },
        ],
        responses: { 200: { description: 'Ticket list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TicketSummary' } } } } } },
      },
      post: {
        summary: 'Create a ticket',
        description: 'Goes through the full intake pipeline: AI triage routes it, sets priority, and writes a subject if yours is blank or vague.',
        tags: ['Tickets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['description'],
                properties: {
                  subject: { type: 'string', maxLength: 300, description: 'Optional — AI writes one from the description if blank' },
                  description: { type: 'string', maxLength: 20000 },
                  type: { type: 'string', enum: ['incident', 'request', 'change'], default: 'incident' },
                  priority: { type: 'integer', minimum: 1, maximum: 4, default: 3, description: 'Requester-stated; AI re-assesses by business impact' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, number: { type: 'string' } } } } } } },
      },
    },
    '/api/tickets/{id}': {
      get: {
        summary: 'Get a ticket',
        description: 'Full detail: comments, events, SLA state, attachments, watchers, incident links, AI triage result.',
        tags: ['Tickets'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Ticket detail' }, 403: { description: 'Outside your queue visibility' }, 404: { description: 'Not found' } },
      },
      patch: {
        summary: 'Update a ticket',
        description: 'Staff only. A queue change that contradicts the AI routing is recorded as a training correction.',
        tags: ['Tickets'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  assigneeId: { type: 'integer', nullable: true },
                  queueId: { type: 'integer' },
                  statusId: { type: 'integer' },
                  priority: { type: 'integer', minimum: 1, maximum: 4 },
                  snooze: { type: 'object', nullable: true, properties: { until: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Applied; audited as events' } },
      },
    },
    '/api/tickets/{id}/comments': {
      post: {
        summary: 'Comment on a ticket',
        description: "Requesters: public replies on their own tickets (reopens resolved ones, answers SOTO's intake/deflection prompts). Staff: public or internal.",
        tags: ['Tickets'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['bodyText'], properties: { bodyText: { type: 'string', maxLength: 10000 }, visibility: { type: 'string', enum: ['public', 'internal'], default: 'public' } } } } },
        },
        responses: { 200: { description: 'Comment created' } },
      },
    },
    '/api/incidents/active': {
      get: {
        summary: 'Open suspected incidents',
        description: 'What the in-app amber banner shows: open incident parents with linked-report counts.',
        tags: ['Incidents'],
        responses: { 200: { description: 'Active incidents', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, number: { type: 'string' }, title: { type: 'string' }, childCount: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' } } } } } } } },
      },
    },
    '/api/search/parse': {
      post: {
        summary: 'Natural-language search',
        description: 'Staff only. Turns plain English ("open printer tickets in phoenix older than a week") into structured list filters.',
        tags: ['Search'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', maxLength: 300 } } } } } },
        responses: { 200: { description: 'Interpretation + filters to pass to GET /api/tickets' } },
      },
    },
    '/api/kb/search': {
      get: {
        summary: 'Search the knowledge base',
        description: 'Hybrid semantic + keyword search over published articles.',
        tags: ['Knowledge Base'],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Ranked article hits with snippets' } },
      },
    },
    '/api/meta': {
      get: {
        summary: 'Queues, statuses, agents, categories',
        description: 'The reference data everything else keys against.',
        tags: ['Reference'],
        responses: { 200: { description: 'Board metadata' } },
      },
    },
    '/api/dashboard': {
      get: {
        summary: 'Operational metrics',
        description: 'Open counts, 30-day volumes, median MTTR/FRT, SLA attainment, CSAT, self-service deflections.',
        tags: ['Reference'],
        responses: { 200: { description: 'Dashboard aggregates' } },
      },
    },
  },
} as const;

const DOCS_HTML = `<!doctype html>
<html>
<head>
  <title>METS API docs</title>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#ui', deepLinking: true });
  </script>
</body>
</html>`;

export async function docsRoutes(app: FastifyInstance) {
  app.get('/api/openapi.json', async () => OPENAPI);
  app.get('/api/docs', async (_req, reply) => reply.type('text/html').send(DOCS_HTML));
}
