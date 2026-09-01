import os from 'os';

export interface SystemMetrics {
  cpuUsage: number;
  freeMemMB: number;
  totalMemMB: number;
  memUsagePercent: number;
  processMemRSSMB: number;
  uptimeSeconds: number;
}

export function getSystemMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsage = (usedMem / totalMem) * 100;
  const procMem = process.memoryUsage();

  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as any)[type];
    }
    totalIdle += cpu.times.idle;
  }
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const cpuPercent = 100 - ~~(100 * (idle / total));

  return {
    cpuUsage: Math.max(0, Math.min(cpuPercent, 100)),
    freeMemMB: Math.round(freeMem / 1024 / 1024),
    totalMemMB: Math.round(totalMem / 1024 / 1024),
    memUsagePercent: Math.round(memUsage),
    processMemRSSMB: Math.round(procMem.rss / 1024 / 1024),
    uptimeSeconds: Math.round(process.uptime()),
  };
}
