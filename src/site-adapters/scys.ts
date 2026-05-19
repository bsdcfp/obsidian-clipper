import { decompress } from 'lz4js';
import { adapterFetchJson, adapterFetchText } from './fetch';
import { SiteAdapter, SiteAdapterResult } from './types';

const SCYS_DOC_RE = /^\/view\/docx\/([^/?#]+)/;
const SCYS_ARTICLE_RE = /^\/(?:articleDetail|mobile\/post)\/(xq_topic|forum_topic)\/([^/?#]+)/;
const DEFAULT_SCYS_CRYPTO_KEY = 'LJg0DdPiCGYyq9h4';

interface ScysInfoResponse {
	data?: unknown;
	version?: number | string;
	key?: string;
	iv?: string;
}

interface ScysDoc {
	title?: string;
	version?: number | string;
	page?: ScysBlock;
	header?: ScysBlock[];
}

interface ScysTopicResponse {
	success?: boolean;
	status?: number;
	message?: string | null;
	data?: {
		topicDTO?: ScysTopic;
		topicUserDTO?: ScysTopicUser;
	};
}

interface ScysTopic {
	aiSummaryContent?: string;
	articleContent?: string;
	docBlocks?: ScysBlock[];
	entityId?: string;
	entityType?: string;
	gmtCreate?: number;
	imageList?: string[];
	showTitle?: string;
	topicId?: string;
}

interface ScysTopicUser {
	name?: string;
	userId?: string | number;
}

interface ScysBlock {
	block_id?: string;
	block_type?: number;
	children?: string[];
	node?: ScysBlock[];
	heading?: string;
	heading1?: RichTextContainer;
	heading2?: RichTextContainer;
	heading3?: RichTextContainer;
	heading4?: RichTextContainer;
	heading5?: RichTextContainer;
	heading6?: RichTextContainer;
	text?: RichTextContainer;
	bullet?: RichTextContainer;
	ordered?: RichTextContainer;
	page?: RichTextContainer;
	callout?: {
		background_color?: number;
		emoji_id?: string;
	};
	file_url?: string;
	image?: {
		token?: string;
		width?: number;
		height?: number;
	};
	document_id?: string;
}

interface RichTextContainer {
	elements?: RichTextElement[];
}

interface RichTextElement {
	text_run?: {
		content?: string;
		text_element_style?: {
			bold?: boolean;
			inline_code?: boolean;
			italic?: boolean;
			link?: { url?: string };
			strikethrough?: boolean;
			underline?: boolean;
		};
	};
}

function extractDocId(url: URL): string | null {
	return url.pathname.match(SCYS_DOC_RE)?.[1] || null;
}

function extractArticleParams(url: URL): { entityType: string; entityId: string } | null {
	const match = url.pathname.match(SCYS_ARTICLE_RE);
	if (!match) return null;
	return { entityType: match[1], entityId: match[2] };
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (keys.includes(key.toLowerCase()) && (typeof item === 'string' || typeof item === 'number')) {
			return String(item);
		}
		const nested = findStringByKeys(item, keys);
		if (nested) return nested;
	}
	return undefined;
}

function resolveScysCrypto(info: ScysInfoResponse): { version: string; key: string; iv: string } {
	const version = findStringByKeys(info, ['version', 'ver', 'v']);
	const key = findStringByKeys(info, ['key', 'secretkey', 'decryptkey', 'aeskey']) || DEFAULT_SCYS_CRYPTO_KEY;
	const iv = findStringByKeys(info, ['iv', 'aesiv']) || key;

	if (!version) {
		throw new Error('SCYS doc info did not include a version');
	}

	return { version, key, iv };
}

function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input.replace(/\s+/g, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function stringToAesBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value).slice(0, 16);
}

async function decryptAesCbcBase64(input: string, key: string, iv: string): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		stringToAesBytes(key),
		{ name: 'AES-CBC' },
		false,
		['decrypt']
	);
	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-CBC', iv: stringToAesBytes(iv) },
		cryptoKey,
		base64ToBytes(input)
	);
	return new Uint8Array(decrypted);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeMarkdown(value: string): string {
	return value.replace(/\|/g, '\\|');
}

