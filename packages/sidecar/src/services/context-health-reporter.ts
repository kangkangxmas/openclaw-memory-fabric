import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

export interface ContextHealthReporterOptions {
  openclawRoot?: string;
  activeTranscriptMaxBytes?: number;
  trajectoryArchiveBytes?: number;
  maxFiles?: number;
  logTailBytes?: number;
  logMaxAgeMs?: number;
  logPathGroups?: string[][];
  now?: () => Date;
}

export interface ContextHealthFileSummary {
  path: string;
  bytes: number;
  archived: boolean;
  kind: "transcript" | "trajectory";
}

export interface ContextHealthReport {
  ok: true;
  generatedAt: string;
  openclawRoot: string;
  thresholds: {
    activeTranscriptMaxBytes: number;
    trajectoryArchiveBytes: number;
  };
  files: {
    sessionCount: number;
    scannedFileCount: number;
    maxTranscriptBytes: number;
    maxTrajectoryBytes: number;
    activeTranscriptWarnings: ContextHealthFileSummary[];
    trajectoryArchiveCandidates: ContextHealthFileSummary[];
  };
  compaction: {
    compactionCount: number;
    overflowCount: number;
    timeoutCount: number;
    alreadyCompactedRecentlyCount: number;
    staleBriefDetailedInjectionCount: number;
    staleBriefSkippedCount: number;
  };
  warnings: string[];
}

const DEFAULT_ACTIVE_TRANSCRIPT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TRAJECTORY_ARCHIVE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_LOG_TAIL_BYTES = 1_000_000;
const DEFAULT_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SKIPPED_DIRS = new Set([
  ".git",
  "browser",
  "cache",
  "media",
  "node_modules",
  "npm",
  "plugins",
]);

export class ContextHealthReporter {
  private readonly openclawRoot: string;
  private readonly activeTranscriptMaxBytes: number;
  private readonly trajectoryArchiveBytes: number;
  private readonly maxFiles: number;
  private readonly logTailBytes: number;
  private readonly logMaxAgeMs: number;
  private readonly logPathGroups?: string[][];
  private readonly now: () => Date;

  constructor(opts: ContextHealthReporterOptions = {}) {
    this.openclawRoot = opts.openclawRoot ?? join(homedir(), ".openclaw");
    this.activeTranscriptMaxBytes = opts.activeTranscriptMaxBytes ?? DEFAULT_ACTIVE_TRANSCRIPT_MAX_BYTES;
    this.trajectoryArchiveBytes = opts.trajectoryArchiveBytes ?? DEFAULT_TRAJECTORY_ARCHIVE_BYTES;
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
    this.logTailBytes = opts.logTailBytes ?? DEFAULT_LOG_TAIL_BYTES;
    this.logMaxAgeMs = opts.logMaxAgeMs ?? DEFAULT_LOG_MAX_AGE_MS;
    this.logPathGroups = opts.logPathGroups;
    this.now = opts.now ?? (() => new Date());
  }

