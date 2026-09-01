import { NextRequest, NextResponse } from 'next/server';
import { cinemeta } from '@discord-stremio/metadata';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q');
  const type = (req.nextUrl.searchParams.get('type') || 'movie') as 'movie' | 'series';

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await cinemeta.searchMedia(query, type);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, results: [] }, { status: 500 });
  }
}
