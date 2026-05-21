import browser from '../utils/browser-polyfill';
import { adapterFetchText } from './fetch';
import { SiteAdapter, SiteAdapterResult } from './types';

const FEISHU_HOSTS = new Set([
	'feishu.cn',
	'larksuite.com',
]);

interface FeishuBlock {
	id: string;
	imageToken?: string;
	imageUrl?: string;
	text?: string;
	type: string;
}

interface FeishuPageData {
	author?: string;
	blocks?: FeishuBlock[];
	objToken?: string;
	title?: string;
	wikiToken?: string;
}

interface FeishuPageResponse {
	data?: FeishuPageData;
	error?: string;
	success?: boolean;
}

interface DataUrlResponse {
	dataUrl?: string;
	error?: string;
	mimeType?: string;
	success?: boolean;
}

function isFeishuHost(hostname: string): boolean {
	return Array.from(FEISHU_HOSTS).some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function cleanText(value: string): string {
	return value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/\u00a0/g, ' ').trim();
}

function cleanTitle(value: string): string {
	return cleanText(value.replace(/\s*-\s*(飞书云文档|Lark Docs)\s*$/i, '')) || 'Untitled';
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function blockToMarkdown(block: FeishuBlock): string {
	const text = cleanText(block.text || '');

	if (block.imageUrl) {
		return `![](${block.imageUrl})`;
	}

	if (!text) return '';

	switch (block.type) {
		case 'heading1':
			return `## ${text}`;
		case 'heading2':
			return `### ${text}`;
		case 'heading3':
			return `#### ${text}`;
		case 'heading4':
			return `##### ${text}`;
		case 'heading5':
		case 'heading6':
			return `###### ${text}`;
		case 'bullet':
		case 'bulletList':
			return `- ${text}`;
		case 'ordered':
		case 'orderedList':
			return `1. ${text}`;
		default:
			return text;
	}
}

function blockToHtml(block: FeishuBlock): string {
	const text = escapeHtml(cleanText(block.text || ''));

	if (block.imageUrl) {
		return `<figure><img src="${escapeHtml(block.imageUrl)}" alt=""></figure>`;
	}

	if (!text) return '';

	switch (block.type) {
		case 'heading1':
			return `<h2>${text}</h2>`;
		case 'heading2':
			return `<h3>${text}</h3>`;
		case 'heading3':
			return `<h4>${text}</h4>`;
		case 'heading4':
			return `<h5>${text}</h5>`;
		case 'heading5':
		case 'heading6':
			return `<h6>${text}</h6>`;
		case 'bullet':
		case 'bulletList':
			return `<ul><li>${text}</li></ul>`;
		case 'ordered':
		case 'orderedList':
			return `<ol><li>${text}</li></ol>`;
		default:
			return `<p>${text}</p>`;
	}
}

function publicScysImageUrl(objToken: string | undefined, imageToken: string | undefined): string {
	if (!objToken || !imageToken) return '';
	return `https://search01.shengcaiyoushu.com/upload/doc/${encodeURIComponent(objToken)}/${encodeURIComponent(imageToken)}`;
}

async function isPublicImageAvailable(url: string): Promise<boolean> {
	try {
		await adapterFetchText(url, { method: 'HEAD', credentials: 'omit' });
		return true;
	} catch {
		return false;
	}
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
	const response = await browser.runtime.sendMessage({
		action: 'fetchAuthenticatedDataUrl',
		url,
	}) as DataUrlResponse;

	if (!response?.success || !response.dataUrl) {
		throw new Error(response?.error || 'Authenticated image fetch failed');
	}
	return response.dataUrl;
}

export async function resolveFeishuImages(data: FeishuPageData): Promise<FeishuPageData> {
	const blocks = await Promise.all((data.blocks || []).map(async (block) => {
		if (!block.imageUrl) return block;

		const publicUrl = publicScysImageUrl(data.objToken, block.imageToken);
		if (publicUrl && await isPublicImageAvailable(publicUrl)) {
			return { ...block, imageUrl: publicUrl };
		}

		try {
			return { ...block, imageUrl: await fetchImageAsDataUrl(block.imageUrl) };
		} catch {
			return block;
		}
	}));

	return { ...data, blocks };
}

export function feishuToMarkdown(data: FeishuPageData, sourceUrl: string): string {
	const title = cleanTitle(data.title || '');
	const body = (data.blocks || []).map(blockToMarkdown).filter(Boolean).join('\n\n');
	return [
		`# ${title}`,
		data.author ? `> Author: ${cleanText(data.author)}` : '',
		`> Source: ${sourceUrl}`,
		body,
	].filter(Boolean).join('\n\n');
}

export function feishuToHtml(data: FeishuPageData): string {
	const title = cleanTitle(data.title || '');
	const body = (data.blocks || []).map(blockToHtml).filter(Boolean).join('\n');
	return `<article data-site-adapter="feishu"><h1>${escapeHtml(title)}</h1>${body}</article>`;
}

function wordCount(markdown: string): number {
	const textOnly = markdown.replace(/!\[[^\]]*]\([^)]*\)/g, '');
	const latinWords = textOnly.match(/[A-Za-z0-9_]+/g)?.length || 0;
	const cjkChars = textOnly.match(/[\u3400-\u9fff]/g)?.length || 0;
	return latinWords + cjkChars;
}

async function extractFeishuPageData(): Promise<FeishuPageData | null> {
	const response = await browser.runtime.sendMessage({ action: 'extractFeishuPageData' }) as FeishuPageResponse;
	if (!response?.success || !response.data) {
		throw new Error(response?.error || 'Feishu page data was not available');
	}
	return response.data;
}

export const feishuAdapter: SiteAdapter = {
	id: 'feishu',
	matches(document: Document): boolean {
		const url = new URL(document.URL);
		return isFeishuHost(url.hostname) && /^\/(?:wiki|docx?|docs)\//.test(url.pathname);
	},
	async extract(document: Document): Promise<SiteAdapterResult | null> {
		const rawData = await extractFeishuPageData();
		if (!rawData?.blocks?.length) return null;
		const data = await resolveFeishuImages(rawData);

		const contentMarkdown = feishuToMarkdown(data, document.URL);
		const contentHtml = feishuToHtml(data);
		const title = cleanTitle(data.title || document.title || '');

		return {
			adapterId: 'feishu',
			author: data.author || '',
			contentHtml,
			contentMarkdown,
			description: 'Feishu document',
			extractedContent: {
				contentMarkdown,
				objToken: data.objToken || '',
				sourceAdapter: 'feishu',
				wikiToken: data.wikiToken || '',
			},
			fullHtml: contentHtml,
			language: 'zh-CN',
			raw: data,
			site: '飞书云文档',
			title,
			wordCount: wordCount(contentMarkdown),
		};
	},
};
