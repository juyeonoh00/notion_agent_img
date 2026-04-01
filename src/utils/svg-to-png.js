/**
 * SVG를 PNG로 변환
 * puppeteer를 사용하여 SVG를 PNG로 렌더링
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

export class SvgToPngConverter {
  async convertSvgToPng(svgPath, pngPath, options = {}) {
    const { width = 1200, height = 800 } = options;

    try {
      // SVG 파일 읽기
      const svgContent = fs.readFileSync(svgPath, 'utf-8');

      // HTML 템플릿 생성
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: transparent;
    }
    svg {
      display: block;
    }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>
`;

      // Puppeteer로 렌더링
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setContent(html);

      // PNG로 스크린샷
      await page.screenshot({
        path: pngPath,
        type: 'png',
        omitBackground: false
      });

      await browser.close();

      console.log(`[SVG→PNG] 변환 완료: ${path.basename(pngPath)}`);

      return { success: true, pngPath };
    } catch (error) {
      console.error(`[SVG→PNG] 변환 실패:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 여러 SVG 파일을 PNG로 일괄 변환
   */
  async convertMultiple(svgFiles, outputDir) {
    const results = [];

    for (const svgPath of svgFiles) {
      const filename = path.basename(svgPath, '.svg') + '.png';
      const pngPath = path.join(outputDir, filename);

      const result = await this.convertSvgToPng(svgPath, pngPath);
      results.push({
        svg: svgPath,
        png: pngPath,
        ...result
      });
    }

    return results;
  }
}
