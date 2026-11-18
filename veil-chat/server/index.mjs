import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const handlePattern = /^[a-z0-9_]{3,24}$/;
const invitePattern = /^[0-9a-f]{32}$/;
const inviteLifetime = 24 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validatedText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${label} must be between 1 and ${max} characters.`);
  }
  return value.trim();
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32768) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

export function createChatServer(filename = 'veil.sqlite') {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, alias TEXT NOT NULL,
      handle TEXT UNIQUE, requests TEXT NOT NULL DEFAULT 'invite'
    );
    CREATE TABLE IF NOT EXISTS invites (
      owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_alias TEXT NOT NULL, recipient_alias TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', updated_at INTEGER NOT NULL,
      sender_read INTEGER NOT NULL DEFAULT 0, recipient_read INTEGER NOT NULL DEFAULT 0,
      UNIQUE(sender, recipient)
    );
    CREATE INDEX IF NOT EXISTS chats_recipient ON chats(recipient);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      author TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, client_id TEXT NOT NULL, UNIQUE(chat_id, author, client_id)
    );
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS blocks (
      owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL, PRIMARY KEY(owner, peer)
    );
    CREATE TABLE IF NOT EXISTS quota (
      bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
    );
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function limit(bucket, max, duration) {
    const now = Date.now();
    const result = get(`
      INSERT INTO quota VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        count = CASE WHEN quota.reset_at <= ? THEN 1 ELSE quota.count + 1 END,
        reset_at = CASE WHEN quota.reset_at <= ? THEN excluded.reset_at ELSE quota.reset_at END
      RETURNING count
    `, bucket, now + duration, now, now);
    if (result.count > max) throw new HttpError(429, 'Too many attempts. Try again later.');
  }

  function getChat(id, userId) {
    const chat = get('SELECT * FROM chats WHERE id = ? AND (sender = ? OR recipient = ?)', id, userId, userId);
    if (!chat) throw new HttpError(404, 'Conversation unavailable.');
    return chat;
  }

  function summarize(chat, userId) {
    const mine = chat.sender === userId;
    const latest = get('SELECT id, body, author FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1', chat.id);
    const readId = mine ? chat.sender_read : chat.recipient_read;
    const { count } = get('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND id > ? AND author != ?', chat.id, readId, userId);
    return {
      id: chat.id, state: chat.state, incoming: !mine, updatedAt: chat.updated_at,
      alias: mine ? chat.sender_alias : chat.recipient_alias,
      peerAlias: mine && chat.state === 'pending' ? '' : (mine ? chat.recipient_alias : chat.sender_alias),
      preview: latest?.body ?? '', unread: count,
    };
  }

  function newRequest(user, body) {
    const myAlias = validatedText(body.alias ?? user.alias, 32, 'Chat alias');
    const target = typeof body.target === 'string' ? body.target.trim().toLowerCase() : '';
    const byInvite = invitePattern.test(target);
    const peer = byInvite
      ? get('SELECT users.* FROM invites JOIN users ON users.id = invites.owner WHERE code_hash = ? AND expires_at > ? AND requests != ?', hash(target), Date.now(), 'closed')
      : (handlePattern.test(target.replace(/^@/, '')) && get('SELECT * FROM users WHERE handle = ? AND requests = ?', target.replace(/^@/, ''), 'handle'));
    const unavailable = () => new HttpError(404, 'Invite or handle unavailable.');
    if (!peer || peer.id === user.id) throw unavailable();
    if (get('SELECT 1 FROM blocks WHERE (owner = ? AND peer = ?) OR (owner = ? AND peer = ?)', user.id, peer.id, peer.id, user.id)) {
      throw unavailable();
    }
    const existing = get('SELECT * FROM chats WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)', user.id, peer.id, peer.id, user.id);
    if (existing) return summarize(existing, user.id);

    const id = randomUUID();
    run('INSERT INTO chats (id, sender, recipient, sender_alias, recipient_alias, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, user.id, peer.id, myAlias, peer.alias, Date.now());
    if (byInvite) run('DELETE FROM invites WHERE owner = ?', peer.id);
    return summarize(getChat(id, user.id), user.id);
  }

  function updateChat(chat, user, body) {
    if (body.action === 'block') {
      const peerId = chat.sender === user.id ? chat.recipient : chat.sender;
      const label = chat.sender === user.id ? (chat.state === 'pending' ? 'Pending request' : chat.recipient_alias) : chat.sender_alias;
      run('INSERT OR IGNORE INTO blocks VALUES (?, ?, ?)', user.id, peerId, label);
      run('DELETE FROM chats WHERE id = ?', chat.id);
      return {};
    }
    if (body.action === 'decline' && chat.recipient === user.id && chat.state === 'pending' ||
        body.action === 'cancel' && chat.sender === user.id && chat.state === 'pending' ||
        body.action === 'leave' && chat.state === 'active') {
      run('DELETE FROM chats WHERE id = ?', chat.id);
      return {};
    }
    if (body.action === 'accept' && chat.recipient === user.id && chat.state === 'pending') {
      const alias = validatedText(body.alias ?? chat.recipient_alias, 32, 'Chat alias');
      run('UPDATE chats SET state = ?, recipient_alias = ?, updated_at = ? WHERE id = ?', 'active', alias, Date.now(), chat.id);
      return summarize(getChat(chat.id, user.id), user.id);
    }
    if (body.action === 'alias' && (chat.state === 'active' || chat.sender === user.id)) {
      const alias = validatedText(body.alias, 32, 'Chat alias');
      const column = chat.sender === user.id ? 'sender_alias' : 'recipient_alias';
      run(`UPDATE chats SET ${column} = ? WHERE id = ?`, alias, chat.id);
      return summarize(getChat(chat.id, user.id), user.id);
    }
    if (body.action === 'read' && chat.state === 'active' && Number.isSafeInteger(body.id) && body.id > 0) {
      const message = get('SELECT id FROM messages WHERE id = ? AND chat_id = ?', body.id, chat.id);
      if (message) {
        const column = chat.sender === user.id ? 'sender_read' : 'recipient_read';
        run(`UPDATE chats SET ${column} = MAX(${column}, ?) WHERE id = ?`, message.id, chat.id);
      }
      return {};
    }
    throw new HttpError(409, 'This action is unavailable.');
  }

  async function dispatch(request) {
    const url = new URL(request.url, 'http://localhost');
    const route = url.pathname;
    const method = request.method;
    if (route === '/health' && method === 'GET') return { ok: true };
    if (route === '/session' && method === 'POST') {
      limit(`signup:${hash(request.socket.remoteAddress ?? 'unknown')}`, 15, 3600000);
      const { alias } = await readBody(request);
      const token = randomBytes(32).toString('hex');
      run('INSERT INTO users (id, token_hash, alias) VALUES (?, ?, ?)', randomUUID(), hash(token), validatedText(alias, 32, 'Alias'));
      return { token };
    }

    const token = (request.headers.authorization ?? '').match(/^Bearer ([0-9a-f]{64})$/)?.[1];
    const tokenHash = token && hash(token);
    let user = tokenHash && get('SELECT * FROM users WHERE token_hash = ?', tokenHash);
    if (!user) throw new HttpError(401, 'Session expired.');
    limit(`api:${user.id}`, 240, 60000);

    const body = method === 'PATCH' || method === 'POST' ? await readBody(request) : null;
    user = get('SELECT * FROM users WHERE token_hash = ?', tokenHash);
    if (!user) throw new HttpError(401, 'Session expired.');

    if (route === '/profile') {
      if (method === 'GET') return { alias: user.alias, handle: user.handle ?? '', requests: user.requests };
      if (method === 'DELETE') {
        run('DELETE FROM users WHERE id = ?', user.id);
        return {};
      }
      if (method === 'PATCH') {
        const alias = validatedText(body.alias, 32, 'Alias');
        const requests = body.requests;
        const handle = typeof body.handle === 'string' ? body.handle.trim().toLowerCase().replace(/^@/, '') : '';
        if (!['invite', 'handle', 'closed'].includes(requests)) throw new HttpError(400, 'Invalid request setting.');
        if ((handle || requests === 'handle') && !handlePattern.test(handle)) {
          throw new HttpError(400, 'Use 3–24 letters, numbers or underscores for your handle.');
        }
        if (handle && get('SELECT 1 FROM users WHERE handle = ? AND id != ?', handle, user.id)) {
          throw new HttpError(409, 'This handle is taken.');
        }
        return transaction(() => {
          run('UPDATE users SET alias = ?, handle = ?, requests = ? WHERE id = ?', alias, handle || null, requests, user.id);
          if (requests === 'closed') {
            run('DELETE FROM invites WHERE owner = ?', user.id);
            run("DELETE FROM chats WHERE recipient = ? AND state = 'pending'", user.id);
          }
          return { alias, handle, requests };
        });
      }
    }

    if (route === '/blocks' && method === 'GET') {
      return { blocks: all('SELECT rowid AS id, label FROM blocks WHERE owner = ? ORDER BY rowid DESC', user.id) };
    }
    const block = route.match(/^\/blocks\/([1-9][0-9]*)$/);
    if (block && method === 'DELETE') {
      run('DELETE FROM blocks WHERE rowid = ? AND owner = ?', Number(block[1]), user.id);
      return {};
    }

    if (route === '/invite') {
      if (method === 'DELETE') {
        run('DELETE FROM invites WHERE owner = ?', user.id);
        return {};
      }
      if (method === 'POST') {
        if (user.requests === 'closed') throw new HttpError(409, 'Enable chat requests to create an invite.');
        const code = randomBytes(16).toString('hex');
        const expiresAt = Date.now() + inviteLifetime;
        run('INSERT INTO invites VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at', user.id, hash(code), expiresAt);
        return { code, expiresAt };
      }
    }

    if (route === '/chats') {
      if (method === 'GET') {
        return { chats: all('SELECT * FROM chats WHERE sender = ? OR recipient = ? ORDER BY updated_at DESC, id', user.id, user.id)
          .map((chat) => summarize(chat, user.id)) };
      }
      if (method === 'POST') {
        limit(`request:${user.id}`, 20, 3600000);
        return transaction(() => newRequest(user, body));
      }
    }

    const matched = route.match(/^\/chats\/([0-9a-f-]{36})(\/messages)?$/);
    if (matched) {
      const chat = getChat(matched[1], user.id);
      if (!matched[2]) {
        if (method === 'GET') return summarize(chat, user.id);
        if (method === 'PATCH') return transaction(() => updateChat(chat, user, body));
      } else if (chat.state === 'active') {
        if (method === 'GET') {
          const before = url.searchParams.get('before');
          const after = url.searchParams.get('after');
          if (before !== null && after !== null) throw new HttpError(400, 'Use one message cursor.');
          const cursor = Number(after ?? before ?? Number.MAX_SAFE_INTEGER);
          if (!Number.isSafeInteger(cursor) || cursor < 1) throw new HttpError(400, 'Invalid message cursor.');
          const rows = after === null
            ? all('SELECT id, body, author, created_at FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT 61', chat.id, cursor)
            : all('SELECT id, body, author, created_at FROM messages WHERE chat_id = ? AND id > ? ORDER BY id ASC LIMIT 61', chat.id, cursor);
          const limit = rows.slice(0, 60);
          return { more: rows.length > 60, messages: (after === null ? limit.reverse() : limit).map((message) => ({
            id: message.id, text: message.body, mine: message.author === user.id, at: message.created_at,
          })) };
        }
        if (method === 'POST') {
          const text = validatedText(body.text, 4000, 'Message');
          if (typeof body.clientId !== 'string' || !/^[a-z0-9-]{10,72}$/.test(body.clientId)) throw new HttpError(400, 'Invalid message identifier.');
          return transaction(() => {
            const existing = get('SELECT id, body, created_at FROM messages WHERE chat_id = ? AND author = ? AND client_id = ?', chat.id, user.id, body.clientId);
            if (existing) return { id: existing.id, text: existing.body, mine: true, at: existing.created_at };
            const now = Date.now();
            const inserted = run('INSERT INTO messages (chat_id, author, body, created_at, client_id) VALUES (?, ?, ?, ?, ?)',
              chat.id, user.id, text, now, body.clientId);
            run('UPDATE chats SET updated_at = ? WHERE id = ?', now, chat.id);
            return { id: Number(inserted.lastInsertRowid), text, mine: true, at: now };
          });
        }
      }
    }
    throw new HttpError(404, 'This action is unavailable.');
  }

  const server = createServer(async (request, response) => {
    let result;
    let status = 200;
    try {
      result = await dispatch(request);
    } catch (error) {
      status = error instanceof HttpError ? error.status : 500;
      result = { error: status === 500 ? 'The server could not complete this request.' : error.message };
      if (status === 500) console.error('Chat request failed:', error.code ?? error.name);
    }
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(result));
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    run('DELETE FROM invites WHERE expires_at <= ?', now);
    run('DELETE FROM quota WHERE reset_at <= ?', now);
  }, 60000);
  cleanup.unref();
  server.on('close', () => {
    clearInterval(cleanup);
    db.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '8787');
  const host = process.env.HOST ?? '127.0.0.1';
  createChatServer(process.env.VEIL_DB_PATH).listen(port, host, () => console.log(`Veil chat server listening on ${host}:${port}`));
}
