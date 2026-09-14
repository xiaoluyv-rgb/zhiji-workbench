// 一次性工具：把工作台注册为 Windows 开机自启。
// 往 Startup 文件夹写一个全 ASCII + CRLF 的 wrapper bat（cd 到工作台目录 + call start-workbench.bat）。
// 用法：node scripts/install-autostart-now.mjs
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const WB = 'C:\\Users\\28691\\WorkBuddy\\person_dashboard\\Workbench';
const STARTUP = 'C:\\Users\\28691\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup';
const DEST = path.join(STARTUP, 'Workbench-Autostart.bat');

// 内容全 ASCII，避免 GBK/UTF-8 编码问题；CRLF 是 bat 的硬性要求
const CONTENT = [
  '@echo off',
  `cd /d "${WB}"`,
  'call start-workbench.bat',
  '',
].join('\r\n');

writeFileSync(DEST, CONTENT, 'ascii');

const raw = readFileSync(DEST);
const crlf = (raw.toString().match(/\r\n/g) || []).length;
const bare = (raw.toString().match(/(?<!\r)\n/g) || []).length;

console.log('写入:', DEST);
console.log('字节数:', raw.length, ' CRLF:', crlf, ' 裸LF:', bare);
console.log('--- 内容 ---');
console.log(raw.toString());

// 反向校验：确认工作台目录存在，且 start-workbench.bat 存在
const bat = path.join(WB, 'start-workbench.bat');
console.log('--- 校验 ---');
console.log('工作台目录存在:', existsSync(WB));
console.log('start-workbench.bat 存在:', existsSync(bat));
