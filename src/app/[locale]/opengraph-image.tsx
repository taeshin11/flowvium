import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Flowvium — AI picks the stocks. Daily buy/sell recommendations.';
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
          AI Picks the Stocks. Every Day.
        </div>
        {/* Subtext */}
        <div
          style={{
            fontSize: 26,
            color: '#94a3b8',
            marginTop: 24,
            maxWidth: 820,
          }}
        >
          Daily AI buy/sell recommendations with entry, stop & target — backed by smart-money flows, supply-chain & macro signals. Free.
        </div>
        {/* CTA pill */}
        <div
          style={{
            display: 'flex',
            marginTop: 36,
            padding: '14px 28px',
            borderRadius: 14,
            background: 'linear-gradient(90deg, #7c3aed, #6d28d9)',
            color: '#ffffff',
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          See today's picks →
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
          flowvium.net
        </div>
      </div>
    ),
    { ...size }
  );
}
