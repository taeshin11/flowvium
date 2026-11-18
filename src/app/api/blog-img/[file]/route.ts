import { readFile } from 'fs/promises';
import { join } from 'path';

// 2026-11-19: 블로그 글(Blogger·네이버)에 넣는 카드 그림을 내준다 — scripts/lib/blog-cards.mjs 가 reports/blog-img(git 제외) 에 그린다.
//   Blogger API 는 그림 올리기가 없어 그림을 바깥 주소로 걸어야 한다. 파일 이름에 내용 해시가 들어 있어 바뀌지 않는다.
export const dynamic = 'force-dynamic';
const DIR = () => join(process.cwd(), 'reports/blog-img');
const NAME = /^[a-z0-9-]{1,80}\.jpg$/;

export async function GET(_req: Request, { params }: { params: { file: string } }) {
  if (!NAME.test(params.file)) return new Response(null, { status: 404 });
  try {
    const buf = await readFile(join(DIR(), params.file));
    return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
