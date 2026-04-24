import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Flowvium — Supply Chain Intelligence Platform';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0a0f1a',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '4px',
            background: 'linear-gradient(90deg, #3b82f6, #6366f1)',
          }}
        />
        {/* Logo wordmark */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#3b82f6',
            letterSpacing: '-0.5px',
            marginBottom: 32,
          }}
        >
          Flowvium
        </div>
        {/* Headline */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: '#f1f5f9',
            lineHeight: 1.1,
            letterSpacing: '-2px',
            maxWidth: 900,
          }}
        >
          Supply Chain Intelligence Platform
        </div>
        {/* Subtext */}
        <div
          style={{
            fontSize: 26,
            color: '#94a3b8',
            marginTop: 24,
            maxWidth: 800,
          }}
        >
          Track where smart money flows. Institutional signals, cascade analysis, free.
        </div>
        {/* URL badge */}
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            right: 80,
            fontSize: 20,
            color: '#475569',
          }}
        >
          flowvium.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
