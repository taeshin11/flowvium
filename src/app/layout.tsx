import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import ClientErrorReporter from '@/components/ClientErrorReporter';  // 2026-07-04: 브라우저 에러 → /api/client-log 수집
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // VERCEL 은 Vercel 런타임이 주입하는 표준 환경변수. 자가호스팅에서는 미설정.
  const isVercel = Boolean(process.env.VERCEL);

  return (
    <html suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} font-sans bg-cf-bg text-cf-text antialiased`}
      >
        {children}
        <ClientErrorReporter />
        {/* 2026-08-20: Vercel 애널리틱스는 Vercel 위에서만 의미가 있다. 자가호스팅(2026-06-02~)에서는
            /_vercel/insights/script.js 와 /_vercel/speed-insights/script.js 가 404 라
            모든 방문자 콘솔에 에러가 찍히고 요청이 낭비됐다. 코드에서 지우지 않고 환경으로 분기해
            Vercel 로 되돌릴 때 자동 복귀하게 둔다. */}
        {isVercel && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
