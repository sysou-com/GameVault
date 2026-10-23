/**
 * cube-rush 稳定性检查（用户裁定 2026-10-23：另一会话在调测 games/cube-rush/，
 * 期间任何会话不动该目录代码；目录稳定 8h（连续两次 4h 检查无变化）后提醒用户开始 W3）。
 *
 * 用法：
 *   node dev-cube-rush-watch.mjs            # 检查并更新状态，打印 JSON
 *   node dev-cube-rush-watch.mjs --remind   # 标记「已提醒」，避免重复提醒
 *
 * 状态文件：.pi/cube-rush-watch-state.json（.pi/ 已 gitignore）
 * 输出 JSON：{ status: "CHANGED"|"STABLE"|"ERROR", streak, reminded, fileCount, lastChangeAt }
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'games/cube-rush';
const STATE = join('.pi', 'cube-rush-watch-state.json');
const EXCLUDE_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // 跳过隐藏文件/目录
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(p, out);
    } else if (e.isFile()) {
      try {
        const st = statSync(p);
        out.push(`${relative(ROOT, p)}\t${Math.floor(st.mtimeMs)}`);
      } catch { /* 瞬态文件竞争，忽略 */ }
    }
  }
}

const files = [];
walk(ROOT, files);
if (files.length === 0) {
  console.log(JSON.stringify({ status: 'ERROR', message: 'games/cube-rush 下未找到文件（cwd 是否为仓库根？' + process.cwd() + '）' }));
  process.exit(1);
}
const hash = [...files].sort().join('\n');

let prev = { hash: null, streak: 0, reminded: false, lastChangeAt: null };
if (existsSync(STATE)) {
  try { prev = { ...prev, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { /* 状态损坏则重置 */ }
}

const changed = prev.hash !== hash;
if (process.argv.includes('--remind')) prev.reminded = true;
const state = {
  hash,
  streak: changed ? 0 : (prev.streak ?? 0) + 1,
  reminded: prev.reminded ?? false,
  lastChangeAt: changed ? new Date().toISOString() : prev.lastChangeAt,
  fileCount: files.length,
};
mkdirSync('.pi', { recursive: true });
writeFileSync(STATE, JSON.stringify(state, null, 2));

console.log(JSON.stringify({
  status: changed ? 'CHANGED' : 'STABLE',
  streak: state.streak,
  reminded: state.reminded,
  fileCount: files.length,
  lastChangeAt: state.lastChangeAt,
}, null, 2));