  async report(): Promise<ContextHealthReport> {
    const [files, logText] = await Promise.all([
      this.scanSessionFiles(),
      this.readGatewayLogs(),
    ]);
    const transcriptFiles = files.filter((file) => file.kind === "transcript");
    const trajectoryFiles = files.filter((file) => file.kind === "trajectory");
    const activeTranscriptFiles = transcriptFiles.filter((file) => !file.archived);
    const activeTrajectoryFiles = trajectoryFiles.filter((file) => !file.archived);
    const activeTranscriptWarnings = transcriptFiles
      .filter((file) => !file.archived && file.bytes > this.activeTranscriptMaxBytes)
      .sort((a, b) => b.bytes - a.bytes);
    const trajectoryArchiveCandidates = trajectoryFiles
      .filter((file) => !file.archived && file.bytes > this.trajectoryArchiveBytes)
      .sort((a, b) => b.bytes - a.bytes);
    const compaction = countCompactionSignals(logText);
    const warnings = [
      activeTranscriptWarnings.length > 0 ? `${activeTranscriptWarnings.length} active transcript files exceed threshold` : "",
      trajectoryArchiveCandidates.length > 0 ? `${trajectoryArchiveCandidates.length} trajectory files should be archived` : "",
      compaction.overflowCount > 0 ? `${compaction.overflowCount} context overflow log matches found` : "",
      compaction.timeoutCount > 0 ? `${compaction.timeoutCount} compaction timeout log matches found` : "",
      compaction.staleBriefDetailedInjectionCount > 0
        ? `${compaction.staleBriefDetailedInjectionCount} stale Graphify detailed injection matches found`
        : "",
    ].filter(Boolean);

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      openclawRoot: this.openclawRoot,
      thresholds: {
        activeTranscriptMaxBytes: this.activeTranscriptMaxBytes,
        trajectoryArchiveBytes: this.trajectoryArchiveBytes,
      },
      files: {
        sessionCount: transcriptFiles.length,
        scannedFileCount: files.length,
        maxTranscriptBytes: maxBytes(activeTranscriptFiles),
        maxTrajectoryBytes: maxBytes(activeTrajectoryFiles),
        activeTranscriptWarnings,
        trajectoryArchiveCandidates,
      },
      compaction,
      warnings,
    };
  }

  private async scanSessionFiles(): Promise<ContextHealthFileSummary[]> {
    const found: ContextHealthFileSummary[] = [];
    let visited = 0;

    const walk = async (dir: string): Promise<void> => {
      if (visited >= this.maxFiles) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (visited >= this.maxFiles) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRS.has(entry.name)) await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".jsonl")) continue;
        if (isLogJsonl(fullPath)) continue;

        visited++;
        const kind = entry.name.endsWith(".trajectory.jsonl") ? "trajectory" : "transcript";
        const info = await stat(fullPath).catch(() => undefined);
        if (!info) continue;
        found.push({
          path: relative(this.openclawRoot, fullPath),
          bytes: info.size,
          archived: isArchivedPath(fullPath),
          kind,
        });
      }
    };

    await walk(this.openclawRoot);
    return found;
  }

  private async readGatewayLogs(): Promise<string> {
    const groups = this.logPathGroups ?? defaultGatewayLogPathGroups(this.openclawRoot, this.now());
    for (const group of groups) {
      const recentPaths = await filterRecentFiles(group, this.now().getTime(), this.logMaxAgeMs);
      if (recentPaths.length === 0) continue;
      const chunks = await Promise.all(recentPaths.map((path) => readTail(path, this.logTailBytes)));
      return chunks.join("\n");
    }
    return "";
  }
}

function countCompactionSignals(text: string): ContextHealthReport["compaction"] {
  const staleDetailedMatches = text.match(/graphify:brief:stale(?!-skipped)|Freshness:\s*stale\s*\|\s*Core entities/gi) ?? [];
  return {
    compactionCount: (text.match(/\bcompact(?:ion|ed|ing)?\b/gi) ?? []).length,
    overflowCount: (text.match(/context\s+overflow(?:\s+detected)?|overflow.*context/gi) ?? []).length,
    timeoutCount: (text.match(/timeout\s+during\s+compaction|compaction\s+timeout|timeout.*compact/gi) ?? []).length,
    alreadyCompactedRecentlyCount: (text.match(/already_compacted_recently/gi) ?? []).length,
    staleBriefDetailedInjectionCount: staleDetailedMatches.length,
    staleBriefSkippedCount: (text.match(/graphify:brief:stale-skipped|graphBriefStaleSkipped/gi) ?? []).length,
  };
}

function defaultGatewayLogPathGroups(openclawRoot: string, now: Date): string[][] {
  const currentDate = formatDate(now);
  const previousDate = formatDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return [
    [
      join(homedir(), "Library", "Logs", "openclaw", "gateway.log"),
      join(homedir(), "Library", "Logs", "openclaw", "gateway.err.log"),
    ],
    [
      join("/tmp", "openclaw", `openclaw-${currentDate}.log`),
      join("/tmp", "openclaw", `openclaw-${currentDate}.err.log`),
      join("/tmp", "openclaw", `openclaw-${previousDate}.log`),
      join("/tmp", "openclaw", `openclaw-${previousDate}.err.log`),
    ],
    [
      join(openclawRoot, "logs", "gateway.log"),
      join(openclawRoot, "logs", "gateway.err.log"),
    ],
  ];
}

async function filterRecentFiles(paths: string[], nowMs: number, maxAgeMs: number): Promise<string[]> {
  const recent: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch(() => undefined);
    if (!info) continue;
    if (nowMs - info.mtimeMs > maxAgeMs) continue;
    recent.push(path);
  }
  return recent;
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function readTail(path: string, maxBytes: number): Promise<string> {
  let handle;
  try {
    const info = await stat(path);
    handle = await open(path, "r");
    const readSize = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, Math.max(0, info.size - readSize));
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isArchivedPath(path: string): boolean {
  const parts = path.split(sep);
  return parts.includes("archive") || parts.includes("archives") || parts.includes("backups") || parts.includes("session-backups");
}

function isLogJsonl(path: string): boolean {
  const parts = path.split(sep);
  return parts.includes("logs") || parts.includes("delivery-queue") || parts.includes("session-delivery-queue");
}

function maxBytes(files: ContextHealthFileSummary[]): number {
  return files.reduce((max, file) => Math.max(max, file.bytes), 0);
}