function decodeUrl(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseAttributes(value: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	value.replace(/([\w-]+)="([^"]*)"/g, (_match, key: string, item: string) => {
		attrs[key] = item;
		return '';
	});
	return attrs;
}

function renderScysInlineTags(value: string, format: 'markdown' | 'html'): string {
	const pattern = /<e\s+([^>]*?)\/?>/g;

	if (format === 'html') {
		let output = '';
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(value))) {
			output += escapeHtml(value.slice(lastIndex, match.index));
			const attrs = parseAttributes(match[1]);
			if (attrs.type === 'web' && attrs.href) {
				const href = decodeUrl(attrs.href);
				const title = decodeUrl(attrs.title || href);
				output += `<a href="${escapeHtml(href)}">${escapeHtml(title)}</a>`;
			}
			lastIndex = match.index + match[0].length;
		}
		return output + escapeHtml(value.slice(lastIndex));
	}

	return value.replace(pattern, (_match, rawAttrs: string) => {
		const attrs = parseAttributes(rawAttrs);
		if (attrs.type !== 'web' || !attrs.href) return '';

		const href = decodeUrl(attrs.href);
		const title = decodeUrl(attrs.title || href);
		return `[${escapeMarkdown(title)}](${href})`;
	});
}

function richText(container?: RichTextContainer, format: 'markdown' | 'html' = 'markdown'): string {
	if (!container?.elements?.length) return '';

	return container.elements.map(element => {
		const run = element.text_run;
		if (!run) return '';

		const style = run.text_element_style || {};
		let content = renderScysInlineTags(run.content || '', format);
		if (format === 'html') {
			if (style.inline_code) content = `<code>${content}</code>`;
			if (style.bold) content = `<strong>${content}</strong>`;
			if (style.italic) content = `<em>${content}</em>`;
			if (style.strikethrough) content = `<s>${content}</s>`;
			if (style.link?.url) content = `<a href="${escapeHtml(style.link.url)}">${content}</a>`;
			return content;
		}

		content = escapeMarkdown(content);
		if (style.inline_code) content = `\`${content}\``;
		if (style.bold) content = `**${content}**`;
		if (style.italic) content = `*${content}*`;
		if (style.strikethrough) content = `~~${content}~~`;
		if (style.link?.url) content = `[${content}](${style.link.url})`;
		return content;
	}).join('');
}

function blockText(block: ScysBlock, format: 'markdown' | 'html' = 'markdown'): string {
	const headingKey = block.heading as keyof ScysBlock | undefined;
	if (headingKey && block[headingKey] && typeof block[headingKey] === 'object') {
		return richText(block[headingKey] as RichTextContainer, format);
	}
	for (const key of ['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'] as const) {
		if (block[key]) return richText(block[key], format);
	}
	return richText(block.text || block.bullet || block.ordered || block.page, format);
}

function blockLevel(block: ScysBlock): number {
	const heading = block.heading || (['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'] as const).find(key => block[key]);
	if (!heading) return 0;
	const match = heading.match(/heading(\d)/);
	return match ? Number(match[1]) : 0;
}

function renderMarkdownBlock(block: ScysBlock): string {
	const text = blockText(block, 'markdown').trim();
	const children = (block.node || []).map(renderMarkdownBlock).filter(Boolean).join('\n\n');

	if (block.block_type === 27 && block.file_url) {
		return `![](${block.file_url})`;
	}

	if (block.block_type === 19) {
		const body = children.split('\n').map(line => line ? `> ${line}` : '>').join('\n');
		return [`> [!note] ${block.callout?.emoji_id || ''}`.trim(), body].filter(Boolean).join('\n');
	}

	if (!text && !children) return '';

	const level = blockLevel(block);
	if (level) {
		return [`${'#'.repeat(Math.min(level + 1, 6))} ${text}`, children].filter(Boolean).join('\n\n');
	}

	if (block.block_type === 12) {
		return [`- ${text}`, children].filter(Boolean).join('\n');
	}

	if (block.block_type === 13) {
		return [`1. ${text}`, children].filter(Boolean).join('\n');
	}

	return [text, children].filter(Boolean).join('\n\n');
}

