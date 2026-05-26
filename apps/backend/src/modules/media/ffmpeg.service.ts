import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ProcessVideoOptions {
  trimStart?: number;
  trimEnd?: number;
  volume?: number;
  audioPath?: string;
  audioVolume?: number;
  shortForm?: boolean;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  audioCodec: string;
  bitrate: number;
  aspectRatio: string;
  isPortrait: boolean;
  isShortForm: boolean;
  raw?: any;
}

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly tmpDir = path.join(process.cwd(), 'tmp', 'media');
  private ffmpegAvailable = false;
  private ffprobeAvailable = false;
  private ffmpegPath = '';
  private ffprobePath = '';

  constructor() {
    if (!fs.existsSync(this.tmpDir)) fs.mkdirSync(this.tmpDir, { recursive: true });
    this.cleanupOldTempFiles();
    this.validateBinaries();
  }

  isAvailable(): boolean {
    return this.ffmpegAvailable && this.ffprobeAvailable;
  }

  canExtractMetadata(): boolean {
    return this.ffprobeAvailable;
  }

  canGenerateThumbnails(): boolean {
    return this.ffmpegAvailable;
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      ffmpeg: { available: this.ffmpegAvailable, path: this.ffmpegPath },
      ffprobe: { available: this.ffprobeAvailable, path: this.ffprobePath },
    };
  }

  private validateBinaries() {
    this.ffmpegPath = this.resolveBinary('FFMPEG_PATH', 'ffmpeg.exe', 'ffmpeg');
    this.ffprobePath = this.resolveBinary('FFPROBE_PATH', 'ffprobe.exe', 'ffprobe');

    this.ffmpegAvailable = this.verifyBinary(this.ffmpegPath, 'ffmpeg');
    this.ffprobeAvailable = this.verifyBinary(this.ffprobePath, 'ffprobe');

    try {
      const ffmpeg = require('fluent-ffmpeg');
      if (this.ffmpegAvailable) ffmpeg.setFfmpegPath(this.ffmpegPath);
      if (this.ffprobeAvailable) ffmpeg.setFfprobePath(this.ffprobePath);
    } catch (err: any) {
      this.logger.warn(`fluent-ffmpeg package unavailable: ${err.message}`);
    }

    if (this.ffmpegAvailable && this.ffprobeAvailable) {
      this.logger.log(`FFmpeg ready: ${this.ffmpegPath}`);
      this.logger.log(`FFprobe ready: ${this.ffprobePath}`);
    } else {
      this.logger.warn('FFmpeg integration is degraded.');
      if (!this.ffmpegAvailable) this.logger.warn('ffmpeg executable not available. Thumbnail generation and video processing disabled.');
      if (!this.ffprobeAvailable) this.logger.warn('ffprobe executable not available. Video metadata extraction disabled.');
      this.logger.warn('Set FFMPEG_PATH and FFPROBE_PATH in .env, or add the ffmpeg bin folder to PATH.');
    }
  }

  private normalizePath(value?: string): string {
    return (value || '').trim().replace(/^['"]|['"]$/g, '');
  }

  private resolveBinary(envKey: string, windowsName: string, unixName: string): string {
    const envPath = this.normalizePath(process.env[envKey]);
    if (envPath && fs.existsSync(envPath)) return envPath;

    const binary = os.platform() === 'win32' ? windowsName : unixName;
    const candidates = [
      ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, binary)),
      `C:/ffmpeg/bin/${binary}`,
      `C:/Program Files/ffmpeg/bin/${binary}`,
      `C:/ProgramData/chocolatey/bin/${binary}`,
      ...this.findWingetCandidates(binary),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || envPath || unixName;
  }

  private findWingetCandidates(binary: string): string[] {
    const root = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    if (!fs.existsSync(root)) return [];

    try {
      return fs.readdirSync(root)
        .filter((name) => name.toLowerCase().includes('ffmpeg'))
        .flatMap((name) => {
          const packageDir = path.join(root, name);
          return fs.readdirSync(packageDir)
            .filter((child) => child.toLowerCase().includes('ffmpeg'))
            .map((child) => path.join(packageDir, child, 'bin', binary));
        });
    } catch {
      return [];
    }
  }

  private verifyBinary(binaryPath: string, label: string): boolean {
    const { execFileSync } = require('child_process');
    try {
      execFileSync(binaryPath, ['-version'], {
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch (err: any) {
      this.logger.warn(`${label} check failed for "${binaryPath}": ${err.code || err.name} ${err.message}`);
      return false;
    }
  }

  private execFile(binaryPath: string, args: string[], context: string): Promise<{ stdout: string; stderr: string }> {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      execFile(binaryPath, args, { timeout: 30_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
        if (err) {
          this.logger.error(`${context} failed: ${err.code || err.name} ${err.message}`);
          if (stderr) this.logger.error(`${context} stderr: ${stderr.slice(0, 2000)}`);
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  async processVideo(inputPath: string, options: ProcessVideoOptions = {}): Promise<string> {
    if (!this.ffmpegAvailable) {
      throw new Error('FFmpeg is not installed. Set FFMPEG_PATH or add ffmpeg to PATH.');
    }

    const ffmpeg = require('fluent-ffmpeg');
    const outputPath = path.join(this.tmpDir, `${uuidv4()}.mp4`);
    const timeoutMs = Number(process.env.FFMPEG_PROCESS_TIMEOUT_MS || 10 * 60 * 1000);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath);
      let completed = false;
      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        try { command.kill('SIGKILL'); } catch {}
        this.cleanup(outputPath);
        reject(new Error(`FFmpeg processing timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      if (options.trimStart !== undefined) command = command.seekInput(options.trimStart);
      if (options.trimEnd !== undefined && options.trimStart !== undefined) {
        command = command.duration(options.trimEnd - options.trimStart);
      }

      const filters: string[] = [];
      if (options.volume !== undefined && options.volume !== 1.0) filters.push(`volume=${options.volume}`);
      if (options.audioPath) {
        command = command.input(options.audioPath);
        filters.push(`[1:a]volume=${options.audioVolume ?? 1.0}[a1]`);
        filters.push('[0:a][a1]amix=inputs=2:duration=first[aout]');
        command = command.complexFilter(filters).outputOptions(['-map 0:v', '-map [aout]']);
      } else if (filters.length > 0) {
        command = command.audioFilters(filters);
      }

      command
        .outputOptions(['-c:v libx264', '-preset fast', '-crf 23', '-movflags +faststart'])
        .output(outputPath)
        .on('end', () => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          resolve(outputPath);
        })
        .on('error', (err: any, stdout: string, stderr: string) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          this.logger.error(`Video processing failed for ${path.basename(inputPath)}: ${err.message}`);
          if (stderr) this.logger.error(`ffmpeg stderr: ${stderr.slice(0, 2000)}`);
          this.cleanup(outputPath);
          reject(err);
        })
        .run();
    });
  }

  async extractThumbnail(videoPath: string, timeSeconds = 1): Promise<string> {
    if (!this.ffmpegAvailable) return '';

    const outputPath = path.join(this.tmpDir, `${uuidv4()}.jpg`);
    try {
      await this.execFile(this.ffmpegPath, [
        '-y',
        '-ss', String(Math.max(0, timeSeconds)),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=1280:-2',
        '-q:v', '3',
        outputPath,
      ], `thumbnail extraction for ${path.basename(videoPath)}`);

      return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0 ? outputPath : '';
    } catch {
      return '';
    }
  }

  async optimizeForShortForm(inputPath: string): Promise<string> {
    if (!this.ffmpegAvailable) {
      throw new Error('FFmpeg is not installed. Set FFMPEG_PATH or add ffmpeg to PATH.');
    }

    const outputPath = path.join(this.tmpDir, `${uuidv4()}-short.mp4`);
    const vf = [
      'scale=1080:1920:force_original_aspect_ratio=decrease',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      'fps=30',
      'format=yuv420p',
    ].join(',');

    await this.execFile(this.ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', vf,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.1',
      '-preset', 'fast',
      '-crf', '23',
      '-maxrate', '8M',
      '-bufsize', '16M',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ], `short-form optimization for ${path.basename(inputPath)}`);

    return outputPath;
  }

  async getMetadata(filePath: string): Promise<VideoMetadata> {
    const fallback: VideoMetadata = {
      duration: 0,
      width: 0,
      height: 0,
      codec: '',
      audioCodec: '',
      bitrate: 0,
      aspectRatio: '',
      isPortrait: false,
      isShortForm: false,
    };
    if (!this.ffprobeAvailable) return fallback;

    try {
      const { stdout } = await this.execFile(this.ffprobePath, [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ], `metadata extraction for ${path.basename(filePath)}`);

      const metadata = JSON.parse(stdout);
      const video = (metadata.streams || []).find((s: any) => s.codec_type === 'video');
      const audio = (metadata.streams || []).find((s: any) => s.codec_type === 'audio');
      const width = Number(video?.width || 0);
      const height = Number(video?.height || 0);
      const duration = Number(metadata.format?.duration || video?.duration || 0);
      const gcd = width && height ? this.gcd(width, height) : 0;
      const aspectRatio = gcd ? `${width / gcd}:${height / gcd}` : '';

      return {
        duration,
        width,
        height,
        codec: video?.codec_name || '',
        audioCodec: audio?.codec_name || '',
        bitrate: Number(metadata.format?.bit_rate || video?.bit_rate || 0),
        aspectRatio,
        isPortrait: width > 0 && height > 0 ? width / height < 0.8 : false,
        isShortForm: duration > 0 && duration <= 60 && width > 0 && height > 0 && width / height < 0.8,
        raw: metadata,
      };
    } catch {
      return fallback;
    }
  }

  cleanup(filePath: string) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }

  private cleanupOldTempFiles() {
    const maxAgeMs = Number(process.env.MEDIA_TMP_MAX_AGE_MS || 24 * 60 * 60 * 1000);
    try {
      for (const file of fs.readdirSync(this.tmpDir)) {
        const fullPath = path.join(this.tmpDir, file);
        const stat = fs.statSync(fullPath);
        if (Date.now() - stat.mtimeMs > maxAgeMs) this.cleanup(fullPath);
      }
    } catch (err: any) {
      this.logger.warn(`Temp media cleanup failed: ${err.message}`);
    }
  }

  private gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b);
  }
}
