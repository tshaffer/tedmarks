/**
 * Generates shared/openapi/tedmarks.openapi.json from the zod schemas.
 * The iOS app generates its API client types from this file
 * (Apple's swift-openapi-generator), so run it after changing a schema.
 */
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { collectionNames, collectionSchemas, recordTypeNames } from '../src/index.js';

const schemas: Record<string, unknown> = {};
for (const name of collectionNames) {
  schemas[recordTypeNames[name]] = z.toJSONSchema(collectionSchemas[name], { target: 'openapi-3.0', io: 'input' });
}

const changeSet = {
  type: 'object',
  description: 'Records grouped by collection name.',
  properties: Object.fromEntries(
    collectionNames.map((n) => [n, { type: 'array', items: { $ref: `#/components/schemas/${recordTypeNames[n]}` } }]),
  ),
};

const doc = {
  openapi: '3.0.3',
  info: { title: 'Tedmarks API', version: '0.1.0' },
  paths: {
    '/health': { get: { operationId: 'getHealth', responses: { '200': { description: 'OK' } } } },
    '/auth/apple': {
      post: {
        operationId: 'signInWithApple',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['identityToken'], properties: { identityToken: { type: 'string' } } } } },
        },
        responses: { '200': { description: 'Session token' }, '403': { description: 'Not on the allowlist' } },
      },
    },
    '/sync/pull': {
      get: {
        operationId: 'syncPull',
        parameters: [{ name: 'since', in: 'query', required: true, schema: { type: 'integer', minimum: 0 } }],
        responses: { '200': { description: 'Changes since serverSeq', content: { 'application/json': { schema: { $ref: '#/components/schemas/SyncPullResponse' } } } } },
      },
    },
    '/sync/push': {
      post: {
        operationId: 'syncPush',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangeSet' } } } },
        responses: { '200': { description: 'Accepted records with assigned serverSeq' } },
      },
    },
  },
  components: {
    schemas: {
      ...schemas,
      ChangeSet: changeSet,
      SyncPullResponse: {
        type: 'object',
        required: ['serverSeq', 'changes'],
        properties: { serverSeq: { type: 'integer' }, changes: { $ref: '#/components/schemas/ChangeSet' } },
      },
    },
  },
};

const out = new URL('../openapi/tedmarks.openapi.json', import.meta.url);
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`Wrote ${out.pathname} (${Object.keys(schemas).length} record schemas)`);