function renderHtmlBlock(block: ScysBlock): string {
	const text = blockText(block, 'html').trim();
	const children = (block.node || []).map(renderHtmlBlock).filter(Boolean).join('');

	if (block.block_type === 27 && block.file_url) {
		return `<figure><img src="${escapeHtml(block.file_url)}" alt=""></figure>`;
	}

	if (block.block_type === 19) {
		return `<blockquote>${children}</blockquote>`;
	}

	if (!text && !children) return '';

	const level = blockLevel(block);
	if (level) {
		const tag = `h${Math.min(level + 1, 6)}`;
		return `<${tag}>${text}</${tag}>${children}`;
	}

	if (block.block_type === 12) {
		return `<ul><li>${text}${children}</li></ul>`;
	}

	if (block.block_type === 13) {
		return `<ol><li>${text}${children}</li></ol>`;
	}

	return `<p>${text}</p>${children}`;
}

function rootBlocks(doc: ScysDoc): ScysBlock[] {
	const nodes = doc.page?.node || [];
	return nodes.filter(block => block.block_id !== doc.page?.block_id);
}

export function docToMarkdown(doc: ScysDoc, sourceUrl: string): string {
	const title = doc.title || 'Untitled';
	const body = rootBlocks(doc).map(renderMarkdownBlock).filter(Boolean).join('\n\n');
	return [
		`# ${title}`,
		`> Source: ${sourceUrl}`,
		doc.version ? `> Version: ${doc.version}` : '',
		body,
	].filter(Boolean).join('\n\n');
}

export function docToHtml(doc: ScysDoc): string {
	const title = escapeHtml(doc.title || 'Untitled');
	const body = rootBlocks(doc).map(renderHtmlBlock).filter(Boolean).join('\n');
	return `<article data-site-adapter="scys"><h1>${title}</h1>${body}</article>`;
}

function wordCount(markdown: string): number {
	const latinWords = markdown.match(/[A-Za-z0-9_]+/g)?.length || 0;
	const cjkChars = markdown.match(/[\u3400-\u9fff]/g)?.length || 0;
	return latinWords + cjkChars;
}

