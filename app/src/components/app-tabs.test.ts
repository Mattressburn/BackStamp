import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getExactRoutes } from 'expo-router/build/getRoutes.js';
import requireContext from 'expo-router/build/testing-library/require-context-ponyfill.js';

test('piece pages live in the root stack outside the three tab routes', () => {
  const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '../app');
  const routes = getExactRoutes(requireContext(appDirectory), { ignoreRequireErrors: true });

  assert.ok(routes);
  const tabs = routes.children.find((route) => route.route === '(tabs)');
  assert.ok(tabs, 'tab screens need their own nested navigator');
  assert.deepEqual(
    tabs.children.map((route) => route.route).sort(),
    ['collection', 'index', 'settings'],
  );
  assert.ok(
    routes.children.some((route) => route.route === 'item/[slug]'),
    'piece pages need to be siblings of the tabs so any tab can push them',
  );
});
