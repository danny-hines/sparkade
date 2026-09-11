import { NextRequest, NextResponse } from 'next/server';
import { start, getRun } from 'workflow/api';
import { authorizeKioskRequest } from '@/lib/kiosk-auth';
import { imageProbeWorkflow } from '@/workflows/image-probe';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return new NextResponse(null, { status: 404 });
  if (!(await authorizeKioskRequest(request))) return new NextResponse(null, { status: 401 });
  const run = await start(imageProbeWorkflow);
  return NextResponse.json({ runId: run.runId });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return new NextResponse(null, { status: 404 });
  if (!(await authorizeKioskRequest(request))) return new NextResponse(null, { status: 401 });
  const id = request.nextUrl.searchParams.get('runId');
  if (!id || !/^wrun_[a-zA-Z0-9_-]+$/.test(id)) return new NextResponse(null, { status: 400 });
  const run = getRun(id);
  const status = await run.status;
  return NextResponse.json({
    status,
    ...(status === 'completed' ? { result: await run.returnValue } : {}),
  });
}
