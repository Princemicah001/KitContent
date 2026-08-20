import { getSession } from '../database.js';

export async function requireAuth(req, res, next) {
  const cookies = req.headers.cookie;
  if (!cookies) return res.status(401).json({ error: 'Unauthorized: No session' });

  const cookieParts = cookies.split(';');
  let sessionId = null;
  for (const cookie of cookieParts) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'session_id') {
      sessionId = value;
      break;
    }
  }

  if (!sessionId) return res.status(401).json({ error: 'Unauthorized: No session id' });

  const session = await getSession(sessionId);
  if (!session) return res.status(401).json({ error: 'Unauthorized: Invalid session' });

  req.user = { open_id: session.open_id };
  next();
}
