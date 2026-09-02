import { NextRequest, NextResponse } from 'next/server';
import { getStoredSettings, saveStoredSettings } from '@/lib/settings-store';

export async function GET() {
  try {
    const settings = await getStoredSettings();
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const newSettings = await req.json();
    const settings = await saveStoredSettings(newSettings);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
