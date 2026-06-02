import { describe, expect, test } from 'vitest';
import { feishuToHtml, feishuToMarkdown } from './feishu';

describe('feishu adapter rendering', () => {
	test('renders Feishu block snapshots to Markdown and HTML', () => {
		const data = {
			author: 'Adam 天行',
			title: '\u2060一个90后老韭菜的投资稳定盈利模型 - 飞书云文档',
			blocks: [
				{ id: 'a', type: 'text', text: '正文第一段' },
				{ id: 'b', type: 'heading1', text: '我的投资编年史' },
				{ id: 'c', type: 'image', imageUrl: 'https://example.com/image.png' },
				{ id: 'd', depth: 1, type: 'bullet', text: '嵌套要点' },
			],
		};

		const markdown = feishuToMarkdown(data, 'https://my.feishu.cn/wiki/abc');
		expect(markdown).toContain('# 一个90后老韭菜的投资稳定盈利模型');
		expect(markdown).toContain('> Author: Adam 天行');
		expect(markdown).toContain('正文第一段');
		expect(markdown).toContain('## 我的投资编年史');
		expect(markdown).toContain('![](https://example.com/image.png)');
		expect(markdown).toContain('  - 嵌套要点');

		const html = feishuToHtml(data);
		expect(html).toContain('data-site-adapter="feishu"');
		expect(html).toContain('<h2>我的投资编年史</h2>');
		expect(html).toContain('<img src="https://example.com/image.png" alt="">');
	});
});
