import { describe, expect, test } from 'vitest';
import { docToHtml, docToMarkdown, topicToHtml, topicToMarkdown } from './scys';

describe('scys adapter rendering', () => {
	test('renders decrypted SCYS block trees to Markdown and HTML', () => {
		const doc = {
			title: 'Sample Doc',
			version: 123,
			page: {
				block_id: 'root',
				node: [
					{
						block_id: 'root',
						block_type: 1,
						page: {
							elements: [{ text_run: { content: 'Sample Doc', text_element_style: {} } }],
						},
					},
					{
						block_id: 'h1',
						block_type: 3,
						heading: 'heading1',
						heading1: {
							elements: [{ text_run: { content: '正文', text_element_style: {} } }],
						},
					},
					{
						block_id: 'p1',
						block_type: 2,
						text: {
							elements: [
								{ text_run: { content: '打开 ', text_element_style: {} } },
								{
									text_run: {
										content: '链接',
										text_element_style: { bold: true, link: { url: 'https://example.com' } },
									},
								},
							],
						},
					},
					{
						block_id: 'b1',
						block_type: 12,
						bullet: {
							elements: [{ text_run: { content: '列表项', text_element_style: { inline_code: true } } }],
						},
					},
				],
			},
		};

		const markdown = docToMarkdown(doc, 'https://scys.com/view/docx/root');
		expect(markdown).toContain('# Sample Doc');
		expect(markdown).toContain('## 正文');
		expect(markdown).toContain('[**链接**](https://example.com)');
		expect(markdown).toContain('- `列表项`');

		const html = docToHtml(doc);
		expect(html).toContain('data-site-adapter="scys"');
		expect(html).toContain('<h2>正文</h2>');
		expect(html).toContain('<a href="https://example.com"><strong>链接</strong></a>');
	});

	test('renders SCYS article topic blocks to Markdown and HTML', () => {
		const topic = {
			showTitle: '帖子标题',
			gmtCreate: 1778147251,
			articleContent: '请移步飞书<e type="web" href="https%3A%2F%2Fexample.com%2Fdoc" title="完整文档" />',
			docBlocks: [
				{
					block_id: 'p1',
					block_type: 2,
					document_id: 'doc-a',
					text: {
						elements: [{ text_run: { content: '正文第一段', text_element_style: {} } }],
					},
				},
				{
					block_id: 'h1',
					block_type: 3,
					document_id: 'doc-a',
					heading1: {
						elements: [{ text_run: { content: '一级标题', text_element_style: {} } }],
					},
				},
				{
					block_id: 'img1',
					block_type: 27,
					document_id: 'doc-a',
					file_url: 'https://example.com/image.webp',
				},
			],
		};

		const markdown = topicToMarkdown(topic, { name: 'Adam' }, 'https://scys.com/articleDetail/xq_topic/1');
		expect(markdown).toContain('# 帖子标题');
		expect(markdown).toContain('> Author: Adam');
		expect(markdown).toContain('[完整文档](https://example.com/doc)');
		expect(markdown).toContain('## 一级标题');
		expect(markdown).toContain('![](https://example.com/image.webp)');

		const html = topicToHtml(topic, { name: 'Adam' });
		expect(html).toContain('data-site-adapter="scys-article"');
		expect(html).toContain('<a href="https://example.com/doc">完整文档</a>');
		expect(html).toContain('<h2>一级标题</h2>');
		expect(html).toContain('<img src="https://example.com/image.webp" alt="">');
	});
});
