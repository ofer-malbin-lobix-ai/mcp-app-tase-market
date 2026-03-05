import crypto from 'node:crypto';

const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// Get secret from env or generate a random one (will change on restart)
const getSecret = (): string => {
  return process.env.SUBSCRIBE_TOKEN_SECRET ?? process.env.CLERK_SECRET_KEY ?? 'fallback-secret';
};

interface TokenPayload {
  userId: string;
  exp: number;
}

export function generateSubscribeToken(userId: string): string {
  const payload: TokenPayload = {
    userId,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };

  const data = JSON.stringify(payload);
  const secret = getSecret();

  // Create HMAC signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac.digest('hex');

  // Encode payload and signature
  const token = Buffer.from(`${data}.${signature}`).toString('base64url');
  return token;
}

export function verifySubscribeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [dataStr, signature] = decoded.split('.');

    if (!dataStr || !signature) {
      return null;
    }

    // Verify signature
    const secret = getSecret();
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(dataStr);
    const expectedSignature = hmac.digest('hex');

    if (signature !== expectedSignature) {
      console.error('[Token] Invalid signature');
      return null;
    }

    // Parse and check expiry
    const payload = JSON.parse(dataStr) as TokenPayload;

    if (Date.now() > payload.exp) {
      console.error('[Token] Token expired');
      return null;
    }

    return payload.userId;
  } catch (error) {
    console.error('[Token] Verification failed:', error);
    return null;
  }
}
