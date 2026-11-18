import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createChatServer } from './index.mjs';

async function start(t) {
  const server = createChatServer(':memory:').listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', token, body, status = 200) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  };
  const user = async (alias) => (await call('/session', 'POST', undefined, { alias })).token;
  return { call, user };
}

test('private invite, consent, per-chat aliases and cross-device-style messaging', async (t) => {
  const { call, user } = await start(t);
  const a = await user('Private A');
  const b = await user('Private B');
  const c = await user('Private C');
  await call('/profile', 'GET', undefined, undefined, 401);
  assert.deepEqual(await call('/profile', 'GET', b), { alias: 'Private B', handle: '', requests: 'invite' });

  const first = await call('/invite', 'POST', b, {});
  const replacement = await call('/invite', 'POST', b, {});
  await call('/chats', 'POST', a, { target: first.code }, 404);
  const chat = await call('/chats', 'POST', a, { target: replacement.code, alias: 'Magpie' });
  const route = `/chats/${chat.id}`;

  assert.equal(chat.peerAlias, '');
  assert.equal(chat.alias, 'Magpie');
  assert.equal(chat.incoming, false);
  assert.equal((await call(route, 'GET', b)).peerAlias, 'Magpie');
  assert.equal((await call('/chats', 'GET', b)).chats[0].state, 'pending');
  await call(route, 'GET', c, undefined, 404);
  await call('/chats', 'POST', c, { target: replacement.code }, 404);
  await call(route, 'PATCH', a, { action: 'accept' }, 409);
  await call(`${route}/messages`, 'POST', a, { text: 'Too early', clientId: 'test-early-123' }, 404);

  await call(route, 'PATCH', b, { action: 'accept', alias: 'Lotus' });
  assert.equal((await call(route, 'GET', a)).peerAlias, 'Lotus');
  await call('/profile', 'PATCH', b, { alias: 'Changed default', handle: '', requests: 'invite' });
  assert.equal((await call(route, 'GET', a)).peerAlias, 'Lotus');
  await call(route, 'PATCH', b, { action: 'alias', alias: 'New Lotus' });
  assert.equal((await call(route, 'GET', a)).peerAlias, 'New Lotus');

  const firstMessage = await call(`${route}/messages`, 'POST', a, { text: 'Hey Lotus', clientId: 'first-message-123' });
  const retry = await call(`${route}/messages`, 'POST', a, { text: 'Hey Lotus', clientId: 'first-message-123' });
  assert.deepEqual(retry, firstMessage);
  assert.equal((await call(route, 'GET', b)).unread, 1);
  const { messages } = await call(`${route}/messages`, 'GET', b);
  assert.deepEqual(messages, [{ ...firstMessage, mine: false }]);
  await call(route, 'PATCH', b, { action: 'read', id: firstMessage.id });
  assert.equal((await call(route, 'GET', b)).unread, 0);
  await call(`${route}/messages`, 'POST', b, { text: 'Hi Magpie', clientId: 'second-message-123' });
  assert.deepEqual((await call(`${route}/messages`, 'GET', a)).messages.map((item) => item.mine), [true, false]);
  await call(`${route}/messages`, 'GET', c, undefined, 404);

  await call('/profile', 'DELETE', b);
  await call('/profile', 'GET', b, undefined, 401);
  assert.deepEqual(await call('/chats', 'GET', a), { chats: [] });
});

test('opt-in handle discovery, block/unblock, and closing requests', async (t) => {
  const { call, user } = await start(t);
  const a = await user('North');
  const b = await user('South');
  const c = await user('East');
  const target = { target: '@bluesky' };
  await call('/profile', 'PATCH', b, { alias: 'South', handle: 'bluesky', requests: 'invite' });
  await call('/chats', 'POST', a, target, 404);
  await call('/profile', 'PATCH', b, { alias: 'South', handle: 'BlueSky', requests: 'handle' });
  await call('/profile', 'PATCH', a, { alias: 'North', handle: 'bluesky', requests: 'handle' }, 409);
  const chat = await call('/chats', 'POST', a, target);
  const repeat = await call('/chats', 'POST', a, target);
  assert.equal(repeat.id, chat.id);

  await call(`/chats/${chat.id}`, 'PATCH', b, { action: 'block' });
  await call('/chats', 'POST', a, target, 404);
  const { blocks: [block] } = await call('/blocks', 'GET', b);
  assert.equal(block.label, 'North');
  await call(`/blocks/${block.id}`, 'DELETE', c);
  await call('/chats', 'POST', a, target, 404);
  await call(`/blocks/${block.id}`, 'DELETE', b);
  await call('/chats', 'POST', a, target);

  const invite = await call('/invite', 'POST', b, {});
  await call('/profile', 'PATCH', b, { alias: 'South', handle: '', requests: 'closed' });
  assert.equal((await call('/chats', 'GET', a)).chats.length, 0);
  await call('/chats', 'POST', c, { target: invite.code }, 404);
  await call('/chats', 'POST', c, target, 404);
  await call('/invite', 'POST', b, {}, 409);
});

test('stored messages paginate without gaps after reconnect', async (t) => {
  const { call, user } = await start(t);
  const a = await user('One');
  const b = await user('Two');
  const { code } = await call('/invite', 'POST', b, {});
  const { id } = await call('/chats', 'POST', a, { target: code });
  const path = `/chats/${id}`;
  await call(path, 'PATCH', b, { action: 'accept' });
  for (let i = 1; i <= 64; i++) {
    await call(`${path}/messages`, 'POST', a, { text: String(i), clientId: `paginates-${i}` });
  }
  const latest = await call(`${path}/messages`, 'GET', b);
  assert.equal(latest.more, true);
  assert.equal(latest.messages.length, 60);
  const older = await call(`${path}/messages?before=${latest.messages[0].id}`, 'GET', b);
  assert.equal(older.more, false);
  const missed = await call(`${path}/messages?after=${older.messages[0].id}`, 'GET', b);
  assert.equal(missed.more, true);
  const caughtUp = await call(`${path}/messages?after=${missed.messages.at(-1).id}`, 'GET', b);
  assert.equal(caughtUp.more, false);
  assert.deepEqual(caughtUp.messages.map((entry) => Number(entry.text)), [62, 63, 64]);
  assert.deepEqual([...older.messages, ...latest.messages].map((entry) => Number(entry.text)),
    Array.from({ length: 64 }, (_, index) => index + 1));
});
