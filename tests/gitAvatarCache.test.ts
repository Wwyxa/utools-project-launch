import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=', 'base64');
const url = 'https://avatars.githubusercontent.com/u/123?s=80';
const image = `data:image/png;base64,${png.toString('base64')}`;
const ttl = 14 * 24 * 60 * 60 * 1000;

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
  it('shares author requests and image URLs, and survives a fresh preload', async () => {
    const first = fixture();
    const loader = vi.fn(() => url);
    await expect(Promise.all([first.read('author', loader), first.read('author', loader)]))
      .resolves.toEqual([image, image]);
    expect(loader).toHaveBeenCalledOnce();
    first.advance(ttl - 1);
    await expect(first.read('author', loader)).resolves.toBe(image);
    expect(loader).toHaveBeenCalledOnce();
    await expect(first.read('another-author', () => url)).resolves.toBe(image);
    expect(first.fetchImage).toHaveBeenCalledOnce();
    const reopened = fixture(first.root);
    await expect(reopened.read('author', () => { throw new Error('should use disk'); })).resolves.toBe(image);
    expect(reopened.fetchImage).not.toHaveBeenCalled();
  });

  it('serves stale images immediately, refreshes unchanged URLs and notifies the page', async () => {
    const context = fixture();
    await context.read('author', () => url);
    context.advance(ttl + 1);
    let complete!: (response: Response) => void;
    context.fetchImage.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await expect(context.read('author', () => url)).resolves.toBe(image);
    const replacement = Buffer.concat([png, Buffer.from('changed')]);
    complete(new Response(replacement, { headers: { 'content-type': 'image/png' } }));
    await context.idle();
    const updated = `data:image/png;base64,${replacement.toString('base64')}`;
    expect(context.events).toContainEqual({ type: 'git-avatar-updated', previousImage: image, image: updated });
    const reopened = fixture(context.root);
    reopened.advance(ttl + 1);
    await expect(reopened.read('author', () => null)).resolves.toBe(updated);
  });

  it('keeps stale images on refresh failures and backs off before retrying', async () => {
    const context = fixture();
    await context.read('author', () => url);
    context.advance(ttl + 1);
    context.fetchImage.mockRejectedValueOnce(new Error('offline'));
    await expect(context.read('author', () => url)).resolves.toBe(image);
    await context.idle();
    await context.read('author', () => url);
    expect(context.fetchImage).toHaveBeenCalledTimes(2);
    context.advance(5 * 60 * 1000 + 1);
    await context.read('author', () => url);
    await context.idle();
    expect(context.fetchImage).toHaveBeenCalledTimes(3);
  });

  it('does not resurrect disk or memory cache when cleanup races with a download', async () => {
    const context = fixture();
    let complete!: (response: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    context.fetchImage.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; markStarted(); }));
    const pending = context.read('author', () => url);
    await started;
    context.clear();
    complete(new Response(png, { headers: { 'content-type': 'image/png' } }));
    await expect(pending).resolves.toBeNull();
    expect(fs.existsSync(path.join(context.root, 'cache', 'git-avatars'))).toBe(false);
    await expect(context.read('author', () => url)).resolves.toBe(image);
    expect(context.fetchImage).toHaveBeenCalledTimes(2);
  });

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