function formatScysTimestamp(timestamp?: number): string {
	if (!timestamp) return '';
	const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
	return new Date(ms).toLocaleString('zh-CN', {
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function renderArticleBody(content: string | undefined, format: 'markdown' | 'html'): string {
	const body = renderScysInlineTags(content || '', format).trim();
	if (!body) return '';
	if (format === 'html') {
		return body.split(/\n{2,}/).map(part => `<p>${part.replace(/\n/g, '<br>')}</p>`).join('\n');
	}
	return body;
}

function groupDocBlocks(blocks: ScysBlock[]): ScysBlock[][] {
	const groups: ScysBlock[][] = [];
	const indexes = new Map<string, number>();

	for (const block of blocks) {
		const key = block.document_id || '__default__';
		let index = indexes.get(key);
		if (index === undefined) {
			index = groups.length;
			indexes.set(key, index);
			groups.push([]);
		}
		groups[index].push(block);
	}

	return groups;
}

export function topicToMarkdown(topic: ScysTopic, user: ScysTopicUser | undefined, sourceUrl: string): string {
	const title = topic.showTitle || 'Untitled';
	const createdAt = formatScysTimestamp(topic.gmtCreate);
	const intro = renderArticleBody(topic.articleContent, 'markdown');
	const documents = groupDocBlocks(topic.docBlocks || [])
		.map(blocks => blocks.map(renderMarkdownBlock).filter(Boolean).join('\n\n'))
		.filter(Boolean);

	return [
		`# ${title}`,
		user?.name ? `> Author: ${user.name}` : '',
		createdAt ? `> Published: ${createdAt}` : '',
		`> Source: ${sourceUrl}`,
		intro,
		...documents,
	].filter(Boolean).join('\n\n');
}

export function topicToHtml(topic: ScysTopic, user?: ScysTopicUser): string {
	const title = escapeHtml(topic.showTitle || 'Untitled');
	const createdAt = formatScysTimestamp(topic.gmtCreate);
	const meta = [user?.name, createdAt].filter((value): value is string => Boolean(value)).map(escapeHtml).join(' · ');
	const intro = renderArticleBody(topic.articleContent, 'html');
	const documents = groupDocBlocks(topic.docBlocks || [])
		.map(blocks => blocks.map(renderHtmlBlock).filter(Boolean).join('\n'))
		.filter(Boolean)
		.map(body => `<section class="scys-doc-blocks">${body}</section>`)
		.join('\n');

	return `<article data-site-adapter="scys-article"><h1>${title}</h1>${meta ? `<p>${meta}</p>` : ''}${intro}${documents}</article>`;
}

async function fetchScysDoc(document: Document, docId: string): Promise<ScysDoc> {
	const info = await adapterFetchJson<ScysInfoResponse>(`https://scys.com/search/docx/${docId}/info`);
	const { version, key, iv } = resolveScysCrypto(info);
	const encrypted = await adapterFetchText(
		`https://search01.shengcaiyoushu.com/upload/doc/${docId}/${docId}.json?v=${encodeURIComponent(version)}`
	);
	const decrypted = await decryptAesCbcBase64(encrypted, key, iv);
	const plain = new TextDecoder().decode(decompress(decrypted));
	const parsed = JSON.parse(plain) as ScysDoc;
	parsed.version = parsed.version || version;
	parsed.title = parsed.title || document.title;
	return parsed;
}

async function fetchScysTopic(entityType: string, entityId: string): Promise<ScysTopicResponse> {
	return adapterFetchJson<ScysTopicResponse>('https://scys.com/shengcai-web/client/homePage/topicDetail', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Device-Type': 'pc',
		},
		body: JSON.stringify({ entityType, entityId }),
	});
}

export const scysAdapter: SiteAdapter = {
	id: 'scys',
	matches(document: Document): boolean {
		const url = new URL(document.URL);
		return url.hostname === 'scys.com' && Boolean(extractDocId(url) || extractArticleParams(url));
	},
	async extract(document: Document): Promise<SiteAdapterResult | null> {
		const url = new URL(document.URL);
		const docId = extractDocId(url);
		const articleParams = extractArticleParams(url);

		if (articleParams) {
			const response = await fetchScysTopic(articleParams.entityType, articleParams.entityId);
			if (!response.success || !response.data?.topicDTO) {
				throw new Error(response.message || 'SCYS topic detail did not include topic data');
			}

			const topic = response.data.topicDTO;
			const contentMarkdown = topicToMarkdown(topic, response.data.topicUserDTO, document.URL);
			const contentHtml = topicToHtml(topic, response.data.topicUserDTO);

			return {
				adapterId: 'scys-article',
				author: response.data.topicUserDTO?.name,
				contentHtml,
				contentMarkdown,
				description: topic.aiSummaryContent || 'SCYS article',
				extractedContent: {
					contentMarkdown,
					entityId: topic.entityId || articleParams.entityId,
					entityType: topic.entityType || articleParams.entityType,
					sourceAdapter: 'scys-article',
				},
				fullHtml: contentHtml,
				language: 'zh-CN',
				raw: response.data,
				site: '生财有术',
				title: topic.showTitle || document.title || 'Untitled',
				wordCount: wordCount(contentMarkdown),
			};
		}

		if (!docId) return null;

		const doc = await fetchScysDoc(document, docId);
		const contentMarkdown = docToMarkdown(doc, document.URL);
		const contentHtml = docToHtml(doc);

		return {
			adapterId: 'scys',
			contentHtml,
			contentMarkdown,
			description: 'SCYS encrypted document',
			extractedContent: {
				contentMarkdown,
				docId,
				sourceAdapter: 'scys',
				version: String(doc.version || ''),
			},
			fullHtml: contentHtml,
			language: 'zh-CN',
			raw: doc,
			site: '生财有术',
			title: doc.title || document.title || 'Untitled',
			wordCount: wordCount(contentMarkdown),
		};
	},
};
