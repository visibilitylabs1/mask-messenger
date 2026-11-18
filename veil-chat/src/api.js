export const defaultServer = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://10.0.2.2:8787' : '');

export function serverAddress(value) {
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid chat server address.');
  }
  const allowed = parsed.protocol === 'https:' || (__DEV__ && parsed.protocol === 'http:');
  if (!allowed || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Enter an HTTPS chat server address without credentials or query parameters.');
  }
  return parsed.href.replace(/\/+$/, '');
}

export async function request(path, { server, token, method = 'GET', body } = {}) {
  const base = serverAddress(server);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(base + path, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(result.error || 'Something went wrong.'), { status: response.status });
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Connection timed out. Try again.');
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('Could not reach the chat server.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
