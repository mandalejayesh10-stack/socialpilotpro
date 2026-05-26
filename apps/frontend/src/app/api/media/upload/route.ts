/**
 * Next.js API Route: POST /api/media/upload
 *
 * Proxies multipart/form-data uploads directly to the backend,
/**
 * Next.js API Route: POST /api/media/upload
 *
 * Proxies multipart/form-data uploads directly to the backend,
 * bypassing the Next.js rewrite which has a 4MB body-size limit.
 * This route streams the raw request body to avoid buffering issues.
 */

import { NextRequest, NextResponse } from 'next/server';

if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_PROXY_URL) {
  throw new Error('BACKEND_PROXY_URL is required in production for media uploads.');
}

const BACKEND_URL = process.env.NODE_ENV === 'production'
  ? process.env.BACKEND_PROXY_URL!
  : (process.env.BACKEND_PROXY_URL || 'http://localhost:3000');

export async function POST(req: NextRequest) {
  try {
    // Forward all relevant headers except host
    const forwardHeaders: Record<string, string> = {};

    req.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // Forward auth, org, content-type (with boundary), ngrok header
      // Skip host — backend needs its own host
      if (
        lower === 'authorization' ||
        lower === 'x-org-id' ||
        lower === 'content-type' ||
        lower === 'cookie' ||
        lower === 'ngrok-skip-browser-warning'
      ) {
        forwardHeaders[key] = value;
      }
    });

    // Stream the body directly to the backend — no buffering
    const backendRes = await fetch(`${BACKEND_URL}/api/media/upload`, {
      method: 'POST',
      headers: forwardHeaders,
      body: req.body,
      // @ts-ignore — duplex required for streaming request bodies in Node 18+
      duplex: 'half',
    });

    const data = await backendRes.json().catch(() => ({}));

    return NextResponse.json(data, { status: backendRes.status });
  } catch (err: any) {
    console.error('[upload-proxy] error:', err);
    return NextResponse.json(
      { message: err?.message || 'Upload proxy failed' },
      { status: 502 },
    );
  }
}
