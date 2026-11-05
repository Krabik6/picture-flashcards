import { requestUrl } from 'obsidian';
import type { HttpPost } from '../ai/provider';

export const obsidianPost: HttpPost = async (url, headers, body) => {
  const res = await requestUrl({ url, method: 'POST', headers, body, throw: false });
  return { status: res.status, text: res.text };
};
