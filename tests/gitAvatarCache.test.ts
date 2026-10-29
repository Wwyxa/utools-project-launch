import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=', 'base64');
const url = 'https://avatars.githubusercontent.com/u/123?s=80';

function fixture(root = fs.mkdtempSync(path.join(tmpdir(), 'git-avatar-cache-'))) {
  if (!roots.includes(root)) roots.push(root);
  let now = 1000000000;
  const events: Array<{ type: string; image?: string; previousImage?: string }> = [];
  const fetchImage = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
  class CacheEvent {
    detail: { type: string };
    constructor(_type: string, options: { detail: { type: string } }) { this.detail = options.detail; }
  }
  const context = createContext({
    fs, path, Buffer, URL, AbortController, setTimeout, clearTimeout,
    require: createRequire(import.meta.url),
    Date: { now: () => now }, fetch: fetchImage,
    pluginLocalDataDirectory: () => root,
    gitCommitAvatarResults: new Map(),
    CustomEvent: CacheEvent,
    window: { dispatchEvent: (event: CacheEvent) => events.push(event.detail) },
  });
  runInContext(fs.readFileSync('public/preload/git-avatar-cache.js', 'utf8'), context);
  return {
    root, events, fetchImage,
    read: runInContext('readCachedGitAvatar', context) as (key: string, load: () => string | null | Promise<string | null>) => Promise<string | null>,
    clear: runInContext('clearGitAvatarCache', context) as () => void,
    idle: () => Promise.all([...runInContext('gitAvatarImageRequests.values()', context)]),
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('Git avatar local image cache', () => {

  it('rejects unsafe redirects, oversized responses and invalid image contents', async () => {
    const context = fixture();
    await expect(context.read('unsafe', () => 'https://example.invalid/avatar')).resolves.toBeNull();
    expect(context.fetchImage).not.toHaveBeenCalled();
    context.fetchImage.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/avatar' } }));
    await expect(context.read('redirect', () => url)).resolves.toBeNull();
    context.fetchImage.mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '1048577' } }));
    await expect(context.read('large', () => url)).resolves.toBeNull();
    context.fetchImage.mockResolvedValueOnce(new Response('<html>error</html>', { headers: { 'content-type': 'image/png' } }));
    await expect(context.read('invalid', () => url)).resolves.toBeNull();
  });

});