import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.argv[2];
if (!vault) throw new Error('Usage: node scripts/deploy.mjs <path-to-vault>');
const target = join(vault, '.obsidian', 'plugins', 'picture-flashcards');
mkdirSync(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(file, join(target, file));
console.log(`Copied to ${target}`);
