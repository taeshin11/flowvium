import MailPrefsPage from '@/components/pages/MailPrefsPage';
import type { Metadata } from 'next';

// 메일 링크로만 오는 페이지 — 검색에 올리지 않는다.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return <MailPrefsPage />;
}
